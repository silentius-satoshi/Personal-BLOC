import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { awaySaves, fmtNumberField, keystrokeWrite, leaveCommits, numberCommit, SAVE_DATED, type NumberSave } from './numberInputModel';
import styles from './NumberInput.module.css';

interface Props {
  value: number;
  onChange: (v: number) => void;
  /** BL35 — how the field saves; required, so every field says so (numberInputModel). `'button'`: a figure read off
   *  Strike or Coinbase — nothing saves until "Save — dated today" or Enter; `'leave'`: a plan setting — saved once, on
   *  leaving the field or Enter; `'live'`: a draft or a what-if — each keystroke hands the figure on. */
  save: NumberSave;
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
  /** The input's accessible name (BL33). The visible label is a span, not a <label>, so a screen reader — and a test —
   *  can't name the field from it; absent, nothing changes. */
  ariaLabel?: string;
}

export function NumberInput({ value, onChange, save, min, max, step = 1, prefix, suffix, decimals, label, subtext, readOnly, valueColor, ariaLabel }: Props) {
  const viewerMode = useStore((s) => s.viewerMode);   // read-only viewer → every NumberInput is non-editable
  const ro = readOnly || viewerMode;
  const focused = useRef(false);
  // F-2d-1 — the text the app's going away last saved, until the owner types again: its two signals, should they come
  // together, save once.
  const awaySaved = useRef<string | null>(null);
  // BL34 (F-2c-1) — whether the owner typed since the field took focus (a 'button' field: since its last Save or Cancel).
  const [typed, setTyped] = useState(false);
  const fmt = (v: number) => fmtNumberField(v, decimals);
  const [raw, setRaw] = useState(fmt(value));
  // BL34–BL35 — the ONE commit rule (numberInputModel): what leaving, Enter or Save would save — nothing unless typed,
  // never the figure the field shows (a dated 'button' field's typing saves even then: its save dates it). A 'button'
  // field holds that typing, with its buttons, until Save or Cancel.
  const pending = numberCommit({ typed, raw, value, min, max, decimals, dated: save === 'button' });
  const holds = save === 'button' && pending.write !== null;

  useEffect(() => {
    if (!focused.current && !holds) setRaw(fmt(value));   // a held figure keeps its text until Save or Cancel
  }, [value]);

  // The rule's one writer: what leaving, Enter, Save — or the app going away — saves.
  function writeTyped() {
    if (pending.write !== null) onChange(pending.write);
  }
  function commit() {
    writeTyped();
    setRaw(pending.show);
    setTyped(false);
    awaySaved.current = null;
  }
  function cancel() {
    setRaw(fmt(value));
    setTyped(false);
  }
  // F-2d-1 — leaving the APP isn't leaving the field. On the owner's iPhone, a plan setting typed and then left by a
  // switch to another app was lost once iOS closed the app: no React onBlur ran (React listens for `focusout`; WebKit's
  // loss of page focus sends the field a bare `blur`, by its source). So a focused 'leave' field saves what was typed, by
  // the rule, when the window loses focus (the app switcher) or the page turns hidden (the Home Screen, another app) —
  // and the edit goes on: its text and `typed` stay, so the owner comes back to the field as he left it, and leaving it
  // afterwards saves only a figure typed since (numberCommit never re-saves the figure the field shows). With the
  // default plain storage, the write reaches localStorage in the same task. The latest render's save, through a ref.
  const awayRef = useRef(() => {});
  awayRef.current = () => {
    if (awaySaved.current === raw) return;
    awaySaved.current = raw;
    writeTyped();
  };
  useEffect(() => {
    if (ro || !awaySaves(save)) return;
    const onAway = (e: Event) => {
      if (!focused.current || (e.type === 'visibilitychange' && document.visibilityState !== 'hidden')) return;
      awayRef.current();
    };
    window.addEventListener('blur', onAway);
    document.addEventListener('visibilitychange', onAway);
    return () => {
      window.removeEventListener('blur', onAway);
      document.removeEventListener('visibilitychange', onAway);
    };
  }, [ro, save]);

  return (
    <div className={styles.root}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={holds ? `${styles.inputWrap} ${styles.inputWrapHeld}` : styles.inputWrap}>
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
          aria-label={ariaLabel}
          onChange={(e) => {
            if (ro) return;
            setTyped(true);
            awaySaved.current = null;
            const raw = e.target.value;
            setRaw(raw);
            const w = keystrokeWrite(save, raw);
            if (w !== null) onChange(w);
          }}
          onFocus={() => { focused.current = true; if (!holds) setTyped(false); }}
          onBlur={() => { if (!ro) { focused.current = false; if (leaveCommits(save)) commit(); else if (!holds) cancel(); } }}
          onKeyDown={(e) => { if (!ro && e.key === 'Enter') commit(); }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
      {holds && (
        <div className={styles.saveRow}>
          <button type="button" className={styles.saveBtn} onClick={commit}>{SAVE_DATED}</button>
          <button type="button" className={styles.cancelBtn} onClick={cancel}>Cancel</button>
        </div>
      )}
      {subtext && <span className={styles.subtext}>{subtext}</span>}
    </div>
  );
}
