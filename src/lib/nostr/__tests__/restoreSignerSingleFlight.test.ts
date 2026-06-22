import { describe, it, expect, beforeEach, vi } from 'vitest';

// node env has no localStorage — minimal shim BEFORE importing the store (its module-init seed reads localStorage).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

// Narrowly mock the local-restore path's two deps — NO real crypto/WebAuthn:
// - NSecSigner: a stub whose pubkey matches the store's nostrPubkey (passes the identity check).
// - unwrapSecretKey: the Face-ID-triggering call → its invocation count IS the single-flight signal.
vi.mock('@nostrify/nostrify', () => ({
  NSecSigner: class { constructor(_sk: Uint8Array) {} async getPublicKey() { return 'PKHEX'; } },
}));
vi.mock('../keyVault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../keyVault')>();
  return { ...actual, unwrapSecretKey: vi.fn(async () => new Uint8Array(32)) };
});

import { restoreSigner } from '../session';
import { unwrapSecretKey } from '../keyVault';
import { useStore } from '../../../store/useStore';

beforeEach(() => {
  mem.clear();
  vi.mocked(unwrapSecretKey).mockClear();
  const s = useStore.getState();
  s.setNostrSigningMethod('local');
  s.setNostrPubkey('PKHEX');                 // matches the stub signer's getPublicKey
  s.setWriterKeyWrapped('CIPHERTEXT');
  s.setWriterKeyWrapMeta({ iv: 'aXY=', scheme: 'pin', salt: 'c2FsdA==' });
  s.setNostrSigner(null);
});

describe('restoreSigner — single-flight guard (Bug 2: concurrent WebAuthn ceremonies)', () => {
  it('two CONCURRENT calls share ONE ceremony and resolve to the SAME signer', async () => {
    const p1 = restoreSigner({} as any);
    const p2 = restoreSigner({} as any);   // launched before p1 settles → must share the in-flight promise
    const [s1, s2] = await Promise.all([p1, p2]);

    expect(unwrapSecretKey).toHaveBeenCalledOnce();   // ONE unwrap → ONE Face ID ceremony (the whole fix)
    expect(s1).toBeTruthy();
    expect(s1).toBe(s2);                              // both callers get the SAME signer (second is NOT null)
  });

  it('a later (non-concurrent) call runs the worker again — the guard cleared on settle', async () => {
    await restoreSigner({} as any);
    await restoreSigner({} as any);
    expect(unwrapSecretKey).toHaveBeenCalledTimes(2);
  });
});

describe('restoreSigner — #5 live-method re-verify before unwrap', () => {
  it('method flipped to nip46 between entry and the guard → bails BEFORE unwrapSecretKey (no spurious passkey)', async () => {
    // Simulate a mid-flight method switch: the entry destructure reads 'local' (enters the local branch), but by
    // the time the pre-unwrap guard re-reads LIVE state the method is 'nip46' (a nip46 login raced auto-restore).
    const real = useStore.getState();
    let methodReads = 0;
    const stateMock = {
      ...real,
      get nostrSigningMethod() { return methodReads++ === 0 ? 'local' : 'nip46'; },   // 1st read (entry) local, then nip46
    };
    const spy = vi.spyOn(useStore, 'getState').mockReturnValue(stateMock as any);
    try {
      const signer = await restoreSigner({} as any);
      expect(unwrapSecretKey).not.toHaveBeenCalled();   // bailed before WebAuthn — the whole #5 fix
      expect(signer).toBe(real.nostrSigner);            // returns the current signer (null here), not throw/null-from-failure
    } finally {
      spy.mockRestore();
    }
  });
});
