import { useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { fetchAndSync } from '../lib/nostr/sync';

export function useNostrSync() {
  const triggerSync = useCallback(async () => {
    const { nostrSigner, nostrPubkey, nostrRelays } = useStore.getState();
    if (!nostrSigner || !nostrPubkey) return;
    useStore.getState().setNostrSyncing(true);
    try {
      await fetchAndSync(nostrSigner, nostrPubkey, nostrRelays);
    } catch (e) {
      console.warn('[Nostr] manual sync failed:', e);
    } finally {
      useStore.getState().setNostrSyncing(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') triggerSync();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [triggerSync]);

  return { triggerSync };
}
