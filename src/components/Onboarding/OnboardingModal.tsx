import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { todayLocalISO } from '../../utils/format';
import { NostrAuthGate } from '../Auth/NostrAuthGate';
import { ViewerLoginFlow } from '../Auth/ViewerLoginFlow';
import { ChoosePathView } from '../Entry/ChoosePathView';
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

  // Access Layer Redesign Phase 1 — the fork routes to these sub-flows (each renders its own overlay).
  const [viewerFlow, setViewerFlow] = useState(false);   // → ViewerLoginFlow (connect to a shared plan)
  const [loginFlow, setLoginFlow]   = useState(false);   // → NostrAuthGate (connect an existing identity)

  const [draft, setDraft] = useState({
    income: 5000, expenses: 4000,
    collateralBtc: 0.50, creditLine: 15000, blocApr: 13,
    startDate: todayLocalISO(),
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

  // Sub-flows render their OWN full-screen overlay → return them directly (not inside the modal chrome).
  if (viewerFlow) return <ViewerLoginFlow onDone={() => onComplete(true)} onBack={() => setViewerFlow(false)} />;
  if (loginFlow)  return <NostrAuthGate onSuccess={() => onComplete(false)} onBack={() => setLoginFlow(false)} />;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>

        {step === 1 ? (
          <ChoosePathView
            onStartNew={() => setStep(2)}
            onLogIn={() => setLoginFlow(true)}
            onConnectShared={() => setViewerFlow(true)}
          />
        ) : (
        <>
        <div className={styles.dots}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`${styles.dot} ${step >= n ? styles.dotActive : ''}`} />
          ))}
        </div>

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
                    max={todayLocalISO()}
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
