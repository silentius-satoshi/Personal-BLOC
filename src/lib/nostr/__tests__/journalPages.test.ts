// 5b (spec `pbloc-spec-journal-pages-v1`) — the journal's v2 layout, pure: pages by month, the byte budget, the
// fingerprints, the manifest, the readers, and the records:v1 bridge's target. ⚠ SYNTHETIC figures throughout.
import { describe, it, expect } from 'vitest';
import {
  layoutPages, buildJournal, canonicalJson, fingerprint, monthKeyOf, parseV1Records, parseManifest, parsePage,
  unionParts, pagesToFetch, pagesToPublish, relayListing, manifestOf, normRecords, v1BridgeTarget, isV1Stub, V1_STUB,
  journalSizes, utf8Bytes, pageItemCount, JOURNAL_PAGE_BUDGET_BYTES, UNDATED_KEY, type JournalPage, type ManifestPage,
} from '../journalPages';
import { mergeRecords, type RecordsState } from '../../../simulation/mergeRecords';
import type { DayEvent, MonthlyLogEntry } from '../../../simulation/types';

const EMPTY: RecordsState = { entries: [], deletions: {}, dayLog: [], dayLogDeletions: {} };
const ev = (id: string, date: string, ts: number, extra: Record<string, unknown> = {}): DayEvent =>
  ({ id, date, ts, kind: 'draw', amount: 100, ...extra }) as DayEvent;
const entry = (month: number, date: string, updatedAt = 1000 + month): MonthlyLogEntry =>
  ({ month, date, btcBought: 0.01, income: 4000, paydown: 0, strikeBal: 500, strikeLtv: 0.1, loggedAt: 1, updatedAt, expensesActual: 3000 }) as MonthlyLogEntry;
const shuffle = <T,>(xs: T[], seed: number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) % 2147483648; const j = seed % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const pageBytes = (p: JournalPage) => utf8Bytes(JSON.stringify(p));

describe('5b — layout: pages by calendar month', () => {
  it('LAYOUT — monthly entries and day events go to the page of their own month; a date that is not ISO goes to undated', () => {
    const r: RecordsState = {
      ...EMPTY,
      entries: [entry(2, '2026-02-01'), entry(1, '2026-01-01')],
      dayLog: [ev('b', '2026-02-10', 5), ev('a', '2026-01-03', 9), ev('x', 'sometime', 1), ev('c', '2026-02-01', 2)],
    };
    const pages = layoutPages(r);
    expect(pages.map((p) => p.key)).toEqual(['2026-01', '2026-02', UNDATED_KEY]);
    expect(pages[0].entries.map((e) => e.month)).toEqual([1]);
    expect(pages[0].dayLog.map((e) => e.id)).toEqual(['a']);
    expect(pages[1].entries.map((e) => e.month)).toEqual([2]);
    expect(pages[1].dayLog.map((e) => e.id), 'by date, then ts, then id').toEqual(['c', 'b']);
    expect(pages[2].dayLog.map((e) => e.id)).toEqual(['x']);
    expect(monthKeyOf('2026-11')).toBe('2026-11');
    expect(monthKeyOf(undefined)).toBe(UNDATED_KEY);
    expect(monthKeyOf('11/2026')).toBe(UNDATED_KEY);
  });

  it('DETERMINISTIC — any order of the same journal lays out the same pages, with the same fingerprints', async () => {
    const dayLog = Array.from({ length: 60 }, (_, i) => ev(`e${i}`, `2026-0${1 + (i % 3)}-${String(1 + (i % 27)).padStart(2, '0')}`, 100 + (i % 7), { memo: 'm'.repeat(i * 13) }));
    const entries = [entry(1, '2026-01-01'), entry(2, '2026-02-01'), entry(3, '2026-03-01')];
    const base = await buildJournal({ ...EMPTY, entries, dayLog });
    for (const seed of [1, 2, 3, 4, 5]) {
      const shuffled = await buildJournal({ ...EMPTY, entries: shuffle(entries, seed), dayLog: shuffle(dayLog, seed + 10) });
      expect(shuffled.pages.map((p) => [p.page.key, p.h])).toEqual(base.pages.map((p) => [p.page.key, p.h]));
      expect(shuffled.manifestH).toBe(base.manifestH);
    }
  });

  it('DETERMINISTIC TIES — the same id twice (a torn copy) lays out the same whichever comes first', async () => {
    const a = ev('dup', '2026-05-05', 7, { amount: 1 });
    const b = ev('dup', '2026-05-05', 7, { amount: 2 });
    const one = await buildJournal({ ...EMPTY, dayLog: [a, b] });
    const two = await buildJournal({ ...EMPTY, dayLog: [b, a] });
    expect(one.pages[0].h).toBe(two.pages[0].h);
  });
});

