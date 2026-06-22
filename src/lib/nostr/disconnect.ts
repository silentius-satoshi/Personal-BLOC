import { useStore } from '../../store/useStore';

export function disconnectNostr(): void {
  const s = useStore.getState();
  // NConnectSigner exposes no public close/dispose API — reload rebuilds the pool clean.
  // Zustand persist writes synchronously, so state is cleared in localStorage before reload.
  s.setNostrSigner(null);
  s.setNostrPubkey(null);
  s.setNostrSigningMethod(null);
  s.setNostrBunkerUri(null);
  s.setNostrLogin(null);
  s.setNostrAuthEnabled(false);
  s.setIsAuthenticated(false);
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
