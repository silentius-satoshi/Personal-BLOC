import styles from './ChoosePathView.module.css';

/**
 * Access Layer Redesign — Phase 1. The sovereign 3-path first-run fork that REPLACES OnboardingModal's
 * step-1 welcome. Pure presentational + 3 actions; renders as the step-1 content inside the modal.
 *
 * "Start a new plan" → the numbers wizard (owner key-gen is Phase 1.5 — softened copy, no over-promise).
 * "Log in to my plan" → connect an existing Nostr identity. "Connect to a shared plan" → read-only viewer.
 */
export interface ChoosePathViewProps {
  onStartNew: () => void;
  onLogIn: () => void;
  onConnectShared: () => void;
}

export function ChoosePathView({ onStartNew, onLogIn, onConnectShared }: ChoosePathViewProps) {
  return (
    <div className={styles.fork}>
      <div className={styles.brand}>
        <div className={styles.brandRing}>₿</div>
        <div className={styles.brandName}>Personal ₿LOC</div>
        <p className={styles.tagline}>Your keys. Your plan. Your device. Nothing leaves without your say.</p>
      </div>

      <div className={styles.paths}>
        <button className={`${styles.path} ${styles.pathAccent}`} onClick={onStartNew}>
          <span className={styles.pathTitle}>Start a new plan</span>
          <span className={styles.pathSub}>Create your own — set up a fresh plan</span>
        </button>
        <button className={styles.path} onClick={onLogIn}>
          <span className={styles.pathTitle}>Log in to my plan</span>
          <span className={styles.pathSub}>Already have one — connect your Nostr key</span>
        </button>
        <button className={styles.path} onClick={onConnectShared}>
          <span className={styles.pathTitle}>Connect to a shared plan</span>
          <span className={styles.pathSub}>Read-only — request access from the owner</span>
        </button>
      </div>

      <p className={styles.footer}>No accounts. No tracking. You hold the keys.</p>
    </div>
  );
}
