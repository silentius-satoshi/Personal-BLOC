import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { publishRecordsNowImmediate, publishPlanEventsNow } from './syncEngine';
import { FALLBACK_RELAYS, RECORDS_DTAG, PLAN_EVENTS_DTAG, PREFS_DTAG } from './publish';
import { withTimeout, signerOpTimeout } from './timeout';
import { nostrLog } from './log';
import { mergeRecords, type RecordsState } from '../../simulation/mergeRecords';
import { unionPlanEvents, foldPlanEvents } from '../planEvents/fold';
import type { PlanEvent } from '../planEvents/types';
import { isBackupGateSatisfied } from '../backupGate';
import { PLAIN_STEP_BYTES } from './payloadSize';
import {
  JOURNAL_MANIFEST_DTAG, JOURNAL_V2_PREFIX, pageDTag, buildJournal, pagesToFetch, pagesToPublish, relayListing,
  manifestOf, fingerprint, normRecords, parseV1Records, parseManifest, parsePage, isV1Stub, pageAsRecords,
  manifestAsRecords, unionParts, v1BridgeTarget, pageItemCount, utf8Bytes, type JournalManifest, type JournalPage, type BuiltJournal,
} from './journalPages';
import { journalKnown, inJournalLane, type JournalKnown } from './journalState';
import { recordPlanPull, errorName } from './planLoad';

// Structural subset of a nostr event — satisfied by querySync results, live-sub events, and test fixtures.
export interface RemoteEvent {
  content:    string;
  created_at: number;
  tags:       string[][];
  id?:        string;   // 5b — the live sub skips this device's own echo by id
}

const dTagOf = (event: RemoteEvent): string | undefined => event.tags.find(([t]) => t === 'd')?.[1];

/** The newest event per d-tag (NIP-01 replaceable: the higher created_at). */
function latestByDTag<E extends RemoteEvent>(events: E[]): Map<string, E> {
  const latest = new Map<string, E>();
  for (const event of events) {
    const dTag = dTagOf(event);
    if (!dTag) continue;
    const existing = latest.get(dTag);
    if (!existing || event.created_at > existing.created_at) latest.set(dTag, event);
  }
  return latest;
}

/**
 * THE single apply path for a remote PLAN-EVENTS or PREFS event — used by both the batch pull (fetchAndSync) and the
 * live subscription. Returns false ONLY on decrypt failure (signer-attributable); parse failures are data-level skips →
 * true. Phase 4e: settings:v1 is no longer read — a settings:v1 event that still arrives (a stale relay copy, an old
 * client) matches no branch and changes nothing. 5b: the journal (records:v1 and the v2 manifest + pages) is read as one
 * unit by pullJournal, never event by event — a records:v1 event that reaches here also matches no branch.
 * 5c (spec `pbloc-spec-plan-load-guard-v1`): a plan event's outcome is recorded (planLoad.recordPlanPull) — applied, or
 * unreadable and why — and an applied plan sets planLoaded. A failure is never swallowed silently again, but its log
 * carries the error's NAME and the payload's size only: a JSON.parse message can quote the payload. A plan past NIP-44's
 * padding step (a build before 5a and 5b sent it) is republished trimmed, so every signer and relay can take it.
 */
