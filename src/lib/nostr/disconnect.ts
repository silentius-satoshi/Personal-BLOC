import { useStore } from '../../store/useStore';
import { biometricLabel } from '../biometricLabel';

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
  window.location.reload();
}

/**
 * Local-key SIGN OUT — NON-DESTRUCTIVE, and deliberately distinct from Settings' "Remove local key" (which nulls
 * writerKeyWrapped, clears the identity + keyProvenance/backupVerifiedAt, and wipes the encrypted blob).
 *
 * Signing out retains EVERYTHING that matters: the wrapped key, the identity (pubkey + method), and — load-bearing —
 * keyProvenance + backupVerifiedAt. So a VERIFIED key that signs out and back in stays verified: no backup ladder,
 * no nag. The user lands on LocalUnlockGate ("authenticated but locked") and unlocks with Face ID / PIN.
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
    const unlockWith = scheme === 'pin' ? 'your PIN' : biometricLabel();
    return `Sign out of this device? Your key stays saved here — unlock with ${unlockWith} to sign back in.`;
  }
  if (method === 'nip46') {
    return "Sign out? Your key stays in your remote signer — you'll re-approve to sign back in.";
  }
  // ⚠ nip07 makes NO identity-retention claim: disconnectNostr clears the app-side record. The KEY is safe in the
  // extension and re-login is one approval — which is exactly, and only, what this says.
  return "Sign out? You'll re-approve with your extension to sign back in.";
}
