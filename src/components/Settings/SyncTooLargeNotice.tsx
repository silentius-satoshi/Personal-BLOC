// 5b (spec `pbloc-spec-journal-pages-v1`) — Settings › SYNC: what the size guard refused to send, and what that means,
// in plain words. Renders nothing while every channel fits.
import { useSyncBlocked, TOO_LARGE_COPY, CHANNEL_LABEL } from '../../hooks/useSyncBlocked';
import styles from './SettingsMain.module.css';

export function SyncTooLargeNotice() {
  const blocked = useSyncBlocked();
  if (!blocked.length) return null;
  return (
    <div className={styles.syncWarn} role="status">
      <span className={styles.syncWarnTitle}>⚠ Too large to sync: {blocked.map((c) => CHANNEL_LABEL[c]).join(', ')}</span>
      {blocked.map((c) => <span key={c} className={styles.syncWarnBody}>{TOO_LARGE_COPY[c]}</span>)}
    </div>
  );
}
