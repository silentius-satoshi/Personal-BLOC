import { useState, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import { QRCodeSVG } from 'qrcode.react';
import { useNostr } from '@nostrify/react';
import { unwrapRecoveryPayload } from '../../lib/nostr/keyVault';
import { wordsFromEntropy } from '../../lib/nostr/nip06Key';
import { pickQuizIndices, checkQuizAnswers, checkNsecTail } from '../../lib/recoveryQuiz';
import { useStore } from '../../store/useStore';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import { WordGrid } from '../Onboarding/WordGrid';
import styles from './RecoveryKeyCeremony.module.css';

/**
 * R2c-1 — the real backup ceremony: explain → reveal → verify → done. Proves the user saved their Recovery Key
 * before stamping backupVerifiedAt (which un-gates sync via the setter's own self-wake). Opt-in from Settings →
 * Identity → RECOVERY. IDEMPOTENT: an already-verified user runs it end-to-end as a re-verify (never a dead end).
 *
 * ⚠ SECRET LIFECYCLE (earliest-possible zeroing): the unwrapped bytes are zeroed the INSTANT the display strings
 * are derived in reveal — verify and "view words again" read only the strings, never the bytes. A cleanup effect
 * zeros bytesRef defensively. The words/nsec strings are transient (a JS string can't be zeroed) and nulled on
 * done/close/unmount. Nothing is logged.
 */
export function RecoveryKeyCeremony({ onClose }: { onClose: () => void }) {
  const { nostr } = useNostr();
  const wrapMeta = useStore((s) => s.writerKeyWrapMeta);
  const backupVerifiedAt = useStore((s) => s.backupVerifiedAt);
  const isPin = wrapMeta?.scheme === 'pin';
  const isEntropy = wrapMeta?.payloadKind === 'nip06-entropy';

  const [step, setStep]     = useState<'explain' | 'reveal' | 'verify' | 'done'>('explain');
  const [pin, setPin]       = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const [words, setWords]   = useState<string[] | null>(null);   // entropy path
  const [nsec, setNsec]     = useState<string | null>(null);     // sk path
  const bytesRef            = useRef<Uint8Array | null>(null);    // held only in the instant between unwrap + zero
  const [showQR, setShowQR] = useState(false);

  const [indices, setIndices]     = useState<[number, number]>([0, 1]);
  const [ans0, setAns0]           = useState('');
  const [ans1, setAns1]           = useState('');
  const [tail, setTail]           = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const zeroBytes = () => { bytesRef.current?.fill(0); bytesRef.current = null; };
  const clearSecrets = () => { zeroBytes(); setWords(null); setNsec(null); setShowQR(false); };

  useEffect(() => () => zeroBytes(), []);   // defensive: zero on unmount (covers an unmount mid-reveal)

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const secretStr = () => (words ? words.join(' ') : nsec ?? '');
  const share = () => { void navigator.share?.({ text: secretStr() }).catch(() => {}); };

  const doUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const { writerKeyWrapped, writerKeyWrapMeta } = useStore.getState();
      if (!writerKeyWrapped || !writerKeyWrapMeta) { setError('No local key on this device.'); return; }
      const { payloadKind, bytes } = await unwrapRecoveryPayload(writerKeyWrapped, writerKeyWrapMeta, writerKeyWrapMeta.scheme === 'pin' ? pin : undefined);
      bytesRef.current = bytes;
      if (payloadKind === 'nip06-entropy') setWords(wordsFromEntropy(bytes).split(' '));
      else setNsec(nip19.nsecEncode(bytes));
      bytesRef.current = null; bytes.fill(0);   // ⚠ zero NOW — nothing after this reads bytes
      setPin('');
      setStep('reveal');
    } catch {
      setError(isPin ? 'Could not unlock — check your PIN and try again.' : 'Could not unlock — try again.');
    } finally {
      setBusy(false);
    }
  };

  // explain → reveal. Passkey unlocks on THIS tap (the WebAuthn user-activation); PIN routes to the PIN sub-UI.
  const onShowKey = () => { setError(null); if (isPin) setStep('reveal'); else doUnlock(); };

  const goVerify = () => {
    if (words) setIndices(pickQuizIndices());
    setVerifyError(null); setAns0(''); setAns1(''); setTail('');
    setStep('verify');
  };

  const submitVerify = () => {
    const ok = words ? checkQuizAnswers(words, indices, [ans0, ans1]) : nsec ? checkNsecTail(nsec, tail) : false;
    if (ok) {
      useStore.getState().setBackupVerifiedAt(Date.now(), nostr);   // the setter self-wakes (dirty + syncNow) — no second wake here
      clearSecrets();
      setStep('done');
    } else {
      setVerifyError("That doesn't match — check your saved copy.");
      if (words) { setIndices(pickQuizIndices()); setAns0(''); setAns1(''); }   // re-randomize on every failed attempt
    }
  };

  const close = () => { clearSecrets(); onClose(); };

  const revealed = !!(words || nsec);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>

        {step === 'explain' && (
          <>
            <div className={styles.brandRing}>🔑</div>
            <h2 className={styles.title}>Your Recovery Key</h2>
            {backupVerifiedAt != null && (
              <div className={styles.chip}>Backed up ✓ {new Date(backupVerifiedAt).toLocaleDateString()}</div>
            )}
            <p className={styles.body}>This is the master key to your plan. Anyone with it can open your plan; without it, no one — including us — can recover it.</p>
            <p className={styles.body}>Your passkey unlocks this device. The Recovery Key is the way back in when your devices are gone. A synced passkey (iCloud, Google) is NOT a backup.</p>
            {isEntropy && (
              <p className={styles.body}>These words were generated fresh for this plan. Never use them as a Bitcoin wallet — same format, different job.</p>
            )}
            <button className={styles.primary} onClick={onShowKey} disabled={busy}>
              {busy ? 'Unlocking…' : 'Show my Recovery Key'}
            </button>
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.ghost} onClick={close} disabled={busy}>Close</button>
          </>
        )}

        {step === 'reveal' && !revealed && (
          // Only the PIN scheme reaches here (passkey unlocks before entering the reveal step).
          <>
            <h2 className={styles.title}>Enter your PIN</h2>
            <input
              className={styles.pinInput}
              type="password"
              inputMode="numeric"
              placeholder="PIN"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(null); }}
              disabled={busy}
            />
            <button className={styles.primary} onClick={doUnlock} disabled={busy || pin.length < 4}>
              {busy ? 'Unlocking…' : 'Show key'}
            </button>
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.ghost} onClick={() => { setStep('explain'); setPin(''); setError(null); }} disabled={busy}>← Back</button>
          </>
        )}

        {step === 'reveal' && revealed && (
          <>
            <h2 className={styles.title}>Save your Recovery Key</h2>
            {words ? <WordGrid mode="reveal" words={words} /> : nsec ? <SecretKeyCard nsec={nsec} /> : null}
            <div className={styles.aids}>
              {canShare && <button type="button" className={styles.aidBtn} onClick={share}>Save…</button>}
              <button type="button" className={styles.aidBtn} onClick={() => setShowQR((v) => !v)}>
                {showQR ? 'Hide QR' : 'Show printable QR'}
              </button>
            </div>
            {showQR && (
              <div className={styles.qrPanel}>
                <QRCodeSVG value={secretStr()} size={220} />
                {words ? (
                  <ol className={styles.qrWords}>
                    {words.map((w, i) => <li key={i}><span className={styles.qrNum}>{i + 1}</span> {w}</li>)}
                  </ol>
                ) : (
                  <code className={styles.qrNsec}>{nsec}</code>
                )}
              </div>
            )}
            <button className={styles.primary} onClick={goVerify}>Continue</button>
            <button className={styles.ghost} onClick={close}>Close</button>
          </>
        )}

        {step === 'verify' && (
          <>
            <h2 className={styles.title}>Confirm you saved it</h2>
            {words ? (
              <>
                <p className={styles.body}>Enter word #{indices[0] + 1} and word #{indices[1] + 1} from your saved copy.</p>
                <input
                  className={styles.pinInput}
                  type="text"
                  placeholder={`Word #${indices[0] + 1}`}
                  value={ans0}
                  onChange={(e) => { setAns0(e.target.value); setVerifyError(null); }}
                  autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                  aria-label={`Word ${indices[0] + 1}`}
                />
                <input
                  className={styles.pinInput}
                  type="text"
                  placeholder={`Word #${indices[1] + 1}`}
                  value={ans1}
                  onChange={(e) => { setAns1(e.target.value); setVerifyError(null); }}
                  autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                  aria-label={`Word ${indices[1] + 1}`}
                />
              </>
            ) : (
              <>
                <p className={styles.body}>Type the last 6 characters of your saved nsec.</p>
                <input
                  className={styles.pinInput}
                  type="text"
                  placeholder="last 6"
                  value={tail}
                  onChange={(e) => { setTail(e.target.value); setVerifyError(null); }}
                  autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                  aria-label="Last 6 characters of your nsec"
                />
              </>
            )}
            {verifyError && <p className={styles.error}>{verifyError}</p>}
            <button className={styles.primary} onClick={submitVerify} disabled={words ? (!ans0.trim() || !ans1.trim()) : !tail.trim()}>
              Confirm
            </button>
            <button className={styles.ghost} onClick={() => { setVerifyError(null); setStep('reveal'); }}>← View words again</button>
          </>
        )}

        {step === 'done' && (
          <>
            <div className={styles.brandRing}>✓</div>
            <h2 className={styles.title}>Backed up. Your plan now syncs, encrypted, under your key.</h2>
            <button className={styles.primary} onClick={onClose}>Close</button>
          </>
        )}

      </div>
    </div>
  );
}
