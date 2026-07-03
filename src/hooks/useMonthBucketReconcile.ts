import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * One-shot calendar-bucket reconcile — runs ONCE per device after the anniversary-bucketing fix to re-roll
 * stored monthlyLog entries that were rolled under the old 30.4375 buckets. Gated on the persisted
 * `monthBucketReconcileDone` flag + `hasData`, so it fires after hydration (incl. the encrypted async-rehydrate
 * path — `hasData` flips once dayLog/monthlyLog load, re-running the effect). `reconcileMonthBuckets` is
 * diff-guarded (only changed months re-roll) and sets the flag itself.
 *
 * ⚠ NEVER in viewerMode: a viewer's monthlyLog comes from the owner's snapshot while its local dayLog stays []
 * — reconciling would see every daily month as "emptied" and delete it. The viewer just displays the owner's
 * (post-reconcile) entries.
 */
export function useMonthBucketReconcile(): void {
  const viewerMode = useStore((s) => s.viewerMode);
  const done       = useStore((s) => s.monthBucketReconcileDone);
  const hasData    = useStore((s) => s.dayLog.length > 0 || s.monthlyLog.length > 0);
  useEffect(() => {
    if (viewerMode || done || !hasData) return;
    useStore.getState().reconcileMonthBuckets();
  }, [viewerMode, done, hasData]);
}
