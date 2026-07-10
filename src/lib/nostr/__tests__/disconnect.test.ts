import { describe, it, expect, beforeEach, vi } from 'vitest';

// node env has no localStorage/window — minimal in-memory shims, installed BEFORE the store is imported (its
// module-init seed reads localStorage, and the teardowns call window.location.reload()). Same shim as escapeHatch.test.
const mem = new Map<string, string>();
const lsShim = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};
(globalThis as any).localStorage = lsShim;
const reloadMock = vi.fn();
(globalThis as any).window = { location: { reload: reloadMock }, localStorage: lsShim };

import { signOutLocal, reconnectNostr, disconnectNostr, signOut, signOutConfirmMessage } from '../disconnect';
import { useStore } from '../../../store/useStore';

const VERIFIED_AT = 1_700_000_000_000;
const WRAP_META = { iv: 'aXY=', scheme: 'pin' as const, salt: 'c2FsdA==' };

/** An established, BACKED-UP local owner: the state that sign-out must preserve in full. */
function seedVerifiedLocalOwner() {
  const s = useStore.getState();
  s.setNostrPubkey('PKHEX');                     // also derives nostrAuthEnabled = true (B1 lockstep)
  s.setNostrSigningMethod('local');
  s.setWriterKeyWrapped('CIPHERTEXT');
  s.setWriterKeyWrapMeta(WRAP_META);
  s.setNostrSigner({} as any);
  s.setIsAuthenticated(true);
  s.setNostrLogin('{"pubkey":"PKHEX"}');
  s.setKeyProvenance(null);                      // clear the write-once latch, then stamp
  s.setKeyProvenance('imported');
  s.setBackupVerifiedAt(VERIFIED_AT);
}

beforeEach(() => {
  mem.clear();
  vi.clearAllMocks();
  seedVerifiedLocalOwner();
});

// ⭐ THE INVARIANT. Signing out and unlocking again must not re-enter the backup ladder: keyProvenance and
// backupVerifiedAt are what `isBackupGateSatisfied` reads, and clearing them would re-gate sync + resurrect the nag.
describe('signOutLocal — non-destructive local sign out', () => {
  it('retains the identity so the app re-locks to LocalUnlockGate (not the login screen)', () => {
    signOutLocal();
    const s = useStore.getState();
    expect(s.nostrPubkey).toBe('PKHEX');
    expect(s.nostrSigningMethod).toBe('local');
    expect(s.nostrAuthEnabled).toBe(true);   // the gate condition: authenticated-but-locked
  });

  it('retains the wrapped key — there is something left to unlock', () => {
    signOutLocal();
    const s = useStore.getState();
    expect(s.writerKeyWrapped).toBe('CIPHERTEXT');
    expect(s.writerKeyWrapMeta).toEqual(WRAP_META);
  });

  it('⭐ retains keyProvenance + backupVerifiedAt — a VERIFIED key stays verified across sign out', () => {
    signOutLocal();
    const s = useStore.getState();
    expect(s.keyProvenance).toBe('imported');
    expect(s.backupVerifiedAt).toBe(VERIFIED_AT);
  });

  it('clears the live session and reloads', () => {
    signOutLocal();
    const s = useStore.getState();
    expect(s.nostrSigner).toBeNull();
    expect(s.isAuthenticated).toBe(false);
    expect(s.nostrLogin).toBeNull();
    expect(reloadMock).toHaveBeenCalledOnce();
  });
});

// signOutLocal delegates to this; asserting the same retention proves the flag was added WITHOUT altering the
// shared teardown (NIP-46 reconnect depends on its exact behavior).
describe('reconnectNostr — unchanged shared teardown', () => {
  it('retains identity, wrapped key, and the backup-gate fields', () => {
    reconnectNostr();
    const s = useStore.getState();
    expect(s.nostrPubkey).toBe('PKHEX');
    expect(s.nostrSigningMethod).toBe('local');
    expect(s.writerKeyWrapped).toBe('CIPHERTEXT');
    expect(s.keyProvenance).toBe('imported');
    expect(s.backupVerifiedAt).toBe(VERIFIED_AT);
    expect(s.isAuthenticated).toBe(false);
  });
});

