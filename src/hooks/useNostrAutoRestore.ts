import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useStore, publishRecordsNow } from '../store/useStore';
import { restoreSigner } from '../lib/nostr/session';

export function useNostrAutoRestore(): void {
  const { nostr } = useNostr();

  useEffect(() => {
    const { nostrAuthEnabled, nostrPubkey } = useStore.getState();
    if (!nostrAuthEnabled || !nostrPubkey) return;

    useStore.getState().setIsAuthenticated(true);  // optimistic

    const restore = async () => {
      const signer = await restoreSigner(nostr);
      if (!signer) {
        useStore.getState().setIsAuthenticated(false);
        useStore.getState().setNostrSigner(null);
        return;
      }
      const { fetchUserRelays } = await import('../lib/nostr/relays');
      const { fetchAndSync }    = await import('../lib/nostr/sync');
      const pk = useStore.getState().nostrPubkey!;
      const relays = await fetchUserRelays(pk);
      useStore.getState().setNostrRelays(relays);

      // Push-before-pull: a records publish that failed before a cold close re-propagates on launch.
      if (useStore.getState().recordsDirty) {
        try { await publishRecordsNow(); } catch { /* publishRecordsNow already sets the reconnect flag on failure */ }
      }

      useStore.getState().setNostrSyncing(true);
      fetchAndSync(signer, pk, relays)
        .catch(e => console.warn('[Nostr] auto-restore sync failed:', e))
        .finally(() => useStore.getState().setNostrSyncing(false));
    };

    restore();
  }, [nostr]);   // nostr is stable (singleton pool from NostrProvider)
}
