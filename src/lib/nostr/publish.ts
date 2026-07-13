import { SimplePool } from 'nostr-tools/pool';
import type { NostrSigner } from '@nostrify/nostrify';
import type { MonthlyLogEntry, DayEvent } from '../../simulation/types';
import type { ViewerSafeSafety } from '../../simulation/safetyView'; // type-only — no runtime cycle
import { withTimeout } from './timeout';
import { nostrLog } from './log';
import { DEFAULT_RELAYS } from './relays';

export const SETTINGS_DTAG = 'personal-bloc:settings:v1';
export const RECORDS_DTAG  = 'personal-bloc:records:v1';
// Phase 4c — the event-sourced plan channel + the tiny whole-object prefs channel. The lastCreatedAtByDtag
// monotonic clock (below) keys dynamically, so each new d-tag gets its own per-session counter for free.
export const PLAN_EVENTS_DTAG = 'personal-bloc:plan-events:v1';
export const PREFS_DTAG       = 'personal-bloc:prefs:v1';

// Phase 4a-inst — real byte length, NOT UTF-16 code units (String.length). eventBytes/plainBytes below
// exist to confirm the relay payload budget against NIP-44's 65,535-plaintext-BYTE ceiling, so undercounting
// non-ASCII text (viewer labels, month notes) via .length would defeat the point.
const byteLen = (s: string): number => new TextEncoder().encode(s).length;

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

  return publishSignedToRelays(signed, relays, createdAt, dTag, byteLen(plaintext));
}

// Per-relay publish instrumentation (last 10 attempts) — DevPanel "PUBLISH ACKS". Metadata only
// (relay URLs, latencies, statuses, d-tag/kind label) — never amounts, safe for Copy Diagnostics.
export interface PublishReport {
  label:       string;            // dTag or 'kind:10002'
  createdAt:   number;            // unix seconds
  startedAt:   number;            // Date.now() ms
  perRelay:    { url: string; status: 'ack' | 'reject' | 'pending'; ms?: number; err?: string }[];
  outcome:     'ok' | 'fail';
  eventBytes?: number;            // real byte length of the signed event's JSON — wire size (Phase 4a-inst)
  plainBytes?: number;            // real byte length of the pre-encryption JSON, when applicable (Phase 4a-inst)
}
const publishReports: PublishReport[] = [];
function pushReport(r: PublishReport): void { publishReports.push(r); if (publishReports.length > 10) publishReports.shift(); }
export function getPublishReports(): readonly PublishReport[] { return publishReports; }

// nostr-tools 2.23.5 footgun: SimplePool.publish RESOLVES a connection failure as the string
// "connection failure: …" (pool.js catch → return String("connection failure: " + err)) instead of
// rejecting, so an offline publish would count as N fake acks. Normalize these to rejections before the
// quorum (see publishSignedToRelays) — an ack must mean a real relay OK frame.
export const isConnectionFailure = (reason: unknown): boolean =>
  typeof reason === 'string' && reason.startsWith('connection failure:');

/**
 * Await an ACK QUORUM over the per-relay publish promises. Resolves once `acks >= quorum`; rejects the
 * MOMENT the quorum becomes unreachable (`pubs.length - rejections < quorum`, AggregateError of the
 * rejection reasons) or on timeout. `onOutcome` fires for EVERY settle regardless of the resolve/reject
 * state (so instrumentation keeps filling after quorum is met). Pure — the caller passes plain promises,
 * so it's node-testable without a pool.
 */
export async function awaitAckQuorum(
  pubs:      Promise<unknown>[],
  quorum:    number,
  timeoutMs: number,
  onOutcome?: (i: number, ok: boolean, err?: unknown) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (pubs.length === 0) { reject(new Error('no relays')); return; }
    let acks = 0, rejections = 0, done = false;
    const errs: unknown[] = [];
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('publish timeout — quorum not reached')); } }, timeoutMs);
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    pubs.forEach((p, i) => {
      p.then(() => {
        acks++;
        onOutcome?.(i, true);
        if (acks >= quorum) finish(resolve);
      }).catch((err) => {
        rejections++;
        errs.push(err);
        onOutcome?.(i, false, err);
        if (pubs.length - rejections < quorum) finish(() => reject(new AggregateError(errs, 'quorum unreachable')));
      });
    });
  });
}