export async function applyRemoteEvent(
  signer: NostrSigner,
  pubkey: string,
  event: RemoteEvent,
  opTimeoutMs: number,
): Promise<boolean> {
  const dTag = dTagOf(event);
  const isPlan = dTag === PLAN_EVENTS_DTAG;
  let plaintext: string;
  try {
    if (!signer.nip44) throw new Error('signer missing NIP-44 support');
    plaintext = await withTimeout(signer.nip44.decrypt(pubkey, event.content), opTimeoutMs, 'nip44 decrypt');
  } catch (e) {
    nostrLog('warn', 'decrypt failed — signer unreachable', e);
    if (isPlan) recordPlanPull({ status: 'unreadable', at: Date.now(), reason: 'decrypt' });
    return false;
  }
  const plainBytes = typeof plaintext === 'string' ? utf8Bytes(plaintext) : 0;   // an extension can hand back a non-string
  let data: any;   // foreign JSON — each branch below checks its shape
  try {
    data = JSON.parse(plaintext);
  } catch (e) {
    nostrLog('warn', `${isPlan ? 'plan' : dTag === PREFS_DTAG ? 'prefs' : 'payload'} unreadable — not JSON (skipped)`, { error: errorName(e), plainBytes });
    if (isPlan) recordPlanPull({ status: 'unreadable', at: Date.now(), reason: 'parse', plainBytes });
    return true;
  }
  const remoteTs = event.created_at;
  // ── PLAN EVENTS (v1) — the ONLY plan channel since 4e; the source of truth for the plan partition.
  // Union+fold is order-independent, so there is NO watermark gate (lastPlanEventsSyncAt is observability only). ──
  if (isPlan) {
    if (!Array.isArray(data?.events)) {
      nostrLog('warn', 'plan unreadable — not a plan log (skipped)', { plainBytes });
      recordPlanPull({ status: 'unreadable', at: Date.now(), reason: 'shape', plainBytes });
      return true;
    }
    try {
      const s = useStore.getState();
      const remote = data.events as PlanEvent[];
      const merged = unionPlanEvents(s.planEvents, remote);
      const idKey = (evs: PlanEvent[]) => JSON.stringify(evs.map((e) => e.id).sort());   // unionPlanEvents already (ts,id)-sorts; sort ids for a stable set-compare
      if (idKey(merged) !== idKey(s.planEvents)) {
        useStore.getState().setPlanEvents(merged);                     // log first
        useStore.getState().applyPlanFold(foldPlanEvents(merged));     // then derived scalars (raw — no event, no dirty)
      }
      useStore.getState().setLastPlanEventsSyncAt(remoteTs);          // observability ONLY
      useStore.getState().setPlanLoaded(true);                        // 5c — this device now holds the plan
      recordPlanPull({ status: 'applied', at: Date.now(), plainBytes });
      // Relay behind → repair (mirrors the records pattern). 5c: also when the relays' copy is past NIP-44's padding step —
      // only a build before 5a/5b sends one, and a signer that caps NIP-44 at 65,535 B, or a relay at 64 KiB, can't take
      // it. The publish compacts the log (5a) and 5b's guard checks the size it sends.
      const oversized = plainBytes > PLAIN_STEP_BYTES;
      if (oversized) nostrLog('info', `the relays' plan is ${plainBytes} B plain, past the ${PLAIN_STEP_BYTES} B step — republishing it trimmed`);
      if (idKey(merged) !== idKey(remote) || oversized) {
        useStore.getState().setPlanDirty(true);
        void publishPlanEventsNow();
      }
    } catch (e) {
      nostrLog('warn', 'plan unreadable — applying it failed (skipped)', { error: errorName(e), plainBytes });
      recordPlanPull({ status: 'unreadable', at: Date.now(), reason: 'apply', plainBytes });
    }
    return true;
  }
  // ── PREFS (v1) — tiny whole-object LWW (tabOrder/hiddenTabs/simpleMode/btcBuyingUnit/venueColors). hydratePrefs
  // whitelists to PREFS_FIELDS, so nothing but the 5 prefs keys of a prefs:v1 object can land — and a key the object
  // lacks is left as it is (an older build's object carries no colours; BL15). ──
  if (dTag === PREFS_DTAG && remoteTs > (useStore.getState().lastPrefsSyncAt ?? 0)) {
    try {
      useStore.getState().hydratePrefs(data);
      useStore.getState().setLastPrefsSyncAt(remoteTs);
      nostrLog('info', 'prefs hydrated');
    } catch (e) {
      nostrLog('warn', 'prefs unreadable (skipped)', { error: errorName(e), plainBytes });   // corrupt/foreign payload
    }
  }
  return true;
}

/** The result of one owner pull.
 *  `ok`        — true if no decrypt failure occurred (parse failures are data-level skips, not signer failures).
 *  `planFound` — R2b-2: did ANY owner plan event exist on the relays? Deliberately INDEPENDENT of `ok`. */
