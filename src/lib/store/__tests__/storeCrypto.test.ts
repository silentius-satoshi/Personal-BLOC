import { describe, it, expect, beforeEach } from 'vitest';
import { encryptedStorage, setStoreKey, isStoreUnlocked } from '../storeCrypto';
import { deriveStoreKey, wrapSecretKey } from '../../nostr/keyVault';

// vitest runs in the node env (no localStorage; WebCrypto is a node global — same as the keyVault tests). Provide
// a minimal in-memory localStorage shim so the adapter has the global it reads.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

// Phase B — the encrypted persist adapter (PIN path, jsdom). Proves: envelope written (not plaintext), locked =
// no hydrate + no write, plaintext passthrough.
const sk = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) & 0xff);

async function aStoreKey(pin = '1234') {
  const { meta } = await wrapSecretKey(sk, 'pin', pin);   // borrow a salt
  return deriveStoreKey('pin', { salt: meta.salt }, pin);
}

describe('encryptedStorage adapter (Phase B)', () => {
  beforeEach(() => { localStorage.clear(); setStoreKey(null); });

  it('setItem writes a {ct,iv} envelope (NOT plaintext); getItem decrypts it back', async () => {
    setStoreKey(await aStoreKey());
    expect(isStoreUnlocked()).toBe(true);
    const json = '{"income":4000}';
    await encryptedStorage.setItem('k', json);

    const stored = localStorage.getItem('k')!;
    expect(stored).not.toContain('income');          // not plaintext
    const env = JSON.parse(stored);
    expect(env.ct).toBeTruthy();
    expect(env.iv).toBeTruthy();
    expect('income' in env).toBe(false);

    expect(await encryptedStorage.getItem('k')).toBe(json);
  });

  it('LOCKED (no key): getItem on an envelope → null; setItem writes NOTHING', async () => {
    // First write an envelope while unlocked, then lock.
    setStoreKey(await aStoreKey());
    await encryptedStorage.setItem('k', '{"x":1}');
    setStoreKey(null);
    expect(await encryptedStorage.getItem('k')).toBeNull();

    // setItem while locked is a no-op — the existing value is untouched, no new key written.
    const before = localStorage.getItem('k');
    await encryptedStorage.setItem('locked', '{"y":2}');
    expect(localStorage.getItem('locked')).toBeNull();
    expect(localStorage.getItem('k')).toBe(before);   // unchanged
  });

  it('plaintext passthrough: getItem on a non-enveloped value returns it as-is (Phase-C interim)', async () => {
    localStorage.setItem('plain', '{"income":4000}');   // a pre-encryption plaintext blob, no ct/iv
    expect(await encryptedStorage.getItem('plain')).toBe('{"income":4000}');
  });

  it('wrong key → getItem returns null (does not throw)', async () => {
    setStoreKey(await aStoreKey('right'));
    await encryptedStorage.setItem('k', '{"z":3}');
    setStoreKey(await aStoreKey('wrong'));
    expect(await encryptedStorage.getItem('k')).toBeNull();
  });
});
