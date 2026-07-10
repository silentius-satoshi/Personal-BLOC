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

import { signOutLocal, reconnectNostr, disconnectNostr } from '../disconnect';
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
