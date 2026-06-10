import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useStore } from '../store/useStore';
import { syncNow } from '../lib/nostr/syncNow';

export function useNostrAutoRestore(): void {
  const { nostr } = useNostr();

  useEffect(() => {
    const { nostrAuthEnabled, nostrPubkey } = useStore.getState();
    if (!nostrAuthEnabled || !nostrPubkey) return;

    useStore.getState().setIsAuthenticated(true);  // optimistic

    const restore = async () => {
      const ok = await syncNow(nostr);
      if (!ok && useStore.getState().nostrSigner === null) {
        // Restore genuinely failed — a failed sync with a live signer is NOT an auth failure.
        useStore.getState().setIsAuthenticated(false);
      }
    };

    restore();
  }, [nostr]);   // nostr is stable (singleton pool from NostrProvider)
}
