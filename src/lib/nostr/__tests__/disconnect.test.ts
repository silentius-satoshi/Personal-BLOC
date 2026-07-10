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
const sess = new Map<string, string>();
(globalThis as any).sessionStorage = {
  getItem: (k: string) => (sess.has(k) ? sess.get(k)! : null),
  setItem: (k: string, v: string) => { sess.set(k, String(v)); },
  removeItem: (k: string) => { sess.delete(k); },
  clear: () => { sess.clear(); },
};
const reloadMock = vi.fn();
(globalThis as any).window = { location: { reload: reloadMock }, localStorage: lsShim };

import { signOutLocal, reconnectNostr, disconnectNostr, signOut, signOutConfirmMessage, identityForgetConfirmMessage } from '../disconnect';
import { useStore } from '../../../store/useStore';

const VERIFIED_AT = 1_700_000_000_000;
const WRAP_META = { iv: 'aXY=', scheme: 'pin' as const, salt: 'c2FsdA==' };

const BLOB = 'personal-bloc-store';
const ONBOARDED = 'personal-bloc-onboarded';   // ⚠ standalone key — removing it is what shows the fresh entry fork
const DEVICE_TAG = 'bloc-device-tag';

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
  sess.clear();
  vi.clearAllMocks();
  seedVerifiedLocalOwner();
  // The persisted plan on disk. `seedVerifiedLocalOwner` writes the identity GATE keys via the setters; these two
  // are what remanence is about — the blob that renders the plan, and the flag that hides the entry fork.
  mem.set(BLOB, '{"state":{"income":4000}}');
  mem.set(ONBOARDED, '1');
  mem.set(DEVICE_TAG, 'a3f2');
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

  // ⭐ R2c-6b RETENTION. Sign-out re-locks; it does not forget. The same user unlocks back into the same plan, so
  // wiping here would force a relay re-pull and lose anything not yet synced.
  it('RETAINS the plan blob and the onboarded flag — the plan waits behind the lock', () => {
    signOutLocal();
    expect(mem.get(BLOB)).toBeDefined();
    expect(mem.get(ONBOARDED)).toBe('1');
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

  // A nip46 sign-out drops a SESSION. Same identity, same plan — nothing is wiped.
  it('RETAINS the plan blob and the onboarded flag', () => {
    reconnectNostr();
    expect(mem.get(BLOB)).toBeDefined();
    expect(mem.get(ONBOARDED)).toBe('1');
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
    expect(mem.get(BLOB)).toBeUndefined();        // …and it WIPES: data follows the identity off a shared desktop
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

  // ⭐ nip07 routes to disconnectNostr, which now WIPES. A confirm that didn't say so would be a lie about the one
  // teardown that destroys local data. The retaining arms must NOT make the same claim.
  it('nip07 warns that the plan leaves the device; local + nip46 do not', () => {
    expect(signOutConfirmMessage('nip07')).toContain('removes your plan from this device');
    expect(signOutConfirmMessage('local', 'pin')).not.toContain('removes your plan');
    expect(signOutConfirmMessage('nip46')).not.toContain('removes your plan');
  });
});

// The two identity-forget confirms. Both route through disconnectNostr → both wipe → both must say so, and the
// never-synced branch must not repeat the "stays on the relay" promise it cannot keep.
describe('identityForgetConfirmMessage', () => {
  it('names the local-data removal in both normal branches', () => {
    expect(identityForgetConfirmMessage('disconnect', false)).toContain('removed from this device');
    expect(identityForgetConfirmMessage('remove-key', false)).toContain('plan data from this device');
  });

  it('promises the relay copy + warns about unsynced changes when the plan HAS synced', () => {
    for (const kind of ['disconnect', 'remove-key'] as const) {
      const msg = identityForgetConfirmMessage(kind, false);
      expect(msg).toContain('stays on the relay');
      expect(msg).toContain('not yet synced will be lost');
    }
  });

  // ⭐ A generated-and-never-verified key has had every sync/publish path gated off since minute one (R2a-1), so the
  // relay holds NOTHING. "Your plan stays on the relay" would be a lie that costs the user their only copy.
  it('never claims a relay copy for a plan that has never synced', () => {
    for (const kind of ['disconnect', 'remove-key'] as const) {
      const msg = identityForgetConfirmMessage(kind, true);
      expect(msg).not.toContain('stays on the relay');
      expect(msg).toContain('deletes it permanently');
      expect(msg).toContain('Save your Recovery Key first');
    }
  });

  it('names the action it is warning about', () => {
    expect(identityForgetConfirmMessage('disconnect', true)).toContain('disconnecting deletes it');
    expect(identityForgetConfirmMessage('remove-key', true)).toContain('removing this key deletes it');
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

  // ⭐ R2c-6b. The bug: clearing identity FIELDS left the blob on disk, the auth gates all condition on
  // nostrAuthEnabled (now false), and the ladder fell through to the app — rendering the full plan to whoever
  // opened the tab next. An identity-forget must never leave the plan readable.
  it('WIPES the plan blob — an identity-less shell must have nothing to render', () => {
    disconnectNostr();
    expect(mem.get(BLOB)).toBeUndefined();
  });

  // Removing the blob alone is a HALF-fix: onboardingComplete is standalone-seeded, so the entry fork would
  // still be skipped and the user would land in a seeded app rather than ChoosePathView.
  it('WIPES personal-bloc-onboarded so the fresh entry fork renders', () => {
    disconnectNostr();
    expect(mem.get(ONBOARDED)).toBeUndefined();
  });

  it('retains the device tag (device-level, survives every identity)', () => {
    disconnectNostr();
    expect(mem.get(DEVICE_TAG)).toBe('a3f2');
  });
});
