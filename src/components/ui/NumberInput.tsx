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

// T4 UX: transient inline feedback instead of silent blur-revert. 'error' = unparseable
// non-empty entry (reverted); 'clamped' = valid entry outside [min,max] (snapped).
// Either clears on the next keystroke / refocus / successful commit. Empty raw stays a
// silent revert (clearing the field to undo typing is a normal gesture, not a mistake).
interface Feedback { kind: 'error' | 'clamped'; text: string }

export function NumberInput({ value, onChange, min, max, step = 1, prefix, suffix, decimals, label, subtext, readOnly, valueColor }: Props) {
  const viewerMode = useStore((s) => s.viewerMode);   // read-only viewer → every NumberInput is non-editable
  const ro = readOnly || viewerMode;
  const focused = useRef(false);
  const fmt = (v: number) => decimals !== undefined ? v.toFixed(decimals) : String(v);
  const [raw, setRaw] = useState(fmt(value));
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (!focused.current) setRaw(fmt(value));
  }, [value]);

  function commit() {
    const trimmed = raw.trim();
    if (trimmed === '') {           // cleared field → quiet revert
      setRaw(fmt(value));
      return;
    }
    const n = parseFloat(trimmed);
    if (!isNaN(n)) {
      const lo = min ?? -Infinity;
      const hi = max ?? Infinity;
      if (n < lo || n > hi) {
        const clamped = Math.min(hi, Math.max(lo, n));
        onChange(clamped);
        setRaw(fmt(clamped));
        const range = min !== undefined && max !== undefined ? `${fmt(min)}–${fmt(max)}`
          : max !== undefined ? `max ${fmt(max)}`
          : `min ${fmt(min ?? 0)}`;
        setFeedback({ kind: 'clamped', text: `Out of range — kept within ${range}` });
      } else {
        onChange(n);
        setRaw(fmt(n));
        setFeedback(null);
      }
    } else {
      setFeedback({ kind: 'error', text: 'Numbers only' });
      setRaw(fmt(value));
    }
  }

  return (
    <div className={styles.root}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={`${styles.inputWrap} ${feedback?.kind === 'error' ? styles.inputWrapError : ''}`}>
        {prefix && <span className={styles.prefix}>{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          className={styles.input}
          style={valueColor ? { color: valueColor } : undefined}
          value={raw}
          min={min}
          max={max}
          step={step}
          readOnly={ro}
          aria-invalid={feedback?.kind === 'error' || undefined}
          onChange={(e) => {
            if (ro) return;
            const raw = e.target.value;
            setRaw(raw);
            setFeedback(null);
            const n = parseFloat(raw);
            if (!isNaN(n) && n >= 0) {
              onChange(n);
            }
          }}
          onFocus={() => { focused.current = true; setFeedback(null); }}
          onBlur={() => { if (!ro) { focused.current = false; commit(); } }}
          // Enter only BLURS — onBlur is the single commit path. Committing here as well would
          // run commit() twice per Enter (each firing onChange → a duplicate plan event).
          onKeyDown={(e) => { if (!ro && e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {feedback && (
        <span className={feedback.kind === 'error' ? styles.errText : styles.clampText} role="status">
          {feedback.text}
        </span>
      )}
      {subtext && <span className={styles.subtext}>{subtext}</span>}
    </div>
  );
}
