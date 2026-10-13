import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth, isStrategyComplete, getNdpStatus } from '../../simulation/runAdvisor';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { deriveAdvisorStart, computeExpenseReanchor } from '../../simulation/logUtils';
import { BLOC_OPERATING_CEILING } from '../../simulation/strikeCredit';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import { MonthlyLogOverlay } from '../Advisor/MonthlyLogOverlay';
import { OutlookProjection } from '../Advisor/OutlookProjection';
import { SafetyDashboard } from './SafetyDashboard';
import { ViewToggle } from '../Layout/ViewToggle';
import { HeaderNavCluster } from '../Layout/HeaderNavCluster';
import { BackupNagCard } from '../Entry/BackupNagCard';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { plBandsAt } from '../../simulation/powerLaw';
import { crashPlaybook } from '../../simulation/crashPlaybook';
import { playbookInputFromLive, monthPlaybookLine, isCrashDay, strikeDepositOf } from '../Tools/crashPlaybookView';
import { PlanMonthCard } from './PlanMonthCard';
import styles from './SimpleModeView.module.css';


interface SimpleModeViewProps {
  onOpenSettings: () => void;
  onOpenAlmanac:  () => void;
  simpleView: 'dashboard' | 'monthly' | 'daily';
  setSimpleView: (v: 'dashboard' | 'monthly' | 'daily') => void;
}



function ModalField({ label, prefix, value, onChange, step = 1, hint }: {
  label: string; prefix?: string; value: number;
  onChange: (v: number) => void; step?: number; hint?: string;
}) {
  return (
    <div className={styles.modalFieldGroup}>
      <span className={styles.modalFieldLabel}>{label}</span>
      <div className={styles.modalFieldInput}>
        {prefix && <span className={styles.modalFieldPrefix}>{prefix}</span>}
        <input
          type="number"
          className={styles.modalNumberInput}
          value={value}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
      </div>
      {hint && <span className={styles.positionStatHint}>{hint}</span>}
    </div>
  );
}

