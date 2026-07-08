import { describe, it, expect, beforeEach, vi } from 'vitest';

// node env has no localStorage — minimal shim BEFORE importing the store (its module-init seed reads localStorage).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

// Narrowly mock establishLocalOwner's three side-effecting deps — NO real crypto / WebAuthn / relay I/O:
// - NSecSigner: an inert stub (establishLocalOwner only stores the ref; pubkey comes from real nostr-tools).
// - wrapSecretKey: returns a fixed { ciphertext, meta } so we can assert what gets persisted + the wrap args.
// - syncNow/markSignerFresh: no-op spies (fire-and-forget; we just assert syncNow was invoked).
vi.mock('@nostrify/nostrify', () => ({
  NSecSigner: class { constructor(_sk: Uint8Array) {} },
}));
vi.mock('../keyVault', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../keyVault')>();
  return {
    ...actual,
    wrapSecretKey: vi.fn(async () => ({ ciphertext: 'CIPHERTEXT', meta: { iv: 'IV', scheme: 'pin', salt: 'SALT' } })),
  };
});
vi.mock('../syncNow', () => ({
  syncNow: vi.fn(async () => true),
  markSignerFresh: vi.fn(),
}));

import { getPublicKey, generateSecretKey } from 'nostr-tools';
import { establishLocalOwner } from '../establishOwner';
import { wrapSecretKey } from '../keyVault';
import { generatePlanKey } from '../nip06Key';   // R2b-1 — NOT mocked; real entropy → words → sk derivation
import { syncNow, markSignerFresh } from '../syncNow';
import { useStore } from '../../../store/useStore';

beforeEach(() => {
  mem.clear();
  vi.mocked(wrapSecretKey).mockClear();
  vi.mocked(syncNow).mockClear();
  vi.mocked(markSignerFresh).mockClear();
  const s = useStore.getState();
  s.setNostrSigner(null);
  s.setIsAuthenticated(false);
  s.setNostrPubkey(null);
  s.setNostrSigningMethod(null);
  s.setWriterKeyWrapped(null);
  s.setWriterKeyWrapMeta(null);
});

describe('establishLocalOwner — the shared local-owner establish path', () => {
  it('persists the wrapped pair, sets pubkey/local/auth (in order), syncs, and zeros the key (PIN path)', async () => {
    const sk = generateSecretKey();
    const expectedPubkey = getPublicKey(sk.slice());   // capture BEFORE establish zeros sk

    const st = useStore.getState();
    const spyPubkey = vi.spyOn(st, 'setNostrPubkey');
    const spyMethod = vi.spyOn(st, 'setNostrSigningMethod');
    const spyAuth   = vi.spyOn(st, 'setIsAuthenticated');

    await establishLocalOwner(sk, 'pin', {} as any, { pin: '1234' });

    const after = useStore.getState();
    expect(after.writerKeyWrapped).toBe('CIPHERTEXT');
    expect(after.writerKeyWrapMeta).toEqual({ iv: 'IV', scheme: 'pin', salt: 'SALT' });
    expect(after.nostrPubkey).toBe(expectedPubkey);
    expect(after.nostrSigningMethod).toBe('local');
    expect(after.isAuthenticated).toBe(true);
    expect(after.nostrSigner).toBeTruthy();

    // wrap args: PIN path forwards the pin, no keyLabel; R2b-1 5th arg defaults to 'sk' (imported/legacy path).
    expect(wrapSecretKey).toHaveBeenCalledWith(expect.any(Uint8Array), 'pin', '1234', undefined, 'sk');
    expect(markSignerFresh).toHaveBeenCalledOnce();
    expect(syncNow).toHaveBeenCalledOnce();

    // order: pubkey → method → auth (the identity is marked before authentication flips on).
    expect(spyPubkey.mock.invocationCallOrder[0]).toBeLessThan(spyMethod.mock.invocationCallOrder[0]);
    expect(spyMethod.mock.invocationCallOrder[0]).toBeLessThan(spyAuth.mock.invocationCallOrder[0]);

    // best-effort zero: the caller's buffer is wiped at the end.
    expect(Array.from(sk).every((b) => b === 0)).toBe(true);
  });

  it('forwards the passkey label (not a pin) on the PRF path', async () => {
    const sk = generateSecretKey();
    await establishLocalOwner(sk, 'prf', {} as any, { keyLabel: 'my laptop' });
    expect(wrapSecretKey).toHaveBeenCalledWith(expect.any(Uint8Array), 'prf', undefined, 'my laptop', 'sk');
    expect(useStore.getState().nostrSigningMethod).toBe('local');
    expect(useStore.getState().isAuthenticated).toBe(true);
  });

  // R2b-1 — the generated-key path: the payload is 16 bytes of NIP-06 entropy, wrapped as 'nip06-entropy'.
  it("derives the signing identity from the entropy payload it wrapped (never from a caller-supplied sk)", async () => {
    const { entropy, sk } = generatePlanKey();
    const expectedPubkey = getPublicKey(sk.slice());   // the identity the wrapped ciphertext must unlock to

    await establishLocalOwner(entropy, 'pin', {} as any, { pin: '1234', payloadKind: 'nip06-entropy' });

    // the 16-byte entropy is the payload; the kind is recorded so unwrapSecretKey re-derives on unlock
    expect(wrapSecretKey).toHaveBeenCalledWith(expect.any(Uint8Array), 'pin', '1234', undefined, 'nip06-entropy');
    // ⚠ the load-bearing assertion: pubkey was DERIVED internally from the payload, never passed in
    expect(useStore.getState().nostrPubkey).toBe(expectedPubkey);
    expect(useStore.getState().nostrSigningMethod).toBe('local');
    expect(useStore.getState().isAuthenticated).toBe(true);
    // the caller's entropy buffer is zeroed
    expect(Array.from(entropy).every((b) => b === 0)).toBe(true);
  });
});