describe('5b — layout: the page budget', () => {
  // Equal-size items so the fill is tight: a page holds as many as fit with their commas, never one byte more.
  const month = (n: number, size: number) =>
    Array.from({ length: n }, (_, i) => ev(`id${String(i).padStart(4, '0')}`, '2026-03-15', 1000 + i, { memo: 'x'.repeat(size) }));

  it('SPLIT — a month past the budget continues on .2, .3 …: every page within the budget, greedy, nothing lost or doubled', () => {
    const dayLog = month(400, 250);
    const pages = layoutPages({ ...EMPTY, dayLog });
    const total = utf8Bytes(JSON.stringify(dayLog));
    expect(pages.length, 'the month is several budgets long').toBeGreaterThanOrEqual(Math.ceil(total / JOURNAL_PAGE_BUDGET_BYTES));
    expect(pages.map((p) => p.key)).toEqual(['2026-03', ...Array.from({ length: pages.length - 1 }, (_, i) => `2026-03.${i + 2}`)]);
    for (const p of pages) expect(pageBytes(p), `${p.key} within the budget`).toBeLessThanOrEqual(JOURNAL_PAGE_BUDGET_BYTES);
    for (let i = 0; i < pages.length - 1; i++) {
      // greedy: the next page's first item, with its comma, would not have fit
      const grown = { ...pages[i], dayLog: [...pages[i].dayLog, pages[i + 1].dayLog[0]] };
      expect(pageBytes(grown), `${pages[i].key} is full`).toBeGreaterThan(JOURNAL_PAGE_BUDGET_BYTES);
    }
    const ids = pages.flatMap((p) => p.dayLog.map((e) => e.id));
    expect(ids).toEqual(dayLog.map((e) => e.id));
  });

  it('SPLIT tight — the commas count: 300 items of exactly 327 B fill each page with 99, never the 100th', () => {
    // The empty page {"v":2,"key":"2026-03","entries":[],"dayLog":[]} is 48 B; 99 items and their 98 commas make 32,519 B;
    // a 100th makes 32,847 B — past the budget by its commas alone (100 × 327 + 48 = 32,748 B fits without them).
    const base = utf8Bytes(JSON.stringify(ev('id0000', '2026-03-15', 1000, { memo: '' })));
    const dayLog = Array.from({ length: 300 }, (_, i) => ev(`id${String(i).padStart(4, '0')}`, '2026-03-15', 1000 + i, { memo: 'x'.repeat(327 - base) }));
    expect(dayLog.every((e) => utf8Bytes(JSON.stringify(e)) === 327), 'premise: every item is 327 B').toBe(true);
    expect(utf8Bytes(JSON.stringify({ v: 2, key: '2026-03', entries: [], dayLog: [] })), 'premise: the empty page').toBe(48);
    const pages = layoutPages({ ...EMPTY, dayLog });
    expect(pages.map((p) => p.dayLog.length), 'COMMAS').toEqual([99, 99, 99, 3]);
    for (const p of pages) expect(pageBytes(p)).toBeLessThanOrEqual(JOURNAL_PAGE_BUDGET_BYTES);
  });

  it('OVERSIZE — an item past the budget gets a page of its own, and the month continues after it', () => {
    const dayLog = [ev('a', '2026-04-01', 1), ev('big', '2026-04-02', 2, { memo: 'x'.repeat(JOURNAL_PAGE_BUDGET_BYTES) }), ev('c', '2026-04-03', 3)];
    const pages = layoutPages({ ...EMPTY, dayLog });
    expect(pages.map((p) => p.dayLog.map((e) => e.id))).toEqual([['a'], ['big'], ['c']]);
    expect(pages.map((p) => p.key)).toEqual(['2026-04', '2026-04.2', '2026-04.3']);
  });
});

