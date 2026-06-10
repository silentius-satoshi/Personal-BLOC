import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import type { MonthlyLogEntry } from '../../simulation/types';
import { withTimeout } from './timeout';

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
  const ciphertext = await withTimeout(signer.nip44.encrypt(pubkey, plaintext), 10000, 'nip44 encrypt');
  const createdAt  = Math.floor(Date.now() / 1000);

  const signed = await withTimeout(signer.signEvent({
    kind:       30078,
    created_at: createdAt,
    tags:       [['d', dTag]],
    content:    ciphertext,
  }), 10000, 'signEvent');

  const pool = new SimplePool();
  const pubs = pool.publish(relays, signed);                 // Promise[] (one per relay)
  Promise.allSettled(pubs).finally(() => pool.close(relays)); // close after all settle; do NOT block the return
  return await new Promise<number>((resolve, reject) => {
    let settled = false, rejections = 0;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('publish timeout — no relay accepted')); } }, 12000);
    if (pubs.length === 0) { clearTimeout(timer); reject(new Error('no relays')); return; }
    for (const p of pubs) {
      p.then(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(createdAt); } })
       .catch((err) => { rejections++; if (!settled && rejections === pubs.length) { settled = true; clearTimeout(timer); reject(new AggregateError([err], 'All relays rejected the event')); } });
    }
  });
}

export async function publishSettings(
  signer:   NostrSigner,
  pubkey:   string,
  relays:   string[],
  settings: Record<string, unknown>,
): Promise<number> {
  return publishEncrypted(signer, pubkey, 'personal-bloc:settings:v1', settings, relays);
}

// Records payload schema v2 — same d-tag; the replaceable event's next publish supersedes old payloads.
// Readers must also accept the legacy v1 bare MonthlyLogEntry[] array.
export type RecordsPayload = { entries: MonthlyLogEntry[]; deletions: Record<number, number> };

export async function publishRecords(
  signer:  NostrSigner,
  pubkey:  string,
  payload: RecordsPayload,
  relays?: string[],
): Promise<number> {
  return publishEncrypted(signer, pubkey, 'personal-bloc:records:v1', payload, relays);
}
