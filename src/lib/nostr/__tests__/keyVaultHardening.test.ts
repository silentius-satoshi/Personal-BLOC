import { describe, it, expect, afterEach, vi } from 'vitest';
import { wrapSecretKey, unwrapSecretKey } from '../keyVault';
import { deriveSkFromEntropy } from '../nip06Key';

// Hardening 1 · keys. PIN path only, through Node's WebCrypto — the keyVault.test.ts setup (the PRF/WebAuthn path
// is device-gated). Every byte here is a synthetic fixed pattern, never a real key.

afterEach(() => { vi.restoreAllMocks(); });

describe('keyVault — hardening', () => {
  it('HK-01 · identity.md `The words string` (callers own zeroing entropy and sk) + `unwrapSecretKey` return type — unwrapSecretKey returns the 32-byte sk and zeroes the decrypted NIP-06 entropy it derived it from', async () => {
    const entropy = new Uint8Array(16).fill(5);   // synthetic 16-byte NIP-06 entropy
    const { ciphertext, meta } = await wrapSecretKey(entropy.slice(), 'pin', '1234', undefined, 'nip06-entropy');

    // unwrapSecretKey views the decrypted ArrayBuffer without copying — capture it to see what is left behind.
    let captured: ArrayBuffer | null = null;
    const real = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args: Parameters<SubtleCrypto['decrypt']>) => {
      const out = await real(...args);
      captured = out;
      return out;
    });

    const sk = await unwrapSecretKey(ciphertext, meta, '1234');

    // The return contract: ALWAYS the 32-byte secret key — the one the stored entropy derives.
    expect(sk.length).toBe(32);
    expect(Array.from(sk)).toEqual(Array.from(deriveSkFromEntropy(new Uint8Array(16).fill(5))));
    // The zeroable form this call held (the 16-byte entropy) never outlives it: every byte is 0.
    expect(captured).not.toBeNull();
    expect(Array.from(new Uint8Array(captured!))).toEqual(new Array(16).fill(0));
  });

  it('HK-02 · identity.md `WrapMeta.payloadKind` (a wrapped key can never become unreadable) — a PIN-wrapped key stored by an earlier build, meta with no payloadKind, still unwraps to its 32 bytes', async () => {
    // A STORED vector, made once with the base's (c7f709e) PIN derivation and pasted in — never re-wrapped here: the
    // ciphertext of the synthetic sk new Uint8Array(32).fill(7) under PIN '1234', with the synthetic salt
    // fill(3) (16 bytes) and iv fill(9) (12 bytes). Its meta carries no payloadKind, as every pre-R2a-2 key's
    // persisted meta does. Whatever the vault's key derivation becomes, this key must still open.
    const ciphertext = 'o/5GauuduUfn6DzvWFMfMex6/eMjQOOlpdEPQl2nJyzloU+eke1M1SHN8WTLY9P2';
    const meta = { scheme: 'pin' as const, salt: 'AwMDAwMDAwMDAwMDAwMDAw==', iv: 'CQkJCQkJCQkJCQkJ' };

    const sk = await unwrapSecretKey(ciphertext, meta, '1234');

    // Absent ⇒ 'sk': the stored bytes come back verbatim — the 32-byte fill(7) that was wrapped.
    expect(Array.from(sk)).toEqual(new Array(32).fill(7));
  });
});
