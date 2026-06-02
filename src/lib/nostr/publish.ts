import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';

export const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

export async function publishEncrypted(
  signer:  NostrSigner,
  pubkey:  string,
  dTag:    string,
  data:    unknown,
  relays:  string[] = NOSTR_RELAYS,
): Promise<void> {
  const plaintext  = JSON.stringify(data);
  const ciphertext = await signer.nip44.encrypt(pubkey, plaintext);

  const signed = await signer.signEvent({
    kind:       30078,
    created_at: Math.floor(Date.now() / 1000),
    tags:       [['d', dTag]],
    content:    ciphertext,
  });

  const pool = new SimplePool();
  try {
    await Promise.any(pool.publish(relays, signed));
  } finally {
    pool.close(relays);
  }
}

export async function publishSettings(
  signer:   NostrSigner,
  pubkey:   string,
  relays:   string[],
  settings: Record<string, unknown>,
): Promise<void> {
  await publishEncrypted(signer, pubkey, 'personal-bloc:settings:v1', settings, relays);
}