export interface FetchAndSyncResult {
  ok: boolean;
  planFound: boolean;
}

export async function fetchAndSync(
  signer: NostrSigner,
  pubkey: string,
  relays: string[] = FALLBACK_RELAYS,
): Promise<FetchAndSyncResult> {
  const pool = new SimplePool();

  const events = await pool.querySync(relays, {
    kinds:   [30078],
    authors: [pubkey],
    '#d':    [RECORDS_DTAG, JOURNAL_MANIFEST_DTAG, PLAN_EVENTS_DTAG, PREFS_DTAG],   // 5b: + the journal's manifest
  });
  // 5c — did any relay answer? A relay that failed to connect is dropped from the pool's map, so a connected entry is
  // one the query reached. Nothing back from relays that couldn't be reached is 'unreachable', not 'none' — and even a
  // 'none' only waits for the owner to say the key is new: a relay can answer and still not hold (or show) the plan.
  const answered = [...pool.listConnectionStatus().values()].some(Boolean);

  pool.close(relays);

  const latest = latestByDTag(events);
  const opTimeoutMs = signerOpTimeout(useStore.getState().nostrSigningMethod);

  let decryptFailed = false;
  let planAttempted = false;
  for (const [dTag, event] of latest) {
    if (dTag === RECORDS_DTAG || dTag === JOURNAL_MANIFEST_DTAG) continue;   // 5b — the journal is read below, as one unit
    if (dTag === PLAN_EVENTS_DTAG) planAttempted = true;
    const ok = await applyRemoteEvent(signer, pubkey, event, opTimeoutMs);
    if (!ok) { decryptFailed = true; break; }   // rest would fail identically
  }
  // 5c — settle the plan's status for this pull (applyRemoteEvent recorded it when it reached the plan). No plan event:
  //  - no relay answered → unknown ('unreachable');
  //  - a journal came back without a plan (its plan lives elsewhere, or only on an old device) → 'absent': the journal is
  //    what a seed plan would damage, so this device keeps waiting;
  //  - nothing of this key's at all → 'none'. A new key looks like that, and so do relays that return nothing for a key
  //    that has a plan (slow, refusing the query, or not the ones that hold it) — so the device doesn't decide: its owner
  //    does ("Start a new plan", usePlanLoad.startNewPlanHere). Until then it keeps waiting.
  if (!latest.has(PLAN_EVENTS_DTAG)) {
    if (!answered) {
      recordPlanPull({ status: 'unreachable', at: Date.now() });
    } else if (latest.has(RECORDS_DTAG) || latest.has(JOURNAL_MANIFEST_DTAG)) {
      recordPlanPull({ status: 'unreadable', at: Date.now(), reason: 'absent' });
      // A device that holds the plan puts it back (the relays dropped it, or never had it) — even an empty log, the plan
      // of a key whose owner never changed a setting — and syncNow's publish sends it after this pull. The plan log
      // unions, so a stale copy can't cost a newer device anything.
      const s = useStore.getState();
      if (s.planLoaded) s.setPlanDirty(true);
    } else {
      recordPlanPull({ status: 'none', at: Date.now() });
    }
  } else if (!planAttempted) {
    recordPlanPull({ status: 'unreadable', at: Date.now(), reason: 'not-reached' });   // a decrypt failure stopped the loop first
  }
  if (!decryptFailed) {
    const journal = await pullJournal(signer, pubkey, relays, { v1: latest.get(RECORDS_DTAG), manifest: latest.get(JOURNAL_MANIFEST_DTAG) }, opTimeoutMs);
    if (!journal.ok) decryptFailed = true;
  }
  // reconnect-flag management lives in syncNow (sole caller).
  // planFound reads `latest`, built BEFORE any decrypt, whose keys can only be the four owner d-tags (the query
  // filters authors:[pubkey] + #d, and latestByDTag skips a missing d-tag). So it means "this key has published on
  // the relays" and stays TRUE even when a decrypt failure sets ok=false — an unreachable signer must never be reported
  // as "no plan found". 4e: a key whose relays hold ONLY a pre-4c settings:v1 now reads "no plan found" (the accepted
  // restore residual, CLAUDE.md § Phase 4).
  return {
    ok: !decryptFailed,
    planFound: latest.size > 0,
  };
}

