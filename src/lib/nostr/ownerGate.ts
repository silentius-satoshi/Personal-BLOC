// Owner-pubkey gate — the app render + the Strike fetch are restricted to the authenticated OWNER, not
// any valid nsec. The owner's hex pubkey is a build-time env var (VITE_OWNER_PUBKEY), like the proxy secret.
//
// Unset-env fallback is LOAD-BEARING: when VITE_OWNER_PUBKEY is unset (local dev, a fork, or a misconfigured
// deploy) this returns true, degrading to the pre-gate behavior (any authenticated key is the owner) — so a
// forgotten env var never bricks the app. The lockdown is active only on the owner's real deploy (env set).
//
// Viewer-aware: the queued viewer-access spec adds `|| viewerMode` at the call site so a provisioned viewer
// (a different pubkey) passes the gate read-only — this helper stays owner-only and unchanged.
export function isOwnerPubkey(pubkey: string | null, ownerEnv: string | undefined): boolean {
  if (!ownerEnv) return true;          // no owner configured → no lockout
  return pubkey === ownerEnv;
}
