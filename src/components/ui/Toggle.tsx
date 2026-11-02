import { useViewerLocked } from './viewerWhatIf';
import styles from './Toggle.module.css';

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ value, onChange, label, disabled }: Props) {
  // A viewer's Toggle is disabled — except in the Almanac's what-ifs (BL48, viewerWhatIf.ts).
  const viewerLocked = useViewerLocked();
  const dis = disabled || viewerLocked;
  return (
    <label className={`${styles.root} ${dis ? styles.rootDisabled : ''}`}>
      <input
        type="checkbox"
        className={styles.input}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        disabled={dis}
      />
      <span className={styles.track}>
        <span className={styles.thumb} />
      </span>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
}