// ── 5b — the journal pull ──

const DECRYPT_FAILED = Symbol('decrypt failed');

/** Decrypt + parse one event: its JSON, undefined when it doesn't parse (a data-level skip), or DECRYPT_FAILED. */
async function decryptJson(signer: NostrSigner, pubkey: string, event: RemoteEvent, opTimeoutMs: number): Promise<unknown> {
  let plaintext: string;
  try {
    if (!signer.nip44) throw new Error('signer missing NIP-44 support');
    plaintext = await withTimeout(signer.nip44.decrypt(pubkey, event.content), opTimeoutMs, 'nip44 decrypt');
  } catch (e) { nostrLog('warn', 'decrypt failed — signer unreachable', e); return DECRYPT_FAILED; }
  try { return JSON.parse(plaintext); } catch { nostrLog('warn', 'payload parse failed (skipped)'); return undefined; }
}

/** Fetch pages by key — one query, and ONE retry for any the relays didn't return. Null on a decrypt failure. A page
 *  that doesn't parse, or whose key doesn't match its d-tag, counts as not returned. */
async function fetchPages(
  signer: NostrSigner, pubkey: string, relays: string[], keys: string[], opTimeoutMs: number,
): Promise<Map<string, { page: JournalPage; at: number }> | null> {
  const pages = new Map<string, { page: JournalPage; at: number }>();
  for (let attempt = 0; attempt < 2; attempt++) {
    const want = keys.filter((k) => !pages.has(k));
    if (!want.length) break;
    const pool = new SimplePool();
    const events = await pool.querySync(relays, { kinds: [30078], authors: [pubkey], '#d': want.map(pageDTag) });
    pool.close(relays);
    for (const [dTag, event] of latestByDTag(events)) {
      const key = dTag.slice(JOURNAL_V2_PREFIX.length);
      if (!dTag.startsWith(JOURNAL_V2_PREFIX) || !want.includes(key)) continue;
      const data = await decryptJson(signer, pubkey, event, opTimeoutMs);
      if (data === DECRYPT_FAILED) return null;
      const page = parsePage(data, key);
      if (page) pages.set(key, { page, at: event.created_at });
    }
  }
  return pages;
}

/**
 * Would this device's next journal publish write anything? The same test the publish applies, page by page: a page
 * whose copy on the relays differs, a manifest that differs, a records:v1 bridge that differs. With no manifest on the
 * relays (records:v1 only — a journal from before 5b), v2 is first written when records:v1 no longer carries the
 * whole journal: a lazy migration, so a pull alone never writes a dozen pages.
 */
async function journalBehind(merged: RecordsState, mergedBuilt: BuiltJournal, known: JournalKnown, hasManifest: boolean, v1: RecordsState | null): Promise<boolean> {
  if (!hasManifest) return !v1 || normRecords(v1) !== normRecords(merged);
  if (pagesToPublish(mergedBuilt, known.pages).length) return true;
  if (await fingerprint(manifestOf(relayListing(mergedBuilt, known.pages, known.unreadable), merged)) !== known.manifestH) return true;
  return (await v1BridgeTarget(merged, PLAIN_STEP_BYTES)) !== known.v1;
}

/**
 * 5b — read the journal from the relays and merge it in: records:v1 (a pre-5b app writes only that) and the v2
 * manifest, then the pages the manifest lists whose fingerprint differs from this device's page of that key — or, on
 * the session's first pull, every listed page (a full check: it also finds a page a relay has dropped). The parts
 * become one state (unionParts) and merge through mergeRecords once, unchanged — as records:v1 did before 5b. Then the
 * known state is reset to what the relays hold, and if this device's next publish would write anything, recordsDirty
 * is set and the repair queued (behind this pull, in the lane).
 * Returns ok:false ONLY on a decrypt failure. With no journal on the relays, nothing is merged or repaired — as
 * before 5b; the first write publishes it.
 */
