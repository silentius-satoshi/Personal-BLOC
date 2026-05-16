import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import styles from './SettingsDropdown.module.css';

export function SettingsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const showFoldCC     = useStore((s) => s.showFoldCC);
  const blocApr        = useStore((s) => s.blocApr);
  const foldRewardRate = useStore((s) => s.foldRewardRate);
  const setShowFoldCC     = useStore((s) => s.setShowFoldCC);
  const setBlocApr        = useStore((s) => s.setBlocApr);
  const setFoldRewardRate = useStore((s) => s.setFoldRewardRate);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div className={styles.root} ref={ref}>
      <button
        className={`${styles.gear} ${open ? styles.gearActive : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        aria-label="Settings"
      >
        ⚙
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.row}>
            <span className={styles.settingLabel}>Fold CC rewards</span>
            <Toggle checked={showFoldCC} onChange={setShowFoldCC} />
          </div>

          <div className={styles.divider} />

          <NumberInput
            label="BLOC APR (%)"
            value={blocApr}
            onChange={setBlocApr}
            min={5}
            max={30}
            step={0.5}
            prefix="%"
          />

          {showFoldCC && (
            <NumberInput
              label="Fold CC Reward Rate (%)"
              value={foldRewardRate}
              onChange={setFoldRewardRate}
              min={0.5}
              max={4}
              step={0.1}
              prefix="%"
            />
          )}
        </div>
      )}
    </div>
  );
}
