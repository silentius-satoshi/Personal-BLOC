import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';
import { withTimeout } from './timeout';
import { DEFAULT_RELAYS } from './relays';

export const SETTINGS_DTAG = 'personal-bloc:settings:v1';
export const RECORDS_DTAG  = 'personal-bloc:records:v1';

export const FALLBACK_RELAYS = DEFAULT_RELAYS;   // unified single source (see relays.ts)

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

  return publishSignedToRelays(signed, relays, createdAt);
}

// Shared publish-and-await-ack tail: resolve on the FIRST relay ack, reject only if ALL reject or after 12s, close
// the pool after all settle. Consumed by publishEncrypted (kind-30078) AND publishRelayListNip65 (plain kind-10002).
function publishSignedToRelays(
  signed:    Parameters<SimplePool['publish']>[1],
  relays:    string[],
  createdAt: number,
): Promise<number> {
  const pool = new SimplePool();
  const pubs = pool.publish(relays, signed);                 // Promise[] (one per relay)
  Promise.allSettled(pubs).finally(() => pool.close(relays)); // close after all settle; do NOT block the return
  return new Promise<number>((resolve, reject) => {
    let settled = false, rejections = 0;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('publish timeout — no relay accepted')); } }, 12000);
    if (pubs.length === 0) { clearTimeout(timer); reject(new Error('no relays')); return; }
    for (const p of pubs) {
      p.then(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(createdAt); } })
       .catch((err) => { rejections++; if (!settled && rejections === pubs.length) { settled = true; clearTimeout(timer); reject(new AggregateError([err], 'All relays rejected the event')); } });
    }
  });
}

/**
 * Publish a PLAIN (unencrypted) NIP-65 relay list — kind 10002, flat `r` tags (no read/write markers, both implied).
 * MUST NOT route through publishEncrypted / signer.nip44 — kind 10002 is public and must stay readable by other
 * clients. `_pubkey` is kept for signature parity (signer.signEvent needs no pubkey). `publishTo` lets the caller
 * also hit well-known relays for reach even after the user removes everything; defaults to `relays`.
 */
export async function publishRelayListNip65(
  signer:      NostrSigner,
  _pubkey:     string,
  relays:      string[],
  publishTo:   string[] = relays,
  opTimeoutMs: number = 20000,
): Promise<number> {
  const createdAt = Math.floor(Date.now() / 1000);
  const signed = await withTimeout(signer.signEvent({
    kind:       10002,
    created_at: createdAt,
    content:    '',
    tags:       relays.map((url) => ['r', url]),   // flat — no read/write markers
  }), opTimeoutMs, 'signEvent');
  return publishSignedToRelays(signed, publishTo, createdAt);
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
// P3: the daily journal (dayLog) + its deletion tombstones ride the SAME records event (required —
// publishRecordsNow always sends them; pre-P3 readers default them to []/{}).
export type RecordsPayload = {
  entries:         MonthlyLogEntry[];
  deletions:       Record<number, number>;
  dayLog:          DayEvent[];
  dayLogDeletions: Record<string, number>;
};

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
  cbCollateralBtc?: number;   // P3 (BUG2) — the derived CB-collateral scalar; the viewer raw-sets it (never gets the dayLog journal). Optional so the revocation tombstone literal typechecks
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