export function pullJournal(
  signer: NostrSigner,
  pubkey: string,
  relays: string[],
  found: { v1?: RemoteEvent; manifest?: RemoteEvent },
  opTimeoutMs: number,
): Promise<{ ok: boolean }> {
  return inJournalLane(async () => {
    const known = journalKnown(pubkey);
    const full = !known.fullCheckDone;
    let v1Data: unknown;
    let manifest: JournalManifest | null = null;
    if (found.v1) {
      v1Data = await decryptJson(signer, pubkey, found.v1, opTimeoutMs);
      if (v1Data === DECRYPT_FAILED) return { ok: false };
    }
    if (found.manifest) {
      const data = await decryptJson(signer, pubkey, found.manifest, opTimeoutMs);
      if (data === DECRYPT_FAILED) return { ok: false };
      manifest = parseManifest(data);
    }
    const v1 = v1Data !== undefined ? parseV1Records(v1Data) : null;
    const v1Kind = v1Data === undefined ? 'none' : isV1Stub(v1Data) ? 'stub' : 'full';
    if (!v1 && !manifest) {
      known.pages.clear(); known.unreadable.clear(); known.manifestH = null; known.v1 = null;
      known.seenAt = Math.max(known.seenAt, found.v1?.created_at ?? 0, found.manifest?.created_at ?? 0);   // an unreadable copy is still one to replace
      known.pulled = true; known.fullCheckDone = true;
      known.check = { at: Date.now(), full, listed: 0, fetched: 0, missing: [], manifest: false, v1: 'none' };
      return { ok: true };
    }

    const s = useStore.getState();
    const local: RecordsState = { entries: s.monthlyLog, deletions: s.deletedMonths, dayLog: s.dayLog, dayLogDeletions: s.deletedDayEvents };
    const localBuilt = await buildJournal(local);   // decides what to fetch: a page whose fingerprint matches is the relays' copy
    const keys = pagesToFetch(localBuilt, manifest, full);
    const fetched = new Map<string, JournalPage>();
    let seenAt = Math.max(found.v1?.created_at ?? 0, found.manifest?.created_at ?? 0);
    if (keys.length) {
      const got = await fetchPages(signer, pubkey, relays, keys, opTimeoutMs);
      if (!got) return { ok: false };
      for (const [key, { page, at }] of got) { fetched.set(key, page); seenAt = Math.max(seenAt, at); }
    }
    const missing = keys.filter((k) => !fetched.has(k));

    // The relays' journal: records:v1, the manifest's tombstones, and every listed page — fetched, or this device's own
    // where the fingerprints match (the same content, so not fetched).
    const parts: RecordsState[] = v1 ? [v1] : [];
    if (manifest) {
      parts.push(manifestAsRecords(manifest));
      const mine = new Map(localBuilt.pages.map((p) => [p.page.key, p]));
      for (const [key, listing] of Object.entries(manifest.pages)) {
        const page = fetched.get(key) ?? (!missing.includes(key) && mine.get(key)?.h === listing.h ? mine.get(key)!.page : undefined);
        if (page) parts.push(pageAsRecords(page));
      }
    }
    // Merge into the journal as it is NOW, not as it was before the fetch: the user may have written while this pull
    // waited on the relays, and a merge of the earlier copy would overwrite that write. No await from here to the apply.
    const cur = useStore.getState();
    const now: RecordsState = { entries: cur.monthlyLog, deletions: cur.deletedMonths, dayLog: cur.dayLog, dayLogDeletions: cur.deletedDayEvents };
    const merged = mergeRecords(now, unionParts(parts), { preferLocalOnTie: cur.recordsDirty });
    if (normRecords(merged) !== normRecords(now)) {
      useStore.getState().setMonthlyLog(merged.entries);   // verbatim — btcHeld is RECORDED per entry, never recomputed
      useStore.getState().setDeletedMonths(merged.deletions);
      useStore.getState().setDayLog(merged.dayLog);                       // folds the Seam-2 cbCollateralBtc derive (no setState / no deriveCbCollateral import here)
      useStore.getState().setDeletedDayEvents(merged.dayLogDeletions);
      nostrLog('info', `records merged (${merged.entries.length} entries, ${merged.dayLog.length} day events)`);
    }

    // What the relays hold now: a fetched page at its own fingerprint, an unfetched one at its listing; a listed page
    // the relays didn't return is either republished from this device's copy or, if this device has none, carried.
    const mergedBuilt = await buildJournal(merged);
    const mergedKeys = new Set(mergedBuilt.pages.map((p) => p.page.key));
    known.pages = new Map();
    known.unreadable = new Map();
    for (const [key, listing] of Object.entries(manifest?.pages ?? {})) {
      const page = fetched.get(key);
      if (page) known.pages.set(key, { n: pageItemCount(page), h: await fingerprint(page) });
      else if (!missing.includes(key)) known.pages.set(key, listing);
      else if (!mergedKeys.has(key)) known.unreadable.set(key, listing);
    }
    known.manifestH = manifest ? await fingerprint(manifest) : null;
    known.v1 = v1Kind === 'none' ? null : v1Kind === 'stub' ? 'stub' : await fingerprint(normRecords(v1!));
    known.seenAt = Math.max(known.seenAt, seenAt);   // the floor for this device's next journal publish
    known.pulled = true;
    if (full) known.fullCheckDone = true;
    known.check = {
      at: Date.now(), full, listed: manifest ? Object.keys(manifest.pages).length : 0, fetched: fetched.size, missing,
      manifest: !!manifest, v1: v1Kind,
    };
    if (missing.length) nostrLog('warn', `journal: ${missing.length} listed page(s) not on the relays: ${missing.join(', ')}`);

    if (await journalBehind(merged, mergedBuilt, known, !!manifest, v1)) {
      useStore.getState().setRecordsDirty(true);   // the relays lack something this device holds → publish needed
      void publishRecordsNowImmediate();           // repair NOW, queued behind this pull (a success clears recordsDirty; the next pull finds nothing behind, so no loop)
    }
    useStore.getState().setLastRecordsSyncAt(Math.max(found.v1?.created_at ?? 0, found.manifest?.created_at ?? 0));   // observability ONLY
    return { ok: true };
  });
}

