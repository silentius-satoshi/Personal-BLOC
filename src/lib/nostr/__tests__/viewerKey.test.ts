import { describe, it, expect } from 'vitest';
import { getPublicKey, generateSecretKey } from 'nostr-tools';
import { deriveViewerKeyFromNsec } from '../viewerKey';

// A fixed owner secret key + pubkey so determinism assertions are reproducible run-to-run.
const OWNER_SK = new Uint8Array(32).fill(7);          // valid scalar (all 0x07)
const OWNER_PUBKEY = getPublicKey(OWNER_SK);
const OTHER_PUBKEY = getPublicKey(new Uint8Array(32).fill(9));

describe('deriveViewerKeyFromNsec', () => {
  it('is DETERMINISTIC — same sk + pubkey + version → identical 32 bytes', async () => {
    const a = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1);
    const b = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1);
    expect(a.length).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));   // byte-for-byte reproducible
  });

  it('DOMAIN SEPARATION — a different version derives a different key', async () => {
    const v1 = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1);
    const v2 = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 2);
    expect(Array.from(v1)).not.toEqual(Array.from(v2));
  });

  it('DOMAIN SEPARATION — a different owner pubkey (salt) derives a different key', async () => {
    const a = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1);
    const b = await deriveViewerKeyFromNsec(OWNER_SK, OTHER_PUBKEY, 1);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('DOMAIN SEPARATION — a different owner sk (ikm) derives a different key', async () => {
    const otherSk = new Uint8Array(32).fill(9);
    const a = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1);
    const b = await deriveViewerKeyFromNsec(otherSk, OWNER_PUBKEY, 1);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('produces a VALID secp256k1 secret key (getPublicKey does not throw)', async () => {
    // Exercise a handful of random owner keys — each derived key must be a usable scalar.
    for (let i = 0; i < 5; i++) {
      const sk = generateSecretKey();
      const derived = await deriveViewerKeyFromNsec(sk, getPublicKey(sk), 1);
      expect(() => getPublicKey(derived)).not.toThrow();
    }
  });

  it('does NOT mutate the input sk and returns a distinct fresh array (zeroing-safety contract)', async () => {
    const sk = new Uint8Array(32).fill(7);
    const before = Array.from(sk);
    const derived = await deriveViewerKeyFromNsec(sk, OWNER_PUBKEY, 1);
    expect(Array.from(sk)).toEqual(before);          // input untouched
    expect(derived).not.toBe(sk);                    // distinct object
    // zeroing the output must not affect the input (independent buffers)
    derived.fill(0);
    expect(Array.from(sk)).toEqual(before);
  });
});
