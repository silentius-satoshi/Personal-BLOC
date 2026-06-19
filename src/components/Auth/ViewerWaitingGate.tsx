import styles from './NostrAuthGate.module.css';

/**
 * Data-remanence guard: shown to a viewer (unlocked, holder populated) until a VALID snapshot decrypt sets
 * viewerDataLoaded. Prevents stale persisted store data from rendering for a key that can't decrypt the owner's
 * snapshot. A REVOKED viewer unlocks fine (valid key) but never decrypts the re-sealed snapshot, so the "Reset
 * viewing key" escape is essential — without it the viewer is trapped here forever.
 */
export function ViewerWaitingGate({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>👁</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>Waiting for the owner's data…</p>
        <p className={styles.hint}>
          If this doesn't load, the owner may not have shared with this key yet (or revoked it). Reset to follow a
          different owner — no data is lost.
        </p>
        <button className={styles.ghostBtn} onClick={onReset}>
          Reset viewing key
        </button>
      </div>
    </div>
  );
}
