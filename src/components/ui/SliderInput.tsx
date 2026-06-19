import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
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
  labelSuffix?: React.ReactNode;
}

export function SliderInput({
  label, value, onChange, min, max, step, display, minLabel, maxLabel, labelSuffix,
}: SliderInputProps) {
  const viewerMode = useStore((s) => s.viewerMode);   // read-only viewer → slider + edit disabled
  const [editing, setEditing]     = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      onChange(Math.min(max, Math.max(min, parsed)));
    }
    setEditing(false);
  }

  return (
    <div className={styles.root}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {labelSuffix && <span className={styles.labelSuffix}>{labelSuffix}</span>}
      </div>

      {editing ? (
        <input
          ref={inputRef}
          type="text"
          className={styles.valueInput}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <div
          className={styles.valueDisplay}
          onClick={() => { if (viewerMode) return; setEditValue(String(value)); setEditing(true); }}
        >
          {display}
        </div>
      )}

      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={viewerMode}
        onChange={(e) => { if (!editing) onChange(Number(e.target.value)); }}
      />

      {(minLabel || maxLabel) && (
        <div className={styles.minMax}>
          <span className={styles.minLabel}>{minLabel}</span>
          <span className={styles.maxLabel}>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