// Shared publish-and-await-ack tail: resolve once an ACK QUORUM of min(2, pubs.length) confirms (was
// first-ack — a single lying/dying relay could clear the dirty flags; device-confirmed Jul 2026). Rejects
// on quorum-unreachable or 12s timeout; closes the pool after all settle. Records a PublishReport per
// attempt (perRelay filled via onOutcome). Consumed by publishEncrypted (kind-30078) AND
// publishRelayListNip65 (plain kind-10002) — both inherit the quorum. The pubs are normalized so a
// nostr-tools "connection failure: …" STRING RESOLUTION (offline; see isConnectionFailure) becomes a
// rejection before the quorum — an ack counts only a genuine relay OK frame.
function publishSignedToRelays(
  signed:      Parameters<SimplePool['publish']>[1],
  relays:      string[],
  createdAt:   number,
  label:       string,
  plainBytes?: number,
): Promise<number> {
  const pool = new SimplePool();
  const startedAt = Date.now();
  const pubs = pool.publish(relays, signed).map((p) =>       // Promise[] (one per relay)
    p.then((reason) => {
      if (isConnectionFailure(reason)) throw new Error(String(reason));   // an ack must be a real OK frame, not an offline connection-failure string
      return reason;
    }));
  Promise.allSettled(pubs).finally(() => pool.close(relays)); // close after all settle; do NOT block the return
  const quorum = Math.min(2, pubs.length);                    // pubs.length === relays.length normally; using pubs guards the URL-dedup case (quorum can never exceed the actual publish attempts)
  const perRelay: PublishReport['perRelay'] = relays.map((url) => ({ url, status: 'pending' }));
  const eventBytes = byteLen(JSON.stringify(signed));
  const report: PublishReport = { label, createdAt, startedAt, perRelay, outcome: 'fail', eventBytes, ...(plainBytes !== undefined ? { plainBytes } : {}) };
  pushReport(report);   // add to ring now; mutate in place as outcomes arrive
  const onOutcome = (i: number, ok: boolean, err?: unknown) => {
    perRelay[i] = {
      url: relays[i], status: ok ? 'ack' : 'reject', ms: Date.now() - startedAt,
      ...(err !== undefined ? { err: err instanceof Error ? err.message : String(err) } : {}),
    };
  };
  return awaitAckQuorum(pubs, quorum, 12000, onOutcome).then(() => {
    report.outcome = 'ok';
    const rejected = perRelay.filter((r) => r.status === 'reject');
    if (rejected.length) nostrLog('warn', `publish ${label}: quorum met but ${rejected.length} relay(s) rejected: ${rejected.map((r) => r.url).join(', ')}`);
    return createdAt;
  }).catch((err) => { report.outcome = 'fail'; throw err; });
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
  return publishSignedToRelays(signed, publishTo, createdAt, 'kind:10002');
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

// Viewer access — ONE combined snapshot sealed to a configured viewer's pubkey (Option B: includes live
// Strike balances). The owner's device NIP-44-encrypts to the viewer's pubkey; only that viewer can decrypt.
// Fire-and-forget at the publish layer — the caller (publishViewerSnapshotNow) owns gating + log-only failure.
//
// Multi-viewer M2: addressing is PER-VIEWER (kind-30078 is one live event per author+d-tag, so N viewers on
// one d-tag would overwrite each other). Each viewer gets `personal-bloc:viewer:v2:<pubkeyHex>`. CLEAN-CUT —
// the v1 d-tag is deleted (no transitional read); after deploy the owner rotates + re-provisions the viewer.
export const viewerDTag = (pubkeyHex: string) => `personal-bloc:viewer:v2:${pubkeyHex}`;

// V2 — MODE-SHAPED. Every field optional so a SAFE payload (health only) and a TRUSTED payload (today's
// full data) are the same type, and old (pre-V2) events without privacyMode still typecheck + read as
// trusted. A SAFE payload carries ONLY the common + safe keys — no settings/records/strike/cbCollateralBtc/
// strikeCollateralBtc exist in it by construction (the privacy audit is Object.keys). A TRUSTED payload adds today's block.
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
  strikeCollateralBtc?: number;   // C-P4 (BUG2 mirror) — the derived reading-anchored Strike-collateral scalar; the viewer raw-sets it (never gets the dayLog journal)
}

export async function publishViewerSnapshot(
  writerSigner: NostrSigner,
  viewerPubkey: string,
  payload:      ViewerSnapshot,
  relays?:      string[],
  opTimeoutMs?: number,
): Promise<number> {
  // M2 — per-viewer d-tag (a pure function of the target pubkey); covers both snapshots + revocation tombstones.
  return publishEncrypted(writerSigner, viewerPubkey, viewerDTag(viewerPubkey), payload, relays, opTimeoutMs);
}
