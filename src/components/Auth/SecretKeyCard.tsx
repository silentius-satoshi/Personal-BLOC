import { useState } from 'react';
import styles from './SecretKeyCard.module.css';

/**
 * Phase 1.5 — shared recovery-key display card. Shows a bech32 nsec, BLURRED by default (tap to reveal),
 * with a one-tap Copy. Standalone/presentational so Access P2's "Reveal recovery key" reuses it verbatim.
 * Props: nsec (the bech32 string to show), onCopied (fired after a successful copy).
 * ⚠ Purely display — never logs the key; the caller owns the nsec's lifecycle.
 */
export interface SecretKeyCardProps {
  nsec: string;
  onCopied?: () => void;
  hint?: string;   // footer caption override (default: password-manager advice); e.g. a handoff-token hint
}

export function SecretKeyCard({ nsec, onCopied, hint }: SecretKeyCardProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied]     = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(nsec);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopied?.();
  };

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.keyArea}
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? 'Hide recovery key' : 'Reveal recovery key'}
      >
        <code className={`${styles.key} ${revealed ? '' : styles.blurred}`}>{nsec}</code>
        {!revealed && <span className={styles.revealPill}>Tap to reveal</span>}
      </button>
      <div className={styles.footer}>
        <button type="button" className={styles.copyBtn} onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <span className={styles.hint}>{hint ?? 'Best kept in a password manager.'}</span>
      </div>
    </div>
  );
}
