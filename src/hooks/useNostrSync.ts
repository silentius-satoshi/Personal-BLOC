import { useEffect, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useStore, publishRecordsNow } from '../store/useStore';
import { fetchAndSync } from '../lib/nostr/sync';
import { restoreSigner } from '../lib/nostr/session';

let lastReconnectAt = 0;

export function useNostrSync() {
  const { nostr } = useNostr();

  const triggerSync = useCallback(async () => {
    const { nostrPubkey, nostrRelays, nostrSigningMethod } = useStore.getState();
    if (!nostrPubkey) return;
    let signer = useStore.getState().nostrSigner;
    if (nostrSigningMethod === 'nip46' && Date.now() - lastReconnectAt > 20000) {
      const fresh = await restoreSigner(nostr);
      if (fresh) { signer = fresh; lastReconnectAt = Date.now(); }
    }
    if (!signer) { useStore.getState().setNostrReconnectNeeded(true); return; }
    useStore.getState().setNostrSyncing(true);
    try {
      if (useStore.getState().recordsDirty) await publishRecordsNow();
      await fetchAndSync(signer, nostrPubkey, nostrRelays);
      useStore.getState().setNostrReconnectNeeded(false);
    } catch (e) {
      console.warn('[Nostr] sync failed:', e);
      useStore.getState().setNostrReconnectNeeded(true);
    } finally {
      useStore.getState().setNostrSyncing(false);
    }
  }, [nostr]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') triggerSync();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [triggerSync]);

  return { triggerSync };
}
