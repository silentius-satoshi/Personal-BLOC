import styles from './ChoosePathView.module.css';

/**
 * Access Layer Redesign — Phase 1. The sovereign 3-path first-run fork that REPLACES OnboardingModal's
 * step-1 welcome. Pure presentational + 3 actions; renders as the step-1 content inside the modal.
 *
 * R2b-2 — the copy is IDENTITY-FRAMED, not protocol-framed: the fork asks what the user HAS, never what
 * technology they hold. "Nostr" appears nowhere here (it lives behind Advanced sign-in in NostrAuthGate).
 *
 * "Get started" → OwnerKeySetup (mint an on-device owner key), then the numbers wizard.
 * "I have a plan or a key" → connect an existing identity. "Connect to a shared plan" → read-only viewer.
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
          <span className={styles.pathTitle}>Get started</span>
          <span className={styles.pathSub}>Free, on this device — we'll create a key for you</span>
        </button>
        <button className={styles.path} onClick={onLogIn}>
          <span className={styles.pathTitle}>I have a plan or a key</span>
          <span className={styles.pathSub}>Sign in with your Recovery Key, extension, or signer — we'll load your plan, or start fresh on your key</span>
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