export function SimpleModeView({ onOpenSettings, onOpenAlmanac, simpleView, setSimpleView }: SimpleModeViewProps) {
  const income    = useStore((s) => s.income);
  const expenses  = useStore((s) => s.expenses);
  const btcPrice  = useStore((s) => s.btcPrice);
  const blocApr   = useStore((s) => s.blocApr);
  const creditLine = useStore((s) => s.creditLine);

  const cbLoanBalance      = useStore((s) => s.cbLoanBalance);
  const cbLoanBalanceAsOf  = useStore((s) => s.cbLoanBalanceAsOf);
  const cbAprPct            = useStore((s) => s.cbAprPct);
  const cbCollateralBtc    = useStore((s) => s.cbCollateralBtc);
  const cbMonthlyPayment   = useStore((s) => s.cbMonthlyPayment);
  const cbPaymentStrategy  = useStore((s) => s.cbPaymentStrategy);
  const cbLtvTriggerPct    = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct     = useStore((s) => s.cbLtvTargetPct);
  const cbRotateBackPct    = useStore((s) => s.cbRotateBackPct);
  const planCbStopAtSupportPct = useStore((s) => s.policyCbStopAtSupportPct);   // the plan of record's Coinbase limit (Run 1)

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const emitBalanceReading          = useStore((s) => s.emitBalanceReading);   // §5b — Quick-Setup save emits a journaled Strike reading
  const advisorMonthStartBalance    = useStore((s) => s.advisorMonthStartBalance);
  const setAdvisorMonthStartBalance = useStore((s) => s.setAdvisorMonthStartBalance);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored current Strike collateral (v20)
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const ndpLastPaidDate             = useStore((s) => s.ndpLastPaidDate);
  const strikeDeposit               = useStore((s) => strikeDepositOf(s));   // Strike's 60-day hold's one fact (D9)
  const coldBtc                     = useStore((s) => s.getCurrentColdBtc());   // the live cold total — the crash playbook's first source

  // §3 — advisorSkip* are DORMANT (retained in the store/payload for sync compat; no consumers).
  const viewerMode           = useStore((s) => s.viewerMode);   // read-only viewer → hide/disable mutation controls
  const hasCbLoan            = useStore((s) => s.hasCbLoan);
  const effectiveCbBalance   = hasCbLoan ? accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf) : 0;

  const blocMinPaymentSource    = useStore((s) => s.blocMinPaymentSource);

  const setSimpleMode = useStore((s) => s.setSimpleMode);

  const setIncome     = useStore((s) => s.setIncome);
  const setExpenses   = useStore((s) => s.setExpenses);
  const expenseReanchorDismissedAt    = useStore((s) => s.expenseReanchorDismissedAt);
  const setExpenseReanchorDismissedAt = useStore((s) => s.setExpenseReanchorDismissedAt);
  const setCreditLine = useStore((s) => s.setCreditLine);

  const activeTier       = useStore((s) => s.activeTier);
  const monthlyLog       = useStore((s) => s.monthlyLog);

  // Change 1 (iter 2) — setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalDraft, setModalDraft] = useState({
    income, expenses, creditLine,
    blocBalance: advisorActualBlocBalance,
    monthStartBalance: advisorMonthStartBalance,
    btcHeld: currentBtcHeld,
  });

  // Monthly log overlay
  const [logOverlayOpen, setLogOverlayOpen]               = useState(false);
  const [logOverlayInitialMonth, setLogOverlayInitialMonth] = useState(0);
  // This Month (operating console) / Outlook (shared scenario projection)
  const [simpleSegment, setSimpleSegment] = useState<'thisMonth' | 'outlook'>('thisMonth');

  const currentMonth    = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone    = isStrategyComplete(advisorStartDate);
  const collateralBtc   = getCollateralForTier(activeTier, expenses, btcPrice, currentBtcHeld);

  const { startingBlocBalance: slmBlocBal, startingBtcHeld: slmBtcHeld, startingMonth: slmStartMonth } = useMemo(
    () => deriveAdvisorStart(monthlyLog, currentBtcHeld, advisorActualBlocBalance, currentMonth, advisorMonthStartBalance),
    [monthlyLog, currentBtcHeld, advisorActualBlocBalance, advisorStartDate, currentMonth, advisorMonthStartBalance],
  );

  // The Advisor's rows feed ONLY the log overlay's planned rows now (the full-mode Advisor tab's component): the card
  // runs the plan of record (Run 2). Run 3 retires them with the Advisor tab. Computed only while the overlay is open.
  const overlayRows = useMemo(
    () => (logOverlayOpen ? runAdvisor({
      btcPrice, income, expenses,
      blocApr, creditLine, blocLtvCeiling: BLOC_OPERATING_CEILING,
      cbBalance:         effectiveCbBalance,
      cbCollateralBtc:   hasCbLoan ? cbCollateralBtc  : 1,
      cbAprPct:          hasCbLoan ? cbAprPct         : 0,
      cbMonthlyPayment:  hasCbLoan ? cbMonthlyPayment  : 0,
      cbPaymentStrategy: hasCbLoan ? cbPaymentStrategy : 'monthly',
      cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
      startingBlocBalance: slmBlocBal,
      startingBtcHeld:     slmBtcHeld,
      startingMonth:       slmStartMonth,
      btcGrowthRate: 0,
      blocMinPaymentSource,
    }).rows : []),
    [logOverlayOpen, btcPrice, income, expenses, blocApr, creditLine, effectiveCbBalance, cbCollateralBtc, cbAprPct,
      cbMonthlyPayment, cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct, slmBlocBal, slmBtcHeld,
      slmStartMonth, hasCbLoan, blocMinPaymentSource],
  );
  const ndp         = getNdpStatus(
    ndpLastPaidDate,
    advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * 0.15,
    blocApr,
  );
  const { show: showReanchor, avg: reanchorAvg } = computeExpenseReanchor(monthlyLog, expenses, expenseReanchorDismissedAt);

  // D13 — a crash day (Coinbase at or past the trigger at today's price): the card's status carries the Emergency
  // Console's own line, built through crashPlaybookView's one builder (the console's inputs).
  const cbTriggered = isCrashDay({
    hasCbLoan, ltvTriggered: cbPaymentStrategy === 'ltvTriggered', cbDebt: effectiveCbBalance, cbCollateralBtc,
    price: btcPrice, triggerPct: cbLtvTriggerPct,
  });
  const today = todayLocalISO();
  const playbookInput = playbookInputFromLive({
    price: btcPrice, support: plBandsAt(new Date(today)).floor, cbDebt: effectiveCbBalance, cbCollateralBtc,
    strikeBalance: advisorActualBlocBalance, strikeCollateralBtc: currentBtcHeld, creditLine, coldBtc,
    cbLtvTargetPct, planCbStopAtSupportPct, strikeDepositISO: strikeDeposit, todayISO: today,
  });
  const playbookLine = cbTriggered ? monthPlaybookLine(crashPlaybook(playbookInput), playbookInput) : null;

  // NDP re-scope (Simple Mode Corrections A): the annual non-draw payment only applies while minimums
  // are ROLLED into the line. In income mode every month's external minimum IS a non-draw payment, so
  // the annual clause disappears entirely.
  const ndpActionActive = blocMinPaymentSource === 'roll' && ndp.status !== 'ok';

  const isDefaultSetup = income === 5000 && expenses === 4000 && advisorActualBlocBalance === 0;

  const openSetupModal = () => {
    setModalDraft({ income, expenses, creditLine, blocBalance: advisorActualBlocBalance, monthStartBalance: advisorMonthStartBalance, btcHeld: currentBtcHeld });
    setShowSetupModal(true);
  };

  const handleSaveSetup = () => {
    setIncome(modalDraft.income);
    setExpenses(modalDraft.expenses);
    setCreditLine(modalDraft.creditLine);
    setAdvisorMonthStartBalance(modalDraft.monthStartBalance);
    // §5b — emit a journaled Strike reading (the seam re-anchors advisorActualBlocBalance + asOf=today); Strike-only
    // (no CB re-base). v20 — when "BTC held" (collateral) changed too, MERGE strikeCollateral into the SAME emission
    // (the LTV is then computed from the new collateral) rather than emitting twice.
    const collChanged = modalDraft.btcHeld !== useStore.getState().getCurrentBtcHeld();
    emitBalanceReading({
      strikeBal: modalDraft.blocBalance,
      ...(collChanged ? { strikeCollateral: modalDraft.btcHeld } : {}),
    });
    setShowSetupModal(false);
  };


  return (
    <>
    <div className={styles.root}>
    <div className={styles.content}>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.brandMark}>₿</span>
          <span className={styles.brandName}>Personal ₿LOC</span>
        </div>
        <HeaderNavCluster
          active="journal"
          onDashboard={() => setSimpleView('dashboard')}
          onJournal={() => setSimpleView('daily')}
          onFullMode={() => setSimpleMode(false)}
          onAlmanac={onOpenAlmanac}
          onSettings={onOpenSettings}
        />
      </div>

      {/* R2c-5 — see DailyModeView: the same self-gating, owner-only nag, with a session-shared dismiss. */}
      <BackupNagCard />

      <ViewToggle simpleView={simpleView} setSimpleView={setSimpleView} />

      <SafetyDashboard />


      {!strategyDone && (
        <div className={styles.segmentControl}>
          <button
            className={`${styles.segmentBtn} ${simpleSegment === 'thisMonth' ? styles.segmentBtnActive : ''}`}
            onClick={() => setSimpleSegment('thisMonth')}
          >This Month</button>
          <button
            className={`${styles.segmentBtn} ${simpleSegment === 'outlook' ? styles.segmentBtnActive : ''}`}
            onClick={() => setSimpleSegment('outlook')}
          >Outlook</button>
        </div>
      )}

      {!strategyDone && simpleSegment === 'outlook' && (
        <div className={styles.cards}>
          {showReanchor && (
            <div className={styles.reanchorBanner}>
              <span className={styles.reanchorText}>
                Your last 3 months averaged {fmtUSD(Math.round(reanchorAvg))} vs your {fmtUSD(expenses)} assumption — update?
              </span>
              <div className={styles.reanchorBtns}>
                <button
                  className={`${styles.reanchorBtn} ${styles.reanchorBtnPrimary}`}
                  onClick={() => setExpenses(Math.round(reanchorAvg))}
                >Update</button>
                <button
                  className={styles.reanchorBtn}
                  onClick={() => setExpenseReanchorDismissedAt(Math.round(reanchorAvg))}
                >Dismiss</button>
              </div>
            </div>
          )}
          <OutlookProjection
            startingBlocBalance={slmBlocBal}
            startingBtcHeld={slmBtcHeld}
            startingMonth={slmStartMonth}
            currentMonth={currentMonth}
            btcPrice={btcPrice}
            income={income}
            expenses={expenses}
            blocApr={blocApr}
            creditLine={creditLine}
            hasCbLoan={hasCbLoan}
             cbLoanBalance={effectiveCbBalance}
            cbCollateralBtc={cbCollateralBtc}
            cbAprPct={cbAprPct}
            cbMonthlyPayment={cbMonthlyPayment}
            cbPaymentStrategy={cbPaymentStrategy}
            cbLtvTriggerPct={cbLtvTriggerPct}
            cbLtvTargetPct={cbLtvTargetPct}
            cbRotateBackPct={cbRotateBackPct}
            blocMinPaymentSource={blocMinPaymentSource}
            planCbStopAtSupportPct={planCbStopAtSupportPct}
          />
        </div>
      )}

      {(strategyDone || simpleSegment === 'thisMonth') && (
      <div className={styles.cards}>

        {/* Feature 3 — NDP urgency card */}
        {(ndp.status === 'soon' || ndp.status === 'overdue') && (
          <div className={`${styles.ndpUrgentCard} ${ndp.status === 'overdue' ? styles.ndpUrgentOverdue : styles.ndpUrgentSoon}`}>
            <span className={styles.ndpUrgentIcon}>
              {ndp.status === 'overdue' ? '⛔' : '⚠'}
            </span>
            <div className={styles.ndpUrgentText}>
              <span className={styles.ndpUrgentTitle}>
                {ndp.status === 'overdue'
                  ? 'NDP overdue — pay Strike immediately'
                  : `NDP due in ${ndp.daysRemaining} days`}
              </span>
              {ndp.estimatedAmount > 0 && (
                <span className={styles.ndpUrgentSub}>
                  ~{fmtUSD(ndp.estimatedAmount)} minimum to keep your line active
                </span>
              )}
            </div>
          </div>
        )}

        {/* The plan of record's Monthly Playbook (Run 2): one card, one month, each fact once. */}
        <PlanMonthCard
          currentMonth={currentMonth}
          strategyDone={strategyDone}
          crashLine={playbookLine}
          ndp={ndp}
          ndpActionActive={ndpActionActive}
          onOpenLedger={() => setSimpleView('daily')}
          onEditMonth={(m) => { setLogOverlayInitialMonth(m - 1); setLogOverlayOpen(true); }}
        />

        {/* Change 1 (iter 2) — setup prompt + modal (always reachable; first-run copy when defaults).
            Hidden for read-only viewers — they cannot edit the owner's numbers. */}
        <>
            {!viewerMode && (
            <button className={styles.setupPrompt} onClick={openSetupModal}>
              {isDefaultSetup ? '⚙ Set up your numbers to personalize this plan' : '⚙ Edit your numbers'}
            </button>
            )}

            {showSetupModal && (
              <div className={styles.modalOverlay} onClick={() => setShowSetupModal(false)}>
                <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                  <h3 className={styles.modalTitle}>Quick Setup</h3>
                  <div className={styles.modalFields}>
                    <ModalField label="Monthly income"   prefix="$" value={modalDraft.income}      onChange={(v) => setModalDraft(d => ({ ...d, income: v }))} />
                    <ModalField label="Monthly expenses" prefix="$" value={modalDraft.expenses}    onChange={(v) => setModalDraft(d => ({ ...d, expenses: v }))} />
                    <ModalField label="Credit line"      prefix="$" value={modalDraft.creditLine}  onChange={(v) => setModalDraft(d => ({ ...d, creditLine: v }))} />
                    <ModalField label="Amount Drawn"      prefix="$" value={modalDraft.blocBalance} onChange={(v) => setModalDraft(d => ({ ...d, blocBalance: v }))} />
                    <ModalField label="Balance at start of this month" prefix="$" value={modalDraft.monthStartBalance} onChange={(v) => setModalDraft(d => ({ ...d, monthStartBalance: v }))}
                      hint="What you owed on Strike at the start of the current month — the base for this month's projection." />
                    <ModalField label="BTC held"         prefix="₿" value={modalDraft.btcHeld}     onChange={(v) => setModalDraft(d => ({ ...d, btcHeld: v }))} step={0.001} />
                  </div>
                  <div className={styles.modalActions}>
                    <button className={styles.modalCancel} onClick={() => setShowSetupModal(false)}>Cancel</button>
                    <button className={styles.modalSave}   onClick={handleSaveSetup}>Save</button>
                  </div>
                </div>
              </div>
            )}
        </>

      </div>
      )}

      <button className={styles.fullAppLink} onClick={() => setSimpleMode(false)}>
        Full App →
      </button>

    </div>
    </div>

    {logOverlayOpen && (
      <MonthlyLogOverlay
        initialMonth={logOverlayInitialMonth}
        months={overlayRows}
        collateralBtc={collateralBtc}
        openInEditMode
        onClose={() => setLogOverlayOpen(false)}
      />
    )}
    </>
  );
}
