import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import { hasLoggedData } from '../../lib/hasLoggedData';
import { RecoveryKeyCeremony } from '../Settings/RecoveryKeyCeremony';
import styles from './BackupNagCard.module.css';

/**
 * R2c-2 ladder rung 2 — the dashboard backup nag. Once a generated key holds REAL data that exists only on
 * this phone, it must be backed up before it's lost. Rides ViewerHomeView's `notice` slot alongside
 * NoPlanNotice — the two are MUTUALLY EXCLUSIVE by construction (NoPlanNotice gates keyProvenance !==
 * 'generated'; this gates keyProvenance === 'generated'), so at most one ever renders.
 *
 * Self-gating (in order): a fresh generated key, gate still unsatisfied, the plan has data, not dismissed this
 * session. Dismissal is session-transient — the nag returns next launch while unsatisfied (the ladder). On
 * ceremony success the gate flips and this self-clears reactively (it subscribes keyProvenance +
 * backupVerifiedAt) — no imperative cleanup. Owns its own ceremony overlay (no lifted state).
 */
export function BackupNagCard() {
  const keyProvenance     = useStore((s) => s.keyProvenance);
  const backupVerifiedAt  = useStore((s) => s.backupVerifiedAt);
  const loggedData        = useStore(hasLoggedData);
  const backupNagDismissed = useStore((s) => s.backupNagDismissed);
  const dismissBackupNag  = useStore((s) => s.dismissBackupNag);

  const [ceremonyOpen, setCeremonyOpen] = useState(false);

  if (keyProvenance !== 'generated') return null;                 // NoPlanNotice owns the other case
  if (isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })) return null;
  if (!loggedData) return null;                                   // nothing worth losing yet
  if (backupNagDismissed) return null;

  return (
    <>
      <div className={styles.notice} role="status">
        <span className={styles.text}>
          Your plan now has real data, and it exists only on this phone. Save your Recovery Key — it takes a minute.
        </span>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => setCeremonyOpen(true)}>Save it now</button>
          <button className={styles.dismiss} onClick={() => dismissBackupNag()}>Dismiss</button>
        </div>
      </div>
      {ceremonyOpen && <RecoveryKeyCeremony onClose={() => setCeremonyOpen(false)} />}
    </>
  );
}
