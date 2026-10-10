// 5b (spec `pbloc-spec-journal-pages-v1`) — the journal's sync layout: monthly pages plus a manifest.
// records:v1 sends the WHOLE journal as ONE NIP-44 event, and the journal only grows: past 40,960 B of plain JSON that
// event goes out at ~66 KB, over a 64 KiB relay limit (strfry's default `maxEventSize`), and the journal stops syncing.
// v2 splits it. Every calendar month is its own replaceable event (a page; a month past the byte budget continues on a
// second page), and a small manifest lists every page — its item count and a fingerprint — and carries the deletion
// tombstones. The manifest is the completeness oracle (a device can tell which pages exist and which it lacks) and the
// commit marker (it is published after the pages). The suite's own pattern: BitBooks' paged journal (master spec D6).
// Pure, apart from SHA-256 (WebCrypto, async). The merge is mergeRecords, unchanged — pages carry no new semantics.
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';
import { entryTs, type RecordsState } from '../../simulation/mergeRecords';

export const JOURNAL_V2_PREFIX     = 'personal-bloc:records:v2:';
export const JOURNAL_MANIFEST_DTAG = `${JOURNAL_V2_PREFIX}manifest`;
/** A page's payload stays at or under one full NIP-44 padding step below 40,960 B (5a's plan budget), so a page pads to
 *  at most 32,768 B and goes out near 44 KB. A month at a log a day is about 12 KB — one page. */
export const JOURNAL_PAGE_BUDGET_BYTES = 32_768;
/** The page for an item whose `date` isn't an ISO date — nothing is ever dropped for its date. */
export const UNDATED_KEY = 'undated';

export const pageDTag = (key: string): string => `${JOURNAL_V2_PREFIX}${key}`;
export const isJournalPageDTag = (dTag: string): boolean =>
  dTag.startsWith(JOURNAL_V2_PREFIX) && dTag !== JOURNAL_MANIFEST_DTAG;

export interface JournalPage {
  v:       2;
  key:     string;              // 'YYYY-MM', 'YYYY-MM.2' …, or 'undated'
  entries: MonthlyLogEntry[];   // the monthly entries whose `date` falls in the month
  dayLog:  DayEvent[];          // the day events whose `date` falls in the month
}
export interface ManifestPage { n: number; h: string }
export interface JournalManifest {
  v:               2;
  pages:           Record<string, ManifestPage>;   // every page, by key: its item count and fingerprint
  deletions:       Record<string, number>;         // the monthly-entry tombstones (month → deletedAt), as on records:v1
  dayLogDeletions: Record<string, number>;         // the day-event tombstones (id → deletedAt), as on records:v1
}

