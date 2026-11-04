import { applyUpdate, checkForUpdate, UPDATE_WORDS, type UpdateStatus } from '../../lib/appUpdate';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import styles from './UpdateCheck.module.css';

/** The line under the row, by state — none before the first check. */
const LINE: Record<UpdateStatus, string | null> = {
  idle: null,
  checking: UPDATE_WORDS.checking,
  current: UPDATE_WORDS.current,
  available: UPDATE_WORDS.ready,
  unknown: UPDATE_WORDS.unknown,
  updating: UPDATE_WORDS.updating,
  failed: UPDATE_WORDS.failed,
};

/**
 * BL51 — Settings → About's "Check for updates", the owner's and a viewer's: a check on demand (lib/appUpdate); another
 * build live → "Update" ("Try again" after a tap that failed, as on the card), the same one tap as the home's card. It
 * never applies an update without that tap.
 */
export function UpdateCheck({ inRow = false }: { inRow?: boolean }) {
  const { status } = useAppUpdate();
  const offer = status === 'available' || status === 'failed';
  const busy = status === 'checking' || status === 'updating';
  const line = LINE[status];
  return (
    <div className={inRow ? `${styles.check} ${styles.inRow}` : styles.check}>
      <div className={styles.row}>
        <span className={styles.title}>Updates</span>
        {offer ? (
          <button className={styles.btnPrimary} onClick={() => { void applyUpdate(); }}>
            {status === 'failed' ? UPDATE_WORDS.tryAgain : UPDATE_WORDS.update}
          </button>
        ) : (
          <button className={styles.btn} onClick={() => { void checkForUpdate(); }} disabled={busy}>{UPDATE_WORDS.check}</button>
        )}
      </div>
      {line && <p className={styles.line} role="status">{line}</p>}
    </div>
  );
}
