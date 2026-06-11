import { useEffect, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { syncNow } from '../lib/nostr/syncNow';
import { openLiveSync, closeLiveSync } from '../lib/nostr/liveSync';
import { useStore } from '../store/useStore';

export function useNostrSync(opts?: { live?: boolean }) {
  const { nostr } = useNostr();
  const live = opts?.live ?? false;
  const nostrPubkey = useStore((s) => s.nostrPubkey);   // login/disconnect cycles the live sub

  const triggerSync = useCallback(() => syncNow(nostr), [nostr]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        if (live) openLiveSync();
        triggerSync();
      } else if (live) {
        closeLiveSync();
      }
    };
    // A visible desktop tab never fires visibilitychange — focus covers app/window switches.
    const onFocus = () => {
      triggerSync();
      if (live) openLiveSync();   // idempotent — covers missed opens
    };
    if (live && document.visibilityState === 'visible') openLiveSync();
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', onFocus);
      if (live) closeLiveSync();
    };
  }, [triggerSync, live, nostrPubkey]);

  return { triggerSync };
}
