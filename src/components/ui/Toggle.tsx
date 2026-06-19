import { useStore } from '../../store/useStore';
import styles from './Toggle.module.css';

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ value, onChange, label, disabled }: Props) {
  const viewerMode = useStore((s) => s.viewerMode);   // read-only viewer → every Toggle is disabled
  const dis = disabled || viewerMode;
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
