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
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [triggerSync]);

  return { triggerSync };
}
