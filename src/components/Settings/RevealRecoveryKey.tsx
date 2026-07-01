import { useState, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import { unwrapSecretKey } from '../../lib/nostr/keyVault';
import { useStore } from '../../store/useStore';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import styles from './RevealRecoveryKey.module.css';

/**
 * Access Phase 2 — the lost-my-backup escape hatch. Re-reveals the local key's recovery nsec, requiring
 * a Face ID / PIN unwrap on EVERY reveal (the plaintext nsec is never cached beyond this component's
 * lifetime). Rendered ONLY inside the identity subpage for a 'local' signer, so leaving the page unmounts
 * it → the revealed nsec is discarded. Auto-re-blurs/clears ~30s after reveal. ⚠ Never logs the key.
 */
const AUTO_CLEAR_MS = 30_000;

export function RevealRecoveryKey() {
  const wrapMeta = useStore((s) => s.writerKeyWrapMeta);
  const isPin = wrapMeta?.scheme === 'pin';

  const [revealedNsec, setRevealedNsec] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin]         = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

  // Clear the auto-hide timer on unmount (leaving the page discards the revealed nsec with the component).
  useEffect(() => clearTimer, []);

  const clearReveal = () => { clearTimer(); setRevealedNsec(null); };

  const doReveal = async () => {
    setBusy(true);
    setError(null);
    let sk: Uint8Array | null = null;
    try {
      const { writerKeyWrapped, writerKeyWrapMeta } = useStore.getState();
      if (!writerKeyWrapped || !writerKeyWrapMeta) { setError('No local key on this device.'); return; }
      sk = await unwrapSecretKey(writerKeyWrapped, writerKeyWrapMeta, writerKeyWrapMeta.scheme === 'pin' ? pin : undefined);
      setRevealedNsec(nip19.nsecEncode(sk));   // the nsec STRING is the only artifact now
      setShowPin(false);
      setPin('');
      clearTimer();
      timerRef.current = setTimeout(clearReveal, AUTO_CLEAR_MS);
    } catch {
      setError(isPin ? 'Could not unlock — check your PIN and try again.' : 'Could not unlock — try again.');
    } finally {
      sk?.fill(0);   // zero immediately; the encoded nsec string carries the value for the reveal window
      setBusy(false);
    }
  };

  const onRevealTap = () => {
    setError(null);
    if (isPin) setShowPin(true);   // PIN scheme → collect the PIN first
    else doReveal();               // PRF → Face ID directly
  };

  if (revealedNsec) {
    return (
      <div className={styles.wrap}>
        <SecretKeyCard nsec={revealedNsec} />
        <div className={styles.revealFoot}>
          <button type="button" className={styles.hideBtn} onClick={clearReveal}>Hide</button>
          <span className={styles.note}>Auto-hides in ~30s.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {showPin ? (
        <div className={styles.pinRow}>
          <input
            className={styles.pinInput}
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(null); }}
            disabled={busy}
          />
          <button
            type="button"
            className={styles.revealBtn}
            onClick={doReveal}
            disabled={busy || pin.length < 4}
          >
            {busy ? 'Unlocking…' : 'Show key'}
          </button>
          <button type="button" className={styles.hideBtn} onClick={() => { setShowPin(false); setPin(''); setError(null); }} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className={styles.revealBtn} onClick={onRevealTap} disabled={busy}>
          {busy ? 'Unlocking…' : '🔑 Reveal recovery key'}
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <span className={styles.note}>Requires {isPin ? 'your PIN' : 'Face ID'} — shown only on this device, never stored in plain text.</span>
    </div>
  );
}
