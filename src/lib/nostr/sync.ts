import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import { useStore } from '../../store/useStore';
import { FALLBACK_RELAYS } from './publish';

export async function fetchAndSync(
  signer: NostrSigner,
  pubkey: string,
  relays: string[] = FALLBACK_RELAYS,
): Promise<void> {
  const pool = new SimplePool();

  const events = await pool.querySync(relays, {
    kinds:   [30078],
    authors: [pubkey],
    '#d':    ['personal-bloc:settings:v1'],
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
  for (const event of latestByDTag.values()) {
    try {
      const plaintext = await signer.nip44.decrypt(pubkey, event.content);
      const data      = JSON.parse(plaintext);
      const dTag      = event.tags.find(([t]) => t === 'd')?.[1];
      const remoteTs  = event.created_at;

      if (dTag === 'personal-bloc:settings:v1') {
        const { lastSettingsSyncAt } = useStore.getState();
        if (remoteTs > (lastSettingsSyncAt ?? 0)) {
          useStore.getState().hydrateSettings(data);
          useStore.getState().setLastSettingsSyncAt(remoteTs);
        }
      }
    } catch {
      // Decryption failure or parse error — skip silently
    }
  }
}
