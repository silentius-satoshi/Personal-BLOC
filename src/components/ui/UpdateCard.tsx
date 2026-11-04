import { applyUpdate, UPDATE_WORDS } from '../../lib/appUpdate';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import styles from './UpdateCard.module.css';

/**
 * BL51 — "New version ready · Update": a slim card at the top of the home — every viewer's, and the owner's Dashboard —
 * once a check finds another build live (lib/appUpdate). One tap applies it; nothing else does. Not in the owner's
 * preview of his viewer (ViewerHomeView draws it only off the preview): the card is his device's, not his viewer's.
 */
export function UpdateCard() {
  const { status } = useAppUpdate();
  if (status !== 'available' && status !== 'updating' && status !== 'failed') return null;
  const failed = status === 'failed';
  return (
    <div className={styles.card} role="status">
      <span className={styles.text}>{failed ? UPDATE_WORDS.failed : UPDATE_WORDS.ready}</span>
      <button className={styles.btn} onClick={() => { void applyUpdate(); }} disabled={status === 'updating'}>
        {status === 'updating' ? UPDATE_WORDS.updating : failed ? UPDATE_WORDS.tryAgain : UPDATE_WORDS.update}
      </button>
    </div>
  );
}
