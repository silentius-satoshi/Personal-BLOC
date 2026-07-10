import { useStore } from '../../store/useStore';
import { biometricLabel } from '../biometricLabel';
import { wipeLocalPlanData } from '../store/wipeLocalPlanData';

/**
 * Full identity FORGET: clears the identity and wipes the plan from this device's storage.
 *
 * ⚠ This is the app's only wiping teardown. reconnectNostr / signOutLocal / resetAndResync all RETAIN plan data —
 * see wipeLocalPlanData for the rule and the key inventory.
 */
export function disconnectNostr(): void {
  const s = useStore.getState();
  // NConnectSigner exposes no public close/dispose API — reload rebuilds the pool clean.
  // The setters remove the standalone GATE_* keys (pubkey/auth/method) SYNCHRONOUSLY; the persist blob write is NOT
  // guaranteed to land before reload(), so the store's GATE-gated `merge` (not the blob) is what makes sign-out
  // authoritative on the next load — a stale, un-flushed blob pubkey can't resurrect the session.
  s.setNostrSigner(null);
  s.setNostrPubkey(null);
  s.setNostrSigningMethod(null);
  s.setNostrBunkerUri(null);
  s.setNostrLogin(null);
  s.setNostrAuthEnabled(false);
  s.setIsAuthenticated(false);
  // Backup gate (R2a-1): provenance is a property of the IDENTITY, so it dies with it. Without this clear, a
  // generate→never-verify→disconnect→import-a-different-nsec sequence would leave keyProvenance frozen at
  // 'generated' (write-once) with backupVerifiedAt null → sync permanently gated with no way out. The persist
  // blob write isn't guaranteed to land before reload(), so `gateHydratedIdentity` nulls both again on the next
  // rehydrate whenever GATE_PUBKEY_KEY is absent (signed out) — same authority rule as the identity fields.
  // ⚠ reconnectNostr + resetAndResync RETAIN the identity and deliberately do NOT clear these.
  s.setKeyProvenance(null);
  s.setBackupVerifiedAt(null);
  // Remanence (R2c-6b): the setters clear identity FIELDS, not the persisted plan. Without this, the next load
  // renders the full hydrated plan to whoever opens the tab — the auth gates all condition on nostrAuthEnabled,
  // which is now false, so the ladder falls straight through to the app.
  // ⚠ MUST be the LAST mutation before reload(): zustand's persist writes the blob synchronously on every set(),
  // so any store setter placed after this call would resurrect the blob we just removed.
  wipeLocalPlanData();
  window.location.reload();
}

export function reconnectNostr(): void {
  const s = useStore.getState();
  // Clear the dead SESSION but KEEP the identity (pubkey + signing method) — same identity, just re-establish the
  // signer. Under the B1 pin nostrAuthEnabled DERIVES from nostrPubkey, so retaining pubkey keeps auth true → the
  // re-login gate (nostrAuthEnabled && !nostrSigner) reappears. nostrLogin is cleared so restoreSigner can't
  // silently revive the dead NIP-46 session — the user re-approves via NostrAuthGate (reconnect's intent).
  // NConnectSigner has no dispose API — reload rebuilds the pool clean (same as disconnectNostr).
  s.setNostrSigner(null);
  s.setNostrBunkerUri(null);
  s.setNostrLogin(null);
  s.setIsAuthenticated(false);
  // nostrPubkey + nostrSigningMethod intentionally retained; auth derives from the retained pubkey.
  // ⚠ NO wipeLocalPlanData: this drops a SESSION, it does not forget the identity. The same user re-authenticates
  // into the same plan — wiping would force a full relay re-pull and lose anything not yet synced.
  window.location.reload();
}

/**
 * Local-key SIGN OUT — NON-DESTRUCTIVE, and deliberately distinct from Settings' "Remove local key" (which nulls
 * writerKeyWrapped, clears the identity + keyProvenance/backupVerifiedAt, and wipes the encrypted blob).
 *
 * Signing out retains EVERYTHING that matters: the wrapped key, the identity (pubkey + method), the plan data, and —
 * load-bearing — keyProvenance + backupVerifiedAt. So a VERIFIED key that signs out and back in stays verified: no
 * backup ladder, no nag. The user lands on LocalUnlockGate ("authenticated but locked") and unlocks with Face ID / PIN.
 * It delegates to reconnectNostr, which never wipes — the plan waits behind the lock.
 */
export function signOutLocal(): void {
  // ⚠ INVARIANT PIN, not dead code. A local sign-out must land AUTHENTICATED-but-LOCKED, never a full logout.
  // Today this is redundant — nostrAuthEnabled DERIVES from the retained pubkey (setNostrPubkey sets the two in
  // lockstep; gateHydratedIdentity pins it true on every rehydrate) — but if that derivation ever changes, this
  // line visibly contradicts the regression instead of letting sign-out silently become a logout.
  // ⚠ MUST run BEFORE reconnectNostr: its reload() is the LAST statement, and navigation ends execution.
  useStore.getState().setNostrAuthEnabled(true);
  // Shared teardown, reused verbatim (no duplication): clears signer/bunkerUri/login/isAuthenticated, retains the
  // identity + gate fields + wrapped key, reloads.
  reconnectNostr();
}

