import { useEffect, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { syncNow } from '../lib/nostr/syncNow';

export function useNostrSync() {
  const { nostr } = useNostr();

  const triggerSync = useCallback(() => syncNow(nostr), [nostr]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') triggerSync();
    };
    // A visible desktop tab never fires visibilitychange — focus covers app/window switches.
    const onFocus = () => triggerSync();
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', onFocus);
    };
  }, [triggerSync]);

  return { triggerSync };
}
