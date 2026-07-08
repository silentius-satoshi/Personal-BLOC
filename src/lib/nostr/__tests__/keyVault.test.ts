import { describe, it, expect } from 'vitest';
import { getPublicKey } from 'nostr-tools/pure';
import { wrapSecretKey, unwrapSecretKey, unwrapRecoveryPayload, deriveStoreKey, deriveStoreKeyFromNsec, encryptBlob, decryptBlob, type WrapMeta } from '../keyVault';
import { deriveSkFromEntropy } from '../nip06Key';

// PIN path only — the PRF (WebAuthn/Face ID) path needs a platform authenticator and is verified on-device.
// These exercise the shared PBKDF2 → HKDF → AES-GCM crypto via Node's WebCrypto.
const sk = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);

describe('keyVault — PIN path', () => {
  it('wrap → unwrap round-trips the secret', async () => {
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', '1234');
    expect(meta.scheme).toBe('pin');
    expect(meta.iv).toBeTruthy();
    expect(meta.salt).toBeTruthy();
    const out = await unwrapSecretKey(ciphertext, meta, '1234');
    expect(Array.from(out)).toEqual(Array.from(sk));
  });

  it('wrong PIN fails to decrypt', async () => {
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', 'correct-horse');
    await expect(unwrapSecretKey(ciphertext, meta, 'wrong-horse')).rejects.toThrow();
  });

  it('malformed meta throws', async () => {
    await expect(
      unwrapSecretKey('AAAA', { iv: '', salt: '', scheme: 'pin' } as any, '1234'),
    ).rejects.toThrow('malformed');
  });

  it('pin scheme requires a PIN on unwrap', async () => {
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', '1234');
    await expect(unwrapSecretKey(ciphertext, meta)).rejects.toThrow('PIN required');
  });

  it('wrap requires a PIN for the pin scheme', async () => {
    await expect(wrapSecretKey(sk, 'pin')).rejects.toThrow('PIN required');
  });

  it('each wrap uses a fresh salt + iv (ciphertext differs)', async () => {
    const a = await wrapSecretKey(sk, 'pin', 'same');
    const b = await wrapSecretKey(sk, 'pin', 'same');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.meta.salt).not.toBe(b.meta.salt);
    expect(a.meta.iv).not.toBe(b.meta.iv);
  });
});

