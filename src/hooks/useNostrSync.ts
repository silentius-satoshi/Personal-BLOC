import { useEffect, useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { syncNow } from '../lib/nostr/syncNow';
import { openLiveSync, closeLiveSync } from '../lib/nostr/liveSync';
import { useStore } from '../store/useStore';
import { isBackupGateSatisfied } from '../lib/backupGate';

// iOS standalone PWAs never fire window online/offline (navigator.onLine stays true through an
// airplane-mode cycle), so an offline publish leaves recordsDirty/settingsDirty set with nothing
// retrying. This dirty-gated backoff re-invokes triggerSync until the flags clear (successful publish).
export const RETRY_DELAYS_MS = [5000, 10000, 20000, 40000, 60000] as const; // cap 60s

/**
 * Self-rescheduling retry chain. Returns a cleanup that cancels the pending tick.
 * No-op (cleanup is a no-op) unless dirty && live && !viewerMode && backupGateOk.
 * Visible ticks call onTick() and advance the backoff; hidden ticks skip the call and
 * keep the chain alive at the current delay (iOS freezes timers when hidden anyway).
 */
export function scheduleDirtyRetry(
  args: { dirty: boolean; live: boolean; viewerMode: boolean; backupGateOk: boolean },
  deps: { isVisible: () => boolean; onTick: () => void },
): () => void {
  if (!args.dirty || !args.live || args.viewerMode || !args.backupGateOk) return () => {};
  let idx = 0;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      if (deps.isVisible()) {
        deps.onTick();
        idx = Math.min(idx + 1, RETRY_DELAYS_MS.length - 1); // advance only after a real attempt
      }
      schedule();
    }, RETRY_DELAYS_MS[idx]);
  };
  schedule();
  return () => clearTimeout(timer);
}

export function useNostrSync(opts?: { live?: boolean }) {
  const { nostr } = useNostr();
  const viewerMode = useStore((s) => s.viewerMode);   // viewer installs run NO writer sync (read-only)
  const live = (opts?.live ?? false) && !viewerMode;
  const nostrPubkey = useStore((s) => s.nostrPubkey);   // login/disconnect cycles the live sub
  const recordsDirty = useStore((s) => s.recordsDirty);
  const settingsDirty = useStore((s) => s.settingsDirty);
  // Backup gate — subscribed (not read via getState) so a verification flip RE-RUNS both effects below,
  // attaching the listeners + opening the live sub. Without the subscription the engine would stay asleep.
  const keyProvenance = useStore((s) => s.keyProvenance);
  const backupVerifiedAt = useStore((s) => s.backupVerifiedAt);
  const backupGateOk = isBackupGateSatisfied({ keyProvenance, backupVerifiedAt });

  // In viewerMode the writer sync path is OFF by construction: triggerSync no-ops (no syncNow/publish).
  // Same for a generated-but-unverified key (read live via getState, mirroring viewerMode).
  const triggerSync = useCallback(
    () => (useStore.getState().viewerMode || !isBackupGateSatisfied(useStore.getState())
      ? Promise.resolve(false)
      : syncNow(nostr)),
    [nostr],
  );

  useEffect(() => {
    if (viewerMode || !backupGateOk) return;   // no visibility/focus listeners → no openLiveSync, no auto syncNow
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
  }, [triggerSync, live, nostrPubkey, viewerMode, backupGateOk]);

  // Dirty-gated backoff retry (a self-heal for a stranded offline publish — see CLAUDE.md Sync Triggers).
  // live-only so only the app-level instance runs it (a bare SettingsMain mount must not double-publish);
  // viewerMode-off by construction. A flag transition re-runs the effect (fresh dirty → restart at 5s;
  // successful sync clears the flags → the early guard tears the chain down via the prior cleanup).
  useEffect(
    () =>
      scheduleDirtyRetry(
        { dirty: recordsDirty || settingsDirty, live, viewerMode, backupGateOk },
        { isVisible: () => document.visibilityState === 'visible', onTick: triggerSync },
      ),
    [recordsDirty, settingsDirty, live, viewerMode, backupGateOk, triggerSync],
  );

  return { triggerSync };
}
