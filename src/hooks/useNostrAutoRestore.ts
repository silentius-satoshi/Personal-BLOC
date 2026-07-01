import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useStore } from '../store/useStore';
import { syncNow } from '../lib/nostr/syncNow';

export function useNostrAutoRestore(): void {
  const { nostr } = useNostr();

  useEffect(() => {
    const { nostrAuthEnabled, nostrPubkey, nostrSigningMethod, nostrLogin } = useStore.getState();
    if (!nostrAuthEnabled || !nostrPubkey) return;

    // 'local' is an "authenticated-but-locked" launch: the unwrap triggers Face ID, which needs a user
    // gesture, so the LocalUnlockGate drives unlock on tap. Do NOT optimistically auth (would render the
    // app before unlock) and do NOT auto-restore here. nip07/nip46 keep the optimistic silent-restore.
    if (nostrSigningMethod === 'local') return;

    // A nip46 session can only be silently rebuilt from a persisted nostrLogin — without it (e.g. after a
    // reconnect cleared it) optimistic auth would render the app for ~1.5s then bounce to the gate. Skip
    // straight to the gate instead of flashing.
    if (nostrSigningMethod === 'nip46' && !nostrLogin) return;

    useStore.getState().setIsAuthenticated(true);  // optimistic

    const restore = async () => {
      let ok = await syncNow(nostr);
      if (!ok && useStore.getState().nostrSigner === null) {
        // Defense-in-depth for the async window.nostr injection race (beyond restoreSigner's own 3s wait):
        // a slow extension inject can outlast the first attempt — retry once before declaring auth failure.
        await new Promise((r) => setTimeout(r, 1500));
        ok = await syncNow(nostr);
      }
      if (!ok && useStore.getState().nostrSigner === null) {
        // Restore genuinely failed — a failed sync with a live signer is NOT an auth failure.
        useStore.getState().setIsAuthenticated(false);
      }
    };

    restore();
  }, [nostr]);   // nostr is stable (singleton pool from NostrProvider)
}