/** 5b — the live sub's journal pull: what the relays hold now, read as one unit. False on a decrypt failure (the caller's
 *  Reconnect); a no-op while Reconnect is up, for a viewer, or for an unverified generated key. */
export async function pullJournalNow(): Promise<boolean> {
  const s = useStore.getState();
  if (!s.nostrSigner?.nip44 || !s.nostrPubkey || s.nostrReconnectNeeded || s.viewerMode || !isBackupGateSatisfied(s)) return false;
  const relays = s.nostrRelays.length ? s.nostrRelays : FALLBACK_RELAYS;
  const pool = new SimplePool();
  const events = await pool.querySync(relays, { kinds: [30078], authors: [s.nostrPubkey], '#d': [RECORDS_DTAG, JOURNAL_MANIFEST_DTAG] });
  pool.close(relays);
  const latest = latestByDTag(events);
  const r = await pullJournal(s.nostrSigner, s.nostrPubkey, relays, { v1: latest.get(RECORDS_DTAG), manifest: latest.get(JOURNAL_MANIFEST_DTAG) }, signerOpTimeout(s.nostrSigningMethod));
  if (!r.ok) useStore.getState().setNostrReconnectNeeded(true);
  return r.ok;
}

let journalPullTimer: ReturnType<typeof setTimeout> | null = null;
/** 5b — debounce the live sub's journal pulls: one device's publish arrives as a manifest and a records:v1 event, and
 *  a burst of edits as several — one pull reads them all. */
export function scheduleJournalPull(delayMs = 1500): void {
  if (journalPullTimer) clearTimeout(journalPullTimer);
  journalPullTimer = setTimeout(() => { journalPullTimer = null; void pullJournalNow(); }, delayMs);
}