const enc = new TextEncoder();
export const utf8Bytes = (s: string): number => enc.encode(s).length;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 'YYYY-MM' from a date that starts 'YYYY-MM' ('YYYY-MM-DD…'; the month isn't range-checked); anything else is undated. */
export function monthKeyOf(date: unknown): string {
  return typeof date === 'string' && /^\d{4}-\d{2}(-|$)/.test(date) ? date.slice(0, 7) : UNDATED_KEY;
}

const pageKey = (month: string, n: number): string => (n === 1 ? month : `${month}.${n}`);
const newPage = (key: string): JournalPage => ({ v: 2, key, entries: [], dayLog: [] });

/**
 * The pages a journal splits into, in key order: by calendar month — a monthly entry by its `date`, a day event by its
 * `date` — and a month past the budget continues on 'YYYY-MM.2', '.3' …. Within a month the items go in a fixed order
 * (monthly entries by month, then day events by date, ts and id), so every device lays out the same pages from the same
 * journal (a tie — the same month or id twice — falls back to the item's canonical JSON). A single item bigger than the
 * budget gets a page of its own (past NIP-44's 40,960 B step, the publish guard refuses that page, visibly). Tombstones
 * are not on pages: they ride the manifest.
 */
export function layoutPages(r: Pick<RecordsState, 'entries' | 'dayLog'>): JournalPage[] {
  const byMonth = new Map<string, { entries: MonthlyLogEntry[]; dayLog: DayEvent[] }>();
  const slot = (k: string) => {
    let s = byMonth.get(k);
    if (!s) byMonth.set(k, (s = { entries: [], dayLog: [] }));
    return s;
  };
  for (const e of r.entries) slot(monthKeyOf(e.date)).entries.push(e);
  for (const e of r.dayLog) slot(monthKeyOf(e.date)).dayLog.push(e);

  const pages: JournalPage[] = [];
  for (const month of [...byMonth.keys()].sort(cmp)) {
    const s = byMonth.get(month)!;
    const items: ['entries' | 'dayLog', MonthlyLogEntry | DayEvent][] = [
      ...[...s.entries].sort((a, b) => (a.month - b.month) || cmp(canonicalJson(a), canonicalJson(b)))
        .map((e) => ['entries', e] as ['entries', MonthlyLogEntry]),
      ...[...s.dayLog].sort((a, b) => cmp(a.date, b.date) || (a.ts - b.ts) || cmp(a.id, b.id) || cmp(canonicalJson(a), canonicalJson(b)))
        .map((e) => ['dayLog', e] as ['dayLog', DayEvent]),
    ];
    let n = 1;
    let page = newPage(pageKey(month, n));
    let bytes = utf8Bytes(JSON.stringify(page));
    for (const [list, item] of items) {
      const b = utf8Bytes(JSON.stringify(item)) + (page[list].length ? 1 : 0);   // the item, and its comma
      if (page.entries.length + page.dayLog.length > 0 && bytes + b > JOURNAL_PAGE_BUDGET_BYTES) {
        pages.push(page);
        page = newPage(pageKey(month, ++n));
        bytes = utf8Bytes(JSON.stringify(page));
        (page[list] as unknown[]).push(item);
        bytes += utf8Bytes(JSON.stringify(item));
      } else {
        (page[list] as unknown[]).push(item);
        bytes += b;
      }
    }
    pages.push(page);
  }
  return pages;
}

/** JSON with object keys sorted at every level — the same text for the same content, whatever order an item's keys
 *  were built or parsed in. Undefined fields are dropped, as JSON.stringify drops them. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** A fingerprint: the first 16 hex digits (64 bits) of SHA-256 over the canonical JSON. It answers "is this the same
 *  page?" — never an integrity proof (each event's signature and NIP-44's MAC are that). */
export async function fingerprint(v: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(canonicalJson(v)));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BuiltPage { page: JournalPage; h: string; bytes: number }
export interface BuiltJournal { pages: BuiltPage[]; manifest: JournalManifest; manifestH: string; manifestBytes: number }

const sortedMap = (m: Record<string | number, number>): Record<string, number> =>
  Object.fromEntries(Object.keys(m).sort(cmp).map((k) => [k, (m as Record<string, number>)[k]]));

export const pageItemCount = (p: JournalPage): number => p.entries.length + p.dayLog.length;

/** A manifest: the given page listing (keys sorted) and the journal's tombstones (keys sorted). */
export function manifestOf(listing: Record<string, ManifestPage>, r: Pick<RecordsState, 'deletions' | 'dayLogDeletions'>): JournalManifest {
  return {
    v: 2,
    pages: Object.fromEntries(Object.keys(listing).sort(cmp).map((k) => [k, listing[k]])),
    deletions: sortedMap(r.deletions),
    dayLogDeletions: sortedMap(r.dayLogDeletions),
  };
}

/** The journal as v2 lays it out: its pages, each with its fingerprint and plain size, and the manifest that lists
 *  them all (what the relays would hold once every page is published). */
export async function buildJournal(r: RecordsState): Promise<BuiltJournal> {
  const pages = await Promise.all(layoutPages(r).map(async (page) => ({
    page, h: await fingerprint(page), bytes: utf8Bytes(JSON.stringify(page)),
  })));
  const manifest = manifestOf(Object.fromEntries(pages.map((p) => [p.page.key, { n: pageItemCount(p.page), h: p.h }])), r);
  return { pages, manifest, manifestH: await fingerprint(manifest), manifestBytes: utf8Bytes(JSON.stringify(manifest)) };
}

/** The listing a manifest published now would carry: each of this journal's pages at the copy the relays hold (a page
 *  not yet published, or refused, is listed only if the relays hold an older copy), and the listed pages this device
 *  could not read — so a device never drops a page it never saw. */
export function relayListing(
  local: BuiltJournal,
  relayPages: ReadonlyMap<string, ManifestPage>,
  unreadable: ReadonlyMap<string, ManifestPage>,
): Record<string, ManifestPage> {
  const listing: Record<string, ManifestPage> = {};
  for (const p of local.pages) {
    const held = relayPages.get(p.page.key);
    if (held) listing[p.page.key] = held;
  }
  for (const [k, mp] of unreadable) if (!(k in listing)) listing[k] = mp;
  return listing;
}

// ── Reading what the relays hold ──

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const numMap = (v: unknown): Record<string, number> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')) as Record<string, number> : {};

/** records:v1, every form it has had: a legacy bare array of entries; an object without the journal (pre-P3). */
export function parseV1Records(data: unknown): RecordsState {
  if (Array.isArray(data)) return { entries: data as MonthlyLogEntry[], deletions: {}, dayLog: [], dayLogDeletions: {} };
  const o = isObj(data) ? data : {};
  return {
    entries:         (Array.isArray(o.entries) ? o.entries : []) as MonthlyLogEntry[],
    deletions:       numMap(o.deletions),
    dayLog:          (Array.isArray(o.dayLog) ? o.dayLog : []) as DayEvent[],
    dayLogDeletions: numMap(o.dayLogDeletions),
  };
}

/** A manifest, or null for anything else (a foreign or corrupt payload is skipped, never trusted). */
export function parseManifest(data: unknown): JournalManifest | null {
  if (!isObj(data) || data.v !== 2 || !isObj(data.pages)) return null;
  const pages: Record<string, ManifestPage> = {};
  for (const [k, p] of Object.entries(data.pages)) {
    if (isObj(p) && typeof p.n === 'number' && typeof p.h === 'string') pages[k] = { n: p.n, h: p.h };
  }
  return { v: 2, pages, deletions: numMap(data.deletions), dayLogDeletions: numMap(data.dayLogDeletions) };
}

/** A page, or null — its key must match the d-tag it came on. */
export function parsePage(data: unknown, key: string): JournalPage | null {
  if (!isObj(data) || data.v !== 2 || data.key !== key || !Array.isArray(data.entries) || !Array.isArray(data.dayLog)) return null;
  return { v: 2, key, entries: data.entries as MonthlyLogEntry[], dayLog: data.dayLog as DayEvent[] };
}

export const EMPTY_RECORDS: RecordsState = { entries: [], deletions: {}, dayLog: [], dayLogDeletions: {} };
export const pageAsRecords = (p: JournalPage): RecordsState =>
  ({ entries: p.entries, deletions: {}, dayLog: p.dayLog, dayLogDeletions: {} });
export const manifestAsRecords = (m: JournalManifest): RecordsState =>
  ({ entries: [], deletions: m.deletions as unknown as Record<number, number>, dayLog: [], dayLogDeletions: m.dayLogDeletions });

/**
 * Everything the relays hold, as ONE records state for pullJournal's single mergeRecords into this device's journal —
 * as records:v1 was before 5b. Each id's and each month's winning copy is picked by the fold's own rules (the newer copy;
 * on a tie the earlier part's day event and the later part's entry; within a part, the first copy), so an item on two
 * pages (a torn read, mid-publish) resolves by its own clock, never by which page came first; each tombstone is kept at
 * its newest. The tombstones are NOT applied here: that one merge applies them and the TTL — so a tombstone past the TTL
 * that the relays still carry deletes this device's older copy, as before 5b (applying them here would GC it first).
 * mergeRecords(EMPTY, unionParts(parts)) is what folding the parts through mergeRecords one at a time gives, in one merge
 * (the fold costs parts × n² through mergeRecords' lookups: 285 ms for three years of daily logs) — except where the
 * fold's step-by-step GC lets an older copy back. Pinned by UNION ≡ FOLD · AGED.
 */
export function unionParts(parts: RecordsState[]): RecordsState {
  const dayLog = new Map<string, DayEvent>();
  const entries = new Map<number, MonthlyLogEntry>();
  const deletions: Record<string, number> = {};
  const dayLogDeletions: Record<string, number> = {};
  for (const part of parts) {
    // Within one part only an id's (a month's) FIRST copy counts — mergeRecords reads a state with find().
    const ids = new Set<string>();
    const months = new Set<number>();
    for (const e of part.dayLog) {
      if (ids.has(e.id)) continue;
      ids.add(e.id);
      const cur = dayLog.get(e.id);
      if (!cur || e.ts > cur.ts) dayLog.set(e.id, e);
    }
    for (const e of part.entries) {
      if (months.has(e.month)) continue;
      months.add(e.month);
      const cur = entries.get(e.month);
      if (!cur || entryTs(e) >= entryTs(cur)) entries.set(e.month, e);
    }
    for (const [k, d] of Object.entries(part.deletions)) deletions[k] = Math.max(deletions[k] ?? 0, d);
    for (const [k, d] of Object.entries(part.dayLogDeletions)) dayLogDeletions[k] = Math.max(dayLogDeletions[k] ?? 0, d);
  }
  return {
    entries: [...entries.values()], deletions: deletions as unknown as Record<number, number>,
    dayLog: [...dayLog.values()], dayLogDeletions,
  };
}

/** The pages to fetch: every page the manifest lists whose fingerprint differs from this device's page of that key, or
 *  that this device doesn't have. `full` fetches them all — the session's first pull checks every page is still there. */
export function pagesToFetch(local: BuiltJournal, manifest: JournalManifest | null, full: boolean): string[] {
  if (!manifest) return [];
  const mine = new Map(local.pages.map((p) => [p.page.key, p.h]));
  return Object.keys(manifest.pages).sort(cmp).filter((k) => full || mine.get(k) !== manifest.pages[k].h);
}

/** The pages to publish: every page whose fingerprint differs from the copy the relays are known to hold. */
export function pagesToPublish(local: BuiltJournal, relayPages: ReadonlyMap<string, ManifestPage>): BuiltPage[] {
  return local.pages.filter((p) => relayPages.get(p.page.key)?.h !== p.h);
}

/** A canonical form of a records state, for "are these the same journal?" — entries by month, day events by id, both
 *  tombstone maps by key (moved from sync.ts, unchanged). */
export function normRecords(r: RecordsState): string {
  return JSON.stringify({
    e:   [...r.entries].sort((a, b) => a.month - b.month),
    d:   sortedMap(r.deletions),
    dl:  [...r.dayLog].sort((a, b) => cmp(a.id, b.id)),
    dld: sortedMap(r.dayLogDeletions),
  });
}

// ── The records:v1 bridge ──

/** What records:v1 carries once the journal is past NIP-44's step: no journal — a pre-5b app merges nothing from it
 *  and keeps what it has — and where the journal went. Small, so no relay refuses it. A frozen full copy would be worse:
 *  read forever, it would bring back an entry deleted after it froze, once that deletion's tombstone aged out (90 days). */
export const V1_STUB = { entries: [], deletions: {}, dayLog: [], dayLogDeletions: {}, movedTo: JOURNAL_MANIFEST_DTAG } as const;
export const isV1Stub = (data: unknown): boolean => isObj(data) && data.movedTo === JOURNAL_MANIFEST_DTAG;

/** The journal as records:v1 sends it — the store's four collections, unchanged. */
export const v1Payload = (r: RecordsState) =>
  ({ entries: r.entries, deletions: r.deletions, dayLog: r.dayLog, dayLogDeletions: r.dayLogDeletions });

/** What the v1 bridge should hold: the whole journal while its plain JSON is within `limitBytes` (NIP-44's step — the
 *  caller passes PLAIN_STEP_BYTES), as a fingerprint of its content in any order; past it, 'stub'. */
export async function v1BridgeTarget(r: RecordsState, limitBytes: number): Promise<string> {
  return utf8Bytes(JSON.stringify(v1Payload(r))) <= limitBytes ? fingerprint(normRecords(r)) : 'stub';
}

// ── Sizes, for DevPanel (synchronous: no fingerprints — a fingerprint is always 16 hex digits) ──

export interface JournalSizes {
  pages:         number;
  largestKey:    string | null;
  largestBytes:  number;   // the largest page's plain JSON
  manifestBytes: number;   // the manifest's plain JSON
  v1Bytes:       number;   // the whole journal as records:v1 would send it
}
export function journalSizes(r: RecordsState): JournalSizes {
  const pages = layoutPages(r);
  let largestKey: string | null = null;
  let largestBytes = 0;
  for (const p of pages) {
    const b = utf8Bytes(JSON.stringify(p));
    if (b > largestBytes) { largestBytes = b; largestKey = p.key; }
  }
  const manifest = manifestOf(Object.fromEntries(pages.map((p) => [p.key, { n: pageItemCount(p), h: '0'.repeat(16) }])), r);
  return { pages: pages.length, largestKey, largestBytes, manifestBytes: utf8Bytes(JSON.stringify(manifest)), v1Bytes: utf8Bytes(JSON.stringify(v1Payload(r))) };
}
