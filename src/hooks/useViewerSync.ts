import { useEffect } from 'react';
import { openViewerSync, closeViewerSync, fetchViewerSnapshot } from '../lib/nostr/viewerSync';
import { useStore } from '../store/useStore';

/**
 * Viewer-side read-only sync mount — the MIRROR of useNostrSync's live wiring, but it pulls + subscribes to
 * the OWNER's snapshot. No-op unless viewerMode. Foreground-only (open on visible, close on hidden), with a
 * batch fetchViewerSnapshot on each foreground so the dashboards populate immediately. NEVER publishes.
 */
export function useViewerSync(): void {
  const viewerMode         = useStore((s) => s.viewerMode);
  const viewerWriterPubkey = useStore((s) => s.viewerWriterPubkey);   // re-provisioning re-subs

  useEffect(() => {
    if (!viewerMode) return;
    const handler = () => {
      if (document.visibilityState === 'visible') { openViewerSync(); void fetchViewerSnapshot(); }
      else closeViewerSync();
    };
    const onFocus = () => { void fetchViewerSnapshot(); openViewerSync(); };
    if (document.visibilityState === 'visible') { openViewerSync(); void fetchViewerSnapshot(); }
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', onFocus);
      closeViewerSync();
    };
  }, [viewerMode, viewerWriterPubkey]);
}
