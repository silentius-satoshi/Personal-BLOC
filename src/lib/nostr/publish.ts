import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';
import type { ViewerSafeSafety } from '../../simulation/safetyView'; // type-only — no runtime cycle
import { withTimeout } from './timeout';
import { DEFAULT_RELAYS } from './relays';

export const SETTINGS_DTAG = 'personal-bloc:settings:v1';
export const RECORDS_DTAG  = 'personal-bloc:records:v1';

export const FALLBACK_RELAYS = DEFAULT_RELAYS;   // unified single source (see relays.ts)

// Per-d-tag monotonic created_at clock. publishEncrypted stamps created_at at SECOND granularity, so two
// publishes of the same replaceable d-tag within one second would tie → NIP-01 tie-break (lowest id) can
// randomly keep the OLDER payload. Guaranteeing strict per-d-tag ordering makes ties impossible within a
// session (covers settings/records/viewer — each d-tag has its own counter, so they never interfere).
const lastCreatedAtByDtag: Record<string, number> = {};

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
  const createdAt  = Math.max(Math.floor(Date.now() / 1000), (lastCreatedAtByDtag[dTag] ?? 0) + 1);   // per-d-tag monotonic — no same-second replaceable ties
  lastCreatedAtByDtag[dTag] = createdAt;

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

// V2 — MODE-SHAPED. Every field optional so a SAFE payload (health only) and a TRUSTED payload (today's
// full data) are the same type, and old (pre-V2) events without privacyMode still typecheck + read as
// trusted. A SAFE payload carries ONLY the common + safe keys — no settings/records/strike/cbCollateralBtc
// exist in it by construction (the privacy audit is Object.keys). A TRUSTED payload adds today's block.
export interface ViewerSnapshot {
  // common (v2)
  snapshotVersion?: number;              // 2
  privacyMode?: 'safe' | 'trusted';      // ABSENT → treat as trusted (old events / compat)
  asOf?: number;                         // owner publish time (ms)
  revoked?: boolean;                     // tombstone — checked FIRST, mode-agnostic; the viewer wipes + exits
  // SAFE branch (nothing absolute — ratios/config/public price)
  hasCbLoan?: boolean;
  btcPriceAtSnapshot?: number;           // public market data
  thresholds?: { strikeLiqLtv: number; cbLtvTriggerPct: number; cbLiqFrac: number };
  safety?: ViewerSafeSafety;
  // TRUSTED branch (today's payload — now optional)
  settings?: Record<string, unknown>;
  records?:  { entries: unknown[]; deletions: Record<number, number> };
  strike?:   { usd: number | null; btcAvail: number | null; rate: number | null };
  cbCollateralBtc?: number;   // P3 (BUG2) — the derived CB-collateral scalar; the viewer raw-sets it (never gets the dayLog journal)
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
