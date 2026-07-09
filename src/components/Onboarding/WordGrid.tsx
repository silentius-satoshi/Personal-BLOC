import { useRef, useState } from 'react';
import { classifyRecoveryInput } from '../../lib/nostr/recoveryInput';
import { distributePaste, suggestWords, isWord } from '../../lib/recoveryGrid';
import styles from './WordGrid.module.css';

/**
 * The 12-word recovery grid. Two modes:
 *   'reveal' (R2b-1) — OwnerKeySetup K2's blurred display of a freshly-generated phrase. Byte-identical to the
 *                      original (the body moved into RevealGrid; output unchanged).
 *   'input'  (R2b-3) — the import capture grid: 12 controlled boxes + BIP-39 autocomplete. NostrAuthGate's
 *                      Recovery-phrase tab.
 *
 * ⚠ Purely a UI — never logs the words; the caller owns their lifecycle (a JS string can't be zeroed).
 * ⚠ CAPTURE UX ONLY in input mode — validity is a HINT here; entropyFromWords on submit is the authority.
 */
export type WordGridProps =
  | { mode: 'reveal'; words: string[]; onCopied?: () => void }
  | {
      mode: 'input';
      values: string[];
      onChange: (v: string[]) => void;
      onNsecPasted: (nsec: string) => void;   // a pasted nsec routes OUT of the grid → the parent's nsec tab
      onSubmitAttempt?: () => void;            // Enter on the last box
    };

export function WordGrid(props: WordGridProps) {
  return props.mode === 'reveal' ? <RevealGrid {...props} /> : <InputGrid {...props} />;
}

// ── Reveal (R2b-1, unchanged output) ─────────────────────────────────────────
// NOT a <button> wrapper (unlike SecretKeyCard): a numbered grid is flow content, invalid inside <button>. So
// the reveal surface is the repo's role="button" + Enter/Space keydown idiom (SafetyDashboard / MonthEventsModal).
function RevealGrid({ words, onCopied }: { words: string[]; onCopied?: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied]     = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(words.join(' '));   // ⚠ never logged
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopied?.();
  };

  const toggle = () => setRevealed((r) => !r);

  return (
    <div className={styles.card}>
      <div
        role="button"
        tabIndex={0}
        className={styles.gridArea}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        aria-label={revealed ? 'Hide recovery words' : 'Reveal recovery words'}
      >
        <ol className={`${styles.grid} ${revealed ? '' : styles.blurred}`}>
          {words.map((w, i) => (
            <li key={i} className={styles.cell}>
              <span className={styles.num}>{i + 1}</span>
              <span className={styles.word}>{w}</span>
            </li>
          ))}
        </ol>
        {!revealed && <span className={styles.revealPill}>Tap to reveal</span>}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.copyBtn} onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <span className={styles.hint}>Best kept written down, offline.</span>
      </div>
    </div>
  );
}

// ── Input (R2b-3) ────────────────────────────────────────────────────────────
// ⚠ CLEAR TEXT by deliberate decision: a masked 12-box grid is unusable (no proofreading, no autocomplete),
// and clear-text seed entry is the wallet convention. Accepted shoulder-surf tradeoff. Every box suppresses
// iOS autocapitalize/autocorrect (they'd mangle a word into a checksum failure — see NostrAuthGate's nsec field).
function InputGrid({
  values,
  onChange,
  onNsecPasted,
  onSubmitAttempt,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  onNsecPasted: (nsec: string) => void;
  onSubmitAttempt?: () => void;
}) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [touched, setTouched]           = useState<boolean[]>(() => Array(12).fill(false));
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const focusBox = (i: number) => inputsRef.current[i]?.focus();
  const markTouched = (i: number) => setTouched((t) => (t[i] ? t : t.map((v, k) => (k === i ? true : v))));

  const setBox = (i: number, word: string) => {
    const next = [...values];
    next[i] = word;
    onChange(next);
  };

  const commitAndAdvance = (i: number) => {
    if (i < 11) focusBox(i + 1);
    else { inputsRef.current[i]?.blur(); onSubmitAttempt?.(); }
  };

  const pick = (i: number, word: string) => {
    setBox(i, word);
    markTouched(i);   // tapping a suggestion commits the box → it may tint immediately
    commitAndAdvance(i);
  };

  const handleKeyDown = (e: React.KeyboardEvent, i: number) => {
    // Space/Enter commit + advance (Tab is left native — DOM order already advances box→box, and the
    // suggestion buttons are tabIndex={-1} so Tab from box 12 reaches Continue).
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); commitAndAdvance(i); }
  };

  const handlePaste = (e: React.ClipboardEvent, i: number) => {
    const text = e.clipboardData.getData('text');
    const c = classifyRecoveryInput(text);
    if (c.kind === 'nsec') { e.preventDefault(); onNsecPasted(c.value); return; }
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    const r = distributePaste(tokens, i);
    if (r === 'fill-from-start') { e.preventDefault(); onChange([...tokens]); return; }
    if (r.length === 0) return;   // 0/1 token → let the native paste land in this box
    e.preventDefault();
    const next = [...values];
    r.forEach((tok, k) => { next[i + k] = tok; });
    onChange(next);
    focusBox(Math.min(i + r.length, 11));
    // ⚠ deliberately NOT marking touched on paste — "neutral until first blur" (LOCKED) is literal. The
    // checksum line (touched-independent) still gives immediate valid/bad-checksum feedback.
  };

  const suggestions = focusedIndex !== null ? suggestWords(values[focusedIndex] ?? '') : [];

  const boxClass = (i: number) => {
    if (!touched[i]) return styles.box;
    return `${styles.box} ${isWord(values[i] ?? '') ? styles.boxOk : styles.boxBad}`;
  };

  return (
    <div className={styles.inputCard}>
      <ol className={styles.inputGrid}>
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} className={styles.inputCell}>
            <span className={styles.inputNum}>{i + 1}</span>
            <input
              ref={(el) => { inputsRef.current[i] = el; }}
              className={boxClass(i)}
              type="text"
              value={values[i] ?? ''}
              onChange={(e) => setBox(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              onPaste={(e) => handlePaste(e, i)}
              onFocus={() => setFocusedIndex(i)}
              onBlur={() => { setFocusedIndex((f) => (f === i ? null : f)); markTouched(i); }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label={`Word ${i + 1}`}
            />
          </li>
        ))}
      </ol>
      <div className={styles.suggestRow}>
        {suggestions.map((w) => (
          <button
            key={w}
            type="button"
            tabIndex={-1}
            className={styles.suggestBtn}
            // ⚠ onPointerDown + preventDefault keeps the focused box from blurring before the tap registers
            // (focus + selection survive → pick() can set the value and advance). This is a NEW pattern for the
            // repo — no prior precedent; the standard toolbar-button-beside-input technique. focusedIndex is
            // captured at render, so the closure sees the box this strip belongs to.
            onPointerDown={(e) => { e.preventDefault(); if (focusedIndex !== null) pick(focusedIndex, w); }}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
