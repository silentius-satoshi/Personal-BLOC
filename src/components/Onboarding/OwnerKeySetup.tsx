import { useState, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import { useNostr } from '@nostrify/react';
import { probeKeyVaultCapability, type WrapMethod } from '../../lib/nostr/keyVault';
import { generatePlanKey } from '../../lib/nostr/nip06Key';
import { establishLocalOwner } from '../../lib/nostr/establishOwner';
import { pickQuizIndices, checkQuizAnswers } from '../../lib/recoveryQuiz';
import { downloadBlob } from '../../lib/backup/downloadFile';
import { buildRecoveryFileText, recoveryFileName } from '../../lib/backup/recoveryFile';
import { todayLocalISO } from '../../utils/format';
import { useStore } from '../../store/useStore';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import { WordGrid } from './WordGrid';
import { PassphraseInput } from '../ui/PassphraseInput';
import styles from './OwnerKeySetup.module.css';

/**
 * Phase 1.5 — "Start a new plan" mints a real owner identity BEFORE the numbers wizard. Three steps:
 *   K1 Create your key   → generatePlanKey() on tap (R2b-1: 128-bit NIP-06 entropy → 12 words; entropy + a
 *                          display-only sk held in refs, never in the store)
 *   K2 Save recovery key → WordGrid (blurred 12 words) + hygiene line + Advanced-nsec disclosure + SAVE AIDS
 *                          (Download/Save…/QR) + a WORD QUIZ. ⚠ R2c-6a: the ceremony merges into onboarding — a
 *                          new owner is VERIFIED BY DEFAULT. Continue is gated on a REAL save (savedOnce, mirroring
 *                          R2c-7b-fix) then two correct quiz words; on quiz-pass we stamp backupVerifiedAt (the
 *                          retired K2 bridge's exact pre-auth spot). A ghost "I'll do this later" SKIPS the quiz +
 *                          stamp → generated + UNVERIFIED → the R2c-2/5b ladder owns them. (The old ack-checkbox is
 *                          gone — an ack is a promise; a save + quiz is the ceremony's own semantics.)
 *   K3 Protect it        → keyVault wrap (Face ID / PIN) of the ENTROPY (payloadKind 'nip06-entropy') via
 *                          establishLocalOwner → onComplete()
 *
 * onComplete fires post-establish (OnboardingModal advances to the numbers wizard). onBack is K1-only
 * (→ fork). onLogIn serves the existing-key guard's [Log in] (→ loginFlow). ⚠ Never logs key material; the
 * `words` string is a transient secret (a JS string can't be zeroed — see nip06Key.ts header).
 */
export interface OwnerKeySetupProps {
  onComplete: () => void;
  onBack: () => void;
  onLogIn: () => void;
}

export function OwnerKeySetup({ onComplete, onBack, onLogIn }: OwnerKeySetupProps) {
  const { nostr } = useNostr();
  // ⚠ HOOK-ORDER: these MUST be two separate, unconditional useStore calls. Written as
  //   `!!useStore((s) => s.writerKeyWrapped) || !!useStore((s) => s.nostrPubkey)`
  // the `||` SHORT-CIRCUITS: while writerKeyWrapped is null the second useStore runs, but the moment K3's
  // establishLocalOwner calls setWriterKeyWrapped the left side turns truthy and the second useStore is never
  // called — the hook count drops mid-flow and React throws #311 ("rendered more hooks than during the previous
  // render") right as onboarding completes. A hook may never sit on the right of `||`, `&&`, or `?:`.
  const writerKeyWrapped = useStore((s) => s.writerKeyWrapped);
  const nostrPubkey      = useStore((s) => s.nostrPubkey);
  const hasExistingKey   = !!writerKeyWrapped || !!nostrPubkey;

  const [step, setStep]   = useState<'intro' | 'save' | 'protect'>('intro');
  const entropyRef        = useRef<Uint8Array | null>(null);   // 16 bytes — THE WRAPPED PAYLOAD (never re-rendered)
  const skRef             = useRef<Uint8Array | null>(null);   // 32 bytes — display-only (the Advanced nsec)
  const [words, setWords] = useState<string[] | null>(null);   // ⚠ transient secret — rendered by K2, cleared below
  const [nsec, setNsec]   = useState<string | null>(null);     // bech32 for the Advanced disclosure only
  const [showNsec, setShowNsec] = useState(false);
  // R2c-6a K2 save-aids + word-quiz (replaces the ack checkbox).
  const [savedOnce, setSavedOnce] = useState(false);           // a real save (download / share / QR) happened
  const [showQR, setShowQR]       = useState(false);
  const [indices, setIndices]     = useState<[number, number]>([0, 1]);   // quiz positions, re-randomized on a wrong answer
  const [ans0, setAns0]           = useState('');
  const [ans1, setAns1]           = useState('');
  const [quizError, setQuizError] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const [method, setMethod] = useState<WrapMethod | null>(null);
  const [pin, setPin]                 = useState('');
  const [pinConfirm, setPinConfirm]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zero BOTH key buffers on unmount (covers back-out / navigation without establishing).
  useEffect(() => () => { entropyRef.current?.fill(0); skRef.current?.fill(0); }, []);

  // Probe Face-ID/PIN capability when we reach the protect step (so K3 can show a PIN field if needed).
  useEffect(() => {
    if (step !== 'protect') return;
    let cancelled = false;
    probeKeyVaultCapability().then((m) => { if (!cancelled) setMethod(m); });
    return () => { cancelled = true; };
  }, [step]);

  const resetSaveQuiz = () => {
    setSavedOnce(false);
    setShowQR(false);
    setAns0(''); setAns1('');
    setQuizError(null);
  };

  const handleGenerate = () => {
    // R2b-1 — mint a NIP-06 plan key: 128-bit entropy → 12 words → sk. The ENTROPY is what we wrap at rest
    // (so R2c can re-display the words); the sk is display-only here (the Advanced nsec).
    const { entropy, words: phrase, sk } = generatePlanKey();
    entropyRef.current = entropy;
    skRef.current = sk;
    setWords(phrase.split(' '));
    setNsec(nip19.nsecEncode(sk));
    // ⚠ R2c-6a — clear any stale stamp from a prior abandoned run (backupVerifiedAt rides partialize `...rest`).
    // Without this: quiz-pass → abandon at K3 → relaunch → regenerate NEW words → skip would establish these
    // UNVERIFIED words carrying the old run's stamp = falsely verified.
    useStore.getState().setBackupVerifiedAt(null);
    setIndices(pickQuizIndices());
    resetSaveQuiz();
    setShowNsec(false);
    setError(null);
    setStep('save');
  };

  const handleStartOver = () => {
    entropyRef.current?.fill(0);
    entropyRef.current = null;
    skRef.current?.fill(0);
    skRef.current = null;
    setWords(null);
    setNsec(null);
    setShowNsec(false);
    useStore.getState().setBackupVerifiedAt(null);   // same stale-stamp guard as handleGenerate
    resetSaveQuiz();
    setPin('');
    setPinConfirm('');
    setError(null);
    setStep('intro');
  };

  // ── K2 save aids (plaintext words — onboarding has no encrypt toggle; kind is always 'words'). A real save
  //    opens the quiz. Mirrors RecoveryKeyCeremony's handler shapes. ────────────────────────────────────────
  const plaintext = () => (words ? words.join(' ') : '');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const doDownload = () => {
    const blob = new Blob([buildRecoveryFileText('words', plaintext())], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, recoveryFileName('words', todayLocalISO()));
    setSavedOnce(true);
  };

  const doShare = async () => {
    if (!navigator.share) return;   // ⚠ NOT `navigator.share?.()` — that resolves undefined and would open the gate
    try { await navigator.share({ text: plaintext() }); setSavedOnce(true); } catch { /* cancelled → not a save */ }
  };

  const downloadQR = () => {
    qrCanvasRef.current?.toBlob((b) => {
      if (!b) return;
      downloadBlob(b, recoveryFileName('words', todayLocalISO(), true));
      setSavedOnce(true);
    });
  };

  const verifyAndAdvance = () => {
    if (!words) return;
    if (checkQuizAnswers(words, indices, [ans0, ans1])) {
      // Pre-auth field-only stamp (K2 bridge's exact spot): the store is unauthenticated here, so setBackupVerifiedAt
      // just sets the field. K3's establishLocalOwner runs syncNow next, now ungated → the key enters VERIFIED.
      useStore.getState().setBackupVerifiedAt(Date.now());
      setStep('protect');
    } else {
      setQuizError("That doesn't match — check your saved copy.");
      setIndices(pickQuizIndices());   // re-randomize on every wrong answer
      setAns0(''); setAns1('');
    }
  };

  const skipLater = () => {
    // No stamp — establishes generated + UNVERIFIED → the R2c-2/5b ladder routes them to the ceremony later.
    setStep('protect');
  };

  const handleProtect = async () => {
    if (!entropyRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const m = method ?? await probeKeyVaultCapability();
      // Guard the pre-probe window: on a PIN-only device the button briefly shows "Enable Face ID"
      // (method still null) — a tap here would otherwise wrap with an empty PIN. Reveal the fields + bail.
      if (m === 'pin' && (pin.length < 4 || pin !== pinConfirm)) {
        setMethod('pin');
        setError('Set a PIN (min 4 digits, matching) to protect your key.');
        return;
      }
      // Backup gate (R2a-1) — stamped BEFORE establishLocalOwner, whose internal syncNow is the wake. A stamp
      // placed after would let this generated key's very first sync publish ungated.
      useStore.getState().setKeyProvenance('generated');
      // R2c-6a — the ceremony now runs AT K2 (save + word quiz), so a verified owner already stamped
      // backupVerifiedAt before reaching here (field-only, pre-auth); the syncNow inside establishLocalOwner then
      // wakes ungated. A "later"-skipper stamped nothing → generated + UNVERIFIED, and the R2c-2/5b ladder routes
      // them to the Settings ceremony. R2b-1: wrap the ENTROPY as 'nip06-entropy' so R2c can re-derive the words;
      // establishLocalOwner derives the signing sk internally. keyLabel omitted — K3 is a single step (no name field).
      await establishLocalOwner(entropyRef.current, m, nostr, { pin, payloadKind: 'nip06-entropy' });
      entropyRef.current = null;   // helper zeroed the payload on success
      skRef.current?.fill(0); skRef.current = null;   // the display-only sk is ours to zero
      setWords(null); setNsec(null);
      onComplete();
    } catch (e: any) {
      // ROLL BACK the backup-gate provenance (R2a-1). It is written before the establish (the syncNow inside it
      // is the wake), so a throw here — Face ID cancelled, PRF unsupported, wrapSecretKey rejects — would leave
      // a stamp for an identity that never came into being. setKeyProvenance is WRITE-ONCE, so a frozen
      // 'generated' would silently reject the later correct 'imported'/'external' stamp if the user backs out and
      // logs in instead. R2c-6a: backupVerifiedAt may have been stamped at K2 (the verified path), so clearing it
      // here rolls back a real K2 verification whose K3 establish then failed — the key never came into being.
      useStore.getState().setKeyProvenance(null);
      useStore.getState().setBackupVerifiedAt(null);
      // the entropy is intact (the helper zeros only after its awaits) — stay on K3 so the user can retry.
      setError(e?.message ?? 'Could not protect the key — try again');
    } finally {
      setBusy(false);
    }
  };

  const canProtect =
    !busy && (method !== 'pin' || (pin.length >= 4 && pin === pinConfirm));

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.step}>

          {/* ── K1 · Create your key ─────────────────────────────────────────── */}
          {step === 'intro' && (hasExistingKey ? (
            <>
              <div className={styles.brandRing}>₿</div>
              <h2 className={styles.title}>This device already has a key</h2>
              <p className={styles.subtitle}>
                An identity is already set up here. Log in to your existing plan instead of creating a new
                key — creating one would not overwrite it.
              </p>
              <div className={styles.nav}>
                <button className={styles.back} onClick={onBack}>← Back</button>
                <button className={styles.primary} onClick={onLogIn}>Log in</button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.brandRing}>₿</div>
              <h2 className={styles.title}>Your key, your plan</h2>
              <p className={styles.subtitle}>
                Personal ₿LOC has no accounts. Your plan is secured by a key generated right here on this
                device — nothing is sent anywhere.
              </p>
              <button className={styles.primary} onClick={handleGenerate}>Generate my key</button>
              <p className={styles.genHint}>Takes a second · Nothing leaves this device</p>
              <button className={styles.startOver} onClick={onBack}>← Back</button>
            </>
          ))}

          {/* ── K2 · Save your recovery key ──────────────────────────────────── */}
          {step === 'save' && (
            <>
              <h2 className={styles.title}>Save your recovery key</h2>
              <p className={styles.subtitle}>
                These 12 words <strong>are</strong> your plan. If you lose them and this device, no one can
                recover your data — there is no server and no reset.
              </p>
              {words && <WordGrid mode="reveal" words={words} />}
              {/* DISPLAY variant — the words are already minted. Mirrors RecoveryKeyCeremony's explain copy verbatim.
                  (The CAPTURE variant, for a user typing words IN, lives in NostrAuthGate's word grid.) */}
              <p className={styles.hygiene}>
                These words were generated fresh for this plan. Never use them as a Bitcoin wallet — same
                format, different job.
              </p>
              <button
                type="button"
                className={styles.advBtn}
                onClick={() => setShowNsec((v) => !v)}
                aria-expanded={showNsec}
                aria-controls="owner-key-nsec"
              >
                <span>Advanced: show as nsec</span>
                <span className={styles.advChevron} data-open={showNsec || undefined} aria-hidden="true">›</span>
              </button>
              {showNsec && nsec && (
                <div id="owner-key-nsec" className={styles.advPanel}>
                  <SecretKeyCard nsec={nsec} />
                </div>
              )}

              {/* Save aids — a real save opens the quiz (the quiz's claim is "you saved it"). */}
              <div className={styles.aids}>
                <button type="button" className={styles.aidBtn} onClick={doDownload}>Download</button>
                {canShare && <button type="button" className={styles.aidBtn} onClick={doShare}>Save…</button>}
                <button type="button" className={styles.aidBtn} onClick={() => setShowQR((v) => !v)}>
                  {showQR ? 'Hide QR' : 'Show printable QR'}
                </button>
              </div>
              {showQR && words && (
                <div className={styles.qrPanel}>
                  <QRCodeSVG value={plaintext()} size={200} />
                  {/* Hidden native canvas → toBlob PNG (no SVG serialization / WebKit taint). marginSize=4 = the
                      spec quiet zone; the on-screen SVG omits it because the white panel pads it. */}
                  <QRCodeCanvas ref={qrCanvasRef} value={plaintext()} size={512} marginSize={4} style={{ display: 'none' }} />
                  <button type="button" className={styles.qrBtn} onClick={downloadQR}>Download QR</button>
                </div>
              )}

              {!savedOnce ? (
                <p className={styles.aidHint}>Download or save your recovery key first — then confirm you've saved it.</p>
              ) : (
                <div className={styles.quizBox}>
                  <p className={styles.subtitle}>Enter word #{indices[0] + 1} and word #{indices[1] + 1} from your saved copy.</p>
                  <input
                    className={styles.quizInput} type="text" placeholder={`Word #${indices[0] + 1}`}
                    value={ans0} onChange={(e) => { setAns0(e.target.value); setQuizError(null); }}
                    autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                    aria-label={`Word ${indices[0] + 1}`}
                  />
                  <input
                    className={styles.quizInput} type="text" placeholder={`Word #${indices[1] + 1}`}
                    value={ans1} onChange={(e) => { setAns1(e.target.value); setQuizError(null); }}
                    autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                    aria-label={`Word ${indices[1] + 1}`}
                  />
                  {quizError && <p className={styles.error}>{quizError}</p>}
                </div>
              )}

              <div className={styles.nav}>
                <button
                  className={styles.primary}
                  disabled={!savedOnce || !ans0.trim() || !ans1.trim()}
                  onClick={verifyAndAdvance}
                >
                  Continue →
                </button>
              </div>
              <button className={styles.startOver} onClick={skipLater}>I'll do this later</button>
              <p className={styles.skipHint}>You can save it later from Settings — until then your plan stays on this device only.</p>
              <button className={styles.startOver} onClick={handleStartOver}>Start over</button>
            </>
          )}

          {/* ── K3 · Protect it on this device ───────────────────────────────── */}
          {step === 'protect' && (
            <>
              <h2 className={styles.title}>Protect it on this device</h2>
              <p className={styles.subtitle}>
                Lock your key with {method === 'pin' ? 'a PIN' : 'Face ID'} so only you can unlock it on
                this device. It's never stored unencrypted.
              </p>
              {method === 'pin' && (
                <div className={styles.fields}>
                  <div className={styles.fieldGroup}>
                    <span className={styles.fieldLabel}>Set a PIN to protect the key (min 4 digits)</span>
                    <div className={styles.fieldInput}>
                      <PassphraseInput className={styles.dateInput} inputMode="numeric" placeholder="PIN"
                        value={pin} onChange={(v) => { setPin(v); setError(null); }} />
                    </div>
                  </div>
                  <div className={styles.fieldGroup}>
                    <span className={styles.fieldLabel}>Confirm PIN</span>
                    <div className={styles.fieldInput}>
                      <PassphraseInput className={styles.dateInput} inputMode="numeric" placeholder="Confirm PIN"
                        value={pinConfirm} onChange={(v) => { setPinConfirm(v); setError(null); }} />
                    </div>
                  </div>
                </div>
              )}
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.nav}>
                <button className={styles.primary} disabled={!canProtect} onClick={handleProtect}>
                  {busy ? 'Protecting…' : method === 'pin' ? 'Encrypt & continue' : 'Enable Face ID'}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
