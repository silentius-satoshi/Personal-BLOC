import { useState } from 'react';
import styles from './PassphraseInput.module.css';

/**
 * The ONE masked-entry widget: a controlled input with a show/hide toggle. Adopted at every rendered masked field
 * in the app — passphrases (encrypt, unlock, verify, viewer token) AND PINs.
 *
 * Why it exists: a mistyped backup passphrase is invisible until it silently fails to decrypt, possibly a year
 * later. The eye lets the user proofread what they typed.
 *
 * ⚠ THE FOUR iOS SUPPRESSIONS ARE BAKED IN, not props. iOS silently autocapitalizes/autocorrects an unsuppressed
 * field, which would mangle a passphrase so the encrypt and decrypt sides permanently disagree. Every call site
 * needs them, so they are the default rather than 16 chances to forget one.
 *
 * ⚠ FOCUS GUARD: the toggle is `onPointerDown` + `preventDefault()` (the WordGrid suggestion-strip idiom). Without
 * it the tap blurs the field first — on iOS the keyboard collapses and the caret is lost mid-passphrase.
 *
 * ⚠ Never logs the value. The caller owns the secret's lifecycle (a JS string can't be zeroed).
 */
export interface PassphraseInputProps {
  value: string;
  onChange: (value: string) => void;
  /** The host's own input class — every call site keeps its exact look (styles.input / .pinInput / .dateInput). */
  className?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** PIN fields pass 'numeric' so the numeric keypad survives BOTH the masked and revealed states. */
  inputMode?: 'numeric';
  'aria-label'?: string;
}

export function PassphraseInput({
  value,
  onChange,
  className,
  id,
  placeholder,
  disabled,
  autoFocus,
  inputMode,
  'aria-label': ariaLabel,
}: PassphraseInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={styles.wrap}>
      <input
        id={id}
        className={className}
        type={revealed ? 'text' : 'password'}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        // ⚠ Mandatory on every masked field — see the header.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        // Inline, not a class: the host's own className sets padding/width, and CSS-module source order can't be
        // relied on to win. `paddingRight` keeps long text from running under the toggle; `width` restores the
        // fill that hosts previously got from the input being a flex child directly (see .wrap in the CSS).
        style={{ width: '100%', boxSizing: 'border-box', paddingRight: 62 }}
      />
      <button
        type="button"
        // tabIndex -1: Tab should move from the field to the form's real action, not into a decoration.
        tabIndex={-1}
        className={styles.toggle}
        // ⚠ preventDefault on POINTERDOWN (not onClick) so the field never blurs — focus + caret survive the tap.
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => setRevealed((r) => !r)}
        disabled={disabled}
        // Text, not an emoji glyph: matches this app's existing reveal vocabulary (NostrAuthGate's Show/Hide on the
        // recovery-key field, SecretKeyCard's "Tap to reveal") and renders identically on every platform.
        aria-label={revealed ? 'Hide passphrase' : 'Show passphrase'}
        aria-pressed={revealed}
      >
        {revealed ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