// The three teardowns are same-module siblings, so signOut can't be vi.mock-spied. Pin the dispatch BEHAVIORALLY:
// each teardown leaves a unique fingerprint on the store. `nostrAuthEnabled` is seeded false so that only
// signOutLocal (which sets it true) can be responsible for it afterwards.
describe('signOut — method-aware dispatch', () => {
  const seedMethod = (method: 'local' | 'nip07' | 'nip46') => {
    const s = useStore.getState();
    s.setNostrSigningMethod(method);
    s.setNostrAuthEnabled(false);   // the discriminator: ONLY signOutLocal turns this back on
  };

  it("'local' → signOutLocal (identity kept, auth-locked, key retained)", () => {
    seedMethod('local');
    signOut('local');
    const s = useStore.getState();
    expect(s.nostrAuthEnabled).toBe(true);        // only signOutLocal does this
    expect(s.nostrPubkey).toBe('PKHEX');
    expect(s.writerKeyWrapped).toBe('CIPHERTEXT');
    expect(s.keyProvenance).toBe('imported');
  });

  it("'nip46' → reconnectNostr (session dropped, identity + provenance kept, login cleared)", () => {
    seedMethod('nip46');
    signOut('nip46');
    const s = useStore.getState();
    expect(s.nostrPubkey).toBe('PKHEX');          // retained → not disconnectNostr
    expect(s.nostrAuthEnabled).toBe(false);       // untouched → not signOutLocal
    expect(s.nostrLogin).toBeNull();
    expect(s.keyProvenance).toBe('imported');
  });

  // ⭐ THE REGRESSION PIN. reconnectNostr retains nostrPubkey, and useNostrAutoRestore early-returns ONLY for
  // 'local' and for (nip46 && !nostrLogin) — so a nip07 session falls through to setIsAuthenticated(true) →
  // restoreSigner → NLogin.fromExtension(), which an authorized extension answers SILENTLY. Sign out would reload
  // and leave the user signed in. If anyone "simplifies" the dispatch to `external → reconnectNostr`, pubkey
  // survives and this fails.
  it("'nip07' → disconnectNostr, NOT reconnectNostr (auto-restore would silently re-authenticate)", () => {
    seedMethod('nip07');
    signOut('nip07');
    const s = useStore.getState();
    expect(s.nostrPubkey).toBeNull();             // reconnectNostr would have RETAINED it
    expect(s.nostrSigningMethod).toBeNull();
    expect(s.keyProvenance).toBeNull();           // re-stamped 'external' on the next extension login
    expect(s.backupVerifiedAt).toBeNull();        // irrelevant to isBackupGateSatisfied for an external key
  });

  it('null (viewer / not signed in) → no-op, no reload', () => {
    signOut(null);
    const s = useStore.getState();
    expect(s.nostrPubkey).toBe('PKHEX');
    expect(s.isAuthenticated).toBe(true);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

describe('signOutConfirmMessage — copy matches the mechanism', () => {
  it('a PIN-scheme local key is never promised a biometric it does not have', () => {
    expect(signOutConfirmMessage('local', 'pin')).toContain('your PIN');
    expect(signOutConfirmMessage('local', 'prf')).not.toContain('your PIN');
  });

  it('nip46 says the key stays in the signer; nip07 claims NO identity retention', () => {
    expect(signOutConfirmMessage('nip46')).toContain('stays in your remote signer');
    // disconnectNostr clears the app-side identity record — the copy must not imply otherwise.
    expect(signOutConfirmMessage('nip07')).not.toMatch(/stays|saved here/);
    expect(signOutConfirmMessage('nip07')).toContain('re-approve with your extension');
  });
});

// The CONTRAST that gives "Sign out" vs "Remove local key" their different weights. If a future edit ever collapses
// these two teardowns, this fails.
describe('disconnectNostr — full sign-out DOES destroy the identity', () => {
  it('clears pubkey, method, and the backup-gate fields', () => {
    disconnectNostr();
    const s = useStore.getState();
    expect(s.nostrPubkey).toBeNull();
    expect(s.nostrSigningMethod).toBeNull();
    expect(s.nostrAuthEnabled).toBe(false);
    expect(s.keyProvenance).toBeNull();
    expect(s.backupVerifiedAt).toBeNull();
  });
});
