import { describe, it, expect, beforeEach, vi } from 'vitest';

// node env has no localStorage — minimal in-memory shim (same as storeCrypto.test.ts).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

// Mock keyVault so decryptBlob is a controllable passthrough (real impl by default; overridable per-test to
// force a verify mismatch). deriveStoreKey / encryptBlob / wrapSecretKey stay real.
vi.mock('../../nostr/keyVault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../nostr/keyVault')>();
  return { ...actual, decryptBlob: vi.fn(actual.decryptBlob) };
});

import { deriveStoreKey, encryptBlob, decryptBlob, wrapSecretKey } from '../../nostr/keyVault';
import { setStoreKey } from '../storeCrypto';
import { migratePlaintextToEncrypted, migrateEncryptedToPlaintext } from '../storeMigration';

const NAME = 'personal-bloc-store';
const PLAINTEXT = '{"state":{"income":4000,"monthlyLog":[]},"version":18}';
const sk = Uint8Array.from({ length: 32 }, (_, i) => (i * 3 + 2) & 0xff);

async function aKey(pin = '1234') {
  const { meta } = await wrapSecretKey(sk, 'pin', pin);
  return deriveStoreKey('pin', { salt: meta.salt }, pin);
}

describe('storeMigration — verify-before-delete (Phase C)', () => {
  beforeEach(() => { mem.clear(); setStoreKey(null); vi.mocked(decryptBlob).mockClear(); });

  it('plaintext → encrypted: writes a {ct,iv} envelope that decrypts to the EXACT original; idempotent', async () => {
    localStorage.setItem(NAME, PLAINTEXT);
    setStoreKey(await aKey());

    expect(await migratePlaintextToEncrypted()).toBe(true);
    const stored = localStorage.getItem(NAME)!;
    const env = JSON.parse(stored);
    expect(env.ct).toBeTruthy();
    expect(env.iv).toBeTruthy();
    expect(stored).not.toContain('income');                       // not plaintext anymore

    // re-run is idempotent (already an envelope)
    const before = localStorage.getItem(NAME);
    expect(await migratePlaintextToEncrypted()).toBe(true);
    expect(localStorage.getItem(NAME)).toBe(before);
  });

  it('round-trips back to the EXACT original plaintext with the same key', async () => {
    localStorage.setItem(NAME, PLAINTEXT);
    const key = await aKey();
    setStoreKey(key);
    await migratePlaintextToEncrypted();
    const env = JSON.parse(localStorage.getItem(NAME)!);
    expect(await decryptBlob(env.ct, env.iv, key)).toBe(PLAINTEXT);
  });

  // THE critical test: a verify mismatch must NOT overwrite the plaintext.
  it('VERIFY-BEFORE-DELETE: a verify mismatch returns false AND leaves the original plaintext intact', async () => {
    localStorage.setItem(NAME, PLAINTEXT);
    setStoreKey(await aKey());
    vi.mocked(decryptBlob).mockResolvedValueOnce('TAMPERED');   // the verify round-trip won't equal raw

    expect(await migratePlaintextToEncrypted()).toBe(false);
    expect(localStorage.getItem(NAME)).toBe(PLAINTEXT);          // SURVIVES — not overwritten
  });

  it('no key → returns false, plaintext untouched', async () => {
    localStorage.setItem(NAME, PLAINTEXT);
    setStoreKey(null);
    expect(await migratePlaintextToEncrypted()).toBe(false);
    expect(localStorage.getItem(NAME)).toBe(PLAINTEXT);
  });
});

describe('storeMigration — encrypted → plaintext (Phase C OFF)', () => {
  beforeEach(() => { mem.clear(); setStoreKey(null); vi.mocked(decryptBlob).mockClear(); });

  it('restores the EXACT plaintext from an envelope', async () => {
    const key = await aKey();
    const env = await encryptBlob(PLAINTEXT, key);
    localStorage.setItem(NAME, JSON.stringify(env));
    setStoreKey(key);

    expect(await migrateEncryptedToPlaintext()).toBe(true);
    expect(localStorage.getItem(NAME)).toBe(PLAINTEXT);
  });

  it('decrypt failure → false, envelope intact', async () => {
    const env = await encryptBlob(PLAINTEXT, await aKey('right'));
    const raw = JSON.stringify(env);
    localStorage.setItem(NAME, raw);
    setStoreKey(await aKey('wrong'));   // different key → decrypt throws

    expect(await migrateEncryptedToPlaintext()).toBe(false);
    expect(localStorage.getItem(NAME)).toBe(raw);   // envelope untouched
  });
});
