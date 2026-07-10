import { useState, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { useNostr } from '@nostrify/react';
import { unwrapRecoveryPayload } from '../../lib/nostr/keyVault';
import { wordsFromEntropy, skFromWords } from '../../lib/nostr/nip06Key';
import { pickQuizIndices, checkQuizAnswers, checkNsecTail, checkBackupPassphrase } from '../../lib/recoveryQuiz';
import { downloadBlob } from '../../lib/backup/downloadFile';
import { buildRecoveryFileText, recoveryFileName, type RecoveryArtifactKind } from '../../lib/backup/recoveryFile';
import { todayLocalISO } from '../../utils/format';
import { useStore } from '../../store/useStore';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import { WordGrid } from '../Onboarding/WordGrid';
import { Toggle } from '../ui/Toggle';
import { PassphraseInput } from '../ui/PassphraseInput';
import styles from './RecoveryKeyCeremony.module.css';

/**
 * R2c-1 — the real backup ceremony: explain → reveal → verify → done. Proves the user saved their Recovery Key
 * before stamping backupVerifiedAt (which un-gates sync via the setter's own self-wake). Opt-in from Settings →
 * Identity → RECOVERY. IDEMPOTENT: an already-verified user runs it end-to-end as a re-verify (never a dead end).
 *
 * ⚠ SECRET LIFECYCLE (earliest-possible zeroing): the unwrapped bytes are zeroed the INSTANT the display strings
 * are derived in reveal — verify, "view words again", AND the save aids read only the strings, never the bytes. A
 * cleanup effect zeros bytesRef defensively. The words/nsec strings are transient (a JS string can't be zeroed) and
 * nulled on done/close/unmount. Nothing is logged.
 *
 * R2c-7b — the SAVE AIDS produce real files: a plaintext .txt by default (a mnemonic backup is meant to be readable
 * off paper), an optional NIP-49 encrypted .txt, a printable QR, and a QR .png. The encrypted export is the FIRST
 * owner-key ncryptsec this app produces — it is exactly what R2c-7a's Recovery-key import branch consumes.
 */
export function RecoveryKeyCeremony({ onClose }: { onClose: () => void }) {
  const { nostr } = useNostr();
  const wrapMeta = useStore((s) => s.writerKeyWrapMeta);
  const backupVerifiedAt = useStore((s) => s.backupVerifiedAt);
  const keyProvenance = useStore((s) => s.keyProvenance);
  const isPin = wrapMeta?.scheme === 'pin';
  const isEntropy = wrapMeta?.payloadKind === 'nip06-entropy';
  const isImported = keyProvenance === 'imported';   // R2c-6a: never claim generated-fresh for a restored phrase

  const [step, setStep]     = useState<'explain' | 'reveal' | 'verify' | 'done'>('explain');
  const [pin, setPin]       = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const [words, setWords]   = useState<string[] | null>(null);   // entropy path
  const [nsec, setNsec]     = useState<string | null>(null);     // sk path
  const bytesRef            = useRef<Uint8Array | null>(null);    // held only in the instant between unwrap + zero
  const [showQR, setShowQR] = useState(false);

  // R2c-7b save aids. `artifact` caches the encrypted string for the CURRENT passphrase; `qrValue` is whatever the
  // on-screen QR encodes. Both are invalidated the moment the toggle or passphrase changes, so the QR on screen can
  // never disagree with what a download would write.
  const [encryptOn, setEncryptOn] = useState(false);
  const [filePass, setFilePass]   = useState('');
  const [artifact, setArtifact]   = useState<string | null>(null);
  const [qrValue, setQrValue]     = useState<string | null>(null);
  const [encrypting, setEncrypting] = useState(false);
  const [aidError, setAidError]   = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  // R2c-7b-fix — Continue is gated on an actual save. Without it a user could walk the whole ceremony, answer the
  // quiz off the on-screen grid, and have backupVerifiedAt stamped with the key living only in RAM.
  const [savedOnce, setSavedOnce] = useState(false);

  const [indices, setIndices]     = useState<[number, number]>([0, 1]);
  const [ans0, setAns0]           = useState('');
  const [ans1, setAns1]           = useState('');
  const [tail, setTail]           = useState('');
  const [verifyPass, setVerifyPass]   = useState('');   // encrypted path: passphrase re-entry
  // Snapshot of encryptOn taken at Continue-time, so the verify question can't change mid-verify (see goVerify).
  const [verifyEncrypted, setVerifyEncrypted] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const zeroBytes = () => { bytesRef.current?.fill(0); bytesRef.current = null; };
  const clearAids = () => {
    setEncryptOn(false); setFilePass(''); setArtifact(null); setQrValue(null);
    setEncrypting(false); setAidError(null); setShowQR(false); setSavedOnce(false);
  };
  const clearSecrets = () => { zeroBytes(); setWords(null); setNsec(null); clearAids(); };

  useEffect(() => () => zeroBytes(), []);   // defensive: zero on unmount (covers an unmount mid-reveal)

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const secretStr = () => (words ? words.join(' ') : nsec ?? '');

  const kind: RecoveryArtifactKind = encryptOn ? 'ncryptsec' : words ? 'words' : 'nsec';
  const passReady = !encryptOn || filePass.trim().length > 0;
  const aidsDisabled = !passReady || encrypting;

  /**
   * Any change to the encryption inputs invalidates the prepared artifact AND the QR that encodes it, and bumps
   * `prepRef` so an in-flight encryption can't land afterwards. ⚠ Without that token an encrypt started under the
   * OLD passphrase (the inputs are live during the 30ms paint yield) would resolve into the cache, and the next
   * Download would write a file locked with a passphrase the user never typed. Same hazard, and the same fix, as
   * R2c-7a's clearTimeout on the stale in-flight decrypt.
   *
   * ⚠ It also clears `savedOnce` (R2c-7b-fix): the same change that staled the cache staled whatever the user
   * already saved. Download plaintext, then toggle encrypt ON, and the file on disk is NOT the encrypted backup
   * you are about to be quizzed on — you must save again.
   */
  const prepRef = useRef(0);
  const invalidateArtifact = () => {
    prepRef.current++;
    setArtifact(null); setQrValue(null); setShowQR(false); setAidError(null); setSavedOnce(false);
  };

  /**
   * ⚠ The sk is re-derived from the DISPLAY STRINGS, never from retained bytes — that is what keeps `doUnlock`'s
   * earliest-possible zeroing intact (contrast RevealRecoveryKey, which holds bytesRef for its nsec disclosure).
   * `skFromWords(words) === deriveSkFromEntropy(entropy)` for every valid phrase (pinned in nip06Key.test.ts).
   * The derived buffer is zeroed immediately, on success and on throw.
   *
   * ⚠ `.trim()` is SYMMETRIC with every decrypt site (SharingPage encrypt, ViewerLoginFlow + NostrAuthGate
   * decrypt). An untrimmed passphrase here would silently never restore.
   */
  const encryptArtifact = (): string => {
    const sk = words ? skFromWords(words.join(' ')) : (nip19.decode(nsec!).data as Uint8Array);
    try { return nip49.encrypt(sk, filePass.trim()); } finally { sk.fill(0); }
  };

  /**
   * The single artifact gate behind all three aids. Plaintext is synchronous; encryption is a deliberate one-shot
   * (no debounce — unlike 7a's decrypt, nothing here reacts to typing), yielding one frame so "Encrypting…" paints
   * before ~1s of synchronous scrypt blocks the thread. Well inside navigator.share's transient-activation window.
   */
  const ensureArtifact = async (): Promise<string | null> => {
    setAidError(null);
    if (!encryptOn) return secretStr();
    if (artifact) return artifact;
    const token = prepRef.current;
    setEncrypting(true);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const value = encryptArtifact();
      if (prepRef.current !== token) return null;   // the inputs changed mid-encrypt → this result is stale
      setArtifact(value);
      return value;
    } catch {
      setAidError("Couldn't encrypt — try again.");   // ⚠ never e.message (it can echo the key)
      return null;
    } finally {
      setEncrypting(false);
    }
  };

  /**
   * ⚠ `savedOnce` is set only when share RESOLVES. An iOS share-sheet CANCEL rejects with AbortError, and a
   * cancelled share is not a saved backup — it must not open the Continue gate.
   */
  const share = async () => {
    if (!navigator.share) return;   // ⚠ NOT `navigator.share?.()` — that resolves undefined and would open the gate
    const a = await ensureArtifact();
    if (!a) return;
    try { await navigator.share({ text: a }); setSavedOnce(true); } catch { /* cancelled → not a save */ }
  };

  const doDownload = async () => {
    const a = await ensureArtifact();
    if (!a) return;
    const blob = new Blob([buildRecoveryFileText(kind, a)], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, recoveryFileName(kind, todayLocalISO()));
    setSavedOnce(true);
  };

  const toggleQR = async () => {
    if (showQR) { setShowQR(false); return; }
    const a = await ensureArtifact();
    if (!a) return;
    setQrValue(a);
    setShowQR(true);
  };

  // The hidden <QRCodeCanvas> gives us a native canvas — no SVG serialization, no Image load, no WebKit taint risk.
  // A saved QR IS a saved backup, so it opens the Continue gate like any other save.
  const downloadQR = () => {
    qrCanvasRef.current?.toBlob((b) => {
      if (!b) return;
      downloadBlob(b, recoveryFileName(kind, todayLocalISO(), true));
      setSavedOnce(true);
    });
  };

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

  /**
   * ⚠ SNAPSHOT the encryption mode here. Verify asks about the artifact the user actually SAVED, and the reveal
   * step's toggle is unreachable while verifying — so freezing `encryptOn` at Continue-time keeps a stray toggle
   * from changing the question mid-verify. Going BACK re-enters goVerify, which re-snapshots (correct: the user
   * must re-save anyway, since invalidateArtifact cleared savedOnce).
   */
  const goVerify = () => {
    setVerifyEncrypted(encryptOn);
    if (words) setIndices(pickQuizIndices());
    setVerifyError(null); setAns0(''); setAns1(''); setTail(''); setVerifyPass('');
    setStep('verify');
  };

  const submitVerify = () => {
    // Verify what the user must actually REMEMBER: an encrypted backup is a passphrase-locked ncryptsec, so the
    // words on the grid are not what they saved — the passphrase is the only thing that can lose the plan.
    const ok = verifyEncrypted
      ? checkBackupPassphrase(filePass, verifyPass)
      : words ? checkQuizAnswers(words, indices, [ans0, ans1])
      : nsec ? checkNsecTail(nsec, tail)
      : false;
    if (ok) {
      useStore.getState().setBackupVerifiedAt(Date.now(), nostr);   // the setter self-wakes (dirty + syncNow) — no second wake here
      clearSecrets();
      setStep('done');
    } else if (verifyEncrypted) {
      setVerifyError("That doesn't match the passphrase you just set.");
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
              isImported
                ? <p className={styles.body}>These are the words you restored this plan with — keep them safe.</p>
                : <p className={styles.body}>These words were generated fresh for this plan. Never use them as a Bitcoin wallet — same format, different job.</p>
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
            <PassphraseInput
              className={styles.pinInput}
              inputMode="numeric"
              placeholder="PIN"
              value={pin}
              onChange={(v) => { setPin(v); setError(null); }}
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

            <div className={styles.encryptBox}>
              <Toggle
                value={encryptOn}
                onChange={(v) => { setEncryptOn(v); invalidateArtifact(); }}
                label="Encrypt this backup with a passphrase"
                disabled={encrypting}
              />
              {encryptOn && (
                <>
                  {/* State-specific copy (R1.5 rule): this is the ENCRYPT direction of the widget R2c-7a uses to
                      DECRYPT, and a device-PIN field can be on screen at the same time. Never label it "Passphrase". */}
                  <label className={styles.aidLabel} htmlFor="rk-file-pass">Passphrase to encrypt this file</label>
                  <PassphraseInput
                    id="rk-file-pass"
                    className={styles.pinInput}
                    placeholder="Passphrase"
                    value={filePass}
                    onChange={(v) => { setFilePass(v); invalidateArtifact(); }}
                    disabled={encrypting}
                  />
                  <p className={styles.aidHint}>
                    You'll need this exact passphrase to restore — it is not your device PIN, and we can't recover it.
                  </p>
                </>
              )}
              {/* Only an entropy key HAS words to lose; for an sk key the restore is a key either way. */}
              {words && <p className={styles.aidHint}>Encrypted backups restore as a key, not your 12 words.</p>}
            </div>

            <div className={styles.aids}>
              <button type="button" className={styles.aidBtn} onClick={doDownload} disabled={aidsDisabled}>
                {encrypting ? 'Encrypting…' : 'Download'}
              </button>
              {canShare && (
                <button type="button" className={styles.aidBtn} onClick={share} disabled={aidsDisabled}>Save…</button>
              )}
              <button type="button" className={styles.aidBtn} onClick={toggleQR} disabled={aidsDisabled && !showQR}>
                {showQR ? 'Hide QR' : 'Show printable QR'}
              </button>
            </div>
            {aidError && <p className={styles.error}>{aidError}</p>}
            {showQR && qrValue && (
              <div className={styles.qrPanel}>
                <QRCodeSVG value={qrValue} size={220} />
                {/* Hidden, print-resolution twin — the only reason it exists is canvas.toBlob(). It draws purely
                    from props, so display:none is safe. marginSize=4 is the spec quiet zone: the on-screen SVG can
                    omit it because the white .qrPanel pads it, but a bare PNG would scan unreliably without it. */}
                <QRCodeCanvas ref={qrCanvasRef} value={qrValue} size={512} marginSize={4} style={{ display: 'none' }} />
                {encryptOn ? (
                  <code className={styles.qrNsec}>{qrValue}</code>
                ) : words ? (
                  <ol className={styles.qrWords}>
                    {words.map((w, i) => <li key={i}><span className={styles.qrNum}>{i + 1}</span> {w}</li>)}
                  </ol>
                ) : (
                  <code className={styles.qrNsec}>{nsec}</code>
                )}
                <button type="button" className={styles.qrBtn} onClick={downloadQR}>Download QR</button>
              </div>
            )}
            {/* R2c-7b-fix — no save, no Continue. savedOnce resets whenever the artifact changes (invalidateArtifact). */}
            <button className={styles.primary} onClick={goVerify} disabled={!savedOnce}>Continue</button>
            {!savedOnce && (
              <p className={styles.aidHint}>Download or save your Recovery Key first — then confirm you've saved it.</p>
            )}
            <button className={styles.ghost} onClick={close}>Close</button>
          </>
        )}

        {step === 'verify' && (
          <>
            <h2 className={styles.title}>Confirm you saved it</h2>
            {verifyEncrypted ? (
              /* The saved artifact is a passphrase-locked ncryptsec — the words on the grid are NOT what they saved. */
              <>
                <p className={styles.body}>
                  Re-enter your backup passphrase to confirm you'll remember it — without it, your encrypted backup
                  can't be opened.
                </p>
                <PassphraseInput
                  className={styles.pinInput}
                  placeholder="Backup passphrase"
                  value={verifyPass}
                  onChange={(v) => { setVerifyPass(v); setVerifyError(null); }}
                  aria-label="Re-enter your backup passphrase"
                />
              </>
            ) : words ? (
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
            <button
              className={styles.primary}
              onClick={submitVerify}
              disabled={verifyEncrypted ? !verifyPass.trim() : words ? (!ans0.trim() || !ans1.trim()) : !tail.trim()}
            >
              Confirm
            </button>
            {/* Both paths return to reveal — an encrypted user going back to re-download is valid. */}
            <button className={styles.ghost} onClick={() => { setVerifyError(null); setStep('reveal'); }}>
              {verifyEncrypted ? '← Back to save' : '← View words again'}
            </button>
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
