import { describe, it, expect } from 'vitest';
import { getPublicKey, generateSecretKey } from 'nostr-tools';
import { deriveViewerKeyFromNsec } from '../viewerKey';

// A fixed owner secret key + pubkey so determinism assertions are reproducible run-to-run.
const OWNER_SK = new Uint8Array(32).fill(7);          // valid scalar (all 0x07)
const OWNER_PUBKEY = getPublicKey(OWNER_SK);
const OTHER_PUBKEY = getPublicKey(new Uint8Array(32).fill(9));

// M2 regression pin — replicate the OLD (pre-M2) index-LESS HKDF label `personal-bloc/viewer-key/v${version}`
// so the test can prove the new 4-arg signature does NOT reproduce it. Standalone (does NOT import the old code
// path, which is gone). Single-shot deriveBits is sufficient — the fixed test key is in range.
async function oldDeriveIndexless(sk: Uint8Array, ownerPubkeyHex: string, version: number): Promise<Uint8Array> {
  const subtle = crypto.subtle;
  const enc = (s: string) => new TextEncoder().encode(s);
  const ikmKey = await subtle.importKey('raw', sk as unknown as BufferSource, 'HKDF', false, ['deriveBits']);
  const saltBuf = await subtle.digest('SHA-256', enc(ownerPubkeyHex) as unknown as BufferSource);
  const info = enc(`personal-bloc/viewer-key/v${version}`);   // OLD label — no /i${index}
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(saltBuf) as unknown as BufferSource, info: info as unknown as BufferSource },
    ikmKey, 256,
  );
  return new Uint8Array(bits);
}

describe('deriveViewerKeyFromNsec (M2 — 4-arg, per-slot indexed)', () => {
  it('is DETERMINISTIC — same sk + pubkey + version + index → identical 32 bytes', async () => {
    const a = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 0);
    const b = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 0);
    expect(a.length).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));   // byte-for-byte reproducible
  });

  it('DOMAIN SEPARATION — same version, DIFFERENT INDEX → different key (per-slot keys)', async () => {
    const i0 = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 0);
    const i1 = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 1);
    expect(Array.from(i0)).not.toEqual(Array.from(i1));
  });

  it('DOMAIN SEPARATION — a different version derives a different key (rotation)', async () => {
    const v1 = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 0);
    const v2 = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 2, 0);
    expect(Array.from(v1)).not.toEqual(Array.from(v2));
  });

  it('DOMAIN SEPARATION — a different owner pubkey (salt) derives a different key', async () => {
    const a = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 0);
    const b = await deriveViewerKeyFromNsec(OWNER_SK, OTHER_PUBKEY, 1, 0);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('DOMAIN SEPARATION — a different owner sk (ikm) derives a different key', async () => {
    const otherSk = new Uint8Array(32).fill(9);
    const a = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 0);
    const b = await deriveViewerKeyFromNsec(otherSk, OWNER_PUBKEY, 1, 0);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('REGRESSION PIN — the new label is NOT reproducible by the old index-less v1 label', async () => {
    const neu = await deriveViewerKeyFromNsec(OWNER_SK, OWNER_PUBKEY, 1, 0);   // …/v1/i0
    const old = await oldDeriveIndexless(OWNER_SK, OWNER_PUBKEY, 1);           // …/v1
    expect(Array.from(neu)).not.toEqual(Array.from(old));
  });

  it('produces a VALID secp256k1 secret key (getPublicKey does not throw)', async () => {
    // Exercise a handful of random owner keys — each derived key must be a usable scalar.
    for (let i = 0; i < 5; i++) {
      const sk = generateSecretKey();
      const derived = await deriveViewerKeyFromNsec(sk, getPublicKey(sk), 1, i);
      expect(() => getPublicKey(derived)).not.toThrow();
    }
  });

  it('does NOT mutate the input sk and returns a distinct fresh array (zeroing-safety contract)', async () => {
    const sk = new Uint8Array(32).fill(7);
    const before = Array.from(sk);
    const derived = await deriveViewerKeyFromNsec(sk, OWNER_PUBKEY, 1, 0);
    expect(Array.from(sk)).toEqual(before);          // input untouched
    expect(derived).not.toBe(sk);                    // distinct object
    // zeroing the output must not affect the input (independent buffers)
    derived.fill(0);
    expect(Array.from(sk)).toEqual(before);
  });
});
