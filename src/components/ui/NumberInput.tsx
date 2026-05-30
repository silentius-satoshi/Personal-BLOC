import { useEffect, useState } from 'react';
import styles from './NumberInput.module.css';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label?: string;
  subtext?: string;
}

export function NumberInput({ value, onChange, min, max, step = 1, prefix, suffix, decimals, label, subtext }: Props) {
  const fmt = (v: number) => decimals !== undefined ? v.toFixed(decimals) : String(v);
  const [raw, setRaw] = useState(fmt(value));

  useEffect(() => {
    setRaw(fmt(value));
  }, [value]);

  function commit() {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
    } else {
      setRaw(fmt(value));
    }
  }

  return (
    <div className={styles.root}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.inputWrap}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input
          type="number"
          className={styles.input}
          value={raw}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const raw = e.target.value;
            setRaw(raw);
            const n = parseFloat(raw);
            if (!isNaN(n) && n >= 0) {
              onChange(n);
            }
          }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {subtext && <span className={styles.subtext}>{subtext}</span>}
    </div>
  );
}