describe('5b — fingerprints and the manifest', () => {
  it('CANONICAL — the fingerprint ignores key order at every level, drops undefined fields, and changes with any value', async () => {
    const a = { v: 2, key: 'k', entries: [], dayLog: [{ id: 'x', ts: 1, reading: { strikeBal: 5, strikeLtv: 0.1 } }] };
    const b = { dayLog: [{ reading: { strikeLtv: 0.1, strikeBal: 5 }, ts: 1, id: 'x', extra: undefined }], entries: [], key: 'k', v: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(await fingerprint(a)).toBe(await fingerprint(b));
    expect(await fingerprint({ ...a, key: 'k2' })).not.toBe(await fingerprint(a));
    expect(await fingerprint(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('BUILD — the manifest lists every page with its item count and fingerprint, and carries the tombstones sorted', async () => {
    const r: RecordsState = {
      entries: [entry(1, '2026-01-01')], deletions: { 7: 50, 3: 40 } as Record<number, number>,
      dayLog: [ev('a', '2026-01-02', 1), ev('b', '2026-02-02', 2)], dayLogDeletions: { z: 9, m: 8 },
    };
    const built = await buildJournal(r);
    expect(built.manifest.pages).toEqual(Object.fromEntries(built.pages.map((p) => [p.page.key, { n: pageItemCount(p.page), h: p.h }])));
    expect(built.manifest.pages['2026-01'].n).toBe(2);
    expect(Object.keys(built.manifest.deletions)).toEqual(['3', '7']);
    expect(Object.keys(built.manifest.dayLogDeletions)).toEqual(['m', 'z']);
    expect(built.manifestH).toBe(await fingerprint(built.manifest));
    expect(built.manifestBytes).toBe(utf8Bytes(JSON.stringify(built.manifest)));
  });

  it('SIZES — DevPanel\'s synchronous sizes match the built journal byte for byte', async () => {
    const r: RecordsState = { ...EMPTY, entries: [entry(1, '2026-01-01')], dayLog: [ev('a', '2026-01-02', 1, { memo: 'y'.repeat(900) }), ev('b', '2026-02-02', 2)], dayLogDeletions: { q: 1 } };
    const built = await buildJournal(r);
    const sizes = journalSizes(r);
    expect(sizes.pages).toBe(built.pages.length);
    expect(sizes.largestBytes).toBe(Math.max(...built.pages.map((p) => p.bytes)));
    expect(sizes.largestKey).toBe('2026-01');
    expect(sizes.manifestBytes).toBe(built.manifestBytes);
    expect(sizes.v1Bytes).toBe(utf8Bytes(JSON.stringify({ entries: r.entries, deletions: r.deletions, dayLog: r.dayLog, dayLogDeletions: r.dayLogDeletions })));
  });
});

describe('5b — reading what the relays hold', () => {
  it('V1 — every form records:v1 has had: a bare array, a pre-P3 object, a P3 object; anything else reads as empty', () => {
    expect(parseV1Records([entry(1, '2026-01-01')]).entries).toHaveLength(1);
    expect(parseV1Records({ entries: [entry(1, '2026-01-01')], deletions: { 2: 5 } })).toEqual({ entries: [entry(1, '2026-01-01')], deletions: { 2: 5 }, dayLog: [], dayLogDeletions: {} });
    expect(parseV1Records({ entries: [], deletions: {}, dayLog: [ev('a', '2026-01-01', 1)], dayLogDeletions: { b: 2, bad: 'x' } }).dayLogDeletions).toEqual({ b: 2 });
    expect(parseV1Records(null)).toEqual(EMPTY);
    expect(parseV1Records('nope')).toEqual(EMPTY);
    expect(parseV1Records(V1_STUB), 'the stub carries no journal').toEqual(EMPTY);
    expect(isV1Stub(V1_STUB)).toBe(true);
    expect(isV1Stub({ entries: [] })).toBe(false);
  });

  it('MANIFEST and PAGE — a foreign or corrupt payload reads as null, never trusted', () => {
    expect(parseManifest({ v: 1, pages: {} })).toBeNull();
    expect(parseManifest({ v: 2 })).toBeNull();
    expect(parseManifest({ v: 2, pages: { '2026-01': { n: 1, h: 'ab' }, bad: { n: 'x' } }, deletions: { 1: 2 } }))
      .toEqual({ v: 2, pages: { '2026-01': { n: 1, h: 'ab' } }, deletions: { 1: 2 }, dayLogDeletions: {} });
    const page = { v: 2, key: '2026-01', entries: [], dayLog: [] };
    expect(parsePage(page, '2026-01')).toEqual(page);
    expect(parsePage(page, '2026-02'), 'a page on the wrong d-tag').toBeNull();
    expect(parsePage({ ...page, v: 3 }, '2026-01')).toBeNull();
    expect(parsePage({ ...page, dayLog: {} }, '2026-01')).toBeNull();
  });

  it('UNION — an item on two pages (a torn read) resolves by its own clock, whichever page is read first', () => {
    const older = { ...EMPTY, dayLog: [ev('moved', '2026-01-05', 10)] };
    const newer = { ...EMPTY, dayLog: [ev('moved', '2026-02-05', 20)] };
    const tomb = { ...EMPTY, dayLogDeletions: { gone: Date.now() } };
    const withGone = { ...EMPTY, dayLog: [ev('gone', '2026-01-01', 5)] };
    for (const parts of [[older, newer, tomb, withGone], [withGone, newer, tomb, older], [tomb, withGone, older, newer]]) {
      const u = unionParts(parts);   // the newest copy of each id and the newest tombstone — the tombstones not yet applied
      expect(u.dayLog.map((e) => [e.id, e.ts]).sort()).toEqual([['gone', 5], ['moved', 20]]);
      expect(Object.keys(u.dayLogDeletions)).toEqual(['gone']);
      // …which the one merge into a device's journal applies: the tombstone wins over the older copy.
      expect(mergeRecords(EMPTY, u, { preferLocalOnTie: false }).dayLog.map((e) => [e.id, e.ts])).toEqual([['moved', 20]]);
    }
  });
});

describe('5b — the union is the fold', () => {
  it('UNION ≡ FOLD — 2,000 random sets of parts: one merge gives what folding them through mergeRecords gives; AGED — where the two part, deleted stays deleted, as before 5b', () => {
    // Ties on ts and on updatedAt, the same id on several parts, tombstones older and newer than the copies, tombstones
    // past the 90-day TTL (present, but these sets never reach the case where one decides — AGED below pins it), monthly
    // entries with and without updatedAt.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (n: number) => Math.floor(rnd() * n);
    const now = Date.now();
    const clock = () => now - pick(6) * 1_000 - (rnd() < 0.1 ? 100 * 86_400_000 : 0);   // a few clocks, so ties are common
    let ties = 0, suppressed = 0, aged = 0;
    for (let n = 0; n < 2_000; n++) {
      const parts: RecordsState[] = Array.from({ length: 1 + pick(4) }, () => ({
        entries: Array.from({ length: pick(3) }, () => {
          const t = clock();
          return { ...entry(1 + pick(3), '2026-01-01'), loggedAt: t, updatedAt: rnd() < 0.3 ? undefined : t, income: pick(9) } as MonthlyLogEntry;
        }),
        deletions: rnd() < 0.3 ? { [1 + pick(3)]: clock() } as Record<number, number> : {},
        dayLog: Array.from({ length: pick(4) }, () => ev(`e${pick(4)}`, '2026-01-02', clock(), { amount: pick(9) })),
        dayLogDeletions: rnd() < 0.3 ? { [`e${pick(4)}`]: clock() } : {},
      }));
      const fold = parts.reduce((acc, part) => mergeRecords(acc, part, { preferLocalOnTie: false }), EMPTY);
      expect(mergeRecords(EMPTY, unionParts(parts), { preferLocalOnTie: false }), `parts #${n}`).toEqual(fold);
      const all = parts.flatMap((p) => p.dayLog);
      if (all.some((a, i) => all.some((b, j) => i !== j && a.id === b.id && a.ts === b.ts && (a as any).amount !== (b as any).amount))) ties++;
      if (Object.keys(fold.dayLogDeletions).length) suppressed++;
      if (parts.some((p) => Object.values(p.dayLogDeletions).some((d) => d < now - 90 * 86_400_000))) aged++;
    }
    expect(ties, 'non-vacuous: same-ts copies that differ').toBeGreaterThan(50);
    expect(suppressed, 'non-vacuous: tombstones that win').toBeGreaterThan(100);
    expect(aged, 'non-vacuous: tombstones past the TTL').toBeGreaterThan(20);

    // AGED — where the two part: a tombstone past the 90-day TTL, then an older copy on a later part (an old page the
    // deletion never reached). The fold GCs the tombstone at its own step and lets the copy back. The union leaves the
    // tombstones to the ONE merge into the device's journal, which applies them and the TTL once — as the single merge of
    // records:v1 did before 5b. So deleted stays deleted: in the relays' journal, and on a device still holding an older copy.
    const old = now - 100 * 86_400_000;
    const tombs: RecordsState = { ...EMPTY, deletions: { 2: old } as Record<number, number>, dayLogDeletions: { e0: old } };
    const copies: RecordsState = { ...EMPTY, entries: [{ ...entry(2, '2026-02-01'), loggedAt: old - 4_000, updatedAt: old - 4_000 }], dayLog: [ev('e0', '2026-02-02', old - 4_000)] };
    const foldOf = (ps: RecordsState[]) => ps.reduce((acc, part) => mergeRecords(acc, part, { preferLocalOnTie: false }), EMPTY);
    const before5b = (local: RecordsState) => mergeRecords(local, { ...tombs, entries: copies.entries, dayLog: copies.dayLog }, { preferLocalOnTie: false });
    expect([foldOf([tombs, copies]).entries.length, foldOf([tombs, copies]).dayLog.length], 'AGED: the fold brings both back').toEqual([1, 1]);
    expect([before5b(EMPTY), before5b(copies)], 'AGED: before 5b, one merge deletes both').toEqual([EMPTY, EMPTY]);
    for (const parts of [[tombs, copies], [copies, tombs]]) {
      expect(mergeRecords(EMPTY, unionParts(parts), { preferLocalOnTie: false }), 'AGED: the relays\' journal keeps both deleted').toEqual(EMPTY);
      expect(mergeRecords(copies, unionParts(parts), { preferLocalOnTie: false }), 'AGED: a device holding the older copies loses them, as before 5b').toEqual(EMPTY);
    }
    expect(foldOf([copies, tombs]), 'AGED, the other order: the fold deletes them too').toEqual(EMPTY);
  });
});

describe('5b — what to fetch, what to publish, what the manifest lists', () => {
  const r: RecordsState = { ...EMPTY, dayLog: [ev('a', '2026-01-02', 1), ev('b', '2026-02-02', 2), ev('c', '2026-03-02', 3)] };

  it('FETCH — only the listed pages whose fingerprint differs or that this device lacks; every listed page on a full check', async () => {
    const local = await buildJournal(r);
    const manifest = manifestOf({
      '2026-01': local.manifest.pages['2026-01'],                  // the same
      '2026-02': { n: 2, h: 'ffffffffffffffff' },                  // changed elsewhere
      '2026-04': { n: 1, h: 'eeeeeeeeeeeeeeee' },                  // a month this device lacks
    }, EMPTY);
    expect(pagesToFetch(local, manifest, false)).toEqual(['2026-02', '2026-04']);
    expect(pagesToFetch(local, manifest, true)).toEqual(['2026-01', '2026-02', '2026-04']);
    expect(pagesToFetch(local, null, true)).toEqual([]);
  });

  it('PUBLISH — only the pages whose copy on the relays differs', async () => {
    const local = await buildJournal(r);
    const relay = new Map<string, ManifestPage>([['2026-01', local.manifest.pages['2026-01']], ['2026-02', { n: 1, h: '0000000000000000' }]]);
    expect(pagesToPublish(local, relay).map((p) => p.page.key)).toEqual(['2026-02', '2026-03']);
  });

  it('LISTING — the relays\' copies: a page not on the relays is not listed; a listed page this device could not read is carried', async () => {
    const local = await buildJournal(r);
    const relay = new Map<string, ManifestPage>([['2026-01', local.manifest.pages['2026-01']], ['2026-02', { n: 9, h: 'aaaaaaaaaaaaaaaa' }]]);
    const unreadable = new Map<string, ManifestPage>([['2025-12', { n: 4, h: 'bbbbbbbbbbbbbbbb' }], ['2026-01', { n: 1, h: 'cccccccccccccccc' }]]);
    expect(relayListing(local, relay, unreadable)).toEqual({
      '2026-01': local.manifest.pages['2026-01'],    // the relays' copy wins over a carried listing of the same key
      '2026-02': { n: 9, h: 'aaaaaaaaaaaaaaaa' },    // an older copy on the relays stays listed until this device's copy lands
      '2025-12': { n: 4, h: 'bbbbbbbbbbbbbbbb' },    // carried: never dropped by a device that never saw it
    });                                              // 2026-03: not on the relays yet → not listed
  });
});

describe('5b — the records:v1 bridge', () => {
  it('TARGET — the whole journal (a fingerprint of its content, any order) while it fits; the stub one byte past the limit', async () => {
    const r: RecordsState = { ...EMPTY, entries: [entry(1, '2026-01-01'), entry(2, '2026-02-01')], dayLog: [ev('a', '2026-01-02', 1), ev('b', '2026-02-02', 2)] };
    const reordered: RecordsState = { ...r, entries: [...r.entries].reverse(), dayLog: [...r.dayLog].reverse() };
    const bytes = utf8Bytes(JSON.stringify({ entries: r.entries, deletions: r.deletions, dayLog: r.dayLog, dayLogDeletions: r.dayLogDeletions }));
    const full = await v1BridgeTarget(r, bytes);
    expect(full).toBe(await fingerprint(normRecords(r)));
    expect(await v1BridgeTarget(reordered, bytes)).toBe(full);
    expect(await v1BridgeTarget(r, bytes - 1)).toBe('stub');
  });
});
