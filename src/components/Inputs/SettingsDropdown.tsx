import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { NumberInput } from '../ui/NumberInput';
import styles from './SettingsDropdown.module.css';

export function SettingsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const blocApr        = useStore((s) => s.blocApr);
  const setBlocApr        = useStore((s) => s.setBlocApr);

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
          <NumberInput
            label="BLOC APR (%)"
            value={blocApr}
            onChange={setBlocApr}
            min={5}
            max={30}
            step={0.5}
            prefix="%"
          />
        </div>
      )}
    </div>
  );
}
