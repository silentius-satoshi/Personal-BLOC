import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { FALLBACK_RELAYS } from './publish';
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

  const { lastSettingsSyncAt, lastRecordsSyncAt, recordsDirty } = useStore.getState();

  let decryptFailed = false, anyDecryptOk = false;
  for (const event of latestByDTag.values()) {
    let plaintext: string;
    try {
      if (!signer.nip44) throw new Error('signer missing NIP-44 support');
      plaintext = await signer.nip44.decrypt(pubkey, event.content);
      anyDecryptOk = true;
    } catch { decryptFailed = true; continue; }            // signer unreachable
    try {
      const data = JSON.parse(plaintext);
      const dTag = event.tags.find(([t]) => t === 'd')?.[1];
      const remoteTs = event.created_at;
      if (dTag === 'personal-bloc:settings:v1' && remoteTs > (lastSettingsSyncAt ?? 0)) {
        useStore.getState().hydrateSettings(data);
        useStore.getState().setLastSettingsSyncAt(remoteTs);
      }
      if (dTag === 'personal-bloc:records:v1' && !recordsDirty && remoteTs > (lastRecordsSyncAt ?? 0)) {
        useStore.getState().setMonthlyLog(data as MonthlyLogEntry[]);
        useStore.getState().setLastRecordsSyncAt(remoteTs);
      }
    } catch { /* corrupt/foreign payload — skip */ }
  }
  if (decryptFailed) useStore.getState().setNostrReconnectNeeded(true);
  else if (anyDecryptOk) useStore.getState().setNostrReconnectNeeded(false);
}
