import { useState, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import { useNostr } from '@nostrify/react';
import { probeKeyVaultCapability, type WrapMethod } from '../../lib/nostr/keyVault';
import { generatePlanKey } from '../../lib/nostr/nip06Key';
import { establishLocalOwner } from '../../lib/nostr/establishOwner';
import { useStore } from '../../store/useStore';
import { SecretKeyCard } from '../Auth/SecretKeyCard';
import { WordGrid } from './WordGrid';
import styles from './OwnerKeySetup.module.css';

/**
 * Phase 1.5 — "Start a new plan" mints a real owner identity BEFORE the numbers wizard. Three steps:
 *   K1 Create your key   → generatePlanKey() on tap (R2b-1: 128-bit NIP-06 entropy → 12 words; entropy + a
 *                          display-only sk held in refs, never in the store)
 *   K2 Save recovery key → WordGrid (blurred 12 words) + a hygiene line + an Advanced-nsec disclosure + a
 *                          mandatory "I saved it" ack
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
  const hasExistingKey = !!useStore((s) => s.writerKeyWrapped) || !!useStore((s) => s.nostrPubkey);

  const [step, setStep]   = useState<'intro' | 'save' | 'protect'>('intro');
  const entropyRef        = useRef<Uint8Array | null>(null);   // 16 bytes — THE WRAPPED PAYLOAD (never re-rendered)
  const skRef             = useRef<Uint8Array | null>(null);   // 32 bytes — display-only (the Advanced nsec)
  const [words, setWords] = useState<string[] | null>(null);   // ⚠ transient secret — rendered by K2, cleared below
  const [nsec, setNsec]   = useState<string | null>(null);     // bech32 for the Advanced disclosure only
  const [showNsec, setShowNsec] = useState(false);
  const [ack, setAck]     = useState(false);
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

  const handleGenerate = () => {
    // R2b-1 — mint a NIP-06 plan key: 128-bit entropy → 12 words → sk. The ENTROPY is what we wrap at rest
    // (so R2c can re-display the words); the sk is display-only here (the Advanced nsec).
    const { entropy, words: phrase, sk } = generatePlanKey();
    entropyRef.current = entropy;
    skRef.current = sk;
    setWords(phrase.split(' '));
    setNsec(nip19.nsecEncode(sk));
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
    setAck(false);
    setPin('');
    setPinConfirm('');
    setError(null);
    setStep('intro');
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
      useStore.getState().setBackupVerifiedAt(Date.now());   // INTERIM (R2a-1 → R2c): K2's mandatory ack is today's backup bar — until the
                                                             // R2c ceremony (word-quiz verify) ships, completing the ack counts as verification
                                                             // so no new-plan user regresses below current behavior. R2c replaces this line.
      // R2b-1: wrap the ENTROPY as 'nip06-entropy' so R2c can re-derive the words; establishLocalOwner derives
      // the signing sk from it internally. keyLabel omitted — K3 is a single "Enable Face ID" step (no name field).
      await establishLocalOwner(entropyRef.current, m, nostr, { pin, payloadKind: 'nip06-entropy' });
      entropyRef.current = null;   // helper zeroed the payload on success
      skRef.current?.fill(0); skRef.current = null;   // the display-only sk is ours to zero
      setWords(null); setNsec(null);
      onComplete();
    } catch (e: any) {
      // ROLL BACK the backup-gate stamps (R2a-1). They were written before the establish (the syncNow inside it
      // is the wake), so a throw here — Face ID cancelled, PRF unsupported, wrapSecretKey rejects — would leave
      // a stamp for an identity that never came into being. setKeyProvenance is WRITE-ONCE, so a frozen
      // 'generated' would silently reject the later correct 'imported'/'external' stamp if the user backs out and
      // logs in instead; and the stale backupVerifiedAt would be a false backup attestation for a discarded key.
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
              {words && <WordGrid words={words} />}
              <p className={styles.hygiene}>
                Generate fresh words here — never reuse your Bitcoin wallet's seed phrase, and never use these
                words as a Bitcoin wallet. Same format, different job.
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
              <label className={styles.ackRow}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I've saved my recovery key somewhere safe</span>
              </label>
              <div className={styles.nav}>
                <button className={styles.primary} disabled={!ack} onClick={() => setStep('protect')}>
                  Continue →
                </button>
              </div>
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
                      <input className={styles.dateInput} type="password" inputMode="numeric" placeholder="PIN"
                        value={pin} onChange={(e) => { setPin(e.target.value); setError(null); }} />
                    </div>
                  </div>
                  <div className={styles.fieldGroup}>
                    <span className={styles.fieldLabel}>Confirm PIN</span>
                    <div className={styles.fieldInput}>
                      <input className={styles.dateInput} type="password" inputMode="numeric" placeholder="Confirm PIN"
                        value={pinConfirm} onChange={(e) => { setPinConfirm(e.target.value); setError(null); }} />
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
