import { reconnectNostr } from '../../lib/nostr/disconnect';
import styles from './NostrAuthGate.module.css';

/**
 * Shown when a valid nsec authenticates but its pubkey isn't the owner's (VITE_OWNER_PUBKEY). The owner gate
 * admits only the owner — a foreign key sees this, never the dashboards. "Use a different key" clears the
 * session (keeps the Nostr lock) and reloads back to the login gate.
 */
export function PrivateAppNotice() {
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>₿</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>This app is private to its owner.</p>
        <button className={styles.ghostBtn} onClick={() => reconnectNostr()}>
          Use a different key
        </button>
      </div>
    </div>
  );
}
