import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { publishRecordsNowImmediate, publishPlanEventsNow } from './syncEngine';
import { FALLBACK_RELAYS, RECORDS_DTAG, PLAN_EVENTS_DTAG, PREFS_DTAG } from './publish';
import { withTimeout, signerOpTimeout } from './timeout';
import { nostrLog } from './log';
import { mergeRecords, type RecordsState } from '../../simulation/mergeRecords';
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';
import { unionPlanEvents, foldPlanEvents } from '../planEvents/fold';
import type { PlanEvent } from '../planEvents/types';

// Structural subset of a nostr event — satisfied by querySync results, live-sub events, and test fixtures.
export interface RemoteEvent {
  content:    string;
  created_at: number;
  tags:       string[][];
}

/**
 * THE single apply path for a remote event — used by both the batch pull (fetchAndSync) and the
 * live subscription. Returns false ONLY on decrypt failure (signer-attributable); parse failures
 * are data-level skips → true. Phase 4e: settings:v1 is no longer read — a settings:v1 event that still
 * arrives (a stale relay copy, an old client) matches no branch and changes nothing.
 */
export async function applyRemoteEvent(
  signer: NostrSigner,
  pubkey: string,
  event: RemoteEvent,
  opTimeoutMs: number,
): Promise<boolean> {
  let plaintext: string;
  try {
    if (!signer.nip44) throw new Error('signer missing NIP-44 support');
    plaintext = await withTimeout(signer.nip44.decrypt(pubkey, event.content), opTimeoutMs, 'nip44 decrypt');
  } catch (e) { nostrLog('warn', 'decrypt failed — signer unreachable', e); return false; }
  try {
    const data = JSON.parse(plaintext);
    const dTag = event.tags.find(([t]) => t === 'd')?.[1];
    const remoteTs = event.created_at;
    // ── PLAN EVENTS (v1) — the ONLY plan channel since 4e; the source of truth for the plan partition.
    // Union+fold is order-independent, so there is NO watermark gate (lastPlanEventsSyncAt is observability only). ──
    if (dTag === PLAN_EVENTS_DTAG && Array.isArray(data?.events)) {
      const s = useStore.getState();
      const remote = data.events as PlanEvent[];
      const merged = unionPlanEvents(s.planEvents, remote);
      const idKey = (evs: PlanEvent[]) => JSON.stringify(evs.map((e) => e.id).sort());   // unionPlanEvents already (ts,id)-sorts; sort ids for a stable set-compare
      if (idKey(merged) !== idKey(s.planEvents)) {
        useStore.getState().setPlanEvents(merged);                     // log first
        useStore.getState().applyPlanFold(foldPlanEvents(merged));     // then derived scalars (raw — no event, no dirty)
      }
      if (idKey(merged) !== idKey(remote)) {                          // relay behind → repair (mirrors the records pattern below)
        useStore.getState().setPlanDirty(true);
        void publishPlanEventsNow();
      }
      useStore.getState().setLastPlanEventsSyncAt(remoteTs);          // observability ONLY
    }
    if (dTag === RECORDS_DTAG) {
      // P3 — records:v1 now carries the daily journal too. Backward-compat: a legacy bare array has no dayLog/deletions;
      // a pre-P3 object payload has entries/deletions but no dayLog/dayLogDeletions. Default every field defensively.
      const remote: RecordsState = Array.isArray(data)
        ? { entries: data as MonthlyLogEntry[], deletions: {}, dayLog: [], dayLogDeletions: {} }   // legacy v1 bare-array payload
        : {
            entries:         (data.entries         ?? []) as MonthlyLogEntry[],
            deletions:       (data.deletions       ?? {}) as Record<number, number>,
            dayLog:          (data.dayLog          ?? []) as DayEvent[],
            dayLogDeletions: (data.dayLogDeletions ?? {}) as Record<string, number>,
          };
      const s = useStore.getState();
      const local: RecordsState = { entries: s.monthlyLog, deletions: s.deletedMonths, dayLog: s.dayLog, dayLogDeletions: s.deletedDayEvents };
      const merged = mergeRecords(local, remote, { preferLocalOnTie: s.recordsDirty });
      // Canonicalize ALL FOUR collections (entries by month, dayLog by id, both maps' keys sorted) so a dayLog-only
      // change is detected and key-order can't trigger a false dirty. norm() sorts internally → norm(remote) replaces
      // the old pre-sorted remoteNorm.
      const sortMap = (m: Record<string | number, number>) =>
        Object.keys(m).sort().reduce<Record<string, number>>((acc, k) => { acc[k] = m[k]; return acc; }, {});
      const norm = (r: RecordsState) => JSON.stringify({
        e:   [...r.entries].sort((a, b) => a.month - b.month),
        d:   sortMap(r.deletions),
        dl:  [...r.dayLog].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        dld: sortMap(r.dayLogDeletions),
      });
      if (norm(merged) !== norm(local)) {
        useStore.getState().setMonthlyLog(merged.entries);   // verbatim — btcHeld is RECORDED per entry, never recomputed
        useStore.getState().setDeletedMonths(merged.deletions);
        useStore.getState().setDayLog(merged.dayLog);                       // folds the Seam-2 cbCollateralBtc derive (no setState / no deriveCbCollateral import here)
        useStore.getState().setDeletedDayEvents(merged.dayLogDeletions);
        nostrLog('info', `records merged (${merged.entries.length} entries, ${merged.dayLog.length} day events)`);
      }
      if (norm(merged) !== norm(remote)) {
        useStore.getState().setRecordsDirty(true);     // relay is missing something we have → publish needed
        void publishRecordsNowImmediate();             // repair NOW — don't wait for the next user action (a successful publish clears recordsDirty; next pull's norm(merged)===norm(remote), so no loop)
      }
      useStore.getState().setLastRecordsSyncAt(remoteTs);  // observability ONLY — no longer a gate
    }
    // ── PREFS (v1) — tiny whole-object LWW (tabOrder/hiddenTabs/simpleMode/btcBuyingUnit). hydratePrefs
    // whitelists to PREFS_FIELDS, so nothing but the 4 prefs keys of a prefs:v1 object can land. ──
    if (dTag === PREFS_DTAG && remoteTs > (useStore.getState().lastPrefsSyncAt ?? 0)) {
      useStore.getState().hydratePrefs(data);
      useStore.getState().setLastPrefsSyncAt(remoteTs);
      nostrLog('info', 'prefs hydrated');
    }
  } catch { nostrLog('warn', 'payload parse failed (skipped)'); }   // corrupt/foreign payload
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
    '#d':    [RECORDS_DTAG, PLAN_EVENTS_DTAG, PREFS_DTAG],
  });

  pool.close(relays);

  const latestByDTag = new Map<string, typeof events[0]>();
  for (const event of events) {
    const dTag = event.tags.find(([t]) => t === 'd')?.[1];
    if (!dTag) continue;
    const existing = latestByDTag.get(dTag);
    if (!existing || event.created_at > existing.created_at) {
      latestByDTag.set(dTag, event);
    }
  }

  const opTimeoutMs = signerOpTimeout(useStore.getState().nostrSigningMethod);

  let decryptFailed = false;
  for (const event of latestByDTag.values()) {
    const ok = await applyRemoteEvent(signer, pubkey, event, opTimeoutMs);
    if (!ok) { decryptFailed = true; break; }   // rest would fail identically
  }
  // reconnect-flag management lives in syncNow (sole caller).
  // planFound reads latestByDTag, built BEFORE the decrypt loop, whose keys can only be the three owner d-tags
  // (the query filters authors:[pubkey] + #d, and the loop above `continue`s on a missing d-tag). So it means
  // "an owner plan exists on the relays" and stays TRUE even when a decrypt failure sets ok=false — an
  // unreachable signer must never be reported as "no plan found". 4e: a key whose relays hold ONLY a pre-4c
  // settings:v1 now reads "no plan found" (the accepted restore residual, CLAUDE.md § Phase 4).
  return {
    ok: !decryptFailed,
    planFound: latestByDTag.size > 0,
  };
}
