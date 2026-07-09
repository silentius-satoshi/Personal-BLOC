import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import { RecoveryKeyCeremony } from '../Settings/RecoveryKeyCeremony';
import styles from './BackupNagCard.module.css';

/**
 * Ladder rung 2 — the backup nag. A generated key that hasn't been verified is the SOLE copy of the user's
 * identity, so it must be backed up. Mounted on the dashboard (via ViewerHomeView's `notice` slot), on both
 * journal surfaces (Daily + Monthly), and at the top of the Settings menu.
 *
 * ⚠ R2c-5b — the nag fires PRE-LOG. It used to also require that the plan held logged data; that condition is
 * gone, because the danger is an unverified generated key EXISTING AT ALL, not data existing to lose.
 * (Sync/publish are already gated off by R2a-1, so a user who walks away right after onboarding is left with an
 * unbacked-up sole key and a silently inert app.)
 *
 * Self-gating (in order): a fresh generated key, gate still unsatisfied, not dismissed this session. Mutually
 * exclusive with NoPlanNotice by construction (that gates keyProvenance !== 'generated'; this gates ===).
 * Dismissal is session-transient — the nag returns next launch while unsatisfied (that IS the ladder), and
 * `backupNagDismissed` is shared store state so one dismiss clears every surface. On ceremony success the gate
 * flips and this self-clears reactively (it subscribes keyProvenance + backupVerifiedAt) — no imperative
 * cleanup. Owns its own ceremony overlay (no lifted state).
 */
export function BackupNagCard() {
  const keyProvenance      = useStore((s) => s.keyProvenance);
  const backupVerifiedAt   = useStore((s) => s.backupVerifiedAt);
  const backupNagDismissed = useStore((s) => s.backupNagDismissed);
  const dismissBackupNag   = useStore((s) => s.dismissBackupNag);

  const [ceremonyOpen, setCeremonyOpen] = useState(false);

  if (keyProvenance !== 'generated') return null;                 // NoPlanNotice owns the other case
  if (isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })) return null;
  if (backupNagDismissed) return null;

  return (
    <>
      <div className={styles.notice} role="status">
        <div className={styles.text}>
          <span className={styles.title}>Your plan's key isn't backed up yet.</span>
          <span className={styles.body}>
            Save your Recovery Key so you never lose access to this plan — it takes a minute.
          </span>
        </div>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => setCeremonyOpen(true)}>Save it now</button>
          <button className={styles.dismiss} onClick={() => dismissBackupNag()}>Dismiss</button>
        </div>
      </div>
      {ceremonyOpen && <RecoveryKeyCeremony onClose={() => setCeremonyOpen(false)} />}
    </>
  );
}
