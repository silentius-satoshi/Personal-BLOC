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
  console.log('[Sync] events found:', events.length);

  const latestByDTag = new Map<string, typeof events[0]>();
  for (const event of events) {
    const dTag = event.tags.find(([t]) => t === 'd')?.[1];
    if (!dTag) continue;
    const existing = latestByDTag.get(dTag);
    if (!existing || event.created_at > existing.created_at) {
      latestByDTag.set(dTag, event);
    }
  }
  console.log('[Sync] latest events by dTag:',
    [...latestByDTag.entries()].map(([d, e]) => ({ d, created_at: e.created_at }))
  );

  for (const event of latestByDTag.values()) {
    try {
      const plaintext = await signer.nip44.decrypt(pubkey, event.content);
      const data      = JSON.parse(plaintext);
      const dTag      = event.tags.find(([t]) => t === 'd')?.[1];
      const remoteTs  = event.created_at;

      if (dTag === 'personal-bloc:settings:v1') {
        const { lastSettingsSyncAt } = useStore.getState();
        console.log('[Sync] checking settings:', {
          remoteTs,
          lastSettingsSyncAt,
          willHydrate: remoteTs > (lastSettingsSyncAt ?? 0),
        });
        if (remoteTs > (lastSettingsSyncAt ?? 0)) {
          useStore.getState().hydrateSettings(data);
          useStore.getState().setLastSettingsSyncAt(remoteTs);
          console.log('[Sync] hydrated settings');
        }
      }
    } catch {
      // Decryption failure or parse error — skip silently
    }
  }
}