export type SigningMethod = 'nip07' | 'nip46' | 'local' | null;

/**
 * Method-aware SIGN OUT — the user-facing "get me out of this session" action, dispatched to whichever existing
 * teardown actually achieves it for the signer in use. Surfaced at the bottom of the Settings menu and in the
 * full-mode dropdown.
 *
 * ⚠ WHY nip07 → disconnectNostr, and why that is NOT the "harder" action here.
 *
 * DESTRUCTIVENESS IS A PROPERTY OF WHAT'S AT STAKE, NOT OF THE FUNCTION. A nip07 user has no on-device key — it
 * lives in the extension. `disconnectNostr` clears nostrPubkey/nostrSigningMethod/keyProvenance/backupVerifiedAt,
 * and every one of those is re-stamped on the next extension login (keyProvenance → 'external', which makes
 * isBackupGateSatisfied true by construction; backupVerifiedAt is irrelevant to that predicate). Re-login is one
 * approval. So for nip07 it is the *reversible* sign-out.
 *
 * ⚠ And it is the ONLY teardown auto-restore cannot silently undo. `reconnectNostr` retains nostrPubkey (hence
 * nostrAuthEnabled), and after its reload `useNostrAutoRestore` early-returns ONLY for 'local' and for
 * (nip46 && !nostrLogin) — a nip07 session falls through to setIsAuthenticated(true) → restoreSigner →
 * NLogin.fromExtension(), which an authorized extension answers SILENTLY. The user would tap Sign out, the page
 * would reload, and they would still be signed in. NEVER collapse this to `external → reconnectNostr`.
 *
 * Accepted duplication: for nip07 this is the same act as THIS DEVICE's "Disconnect" — two framings (a
 * discoverable exit vs. in-context identity management) of one function.
 */
export function signOut(method: SigningMethod): void {
  if (method === 'local') { signOutLocal(); return; }        // key stays on device → LocalUnlockGate
  if (method === 'nip46') { reconnectNostr(); return; }      // nostrLogin cleared → NostrAuthGate; pubkey kept
  if (method === 'nip07') { disconnectNostr(); return; }     // see above — the only thing auto-restore can't undo
  // null → nothing to sign out of (a viewer, or never signed in). The call sites gate on the method, so this is
  // defensive: silently do nothing rather than reload.
}

/**
 * The confirm copy for {@link signOut}. ⚠ It must describe the MECHANISM the dispatch actually runs — never
 * promise retention a teardown does not provide, and never promise a biometric a PIN-scheme key does not have
 * (the P0 lesson).
 */
export function signOutConfirmMessage(method: SigningMethod, scheme?: 'prf' | 'pin'): string {
  if (method === 'local') {
    // → signOutLocal → reconnectNostr: nothing is wiped, the plan waits behind the lock.
    const unlockWith = scheme === 'pin' ? 'your PIN' : biometricLabel();
    return `Sign out of this device? Your key stays saved here — unlock with ${unlockWith} to sign back in.`;
  }
  if (method === 'nip46') {
    // → reconnectNostr: session only. Identity and plan both retained.
    return "Sign out? Your key stays in your remote signer — you'll re-approve to sign back in.";
  }
  // nip07 → disconnectNostr, which WIPES. The copy says so: the data follows the identity off the device, which is
  // right for the shared-desktop context an extension lives in. ⚠ It makes NO identity-retention claim, and no
  // neverSynced branch is needed — a nip07 key is keyProvenance 'external', so the backup gate is satisfied by
  // construction and its plan has always been free to sync.
  return "Sign out? This removes your plan from this device — you'll re-approve with your extension and it re-syncs from your relays.";
}

/**
 * The confirm copy for the two IDENTITY-FORGET actions in Settings → THIS DEVICE. Both wipe plan-scoped storage
 * (they route through {@link disconnectNostr}), so both must say so.
 *
 * ⚠ `neverSynced` is the edge where "your plan stays on the relay" is a LIE. Pass
 * `!isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })` (from lib/backupGate — never re-derive it): a
 * `generated` key with no `backupVerifiedAt` has had every sync and publish path gated off since minute one, so the
 * relay holds NOTHING and forgetting the identity deletes the plan permanently.
 */
export function identityForgetConfirmMessage(kind: 'disconnect' | 'remove-key', neverSynced: boolean): string {
  if (neverSynced) {
    const verb = kind === 'disconnect' ? 'disconnecting' : 'removing this key';
    return `⚠ This plan has never been backed up or synced — ${verb} deletes it permanently. Save your Recovery Key first if you want to keep it.`;
  }
  if (kind === 'disconnect') {
    return 'Disconnect this identity from this device? Your plan stays on the relay but is removed from this device. Any changes not yet synced will be lost.';
  }
  return "Remove the encrypted key and plan data from this device? Your plan stays on the relay — make sure your Recovery Key is backed up, you'll need it to sign in again. Any changes not yet synced will be lost.";
}
