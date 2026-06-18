import { describe, it, expect } from 'vitest';
import { wrapSecretKey, unwrapSecretKey } from '../keyVault';

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
