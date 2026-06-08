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
