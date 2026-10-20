import styles from './NostrAuthGate.module.css';
import { openTheApp } from '../../lib/nostr/firstPull';

export const PLAN_LOADING_TITLE = 'Loading your plan…';
export const PLAN_LOADING_SLOW  = 'Still loading — your relays or signer are slow.';
export const OPEN_THE_APP       = 'Open the app';

/**
 * 5e (F1) — the owner's twin of ViewerWaitingGate: in place of the red flash after a fresh sign-in, while the session's
 * first pull brings the plan and then the journal (lib/nostr/firstPull). It goes when the pull lands — with a plan, with
 * nothing, or failed — never later. It is never a trap: after 15 s (`slow`) it says why it's still here and offers "Open
 * the app", which releases it for the session while the pull carries on. It holds no write: 5c refuses every
 * plan-dependent one until the plan loads, whether this screen is up or not.
 */
export function PlanLoadingGate({ slow }: { slow: boolean }) {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>{PLAN_LOADING_TITLE}</p>
        {slow && (
          <>
            <p className={styles.hint}>{PLAN_LOADING_SLOW}</p>
            <button className={styles.ghostBtn} onClick={() => openTheApp()}>{OPEN_THE_APP}</button>
          </>
        )}
      </div>
    </div>
  );
}
