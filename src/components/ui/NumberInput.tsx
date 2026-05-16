import { useEffect, useRef, useState } from 'react';
import styles from './NumberInput.module.css';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  label?: string;
  subtext?: string;
}

export function NumberInput({ value, onChange, min, max, step = 1, prefix, label, subtext }: Props) {
  const [localValue, setLocalValue] = useState(String(value));
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  function handleChange(raw: string) {
    setLocalValue(raw);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const n = parseFloat(raw);
      if (!isNaN(n)) {
        const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
        onChange(clamped);
      }
    }, 300);
  }

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <div className={styles.root}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.inputWrap}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input
          type="number"
          className={styles.input}
          value={localValue}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handleChange(e.target.value)}
        />
      </div>
      {subtext && <span className={styles.subtext}>{subtext}</span>}
    </div>
  );
}
