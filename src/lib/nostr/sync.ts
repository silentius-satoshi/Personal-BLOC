import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { FALLBACK_RELAYS } from './publish';
import { withTimeout, signerOpTimeout } from './timeout';
import { mergeRecords, type RecordsState } from '../../simulation/mergeRecords';
import { recomputeBtcHeld } from '../../simulation/logUtils';
import type { MonthlyLogEntry } from '../../simulation/types';

export async function fetchAndSync(
  signer: NostrSigner,
  pubkey: string,
  relays: string[] = FALLBACK_RELAYS,
): Promise<void> {
  const pool = new SimplePool();

  const events = await pool.querySync(relays, {
    kinds:   [30078],
    authors: [pubkey],
    '#d':    ['personal-bloc:settings:v1', 'personal-bloc:records:v1'],
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

  const { lastSettingsSyncAt } = useStore.getState();
  const opTimeoutMs = signerOpTimeout(useStore.getState().nostrSigningMethod);

  let decryptFailed = false, anyDecryptOk = false;
  for (const event of latestByDTag.values()) {
    let plaintext: string;
    try {
      if (!signer.nip44) throw new Error('signer missing NIP-44 support');
      plaintext = await withTimeout(signer.nip44.decrypt(pubkey, event.content), opTimeoutMs, 'nip44 decrypt');
      anyDecryptOk = true;
    } catch { decryptFailed = true; break; }               // signer unreachable — rest would fail identically
    try {
      const data = JSON.parse(plaintext);
      const dTag = event.tags.find(([t]) => t === 'd')?.[1];
      const remoteTs = event.created_at;
      if (dTag === 'personal-bloc:settings:v1' && remoteTs > (lastSettingsSyncAt ?? 0)) {
        useStore.getState().hydrateSettings(data);
        useStore.getState().setLastSettingsSyncAt(remoteTs);
      }
      if (dTag === 'personal-bloc:records:v1') {
        const remote: RecordsState = Array.isArray(data)
          ? { entries: data as MonthlyLogEntry[], deletions: {} }            // legacy v1 bare-array payload
          : data as RecordsState;
        const s = useStore.getState();
        const local: RecordsState = { entries: s.monthlyLog, deletions: s.deletedMonths };
        const merged = mergeRecords(local, remote, { preferLocalOnTie: s.recordsDirty });
        const norm = (r: RecordsState) => JSON.stringify({ e: r.entries, d: r.deletions });
        const remoteNorm: RecordsState = { entries: [...remote.entries].sort((a, b) => a.month - b.month), deletions: remote.deletions };
        if (norm(merged) !== norm(local)) {
          useStore.getState().setMonthlyLog(recomputeBtcHeld(merged.entries, s.advisorActualBtcHeld));
          useStore.getState().setDeletedMonths(merged.deletions);
        }
        if (norm(merged) !== norm(remoteNorm)) {
          useStore.getState().setRecordsDirty(true);     // relay is missing something we have → publish needed
        }
        useStore.getState().setLastRecordsSyncAt(remoteTs);  // observability ONLY — no longer a gate
      }
    } catch { /* corrupt/foreign payload — skip */ }
  }
  if (decryptFailed) useStore.getState().setNostrReconnectNeeded(true);
  else if (anyDecryptOk) useStore.getState().setNostrReconnectNeeded(false);
}
