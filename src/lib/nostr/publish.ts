import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import type { MonthlyLogEntry } from '../../simulation/types';
import { withTimeout } from './timeout';

export const SETTINGS_DTAG = 'personal-bloc:settings:v1';
export const RECORDS_DTAG  = 'personal-bloc:records:v1';

export const FALLBACK_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

export async function publishEncrypted(
  signer:  NostrSigner,
  pubkey:  string,
  dTag:    string,
  data:    unknown,
  relays:  string[] = FALLBACK_RELAYS,
  opTimeoutMs: number = 20000,
): Promise<number> {
  const plaintext  = JSON.stringify(data);
  if (!signer.nip44) throw new Error('signer missing NIP-44 support');
  const ciphertext = await withTimeout(signer.nip44.encrypt(pubkey, plaintext), opTimeoutMs, 'nip44 encrypt');
  const createdAt  = Math.floor(Date.now() / 1000);

  const signed = await withTimeout(signer.signEvent({
    kind:       30078,
    created_at: createdAt,
    tags:       [['d', dTag]],
    content:    ciphertext,
  }), opTimeoutMs, 'signEvent');

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
  opTimeoutMs?: number,
): Promise<number> {
  return publishEncrypted(signer, pubkey, SETTINGS_DTAG, settings, relays, opTimeoutMs);
}

// Records payload schema v2 — same d-tag; the replaceable event's next publish supersedes old payloads.
// Readers must also accept the legacy v1 bare MonthlyLogEntry[] array.
export type RecordsPayload = { entries: MonthlyLogEntry[]; deletions: Record<number, number> };

export async function publishRecords(
  signer:  NostrSigner,
  pubkey:  string,
  payload: RecordsPayload,
  relays?: string[],
  opTimeoutMs?: number,
): Promise<number> {
  return publishEncrypted(signer, pubkey, RECORDS_DTAG, payload, relays, opTimeoutMs);
}

// Viewer access (Phase 1, writer-side) — ONE combined snapshot sealed to a configured viewer's pubkey
// (Option B: includes live Strike balances). The owner's device NIP-44-encrypts to the viewer's pubkey;
// only that viewer can decrypt. Fire-and-forget at the publish layer — the caller (publishViewerSnapshotNow)
// owns the gating + log-only failure handling.
export const VIEWER_DTAG = 'personal-bloc:viewer:v1';

export interface ViewerSnapshot {
  settings: Record<string, unknown>;
  records:  { entries: unknown[]; deletions: Record<number, number> };
  strike:   { usd: number | null; btcAvail: number | null; rate: number | null };
  revoked?: boolean;   // tombstone — the owner revoked this viewer; the viewer wipes + exits the data
}

export async function publishViewerSnapshot(
  writerSigner: NostrSigner,
  viewerPubkey: string,
  payload:      ViewerSnapshot,
  relays?:      string[],
  opTimeoutMs?: number,
): Promise<number> {
  return publishEncrypted(writerSigner, viewerPubkey, VIEWER_DTAG, payload, relays, opTimeoutMs);
}
