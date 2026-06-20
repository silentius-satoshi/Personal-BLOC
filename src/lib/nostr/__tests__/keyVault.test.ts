import { describe, it, expect } from 'vitest';
import { wrapSecretKey, unwrapSecretKey, deriveStoreKey, encryptBlob, decryptBlob } from '../keyVault';

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
