import { useStore } from '../../store/useStore';
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
 */
export function NoPlanNotice() {
  const remotePlanFound    = useStore((s) => s.remotePlanFound);
  const keyProvenance      = useStore((s) => s.keyProvenance);
  const setRemotePlanFound = useStore((s) => s.setRemotePlanFound);

  if (remotePlanFound !== false || keyProvenance === 'generated') return null;

  return (
    <div className={styles.notice} role="status">
      <span className={styles.text}>
        No plan found on this key — starting fresh. Your first edits will create it.
      </span>
      <button
        className={styles.dismiss}
        onClick={() => setRemotePlanFound(null)}   // the latch keeps this permanent for the session
      >
        Dismiss
      </button>
    </div>
  );
}
