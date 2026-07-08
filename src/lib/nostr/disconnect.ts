import { useStore } from '../../store/useStore';

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
