import { useStore } from '../../store/useStore';
import { usePlanMissing, usePlanPull, startNewPlanHere, START_NEW_PLAN_LABEL } from '../../hooks/usePlanLoad';
import styles from './NoPlanNotice.module.css';

/**
 * R2b-2 — "you signed in, but this key has no plan yet."
 *
 * Without it, signing in with a key that has nothing on the relays renders a seed-default dashboard and the
 * user cannot distinguish "my plan failed to load" from "this key has no plan." `remotePlanFound` is written
 * exactly once per session by syncNow's first owner pull, and it stays TRUE on a decrypt failure — so an
 * unreachable signer never triggers this.
 *
 * SELF-GATING: renders null unless the pull genuinely found nothing AND this key wasn't just generated in-app
 * (a fresh generated key obviously has no plan; the notice would be noise — and such a key is backup-gated out
 * of syncNow anyway, so remotePlanFound stays null for it).
 *
 * ⚠ OWNER-ONLY BY CONSTRUCTION: mounted solely via ViewerHomeView's `notice` prop, which only AppShell's owner
 * dashboard arm passes, and which ViewerHomeView renders behind `{ownerNav && …}`. A real viewer never sets
 * remotePlanFound either (viewer installs never reach doSyncNow). Three independent reasons it can't leak.
 *
 * 5c (spec `pbloc-spec-plan-load-guard-v1`): "found nothing" now also means the last plan pull is `'none'` — a relay
 * ANSWERED with nothing — and this device is waiting for its plan. The same empty pull from relays that couldn't be
 * reached ('unreachable') isn't "no plan", and a later pull that applied the plan hides it (the session latch keeps
 * remotePlanFound false from the first pull). It no longer says "starting fresh": an empty answer is also what relays
 * that don't show the plan give, so the device waits until its owner says the key is new — "Start a new plan".
 */
export function NoPlanNotice() {
  const remotePlanFound    = useStore((s) => s.remotePlanFound);
  const keyProvenance      = useStore((s) => s.keyProvenance);
  const setRemotePlanFound = useStore((s) => s.setRemotePlanFound);
  const planPull           = usePlanPull();
  const waiting            = usePlanMissing();

  if (remotePlanFound !== false || keyProvenance === 'generated' || planPull.status !== 'none' || !waiting) return null;

  return (
    <div className={styles.notice} role="status">
      <span className={styles.text}>
        No plan found on this key. If it’s new, start your plan here; if you expected one, it hasn’t loaded — don’t start a new one.
      </span>
      <button className={styles.dismiss} onClick={() => { startNewPlanHere(); }}>
        {START_NEW_PLAN_LABEL}
      </button>
      <button
        className={styles.dismiss}
        onClick={() => setRemotePlanFound(null)}   // the latch keeps this permanent for the session
      >
        Dismiss
      </button>
    </div>
  );
}
