import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import type { MonthlyLogEntry } from '../../simulation/types';

export const FALLBACK_RELAYS = [
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
  relays:  string[] = FALLBACK_RELAYS,
): Promise<number> {
  const plaintext  = JSON.stringify(data);
  if (!signer.nip44) throw new Error('signer missing NIP-44 support');
  const ciphertext = await signer.nip44.encrypt(pubkey, plaintext);
  const createdAt  = Math.floor(Date.now() / 1000);

  const signed = await signer.signEvent({
    kind:       30078,
    created_at: createdAt,
    tags:       [['d', dTag]],
    content:    ciphertext,
  });

  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(pool.publish(relays, signed));
    const anyAccepted = results.some(r => r.status === 'fulfilled');
    if (!anyAccepted) {
      throw new AggregateError(
        results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map(r => r.reason),
        'All relays rejected the event'
      );
    }
    return createdAt;
  } finally {
    pool.close(relays);
  }
}

export async function publishSettings(
  signer:   NostrSigner,
  pubkey:   string,
  relays:   string[],
  settings: Record<string, unknown>,
): Promise<number> {
  return publishEncrypted(signer, pubkey, 'personal-bloc:settings:v1', settings, relays);
}

export async function publishRecords(
  signer:  NostrSigner,
  pubkey:  string,
  entries: MonthlyLogEntry[],
  relays?: string[],
): Promise<number> {
  return publishEncrypted(signer, pubkey, 'personal-bloc:records:v1', entries, relays);
}
