// Deterministic viewer-key derivation. Derives a viewer's secp256k1 secret key from the OWNER's nsec,
// so the owner can regenerate the exact same viewer key at any time (no separate backup) and hand it off
// in person. Because it is deterministic in (ownerSk, ownerPubkeyHex, keyVersion, index), re-running
// "Generate viewer key" for the same slot yields the identical nsec — that IS the recovery/regeneration
// property. (Multi-viewer M2: the label is PER-SLOT-INDEXED so each roster slot derives a distinct key.)
//
// CRYPTO DOMAIN: this is its OWN domain, separate from keyVault.ts. It uses WebCrypto directly and does NOT
// import keyVault's helpers or reuse its HKDF info labels — a distinct `personal-bloc/viewer-key/v${keyVersion}/i${index}`
// info string keeps the viewer key cryptographically independent from the at-rest wrap/store keys.
//
// SECURITY: the derived key is returned in memory only and NEVER persisted or logged here. The caller owns
// its lifecycle and MUST zero it after use (`.fill(0)`), exactly as the local-key reveal path does.

import { getPublicKey } from 'nostr-tools';

const utf8 = (s: string) => new TextEncoder().encode(s);
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/**
 * Derive a 32-byte viewer secret key from the owner's secret key, for roster slot `index`.
 *
 * HKDF-SHA256: ikm = owner sk, salt = SHA-256(utf8(ownerPubkeyHex)), info =
 * `personal-bloc/viewer-key/v${keyVersion}/i${index}`, deriveBits 256. The `index` makes every roster slot's
 * key distinct even at the same keyVersion (Multi-viewer M2); `keyVersion` is per-slot (rotation bumps it).
 *
 * The 256 bits must be a VALID secp256k1 scalar (1 ≤ d < n). The out-of-range probability is ~2^-128, but on
 * the vanishing chance it is out of range we append `/${counter}` to the info label and re-derive — a stable,
 * deterministic bump (never random), so the result stays reproducible.
 *
 * Does NOT mutate `sk` (importKey reads it, doesn't retain a reference). Returns a fresh Uint8Array — the
 * caller must zero it after use.
 */
export async function deriveViewerKeyFromNsec(
  sk: Uint8Array,
  ownerPubkeyHex: string,
  keyVersion: number,
  index: number,
): Promise<Uint8Array> {
  const subtle = crypto.subtle;
  const ikmKey = await subtle.importKey('raw', bs(sk), 'HKDF', false, ['deriveBits']);
  const saltBuf = await subtle.digest('SHA-256', bs(utf8(ownerPubkeyHex)));
  const salt = new Uint8Array(saltBuf);
  const baseInfo = `personal-bloc/viewer-key/v${keyVersion}/i${index}`;

  for (let counter = 0; ; counter++) {
    const info = utf8(counter === 0 ? baseInfo : `${baseInfo}/${counter}`);
    const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bs(salt), info: bs(info) }, ikmKey, 256);
    const cand = new Uint8Array(bits);
    // getPublicKey throws "invalid scalar: out of range" on a bad scalar — the validity gate (no extra deps).
    try { getPublicKey(cand); return cand; } catch { /* out of range → bump counter, re-derive */ }
  }
}
