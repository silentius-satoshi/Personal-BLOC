import { useEffect, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { syncNow } from '../lib/nostr/syncNow';
import { openLiveSync, closeLiveSync } from '../lib/nostr/liveSync';
import { useStore } from '../store/useStore';

export function useNostrSync(opts?: { live?: boolean }) {
  const { nostr } = useNostr();
  const viewerMode = useStore((s) => s.viewerMode);   // viewer installs run NO writer sync (read-only)
  const live = (opts?.live ?? false) && !viewerMode;
  const nostrPubkey = useStore((s) => s.nostrPubkey);   // login/disconnect cycles the live sub

  // In viewerMode the writer sync path is OFF by construction: triggerSync no-ops (no syncNow/publish).
  const triggerSync = useCallback(
    () => (useStore.getState().viewerMode ? Promise.resolve(false) : syncNow(nostr)),
    [nostr],
  );

  useEffect(() => {
    if (viewerMode) return;   // no visibility/focus listeners → no openLiveSync, no auto syncNow
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
    // An OS-level network reconnect (e.g. iOS airplane-mode toggle while foregrounded) fires neither
    // visibilitychange nor focus — the tab never hides/shows and the window never loses/regains focus.
    const onOnline = () => {
      triggerSync();
      if (live) openLiveSync();   // idempotent — mirrors onFocus's "covers missed opens"
    };
    if (live && document.visibilityState === 'visible') openLiveSync();
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (live) closeLiveSync();
    };
  }, [triggerSync, live, nostrPubkey, viewerMode]);

  return { triggerSync };
}
