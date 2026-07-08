import { useState } from 'react';
import styles from './WordGrid.module.css';

/**
 * R2b-1 — the 12-word recovery-phrase display for OwnerKeySetup K2. Mirrors SecretKeyCard's blur/reveal +
 * copy pattern and reuses its visual language (btc-tinted card, --mono, filter-blur, "Tap to reveal" pill).
 *
 * ⚠ Purely display — never logs the words; the caller owns their lifecycle (a JS string can't be zeroed).
 *
 * NOT a <button> wrapper (unlike SecretKeyCard). SecretKeyCard nests a <code> (phrasing content) inside its
 * reveal button; a numbered grid is flow content (<ol>/<div>), which is invalid inside <button>. So the reveal
 * surface is the repo's role="button" + Enter/Space keydown idiom (SafetyDashboard / MonthEventsModal).
 *
 * R2b-3 will add an `input` mode (a controlled capture grid); R2b-1 is reveal-only.
 */
export interface WordGridProps {
  words: string[];
  onCopied?: () => void;
}

export function WordGrid({ words, onCopied }: WordGridProps) {
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
