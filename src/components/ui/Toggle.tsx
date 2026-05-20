import styles from './Toggle.module.css';

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ value, onChange, label, disabled }: Props) {
  return (
    <label className={`${styles.root} ${disabled ? styles.rootDisabled : ''}`}>
      <input
        type="checkbox"
        className={styles.input}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className={styles.track}>
        <span className={styles.thumb} />
      </span>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
}
