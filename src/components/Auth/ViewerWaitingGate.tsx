import styles from './NostrAuthGate.module.css';

/**
 * Data-remanence guard: shown to a viewer (unlocked, holder populated) until a VALID snapshot decrypt sets
 * viewerDataLoaded. Prevents stale persisted store data from rendering for a key that can't decrypt the owner's
 * snapshot. A REVOKED or ROTATED-OUT viewer unlocks fine (valid key) but never decrypts the re-sealed snapshot,
 * so the "Reset viewing key" escape is essential — without it the viewer is trapped here forever. Handoff v4:
 * PASTE-ONLY — the owner mints + hands over a token, so there's no "send the owner your npub" affordance;
 * recovery is asking the owner for a new token and resetting to reconnect.
 */
export function ViewerWaitingGate({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logo}>👁</div>
        <h1 className={styles.title}>Personal ₿LOC</h1>
        <p className={styles.subtitle}>Waiting for the owner's data…</p>
        <p className={styles.hint}>
          If this doesn't load, the owner may not have shared with this key yet (or rotated it). Ask the owner
          for a new handoff token, then reset below to reconnect — no data is lost.
        </p>
        <button className={styles.ghostBtn} onClick={onReset}>
          Reset viewing key
        </button>
      </div>
    </div>
  );
}
