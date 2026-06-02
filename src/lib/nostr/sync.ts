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

  for (const event of events) {
    try {
      const plaintext = await signer.nip44.decrypt(pubkey, event.content);
      const data      = JSON.parse(plaintext);
      const dTag      = event.tags.find(([t]) => t === 'd')?.[1];
      const remoteTs  = event.created_at;

      if (dTag === 'personal-bloc:settings:v1') {
        if (remoteTs > (useStore.getState().lastSettingsSyncAt ?? 0)) {
          useStore.getState().hydrateSettings(data);
          useStore.getState().setLastSettingsSyncAt(remoteTs);
        }
      }
    } catch {
      // Decryption failure or parse error — skip silently
    }
  }
}
