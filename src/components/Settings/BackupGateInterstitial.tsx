import { useState } from 'react';
import { RecoveryKeyCeremony } from './RecoveryKeyCeremony';
import styles from './BackupGateInterstitial.module.css';

/**
 * R2c-2 ladder rung 3 — the hard gate. Replaces the Sharing / Network page content while the backup gate is
 * unsatisfied. For a generated-unverified key the engine is idle anyway (R2a-1) — sharing and relay sync would
 * silently no-op — so this converts that silent failure into a path forward instead of a dead button.
 *
 * Self-contained: owns its own ceremony overlay (no lifted state). On success the gate flips and the mounting
 * page re-renders the real content reactively (SettingsMain subscribes keyProvenance + backupVerifiedAt) — no
 * imperative cleanup. `onBack` is the ghost escape (its host wires it to the settings menu).
 */
export function BackupGateInterstitial({ onBack }: { onBack: () => void }) {
  const [ceremonyOpen, setCeremonyOpen] = useState(false);

  return (
    <div className={styles.wrap}>
      <div className={styles.ring}>🔑</div>
      <h2 className={styles.title}>Save your Recovery Key first</h2>
      <p className={styles.body}>
        Sharing your plan and syncing to relays create copies only your key can open. Prove you've saved it,
        then this unlocks.
      </p>
      <button className={styles.primary} onClick={() => setCeremonyOpen(true)}>Save my Recovery Key</button>
      <button className={styles.ghost} onClick={onBack}>← Back</button>
      {ceremonyOpen && <RecoveryKeyCeremony onClose={() => setCeremonyOpen(false)} />}
    </div>
  );
}
