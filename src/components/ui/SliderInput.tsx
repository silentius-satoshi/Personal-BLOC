import styles from './SliderInput.module.css';

interface SliderInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  display: string;
  minLabel?: string;
  maxLabel?: string;
}

export function SliderInput({
  label, value, onChange, min, max, step, display, minLabel, maxLabel,
}: SliderInputProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{display}</span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {(minLabel || maxLabel) && (
        <div className={styles.rangeLabels}>
          <span>{minLabel ?? ''}</span>
          <span>{maxLabel ?? ''}</span>
        </div>
      )}
    </div>
  );
}
