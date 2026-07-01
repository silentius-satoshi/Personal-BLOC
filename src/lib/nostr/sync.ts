import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { FALLBACK_RELAYS, SETTINGS_DTAG, RECORDS_DTAG } from './publish';
import { withTimeout, signerOpTimeout } from './timeout';
import { nostrLog } from './log';
import { mergeRecords, type RecordsState } from '../../simulation/mergeRecords';
import { recomputeBtcHeld } from '../../simulation/logUtils';
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';

// Structural subset of a nostr event — satisfied by querySync results, live-sub events, and test fixtures.
export interface RemoteEvent {
  content:    string;
  created_at: number;
  tags:       string[][];
}

/**
 * THE single apply path for a remote event — used by both the batch pull (fetchAndSync) and the
 * live subscription. Returns false ONLY on decrypt failure (signer-attributable); parse failures
 * are data-level skips → true. Reads the settings watermark FRESH (a live stream advances it
 * between events).
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
    // While local settings changes are unpublished (settingsDirty), an older/foreign remote
    // whole-object must not clobber them; syncNow pushes local first, then the watermark governs.
    // EXCEPTION — the FIRST pull of a session (!initialSettingsPullDone, still false until fetchAndSync
    // returns) must hydrate real remote data even if a benign post-auth setter spuriously seed-dirtied the
    // store; there are no genuine unpublished edits yet, so the "dirty" is seed noise. Subsequent pulls
    // (flag now true) keep the genuine edit-protection.
    if (dTag === SETTINGS_DTAG
        && (!useStore.getState().settingsDirty || !useStore.getState().initialSettingsPullDone)
        && remoteTs > (useStore.getState().lastSettingsSyncAt ?? 0)) {
      useStore.getState().hydrateSettings(data);
      useStore.getState().setLastSettingsSyncAt(remoteTs);
      nostrLog('info', 'settings hydrated');
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
        useStore.getState().setMonthlyLog(recomputeBtcHeld(merged.entries, s.advisorActualBtcHeld));
        useStore.getState().setDeletedMonths(merged.deletions);
        useStore.getState().setDayLog(merged.dayLog);                       // folds the Seam-2 cbCollateralBtc derive (no setState / no deriveCbCollateral import here)
        useStore.getState().setDeletedDayEvents(merged.dayLogDeletions);
        nostrLog('info', `records merged (${merged.entries.length} entries, ${merged.dayLog.length} day events)`);
      }
      if (norm(merged) !== norm(remote)) {
        useStore.getState().setRecordsDirty(true);     // relay is missing something we have → publish needed
      }
      useStore.getState().setLastRecordsSyncAt(remoteTs);  // observability ONLY — no longer a gate
    }
  } catch { nostrLog('warn', 'payload parse failed (skipped)'); }   // corrupt/foreign payload
  return true;
}

/** Returns true if no decrypt failure occurred (parse failures are data-level skips, not signer failures). */
export async function fetchAndSync(
  signer: NostrSigner,
  pubkey: string,
  relays: string[] = FALLBACK_RELAYS,
): Promise<boolean> {
  const pool = new SimplePool();

  const events = await pool.querySync(relays, {
    kinds:   [30078],
    authors: [pubkey],
    '#d':    [SETTINGS_DTAG, RECORDS_DTAG],
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
  return !decryptFailed;   // reconnect-flag management lives in syncNow (sole caller)
}
