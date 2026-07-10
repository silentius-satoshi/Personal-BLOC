import { useState, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import { unwrapRecoveryPayload } from '../../lib/nostr/keyVault';
import { wordsFromEntropy, deriveSkFromEntropy } from '../../lib/nostr/nip06Key';
import { useStore } from '../../store/useStore';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import { WordGrid } from '../Onboarding/WordGrid';
import { PassphraseInput } from '../ui/PassphraseInput';
import styles from './RevealRecoveryKey.module.css';

/**
 * Access Phase 2 (R2c-1) — the lost-my-backup escape hatch, VIEW-ONLY (it never verifies or stamps — that is
 * RecoveryKeyCeremony's job; this is the quiet utility). Re-reveals the local key on EVERY reveal via a Face ID
 * / PIN unwrap, branching on payloadKind:
 *   'nip06-entropy' → the 12 recovery WORDS (WordGrid) + an "Advanced: show as nsec" disclosure that derives the
 *                     nsec from the held entropy ON OPEN.
 *   'sk' / absent   → the nsec directly (SecretKeyCard), unchanged.
 * Rendered ONLY inside the identity subpage for a 'local' signer, so leaving the page unmounts it → the revealed
 * material is discarded. Auto-re-blurs/clears ~30s after reveal. ⚠ Never logs key material.
 */
const AUTO_CLEAR_MS = 30_000;

export function RevealRecoveryKey() {
  const wrapMeta = useStore((s) => s.writerKeyWrapMeta);
  const isPin = wrapMeta?.scheme === 'pin';

  const [words, setWords]     = useState<string[] | null>(null);   // entropy path — the revealed recovery words
  const [nsec, setNsec]       = useState<string | null>(null);     // sk path — the revealed nsec
  const [advNsec, setAdvNsec] = useState<string | null>(null);     // entropy path — Advanced: show as nsec
  const bytesRef              = useRef<Uint8Array | null>(null);    // entropy bytes, held so the Advanced disclosure can derive on open
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin]         = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  const zeroBytes  = () => { bytesRef.current?.fill(0); bytesRef.current = null; };

  // Zero the entropy + clear the timer on unmount (leaving the page discards everything with the component).
  useEffect(() => () => { clearTimer(); zeroBytes(); }, []);

  const clearReveal = () => { clearTimer(); zeroBytes(); setWords(null); setNsec(null); setAdvNsec(null); };

  const doReveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const { writerKeyWrapped, writerKeyWrapMeta } = useStore.getState();
      if (!writerKeyWrapped || !writerKeyWrapMeta) { setError('No local key on this device.'); return; }
      const { payloadKind, bytes } = await unwrapRecoveryPayload(writerKeyWrapped, writerKeyWrapMeta, writerKeyWrapMeta.scheme === 'pin' ? pin : undefined);
      if (payloadKind === 'nip06-entropy') {
        bytesRef.current = bytes;   // held for the Advanced-nsec derivation; zeroed on Hide / auto-clear / unmount
        setWords(wordsFromEntropy(bytes).split(' '));
      } else {
        setNsec(nip19.nsecEncode(bytes));   // the nsec STRING is the only artifact
        bytes.fill(0);                       // sk has no held-bytes use → zero immediately
      }
      setShowPin(false);
      setPin('');
      clearTimer();
      timerRef.current = setTimeout(clearReveal, AUTO_CLEAR_MS);
    } catch {
      setError(isPin ? 'Could not unlock — check your PIN and try again.' : 'Could not unlock — try again.');
    } finally {
      setBusy(false);
    }
  };

  const onRevealTap = () => {
    setError(null);
    if (isPin) setShowPin(true);   // PIN scheme → collect the PIN first
    else doReveal();               // PRF → Face ID directly
  };

  const toggleAdvNsec = () => {
    if (advNsec) { setAdvNsec(null); return; }   // closing — drop the derived nsec
    if (!bytesRef.current) return;
    const dsk = deriveSkFromEntropy(bytesRef.current);
    setAdvNsec(nip19.nsecEncode(dsk));
    dsk.fill(0);                                  // the derived sk is transient — zero right after encoding
  };

  if (words) {
    return (
      <div className={styles.wrap}>
        <WordGrid mode="reveal" words={words} />
        <button type="button" className={styles.advBtn} onClick={toggleAdvNsec} aria-expanded={!!advNsec} aria-controls="reveal-adv-nsec">
          <span>Advanced: show as nsec</span>
          <span className={styles.advChevron} data-open={advNsec ? true : undefined} aria-hidden="true">›</span>
        </button>
        {advNsec && <div id="reveal-adv-nsec" className={styles.advPanel}><SecretKeyCard nsec={advNsec} /></div>}
        <div className={styles.revealFoot}>
          <button type="button" className={styles.hideBtn} onClick={clearReveal}>Hide</button>
          <span className={styles.note}>Auto-hides in ~30s.</span>
        </div>
      </div>
    );
  }

  if (nsec) {
    return (
      <div className={styles.wrap}>
        <SecretKeyCard nsec={nsec} />
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
          <PassphraseInput
            className={styles.pinInput}
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            onChange={(v) => { setPin(v); setError(null); }}
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
