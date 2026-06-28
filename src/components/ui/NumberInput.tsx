import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
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
  readOnly?: boolean;
  valueColor?: string;
}

export function NumberInput({ value, onChange, min, max, step = 1, prefix, suffix, decimals, label, subtext, readOnly, valueColor }: Props) {
  const viewerMode = useStore((s) => s.viewerMode);   // read-only viewer → every NumberInput is non-editable
  const ro = readOnly || viewerMode;
  const focused = useRef(false);
  const fmt = (v: number) => decimals !== undefined ? v.toFixed(decimals) : String(v);
  const [raw, setRaw] = useState(fmt(value));

  useEffect(() => {
    if (!focused.current) setRaw(fmt(value));
  }, [value]);

  function commit() {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
      onChange(clamped);
      setRaw(fmt(clamped));
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
          style={valueColor ? { color: valueColor } : undefined}
          value={raw}
          min={min}
          max={max}
          step={step}
          readOnly={ro}
          onChange={(e) => {
            if (ro) return;
            const raw = e.target.value;
            setRaw(raw);
            const n = parseFloat(raw);
            if (!isNaN(n) && n >= 0) {
              onChange(n);
            }
          }}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { if (!ro) { focused.current = false; commit(); } }}
          onKeyDown={(e) => { if (!ro && e.key === 'Enter') commit(); }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {subtext && <span className={styles.subtext}>{subtext}</span>}
    </div>
  );
}