// Phase A — store-encryption primitives (independent key from the same unlock; PIN path in jsdom).
describe('keyVault — store key (Phase A)', () => {
  it('deriveStoreKey round-trips encryptBlob → decryptBlob', async () => {
    const { meta } = await wrapSecretKey(sk, 'pin', '1234');
    const storeKey = await deriveStoreKey('pin', { salt: meta.salt }, '1234');
    const { ct, iv } = await encryptBlob('{"income":4000}', storeKey);
    expect(await decryptBlob(ct, iv, storeKey)).toBe('{"income":4000}');
  });

  it('is cryptographically INDEPENDENT of the nsec-wrap key (same pin+salt, different HKDF info)', async () => {
    // Wrap a secret, then derive the store key from the SAME pin + salt. The different info label must yield a
    // different AES key → the store key cannot decrypt the wrap ciphertext (GCM auth failure across infos).
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', 'shared-pin');
    const storeKey = await deriveStoreKey('pin', { salt: meta.salt }, 'shared-pin');
    await expect(decryptBlob(ciphertext, meta.iv, storeKey)).rejects.toThrow();
    // sanity: the wrap path itself is unchanged — still unwraps with the same pin.
    expect(Array.from(await unwrapSecretKey(ciphertext, meta, 'shared-pin'))).toEqual(Array.from(sk));
  });

  it('a blob fails to decrypt under a store key from a different pin', async () => {
    const { meta } = await wrapSecretKey(sk, 'pin', 'pin-a');
    const keyA = await deriveStoreKey('pin', { salt: meta.salt }, 'pin-a');
    const keyB = await deriveStoreKey('pin', { salt: meta.salt }, 'pin-b');   // wrong pin, same salt
    const { ct, iv } = await encryptBlob('secret', keyA);
    await expect(decryptBlob(ct, iv, keyB)).rejects.toThrow();
  });

  it('encryptBlob uses a fresh random IV per call (same plaintext + key)', async () => {
    const { meta } = await wrapSecretKey(sk, 'pin', '1234');
    const storeKey = await deriveStoreKey('pin', { salt: meta.salt }, '1234');
    const a = await encryptBlob('same', storeKey);
    const b = await encryptBlob('same', storeKey);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});

// 3a.1 — store key derived from the nsec itself (no separate credential). PIN-free: pure nsec + pubkey via WebCrypto.
describe('keyVault — deriveStoreKeyFromNsec (3a.1)', () => {
  const skA = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
  const skB = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff);
  const pubA = 'a'.repeat(64);
  const pubB = 'b'.repeat(64);

  it('is deterministic — same nsec + pubkey → same key (round-trips across two derivations)', async () => {
    const k1 = await deriveStoreKeyFromNsec(skA, pubA);
    const k2 = await deriveStoreKeyFromNsec(skA, pubA);
    const { ct, iv } = await encryptBlob('{"income":4000}', k1);
    expect(await decryptBlob(ct, iv, k2)).toBe('{"income":4000}');
  });

  it('different nsec → different key (cross-decrypt throws)', async () => {
    const k1 = await deriveStoreKeyFromNsec(skA, pubA);
    const k2 = await deriveStoreKeyFromNsec(skB, pubA);   // different nsec, same pubkey
    const { ct, iv } = await encryptBlob('secret', k1);
    await expect(decryptBlob(ct, iv, k2)).rejects.toThrow();
  });

  it('different pubkey → different key via the salt (cross-decrypt throws)', async () => {
    const k1 = await deriveStoreKeyFromNsec(skA, pubA);
    const k2 = await deriveStoreKeyFromNsec(skA, pubB);   // same nsec, different pubkey-salt
    const { ct, iv } = await encryptBlob('secret', k1);
    await expect(decryptBlob(ct, iv, k2)).rejects.toThrow();
  });

  it('is INDEPENDENT of the nsec-WRAP key (STORE_ENC_INFO label) — cannot decrypt the wrap ciphertext', async () => {
    const { ciphertext, meta } = await wrapSecretKey(skA, 'pin', 'shared-pin');
    const storeKey = await deriveStoreKeyFromNsec(skA, pubA);
    await expect(decryptBlob(ciphertext, meta.iv, storeKey)).rejects.toThrow();
    // sanity: the wrap path itself still unwraps with the same pin.
    expect(Array.from(await unwrapSecretKey(ciphertext, meta, 'shared-pin'))).toEqual(Array.from(skA));
  });

  it('does not mutate the caller sk (copies the buffer)', async () => {
    const before = Array.from(skA);
    await deriveStoreKeyFromNsec(skA, pubA);
    expect(Array.from(skA)).toEqual(before);
  });
});

// R2a-2 — the payloadKind discriminator. PIN wrap path, as above.
describe('keyVault — payloadKind (R2a-2)', () => {
  const entropy = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

  it("wrapping entropy records the kind, and unwrapSecretKey DERIVES the 32-byte sk (not a passthrough)", async () => {
    const { ciphertext, meta } = await wrapSecretKey(entropy, 'pin', '1234', undefined, 'nip06-entropy');
    expect(meta.payloadKind).toBe('nip06-entropy');

    const out = await unwrapSecretKey(ciphertext, meta, '1234');
    expect(out).toHaveLength(32);   // ← 32, not the 16-byte payload: this is what proves derivation happened
    expect(getPublicKey(out)).toBe(getPublicKey(deriveSkFromEntropy(entropy)));
  });

  it("a new 'sk' wrap records payloadKind:'sk' and round-trips byte-identically", async () => {
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', '1234');   // default kind
    expect(meta.payloadKind).toBe('sk');
    expect(Array.from(await unwrapSecretKey(ciphertext, meta, '1234'))).toEqual(Array.from(sk));
  });

  // ⚠ THE COMPATIBILITY CONTRACT. Every key wrapped before R2a-2 has meta WITHOUT payloadKind, persisted
  // through JSON (useStore's WK_META_KEY / the persist blob). Absence must mean 'sk' forever.
  it("LEGACY: meta with NO payloadKind unwraps as 'sk', byte-identically, even after a JSON round-trip", async () => {
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', '1234');
    const { payloadKind: _drop, ...stripped } = meta;
    const legacyMeta = JSON.parse(JSON.stringify(stripped)) as WrapMeta;   // exactly how it is persisted + re-read
    expect('payloadKind' in legacyMeta).toBe(false);

    expect(Array.from(await unwrapSecretKey(ciphertext, legacyMeta, '1234'))).toEqual(Array.from(sk));
    const { payloadKind, bytes } = await unwrapRecoveryPayload(ciphertext, legacyMeta, '1234');
    expect(payloadKind).toBe('sk');                       // absent ⇒ 'sk'
    expect(Array.from(bytes)).toEqual(Array.from(sk));
  });

  it('unwrapRecoveryPayload returns the payload AS STORED (entropy stays 16 bytes — it must NOT derive)', async () => {
    const { ciphertext, meta } = await wrapSecretKey(entropy, 'pin', '1234', undefined, 'nip06-entropy');
    const { payloadKind, bytes } = await unwrapRecoveryPayload(ciphertext, meta, '1234');
    expect(payloadKind).toBe('nip06-entropy');
    expect(bytes).toHaveLength(16);
    expect(Array.from(bytes)).toEqual(Array.from(entropy));
  });

  it('an unknown future payloadKind falls through the legacy path rather than becoming unreadable', async () => {
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', '1234');
    const futureMeta = { ...meta, payloadKind: 'something-new-in-2030' } as unknown as WrapMeta;
    expect(Array.from(await unwrapSecretKey(ciphertext, futureMeta, '1234'))).toEqual(Array.from(sk));
  });

  it('unwrapRecoveryPayload still enforces the malformed-meta guard and the PIN requirement', async () => {
    await expect(unwrapRecoveryPayload('AAAA', { iv: '', salt: '', scheme: 'pin' } as any, '1234')).rejects.toThrow('malformed');
    const { ciphertext, meta } = await wrapSecretKey(sk, 'pin', '1234');
    await expect(unwrapRecoveryPayload(ciphertext, meta)).rejects.toThrow('PIN required');
  });
});
