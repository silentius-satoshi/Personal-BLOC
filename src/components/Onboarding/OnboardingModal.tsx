import { useState, useEffect } from 'react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { probeKeyVaultCapability, wrapSecretKey, type WrapMethod } from '../../lib/nostr/keyVault';
import { setUnwrappedViewerKey } from '../../lib/nostr/viewerSync';
import { useStore } from '../../store/useStore';
import styles from './OnboardingModal.module.css';

interface OnboardingModalProps {
  onComplete: (enableSimple: boolean) => void;
}

function OnboardingField({ label, prefix, suffix, value, onChange, step = 1 }: {
  label: string; prefix?: string; suffix?: string;
  value: number; onChange: (v: number) => void; step?: number;
}) {
  return (
    <div className={styles.fieldGroup}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldInput}>
        {prefix && <span className={styles.fieldPrefix}>{prefix}</span>}
        <input
          type="number"
          className={styles.numberInput}
          value={value}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
        {suffix && <span className={styles.fieldSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [step, setStep]       = useState(1);
  const [hasCbLoan, setHasCbLoan] = useState(false);

  // ── Viewer (read-only) flow ──────────────────────────────────────────────────
  const setViewerMode         = useStore((s) => s.setViewerMode);
  const setViewerWriterPubkey = useStore((s) => s.setViewerWriterPubkey);
  const setViewerKeyWrapped   = useStore((s) => s.setViewerKeyWrapped);
  const setViewerKeyWrapMeta  = useStore((s) => s.setViewerKeyWrapMeta);
  const clearViewerData       = useStore((s) => s.clearViewerData);
  const [viewerFlow, setViewerFlow]   = useState(false);
  // Generate this viewer's own key ONCE when the flow opens (lazy initializer → stable across re-renders).
  // Keep the raw sk bytes (NOT plaintext in the store) so we can keyVault-wrap them on Done.
  const [viewerKey] = useState(() => {
    const sk = generateSecretKey();
    return { sk, npub: nip19.npubEncode(getPublicKey(sk)) };
  });
  const [ownerNpub, setOwnerNpub]     = useState('');
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [viewerBusy, setViewerBusy]   = useState(false);
  const [viewerMethod, setViewerMethod] = useState<WrapMethod | null>(null);   // probed wrap capability
  const [viewerPin, setViewerPin]         = useState('');
  const [viewerPinConfirm, setViewerPinConfirm] = useState('');
  const [viewerLabel, setViewerLabel]     = useState('');   // names the viewer passkey (PRF path only)

  // Probe Face-ID/PIN capability when the viewer flow opens (so the step can show a PIN field if needed).
  useEffect(() => {
    if (!viewerFlow) return;
    let cancelled = false;
    probeKeyVaultCapability().then((m) => { if (!cancelled) setViewerMethod(m); });
    return () => { cancelled = true; };
  }, [viewerFlow]);

  const handleViewerDone = async () => {
    const input = ownerNpub.trim();
    let decoded;
    try { decoded = nip19.decode(input); }
    catch { setViewerError('Not a valid npub'); return; }
    if (decoded.type !== 'npub') { setViewerError('Not a valid npub'); return; }
    setViewerBusy(true);
    setViewerError(null);
    try {
      const method = viewerMethod ?? await probeKeyVaultCapability();
      const { ciphertext, meta } = await wrapSecretKey(
        viewerKey.sk, method, method === 'pin' ? viewerPin : undefined, method !== 'pin' ? viewerLabel : undefined,
      );
      setViewerKeyWrapped(ciphertext);
      setViewerKeyWrapMeta(meta);
      setUnwrappedViewerKey(viewerKey.sk);   // unlock this session immediately (no re-prompt) — NO plaintext stored
      clearViewerData();   // start clean — wipe any residual owner/prior-viewer data BEFORE viewerMode triggers the first fetch
      setViewerWriterPubkey(decoded.data as string);
      setViewerMode(true);
      onComplete(true);   // viewers land in the simple-mode dashboard
    } catch (e: any) {
      setViewerError(e?.message ?? 'Could not protect the viewing key');
    } finally {
      setViewerBusy(false);
    }
  };

  const viewerCanDone =
    !!ownerNpub.trim() && !viewerBusy &&
    (viewerMethod !== 'pin' || (viewerPin.length >= 4 && viewerPin === viewerPinConfirm));
  const [draft, setDraft] = useState({
    income: 5000, expenses: 4000,
    collateralBtc: 0.50, creditLine: 15000, blocApr: 13,
    startDate: new Date().toISOString().split('T')[0],
    cbLoanBalance: 50000, cbCollateralBtc: 1.00, cbAprPct: 4.77,
  });

  const setIncome           = useStore((s) => s.setIncome);
  const setExpenses         = useStore((s) => s.setExpenses);
  const setAdvisorActualBtcHeld = useStore((s) => s.setAdvisorActualBtcHeld);
  const setActiveTier       = useStore((s) => s.setActiveTier);
  const setCreditLine       = useStore((s) => s.setCreditLine);
  const setBlocApr          = useStore((s) => s.setBlocApr);
  const setAdvisorStartDate = useStore((s) => s.setAdvisorStartDate);
  const setCbLoanBalance    = useStore((s) => s.setCbLoanBalance);
  const setCbCollateralBtc  = useStore((s) => s.setCbCollateralBtc);
  const setCbAprPct         = useStore((s) => s.setCbAprPct);
  const storeSetHasCbLoan   = useStore((s) => s.setHasCbLoan);

  const handleDone = (enableSimple: boolean) => {
    setIncome(draft.income);
    setExpenses(draft.expenses);
    setAdvisorActualBtcHeld(draft.collateralBtc);
    setActiveTier('custom');
    setCreditLine(draft.creditLine);
    setBlocApr(draft.blocApr);
    setAdvisorStartDate(draft.startDate);
    if (hasCbLoan) {
      setCbLoanBalance(draft.cbLoanBalance);
      setCbCollateralBtc(draft.cbCollateralBtc);
      setCbAprPct(draft.cbAprPct);
      storeSetHasCbLoan(true);
    }
    onComplete(enableSimple);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>

        {viewerFlow ? (
          <div className={styles.step}>
            <div className={styles.welcomeIcon}>👁</div>
            <h2 className={styles.title}>View a plan (read-only)</h2>
            <p className={styles.subtitle}>
              Send your viewer key to the plan's owner. Once they add it, you'll see a live, read-only copy of
              their plan and balances — you can never change their inputs.
            </p>
            <div className={styles.fields}>
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Your viewer key (send to the owner)</span>
                <div className={styles.fieldInput}>
                  <input className={styles.dateInput} type="text" readOnly value={viewerKey.npub} onFocus={(e) => e.target.select()} />
                </div>
                <button
                  className={styles.skip}
                  onClick={() => { navigator.clipboard?.writeText(viewerKey.npub); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>The owner's npub</span>
                <div className={styles.fieldInput}>
                  <input
                    className={styles.dateInput}
                    type="text"
                    placeholder="npub1…"
                    value={ownerNpub}
                    onChange={(e) => { setOwnerNpub(e.target.value); setViewerError(null); }}
                  />
                </div>
              </div>
              {viewerMethod !== 'pin' && (
                <div className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Name this viewer (optional)</span>
                  <div className={styles.fieldInput}>
                    <input
                      className={styles.dateInput}
                      type="text"
                      placeholder="e.g. Dad's iPhone"
                      value={viewerLabel}
                      onChange={(e) => setViewerLabel(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {viewerMethod === 'pin' && (
                <>
                  <div className={styles.fieldGroup}>
                    <span className={styles.fieldLabel}>Set a PIN to protect the key (min 4 digits)</span>
                    <div className={styles.fieldInput}>
                      <input className={styles.dateInput} type="password" inputMode="numeric" placeholder="PIN"
                        value={viewerPin} onChange={(e) => { setViewerPin(e.target.value); setViewerError(null); }} />
                    </div>
                  </div>
                  <div className={styles.fieldGroup}>
                    <span className={styles.fieldLabel}>Confirm PIN</span>
                    <div className={styles.fieldInput}>
                      <input className={styles.dateInput} type="password" inputMode="numeric" placeholder="Confirm PIN"
                        value={viewerPinConfirm} onChange={(e) => { setViewerPinConfirm(e.target.value); setViewerError(null); }} />
                    </div>
                  </div>
                </>
              )}
            </div>
            <p className={styles.subtitle} style={{ fontSize: 12 }}>
              🔒 Your viewing key is protected by {viewerMethod === 'pin' ? 'a PIN' : 'Face ID'} and never stored unencrypted.
              You can reset it anytime without losing data.
            </p>
            {viewerError && <p className={styles.subtitle} style={{ color: 'var(--red)' }}>{viewerError}</p>}
            <div className={styles.nav}>
              <button className={styles.back} onClick={() => { setViewerFlow(false); setViewerError(null); }}>← Back</button>
              <button className={styles.primary} disabled={!viewerCanDone} onClick={handleViewerDone}>
                {viewerBusy ? 'Protecting…' : 'Start viewing →'}
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className={styles.dots}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`${styles.dot} ${step >= n ? styles.dotActive : ''}`} />
          ))}
        </div>

        {step === 1 && (
          <div className={styles.step}>
            <div className={styles.welcomeIcon}>₿</div>
            <h2 className={styles.title}>Welcome to Personal ₿LOC</h2>
            <p className={styles.subtitle}>
              Fund your life with Bitcoin without selling a sat.
              Let's set up your numbers — takes about 2 minutes.
            </p>
            <button className={styles.primary} onClick={() => setStep(2)}>
              Get Started
            </button>
            <button className={styles.skip} onClick={() => handleDone(false)}>
              Skip for now →
            </button>
            <button className={styles.skip} onClick={() => { setViewerFlow(true); setViewerError(null); }}>
              View someone else's plan (read-only) →
            </button>
          </div>
        )}

        {step === 2 && (
          <div className={styles.step}>
            <h2 className={styles.title}>Your Monthly Budget</h2>
            <p className={styles.subtitle}>Your surplus funds Bitcoin accumulation.</p>
            <div className={styles.fields}>
              <OnboardingField
                label="Monthly income"
                prefix="$"
                value={draft.income}
                onChange={(v) => setDraft((d) => ({ ...d, income: v }))}
              />
              <OnboardingField
                label="Monthly expenses"
                prefix="$"
                value={draft.expenses}
                onChange={(v) => setDraft((d) => ({ ...d, expenses: v }))}
              />
            </div>
            <div className={styles.nav}>
              <button className={styles.back} onClick={() => setStep(1)}>← Back</button>
              <button className={styles.primary} onClick={() => setStep(3)}>Next →</button>
            </div>
            <button className={styles.skip} onClick={() => handleDone(false)}>
              Skip — I'll set up in Settings
            </button>
          </div>
        )}

        {step === 3 && (
          <div className={styles.step}>
            <h2 className={styles.title}>Your Strike Line of Credit</h2>
            <p className={styles.subtitle}>Your Bitcoin-backed credit line details.</p>
            <div className={styles.fields}>
              <OnboardingField
                label="BTC collateral"
                prefix="₿"
                value={draft.collateralBtc}
                onChange={(v) => setDraft((d) => ({ ...d, collateralBtc: v }))}
                step={0.001}
              />
              <OnboardingField
                label="Credit line"
                prefix="$"
                value={draft.creditLine}
                onChange={(v) => setDraft((d) => ({ ...d, creditLine: v }))}
                step={500}
              />
              <OnboardingField
                label="APR"
                suffix="%"
                value={draft.blocApr}
                onChange={(v) => setDraft((d) => ({ ...d, blocApr: v }))}
                step={0.1}
              />
              <div className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Strategy started</span>
                <div className={styles.fieldInput}>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={draft.startDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className={styles.nav}>
              <button className={styles.back} onClick={() => setStep(2)}>← Back</button>
              <button className={styles.primary} onClick={() => setStep(4)}>Next →</button>
            </div>
            <button className={styles.skip} onClick={() => handleDone(false)}>
              Skip — I'll set up in Settings
            </button>
          </div>
        )}

        {step === 4 && (
          <div className={styles.step}>
            <h2 className={styles.title}>Coinbase Loan</h2>
            <p className={styles.subtitle}>
              Do you have a Bitcoin-backed loan with Coinbase?
            </p>
            <div className={styles.yesNo}>
              <button
                className={`${styles.yesNoBtn} ${hasCbLoan ? styles.yesNoBtnActive : ''}`}
                onClick={() => setHasCbLoan(true)}
              >
                Yes, I have one
              </button>
              <button
                className={`${styles.yesNoBtn} ${!hasCbLoan ? styles.yesNoBtnActive : ''}`}
                onClick={() => setHasCbLoan(false)}
              >
                No, skip
              </button>
            </div>
            {hasCbLoan && (
              <div className={styles.fields}>
                <OnboardingField
                  label="Loan balance"
                  prefix="$"
                  value={draft.cbLoanBalance}
                  onChange={(v) => setDraft((d) => ({ ...d, cbLoanBalance: v }))}
                />
                <OnboardingField
                  label="BTC collateral"
                  prefix="₿"
                  value={draft.cbCollateralBtc}
                  onChange={(v) => setDraft((d) => ({ ...d, cbCollateralBtc: v }))}
                  step={0.001}
                />
                <OnboardingField
                  label="APR"
                  suffix="%"
                  value={draft.cbAprPct}
                  onChange={(v) => setDraft((d) => ({ ...d, cbAprPct: v }))}
                  step={0.01}
                />
              </div>
            )}
            <div className={styles.nav}>
              <button className={styles.back} onClick={() => setStep(3)}>← Back</button>
              <button className={styles.primary} onClick={() => handleDone(true)}>
                Done — Show My Plan →
              </button>
            </div>
          </div>
        )}
        </>
        )}

      </div>
    </div>
  );
}
