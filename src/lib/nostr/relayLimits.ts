// 5b (spec `pbloc-spec-journal-pages-v1`) — measure what each relay actually accepts (DevPanel → RELAY LIMITS → Probe).
// A relay's NIP-11 document advertises max_message_length — on strfry, the websocket FRAME cap
// (relay.maxWebsocketPayloadSize) — but never the cap that refuses an event: strfry checks events.maxEventSize (65,536 B
// by default) against the event's normalised JSON, and doesn't advertise it. So the probe also SENDS: three throwaway
// events whose content is as long as this app's NIP-44 payload would be for 1 KB of plain JSON, for exactly NIP-44's
// 40,960 B step, and for one byte past it — signed by a ONE-TIME key made for the probe, never the user's (nothing lands
// under their account, no signer prompt), on a probe d-tag. Each relay's OK or refusal, with its message, is the
// measurement. Metadata only: URLs, sizes, statuses.
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';
import { fetchRelayInformation } from 'nostr-tools/nip11';
import { PLAIN_STEP_BYTES } from './payloadSize';
import { isConnectionFailure } from './publish';
import { withTimeout } from './timeout';
import { redactSensitive } from './log';

export const PROBE_DTAG = 'personal-bloc:probe:v1';
/** 1 KB (does the relay take an event from a new key at all?), exactly the step, one byte past it. */
export const PROBE_PLAIN_SIZES = [1_024, PLAIN_STEP_BYTES, PLAIN_STEP_BYTES + 1] as const;

/** NIP-44 v2's calc_padded_len. */
export function nip44PaddedLen(plainBytes: number): number {
  if (plainBytes <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(plainBytes - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((plainBytes - 1) / chunk) + 1);
}
/** The base64 payload NIP-44 v2 sends for a plaintext of this many bytes (1–65,535): a version byte, the 32-byte nonce,
 *  the 2-byte length, the padded plaintext and the 32-byte MAC. */
export function nip44PayloadLen(plainBytes: number): number {
  return 4 * Math.ceil((1 + 32 + 2 + nip44PaddedLen(plainBytes) + 32) / 3);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Random base64 characters — the probe's stand-in for a ciphertext of that length. getRandomValues fills at most
 *  65,536 bytes a call, and the past-the-step probe needs more. */
export function filler(length: number): string {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 65_536) crypto.getRandomValues(bytes.subarray(i, Math.min(length, i + 65_536)));
  let s = '';
  for (const b of bytes) s += B64[b & 63];
  return s;
}

export interface RelayInfo { url: string; software?: string; version?: string; maxMessageLength?: number; error?: string }

/** The relay's NIP-11 document: its software and the frame cap it advertises. */
export async function fetchRelayInfo(url: string, timeoutMs = 8_000): Promise<RelayInfo> {
  try {
    const doc = await withTimeout(fetchRelayInformation(url), timeoutMs, 'NIP-11') as unknown as Record<string, unknown>;
    const limitation = (doc.limitation ?? {}) as Record<string, unknown>;
    return {
      url,
      ...(typeof doc.software === 'string' ? { software: doc.software } : {}),
      ...(typeof doc.version === 'string' ? { version: doc.version } : {}),
      ...(typeof limitation.max_message_length === 'number' ? { maxMessageLength: limitation.max_message_length } : {}),
    };
  } catch (e) {
    return { url, error: redactSensitive(e instanceof Error ? e.message : String(e)) };
  }
}

export interface ProbeResult { url: string; plainBytes: number; eventBytes: number; status: 'ack' | 'reject'; message?: string }

/** Send the three probe events to every relay; one result per relay per size. */
export async function probeRelaySizes(relays: string[], timeoutMs = 12_000): Promise<ProbeResult[]> {
  const sk = generateSecretKey();   // one-time — never stored, never the user's
  const pool = new SimplePool();
  const results: ProbeResult[] = [];
  const t0 = Math.floor(Date.now() / 1000);
  try {
    for (const [i, plainBytes] of PROBE_PLAIN_SIZES.entries()) {
      const event = finalizeEvent(
        { kind: 30078, created_at: t0 + i, tags: [['d', PROBE_DTAG]], content: filler(nip44PayloadLen(plainBytes)) },   // each newer than the last
        sk,
      );
      const eventBytes = new TextEncoder().encode(JSON.stringify(event)).length;
      const settled = await Promise.allSettled(pool.publish(relays, event).map((p) =>
        withTimeout(p.then((reason) => { if (isConnectionFailure(reason)) throw new Error(String(reason)); return reason; }), timeoutMs, 'probe publish')));
      settled.forEach((s, r) => {
        results.push({
          url: relays[r], plainBytes, eventBytes, status: s.status === 'fulfilled' ? 'ack' : 'reject',
          ...(s.status === 'rejected' ? { message: redactSensitive(s.reason instanceof Error ? s.reason.message : String(s.reason)) } : {}),
        });
      });
    }
  } finally {
    pool.close(relays);
  }
  return results;
}
