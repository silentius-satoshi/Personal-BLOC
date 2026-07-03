import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth, isStrategyComplete, getTier, getNdpStatus } from '../../simulation/runAdvisor';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { deriveAdvisorStart, computeExpenseReanchor } from '../../simulation/logUtils';
import { strikeAvailableCredit, computeStrikeLtv } from '../../simulation/strikeCredit';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { deriveForMonth, isOperatingMonth, composeMonthSummary, minPaymentStatus } from '../../simulation/simpleModePlan';
import { buildMonthRollup } from '../Daily/calendarModel';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import { MonthlyLogOverlay } from '../Advisor/MonthlyLogOverlay';
import { OutlookProjection } from '../Advisor/OutlookProjection';
import { SafetyDashboard } from './SafetyDashboard';
import { ViewToggle } from '../Layout/ViewToggle';
import { barLevel, type SafetyLevel } from '../../simulation/cbMetrics';
import styles from './SimpleModeView.module.css';

const LEVEL_COLOR: Record<SafetyLevel, string> = {
  safe:  'var(--green)',
  watch: 'var(--amber)',
  act:   'var(--red)',
};

interface SimpleModeViewProps {
  onOpenSettings: () => void;
  onOpenAlmanac:  () => void;
  simpleView: 'monthly' | 'daily';
  setSimpleView: (v: 'monthly' | 'daily') => void;
}

const fmtPct = (n: number) => `${Math.round(n * 100)}%`;


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
  const cbCollateralBtc    = useStore((s) => s.cbCollateralBtc);
  const cbLiquidationPrice = useStore((s) => s.cbLiquidationPrice);
  const cbMonthlyPayment   = useStore((s) => s.cbMonthlyPayment);
  const cbPaymentStrategy  = useStore((s) => s.cbPaymentStrategy);
  const cbLtvTriggerPct    = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct     = useStore((s) => s.cbLtvTargetPct);
  const cbRotateBackPct    = useStore((s) => s.cbRotateBackPct);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const emitBalanceReading          = useStore((s) => s.emitBalanceReading);   // §5b — Quick-Setup save emits a journaled Strike reading
  const advisorMonthStartBalance    = useStore((s) => s.advisorMonthStartBalance);
  const setAdvisorMonthStartBalance = useStore((s) => s.setAdvisorMonthStartBalance);
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());
  const adjustCurrentCollateral     = useStore((s) => s.adjustCurrentCollateral);
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const ndpLastPaidDate             = useStore((s) => s.ndpLastPaidDate);
  const dayLog                      = useStore((s) => s.dayLog);   // §3 — month-to-date ledger progress

  // §3 — advisorSkip* are DORMANT (retained in the store/payload for sync compat; no consumers).
  const viewerMode           = useStore((s) => s.viewerMode);   // read-only viewer → hide/disable mutation controls
  const hasCbLoan            = useStore((s) => s.hasCbLoan);

  const strikeLiquidationLtvPct = useStore((s) => s.strikeLiquidationLtvPct);
  const blocMinPaymentSource    = useStore((s) => s.blocMinPaymentSource);
  const blocStatementMinimum    = useStore((s) => s.blocStatementMinimum);
  const setBlocStatementMinimum = useStore((s) => s.setBlocStatementMinimum);
  const blocMinPaymentDueDay    = useStore((s) => s.blocMinPaymentDueDay);
  const showPlanStrikeBar       = useStore((s) => s.showPlanStrikeBar);
  const showPlanCbBar           = useStore((s) => s.showPlanCbBar);

  const setSimpleMode = useStore((s) => s.setSimpleMode);
  const setViewerPreview = useStore((s) => s.setViewerPreview);

  const setIncome     = useStore((s) => s.setIncome);
  const setExpenses   = useStore((s) => s.setExpenses);
  const expenseReanchorDismissedAt    = useStore((s) => s.expenseReanchorDismissedAt);
  const setExpenseReanchorDismissedAt = useStore((s) => s.setExpenseReanchorDismissedAt);
  const setCreditLine = useStore((s) => s.setCreditLine);

  const activeTier       = useStore((s) => s.activeTier);
  const cbAprPct         = useStore((s) => s.cbAprPct);
  const monthlyLog       = useStore((s) => s.monthlyLog);

  // Change 1 (iter 2) — setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalDraft, setModalDraft] = useState({
    income, expenses, creditLine,
    blocBalance: advisorActualBlocBalance,
    monthStartBalance: advisorMonthStartBalance,
    btcHeld: currentBtcHeld,
  });

  // §3 — the Playbook no longer writes: ConfirmLogSheet, Pay/Skip pills, and the custom-amount overrides
  // are retired. The current-month Min line keeps its inline statement entry (a reading, not a log).
  const [editingMin, setEditingMin] = useState(false);
  // Monthly log overlay
  const [logOverlayOpen, setLogOverlayOpen]               = useState(false);
  const [logOverlayInitialMonth, setLogOverlayInitialMonth] = useState(0);
  // This Month (operating console) / Outlook (shared scenario projection)
  const [simpleSegment, setSimpleSegment] = useState<'thisMonth' | 'outlook'>('thisMonth');
  // Plan-card month scrubber — defaults to "now"; snaps to currentMonth when the real month advances,
  // free scrubbing within a session (see effect below).
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentStrategyMonth(advisorStartDate));

  const currentMonth    = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone    = isStrategyComplete(advisorStartDate);
  const isLogged        = monthlyLog.some((e) => e.month === currentMonth);
  const collateralBtc   = getCollateralForTier(activeTier, expenses, btcPrice, currentBtcHeld);

  const { startingBlocBalance: slmBlocBal, startingBtcHeld: slmBtcHeld, startingMonth: slmStartMonth } = useMemo(
    () => deriveAdvisorStart(monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, currentMonth, pendingCollateralAdjustment, advisorMonthStartBalance),
    [monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, advisorStartDate, currentMonth, pendingCollateralAdjustment, advisorMonthStartBalance],
  );

  const advisorRows = useMemo(
    () => {
      const rows = runAdvisor({
        btcPrice, income, expenses,
        blocApr, creditLine, blocLtvCeiling: 0.15,
        cbBalance:        hasCbLoan ? cbLoanBalance    : 0,
        cbCollateralBtc:  hasCbLoan ? cbCollateralBtc  : 1,
        cbAprPct:         hasCbLoan ? cbAprPct         : 0,
        cbMonthlyPayment:  hasCbLoan ? cbMonthlyPayment  : 0,
        cbPaymentStrategy: hasCbLoan ? cbPaymentStrategy : 'monthly',
        cbLtvTriggerPct,
        cbLtvTargetPct,
        cbRotateBackPct,
        startingBlocBalance: slmBlocBal,
        startingBtcHeld:     slmBtcHeld,
        startingMonth:       slmStartMonth,
        btcGrowthRate: 0,
        blocMinPaymentSource,
      }).rows;
      return rows;
    },
    [btcPrice, income, expenses, blocApr, creditLine,
     cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
     cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
     slmBlocBal, slmBtcHeld, slmStartMonth, hasCbLoan, blocMinPaymentSource],
  );
  const currentCbLtv = cbCollateralBtc * btcPrice > 0
    ? cbLoanBalance / (cbCollateralBtc * btcPrice)
    : 0;
  const currentTier = getTier(currentCbLtv);
  const ndp         = getNdpStatus(
    ndpLastPaidDate,
    advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * 0.15,
    blocApr,
  );

  const currentRow        = advisorRows.find((r) => r.month === currentMonth) ?? null;
  const nextRow           = advisorRows.find((r) => r.month === currentMonth + 1);   // month after current; undefined at Mo 12
  const { show: showReanchor, avg: reanchorAvg } = computeExpenseReanchor(monthlyLog, expenses, expenseReanchorDismissedAt);

  // Strike minimum payment source. In 'income' mode the monthly minimum (accrued interest) is paid from
  // income; the user-entered statement figure overrides the one-month-interest estimate.
  const isIncomeSource    = blocMinPaymentSource === 'income';
  const strikeMinEstimate = currentRow?.blocInterest ?? 0;   // one month's accrued interest (model hint)

  // B — mis-ordered CB thresholds: the engine suspends rotation; the plan card surfaces it.
  const cbThresholdsMisordered = hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
    && !(cbRotateBackPct < cbLtvTargetPct && cbLtvTargetPct < cbLtvTriggerPct);

  // C — cumulative savings need over the remaining projection: uncovered expenses (fiatGap) plus any
  // interest that couldn't be paid from income (blocMinShortfall). N = remaining months with a gap.
  const savingsNeed = advisorRows
    .filter((r) => r.month >= currentMonth)
    .reduce((sum, r) => sum + Math.max(0, r.fiatGap) + Math.max(0, r.blocMinShortfall), 0);
  const savingsNeedMonths = advisorRows
    .filter((r) => r.month >= currentMonth && (r.fiatGap + r.blocMinShortfall) > 0).length;

  // §3 — the Playbook is PURE: the current month renders like any projected month, figures straight from
  // the engine row (via selectedPlan/deriveForMonth). The Ledger owns actuals; there's no operate console,
  // no Pay/Skip, no ConfirmLogSheet. Skip flags (advisorSkip*) are dormant (kept in the store for sync compat).
  const currentEntry = monthlyLog.find((e) => e.month === currentMonth);

  // AFTER-this-month = the engine row's end-of-month figures (plan, unskipped — the row already holds them).
  const eomBtcHeld: number     = currentRow?.btcHeld ?? currentBtcHeld;
  const eomBlocBalance: number = currentRow?.blocBalance ?? advisorActualBlocBalance;
  const eomLtv: number         = currentRow?.blocLtv ?? computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice);
  const currentBlocLtv: number = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice);   // matches the Strike dashboard bar
  const availCredit  = strikeAvailableCredit(creditLine, eomBtcHeld, btcPrice, eomBlocBalance);          // AFTER-this-month basis
  const currentAvail = strikeAvailableCredit(creditLine, currentBtcHeld, btcPrice, advisorActualBlocBalance);   // CURRENT basis

  // §3 — month-to-date ledger progress for the current month (Box 2/3 parens + the MTD strip).
  const mtd = buildMonthRollup(dayLog, advisorStartDate, currentMonth);

  // §2b — current month's Strike minimum: owed figure + PAID/DUE/MISSED/ROLLS status chip.
  const strikeMinOwed = blocStatementMinimum ?? strikeMinEstimate;
  const curMinStatus = minPaymentStatus({
    source: blocMinPaymentSource, paidSoFar: mtd.streams.minPayment, owed: strikeMinOwed,
    dueDay: blocMinPaymentDueDay, todayDay: Number(todayLocalISO().split('-')[2]), isCurrent: true,
  });

  // §3 — the current month "awaits sign-off" until confirmed in the Ledger. A daily month starts
  // confirmed:false; a legacy/manual month has confirmed undefined (treated signed). No entry yet → still
  // prompt the user into the Ledger to log + sign off.
  const needsSignoff = !strategyDone && (currentEntry ? currentEntry.confirmed === false : true);

  // CB runway/paydown indicator (ltvTriggered only), banded to match the engine: below the 75% trigger we're
  // deliberately idle → show RUNWAY (headroom before the trigger); at/above it the engine draws → show the
  // PAYDOWN to the 65% target. Reuses currentCbLtv.
  const cbTriggered = hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && currentCbLtv >= cbLtvTriggerPct / 100;
  const cbRunwayToTrigger = hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
    ? Math.max(0, cbCollateralBtc * btcPrice * (cbLtvTriggerPct / 100) - cbLoanBalance) : 0;
  const cbPaydownToTarget = hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
    ? Math.max(0, cbLoanBalance - cbCollateralBtc * btcPrice * (cbLtvTargetPct / 100)) : 0;
  const cbPaydownAffordable = cbPaydownToTarget <= Math.max(0, creditLine - advisorActualBlocBalance);

  // ── Month scrubber — projection-vs-reality split (spec v2) ─────────────────────────────────
  // Snap the selection to "now" whenever the real month advances; free scrubbing within a session.
  useEffect(() => { setSelectedMonth(currentMonth); }, [currentMonth]);

  const isCurrent     = isOperatingMonth(selectedMonth, currentMonth);
  // Months BEFORE the projection start have no engine row — render logged actuals only. Falling back to
  // currentRow borrowed the CURRENT month's paydown flag onto logged past months (device-verified display bug).
  const selectedRow   = advisorRows.find((r) => r.month === selectedMonth) ?? null;
  const selectedEntry = monthlyLog.find((e) => e.month === selectedMonth);
  const selectedPlan  = selectedRow ? deriveForMonth(selectedRow, income, hasCbLoan, cbPaymentStrategy) : null;

  // §3 — the current month is no longer special: bars/rows read the LOGGED actuals when the month has an
  // entry, else the engine plan projection — identical treatment to any projected month.
  const barStrikeLtv = selectedEntry ? selectedEntry.strikeLtv : (selectedRow?.blocLtv ?? 0);
  const barCbLtv     = selectedEntry ? (selectedEntry.cbLtv ?? 0) : (selectedRow?.cbLtv ?? 0);

  // Action-row display values for the SELECTED month.
  const rowDrawUsd  = selectedEntry ? (selectedEntry.expensesActual ?? selectedPlan?.blocDraw ?? 0) : (selectedPlan?.blocDraw ?? 0);
  const rowBtcAmt   = selectedEntry ? selectedEntry.btcBought : (selectedPlan?.btcBought ?? 0);
  const rowBtcUsd   = selectedEntry ? selectedEntry.btcBought * btcPrice : (selectedPlan?.btcBoughtUsd ?? 0);
  const rowInterest = selectedRow?.blocInterest ?? 0;
  const rowCbPayUsd = selectedPlan?.cbPayment ?? 0;
  const rowMinPayment = selectedPlan?.minPayment ?? 0;
  const rowPaydownUsd = selectedPlan?.paydown ?? 0;
  const hasPaydown    = rowPaydownUsd > 0;
  const rowBuyPct     = income > 0 ? rowBtcUsd / income : 1;
  const rowPaydownPct = income > 0 ? rowPaydownUsd / income : 0;

  // Demoted "this month also" strip reads the SELECTED row's flags (scrubbing shows that month's alerts).
  const sCbTriggered = hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && !!selectedRow?.cbLtvTriggered;
  const sCapped      = sCbTriggered && !!selectedRow?.cbPaydownCapped;
  const sRepayFired  = hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && !!selectedRow?.strikeRepayFired;
  const sFiatGap     = selectedRow?.fiatGap ?? 0;

  const summaryText = composeMonthSummary({
    month: selectedMonth, isLogged: !!selectedEntry, hasCbLoan,
    cbLtv: barCbLtv, triggerPct: cbLtvTriggerPct,
    draw: rowDrawUsd, btcBoughtUsd: rowBtcUsd, cbPayment: rowCbPayUsd,
    rotationFired: sRepayFired, rotationAmount: selectedRow?.strikeRepayDraw ?? 0,
    interest: rowInterest,
    minPayment: rowMinPayment,
  });

  // Bar fill % + shared barLevel color language.
  const clampPct = (frac: number) => Math.max(0, Math.min(100, frac * 100));
  const strikeLiqFrac = strikeLiquidationLtvPct / 100;
  const cbTriggerFrac = cbLtvTriggerPct / 100;
  // CB bar denominator = effective liquidation fraction from the authoritative cbLiquidationPrice
  // (balance/(collateral×price)); falls back to the protocol CB_LLTV when no price set. Raw-balance basis
  // matches barCbLtv (currentCbLtv), so the no-price case is an exact CB_LLTV no-op.
  const cbLiqFrac     = cbLiquidationPrice > 0 && cbCollateralBtc > 0
    ? cbLoanBalance / (cbCollateralBtc * cbLiquidationPrice)
    : CB_LLTV;
  const barPaydownPct = income > 0 ? clampPct(rowPaydownUsd / income) : 0;   // scrubber paydown segment (red share)
  const strikeFillPct = strikeLiqFrac > 0 ? clampPct(barStrikeLtv / strikeLiqFrac) : 0;
  const cbFillPct     = clampPct(barCbLtv / cbLiqFrac);
  const strikeLevel   = barLevel(barStrikeLtv, strikeLiqFrac * 0.6, strikeLiqFrac * 0.8);
  const cbLevel       = barLevel(barCbLtv, cbTriggerFrac * 0.85, cbTriggerFrac);

  // NDP re-scope (Simple Mode Corrections A): the annual non-draw payment only applies while minimums
  // are ROLLED into the line. In income mode every month's external minimum IS a non-draw payment, so
  // the annual clause disappears entirely.
  const ndpActionActive = blocMinPaymentSource === 'roll' && ndp.status !== 'ok';

  const cardTierClass  = styles[`cardTier${currentTier}`];

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
    // btcHeld edits are reality edits — a dated adjustment, never the baseline. Do this BEFORE the emit so the
    // reading's synthesized Strike LTV reflects the new collateral.
    if (modalDraft.btcHeld !== useStore.getState().getCurrentBtcHeld()) {
      adjustCurrentCollateral(modalDraft.btcHeld);
    }
    // §5b — emit a journaled Strike reading (the seam re-anchors advisorActualBlocBalance + asOf=today); Strike-only
    // (no CB assertion) so a setup save never re-bases the CB balance.
    emitBalanceReading({ strikeBal: modalDraft.blocBalance });
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
        <div className={styles.headerRight}>
          {!viewerMode && (
            <button className={styles.settingsBtn} onClick={() => setViewerPreview(true)} aria-label="Preview as viewer" title="Preview as viewer">👁</button>
          )}
          <button
            className={styles.modeToggleBtn}
            onClick={() => setSimpleMode(false)}
            aria-label="Switch to full app"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
              <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
              <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor"/>
              <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>
            </svg>
          </button>
          <button className={styles.settingsBtn} onClick={onOpenAlmanac} aria-label="Almanac">
            <svg width="16" height="16" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
              <path d="M480 576L192 576C139 576 96 533 96 480L96 160C96 107 139 64 192 64L496 64C522.5 64 544 85.5 544 112L544 400C544 420.9 530.6 438.7 512 445.3L512 512C529.7 512 544 526.3 544 544C544 561.7 529.7 576 512 576L480 576zM192 448C174.3 448 160 462.3 160 480C160 497.7 174.3 512 192 512L448 512L448 448L192 448zM224 216C224 229.3 234.7 240 248 240L424 240C437.3 240 448 229.3 448 216C448 202.7 437.3 192 424 192L248 192C234.7 192 224 202.7 224 216zM248 288C234.7 288 224 298.7 224 312C224 325.3 234.7 336 248 336L424 336C437.3 336 448 325.3 448 312C448 298.7 437.3 288 424 288L248 288z"/>
            </svg>
          </button>
          <button className={styles.settingsBtn} onClick={onOpenSettings} title="Settings">
            ⚙
          </button>
        </div>
      </div>

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
            cbLoanBalance={cbLoanBalance}
            cbCollateralBtc={cbCollateralBtc}
            cbAprPct={cbAprPct}
            cbMonthlyPayment={cbMonthlyPayment}
            cbPaymentStrategy={cbPaymentStrategy}
            cbLtvTriggerPct={cbLtvTriggerPct}
            cbLtvTargetPct={cbLtvTargetPct}
            cbRotateBackPct={cbRotateBackPct}
            blocMinPaymentSource={blocMinPaymentSource}
          />
        </div>
      )}

      {(strategyDone || simpleSegment === 'thisMonth') && (
      <div className={styles.cards}>

        {/* Position — two carded boxes (STRIKE BLOC | THIS MONTH) */}
        <div className={styles.positionRow}>

            {/* Box 1 — CURRENT STRIKE BLOC (where you are now): asset → debt → avail */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>CURRENT STRIKE BLOC</span>
              <span className={styles.positionStat}><span className={styles.btcAmt}>₿ {currentBtcHeld.toFixed(5)}</span> <span className={styles.parenSub}>({fmtUSD(currentBtcHeld * btcPrice)})</span></span>
              <span className={styles.positionStat}>{fmtUSD(advisorActualBlocBalance)} <span className={styles.parenSub}>({(currentBlocLtv * 100).toFixed(1)}% LTV)</span></span>
              <span className={styles.positionStat}>Avail: {fmtUSD(currentAvail.available)}</span>
              {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && currentRow?.strikeRepayFired && (
                <span className={styles.positionStatHint} style={{ color: 'var(--green)' }}>
                  ↩ Rotation ready — shift to the cheaper CB loan
                </span>
              )}
            </div>

            {/* Box 2 — THIS MONTH (the action): Buy + Draw; entry actuals when logged, (proj) otherwise */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>
                THIS MONTH{!currentEntry && <span className={styles.projSuffix}> (proj)</span>}
              </span>
              {/* §3 — headline = the engine PLAN; ledger month-to-date in the parenthetical. */}
              <span className={`${styles.positionStat} ${(currentRow?.btcBought ?? 0) > 0 ? styles.statGreen : styles.statMuted}`}>
                Buy: ₿ {(currentRow?.btcBought ?? 0) > 0 ? `+${(currentRow?.btcBought ?? 0).toFixed(5)}` : '—'}
                {mtd.streams.buyBtc > 0 && <span className={styles.parenSub}> (₿{mtd.streams.buyBtc.toFixed(3)} so far)</span>}
              </span>
              <span className={styles.positionStat}>
                Draw: {fmtUSD(currentRow?.blocDraw ?? 0)}
                {mtd.streams.draw < (currentRow?.blocDraw ?? 0) && mtd.streams.draw > 0 && (
                  <span className={styles.parenSub}> ({fmtUSD((currentRow?.blocDraw ?? 0) - mtd.streams.draw)} left)</span>
                )}
              </span>
              {/* §2b — Strike monthly minimum + status chip (income) / capitalize note (roll). */}
              <span className={styles.positionStat}>
                Min: {fmtUSD(isIncomeSource ? strikeMinOwed : (currentRow?.blocInterest ?? 0))}
                {isIncomeSource
                  ? <span className={`${styles.minChip} ${styles[`minChip_${curMinStatus}`]}`}>{curMinStatus}</span>
                  : <span className={styles.parenSub}> · {blocMinPaymentDueDay}th (rolls in)</span>}
              </span>
              {ndpActionActive && (
                <span className={`${styles.ndpBadge} ${styles[`ndp_${ndp.status}`]}`}>
                  {ndp.status === 'never'    && 'NDP — not recorded'}
                  {ndp.status === 'upcoming' && `⚠ NDP: ${ndp.daysRemaining}d`}
                  {ndp.status === 'soon'     && `⚠ NDP: ${ndp.daysRemaining}d`}
                  {ndp.status === 'overdue'  && '⛔ NDP overdue'}
                </span>
              )}
              {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && (cbTriggered ? cbPaydownToTarget > 0 : cbRunwayToTrigger > 0) && (
                <>
                  <div className={styles.positionDivider} />
                  {cbTriggered ? (
                    <>
                      <span className={styles.positionStat} style={{ color: cbPaydownAffordable ? 'var(--green)' : 'var(--red)' }}>
                        CB paydown: {fmtUSD(cbPaydownToTarget)}
                      </span>
                      <span className={styles.positionStatHint}>to reach {cbLtvTargetPct}% LTV</span>
                    </>
                  ) : (
                    <>
                      <span className={styles.positionStat} style={{ color: 'var(--text-secondary)' }}>
                        CB runway: {(cbLtvTriggerPct - currentCbLtv * 100).toFixed(1)}%
                      </span>
                      <span className={styles.positionStatHint}>before {cbLtvTriggerPct}% trigger</span>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Box 3 — AFTER THIS MONTH (where it leaves you) — mirrors Box 1 line-for-line */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>AFTER THIS MONTH</span>
              <span className={styles.positionStat}><span className={styles.btcAmt}>₿ {eomBtcHeld.toFixed(5)}</span> <span className={styles.parenSub}>({fmtUSD(eomBtcHeld * btcPrice)})</span></span>
              <span className={styles.positionStat}>{fmtUSD(eomBlocBalance)} <span className={styles.parenSub}>(<span style={hasPaydown ? { color: 'var(--orange)' } : undefined}>{(eomLtv * 100).toFixed(1)}% LTV</span>)</span></span>
              <span className={styles.positionStat}>Avail: {fmtUSD(availCredit.available)}</span>
            </div>

          </div>

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

        {/* Plan card — Monthly Playbook with month scrubber (projection-vs-reality split) */}
        <div className={`${styles.card} ${isCurrent && !isLogged ? cardTierClass : ''}`}>

          {/* Scrubber header */}
          <div className={styles.scrubHeader}>
            <div className={styles.scrubHeaderTop}>
              <div className={styles.scrubTitleGroup}>
                <h3 className={styles.planTitle}>
                  Monthly Playbook <span className={styles.planTitleSep}>·</span> Month <span className={styles.scrubMonthNum}>{selectedMonth}</span> of 12
                </h3>
                <span className={`${styles.scrubBadge} ${
                  isCurrent ? styles.scrubBadgeCurrent
                  : selectedEntry ? styles.scrubBadgeLogged
                  : styles.scrubBadgeProjected
                }`}>
                  {isCurrent ? 'CURRENT' : selectedEntry ? '✓ LOGGED' : 'PROJECTED'}
                </span>
              </div>
            </div>
            <div className={styles.scrubMeta}>
              <span className={styles.scrubLtv}>
                LTV <span style={hasPaydown ? { color: 'var(--orange)' } : undefined}>{(barStrikeLtv * 100).toFixed(1)}%</span>
                {hasPaydown && <span className={styles.scrubPaydownFlag}> — paydown triggered</span>}
              </span>
              <span className={styles.scrubPrice}>BTC {fmtUSD(btcPrice)}</span>
            </div>
            <input
              type="range"
              className={styles.scrubSlider}
              style={{ ['--paydownPct' as string]: barPaydownPct }}
              min={1} max={12} step={1}
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              aria-label="Scrub through months"
            />
            <div className={styles.scrubMonthLabels}>
              {[1, 3, 6, 9, 12].map((m) => (
                <span key={m} className={styles.scrubMonthTick}>M{m}</span>
              ))}
            </div>
          </div>

          {/* Stacked status bars — selected month's projection; current = skip-adjusted reality */}
          {(showPlanStrikeBar || (showPlanCbBar && hasCbLoan)) && (
            <div className={styles.planBars}>
              {showPlanStrikeBar && (
                <div className={styles.planBar}>
                  <div className={styles.planBarHead}>
                    <span className={styles.planBarLabel}>STRIKE BLOC</span>
                    <span className={styles.planBarVal}>
                      {isCurrent ? (
                        <>
                          <span className={styles.planBarFrom}>{(currentBlocLtv * 100).toFixed(1)}%</span>
                          <span className={styles.planBarArrow}> → </span>
                          <span style={hasPaydown ? { color: 'var(--orange)' } : undefined}>{(barStrikeLtv * 100).toFixed(1)}% LTV</span>
                        </>
                      ) : (
                        <span style={hasPaydown ? { color: 'var(--orange)' } : undefined}>{(barStrikeLtv * 100).toFixed(1)}% LTV</span>
                      )}
                    </span>
                  </div>
                  <div className={styles.planBarTrack}>
                    <div className={styles.planBarFill} style={{ width: `${strikeFillPct}%`, background: LEVEL_COLOR[strikeLevel] }} />
                    <div className={styles.planBarMarker} style={{ left: '100%' }} />
                  </div>
                </div>
              )}
              {showPlanCbBar && hasCbLoan && (
                <div className={styles.planBar}>
                  <div className={styles.planBarHead}>
                    <span className={styles.planBarLabel}>COINBASE LOAN</span>
                    <span className={styles.planBarVal}>
                      {isCurrent ? (
                        <>
                          <span className={styles.planBarFrom}>{(currentCbLtv * 100).toFixed(1)}%</span>
                          <span className={styles.planBarArrow}> → </span>
                          <span>{(barCbLtv * 100).toFixed(1)}% LTV</span>
                        </>
                      ) : (
                        <span>{(barCbLtv * 100).toFixed(1)}% LTV</span>
                      )}
                    </span>
                  </div>
                  <div className={styles.planBarTrack}>
                    <div className={styles.planBarFill} style={{ width: `${cbFillPct}%`, background: LEVEL_COLOR[cbLevel] }} />
                    <div className={styles.planBarMarker} style={{ left: `${clampPct(cbTriggerFrac / cbLiqFrac)}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Body — pure plan rows: the current month renders like any projected month; the Ledger owns
              actuals. §3 — no operate console, no Pay/Skip, no Log button. */}
          <>
              <div className={styles.dotRows}>
                {/* Buy Bitcoin */}
                <div className={styles.dotRow}>
                  <span className={`${styles.dot} ${styles.dotGreen}`} />
                  <div className={styles.dotLabelGroup}>
                    <span className={styles.dotLabel}>Buy Bitcoin</span>
                    <span className={styles.dotSub}>
                      {`~${fmtUSD(rowBtcUsd)} ${hasPaydown ? '(after paydown)' : '(100% of income)'}`}
                    </span>
                  </div>
                  <div className={styles.dotRightInner}>
                    <span className={styles.dotPct}>{fmtPct(rowBuyPct)}</span>
                    <span className={styles.dotAmount}>{rowBtcAmt.toFixed(5)} ₿</span>
                  </div>
                </div>

                {/* LoC Paydown — income-driven, no pill (months where paydown fires) */}
                {hasPaydown && (
                  <div className={styles.dotRow}>
                    <span className={`${styles.dot} ${styles.dotOrange}`} />
                    <div className={styles.dotLabelGroup}>
                      <span className={styles.dotLabel}>LoC Paydown</span>
                      <span className={styles.dotSub}>reducing your BLOC LTV</span>
                    </div>
                    <div className={styles.dotRightInner}>
                      <span className={styles.dotPct}>{fmtPct(rowPaydownPct)}</span>
                      <span className={styles.dotAmount}>{fmtUSD(rowPaydownUsd)}</span>
                    </div>
                  </div>
                )}

                {/* Line of Credit section separator (Smart BLOC structure) */}
                <div className={styles.separator}>
                  <span className={styles.separatorLabel}>Line of Credit (funds your lifestyle)</span>
                </div>

                {/* Monthly Draw */}
                {rowDrawUsd > 0 && (
                  <div className={styles.dotRow}>
                    <span className={`${styles.dot} ${styles.dotAmber}`} />
                    <div className={styles.dotLabelGroup}>
                      <span className={styles.dotLabel}>Monthly Draw</span>
                      <span className={styles.dotSub}>living expenses, from BLOC</span>
                    </div>
                    <span className={styles.dotAmount}>{fmtUSD(rowDrawUsd)}</span>
                  </div>
                )}

                {/* Pay Coinbase loan — monthly CB mode only (preserves the Skip-CB control) */}
                {hasCbLoan && cbPaymentStrategy === 'monthly' && rowCbPayUsd > 0 && (
                  <div className={styles.dotRow}>
                    <span className={`${styles.dot} ${styles.dotBlue}`} />
                    <div className={styles.dotLabelGroup}>
                      <span className={styles.dotLabel}>Pay Coinbase loan</span>
                      <span className={styles.dotSub}>from monthly income</span>
                    </div>
                    <span className={styles.dotAmount}>{fmtUSD(rowCbPayUsd)}</span>
                  </div>
                )}

                {/* Strike minimum — income source only (roll mode carries it via the Interest row below) */}
                {isIncomeSource && rowMinPayment > 0 && (
                  <div className={styles.dotRow}>
                    <span className={`${styles.dot} ${styles.dotRed}`} />
                    <div className={styles.dotLabelGroup}>
                      <span className={styles.dotLabel}>Strike minimum · due the {blocMinPaymentDueDay}th</span>
                      <span className={styles.dotSub}>paid from income (no compounding)</span>
                    </div>
                    <div className={styles.dotRightInner}>
                      {isCurrent && !viewerMode && editingMin ? (
                        <div className={styles.confirmExpensesField}>
                          <span className={styles.confirmExpensesPrefix}>$</span>
                          <input
                            type="number"
                            className={styles.confirmExpensesInput}
                            autoFocus
                            defaultValue={blocStatementMinimum ?? Math.round(strikeMinEstimate)}
                            step={1}
                            onBlur={(e) => { setBlocStatementMinimum(parseFloat(e.target.value) || 0); setEditingMin(false); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          />
                        </div>
                      ) : (
                        <button
                          className={styles.minAmountBtn}
                          disabled={!isCurrent || viewerMode}
                          onClick={() => setEditingMin(true)}
                        >
                          <span className={styles.dotAmount}>{fmtUSD(rowMinPayment)}</span>
                          {isCurrent
                            ? <span className={`${styles.minChip} ${styles[`minChip_${curMinStatus}`]}`}>{curMinStatus}</span>
                            : <span className={`${styles.chip} ${styles.chipEst}`}>est.</span>}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Interest /mo — informational, no pill (roll mode: interest capitalizes) */}
                {!isIncomeSource && rowInterest > 0 && (
                  <div className={styles.dotRow}>
                    <span className={`${styles.dot} ${styles.dotRed}`} />
                    <div className={styles.dotLabelGroup}>
                      <span className={styles.dotLabel}>Interest /mo</span>
                      <span className={styles.dotSub}>capitalizes onto your BLOC balance</span>
                    </div>
                    <span className={styles.dotAmount} style={{ color: 'var(--red)' }}>{fmtUSD(rowInterest)}</span>
                  </div>
                )}
              </div>

              {/* Demoted "this month also" strip */}
              {(sCbTriggered || sCapped || sRepayFired || sFiatGap > 0 || (isCurrent && ndpActionActive)) && (
                <div className={styles.alsoStrip}>
                  <span className={styles.alsoLabel}>THIS MONTH ALSO</span>
                  {sCbTriggered && (
                    <div className={styles.alsoRow}>
                      <span className={styles.alsoIcon}>⚠</span>
                      <span className={styles.alsoText}>CB LTV alert — draw from BLOC to pay down CB</span>
                      <span className={styles.alsoAmt} style={{ color: 'var(--amber)' }}>{fmtUSD(selectedRow?.cbPaydownDraw ?? 0)}</span>
                    </div>
                  )}
                  {sCapped && (
                    <div className={styles.alsoRow}>
                      <span className={styles.alsoIcon}>⚠</span>
                      <span className={styles.alsoText} style={{ color: 'var(--amber)' }}>
                        Paydown capped — credit line reached · {fmtUSD(selectedRow?.cbPaydownShortfall ?? 0)} shortfall
                      </span>
                    </div>
                  )}
                  {sRepayFired && (
                    <div className={styles.alsoRow} style={{ color: 'var(--green)' }}>
                      <span className={styles.alsoIcon}>↩</span>
                      <span className={styles.alsoText}>
                        Rotate to cheap debt — saves ~{fmtUSD((selectedRow?.strikeRepayDraw ?? 0) * (blocApr - cbAprPct) / 100)}/yr
                      </span>
                      <span className={styles.alsoAmt}>{fmtUSD(selectedRow?.strikeRepayDraw ?? 0)}</span>
                    </div>
                  )}
                  {sFiatGap > 0 && (
                    <div className={styles.alsoRow}>
                      <span className={styles.alsoIcon}>≡</span>
                      <span className={styles.alsoText}>Cover from savings</span>
                      <span className={styles.alsoAmt}>{fmtUSD(sFiatGap)}</span>
                    </div>
                  )}
                  {isCurrent && ndpActionActive && (
                    <div className={styles.alsoRow}>
                      <span className={styles.alsoIcon}>⚡</span>
                      <span className={styles.alsoText}>
                        {ndp.status === 'never' ? 'Non-draw payment — not yet recorded'
                          : ndp.status === 'overdue' ? 'NDP overdue — pay Strike now'
                          : `Non-draw payment due in ${ndp.daysRemaining}d`}
                        {ndp.estimatedAmount > 0 ? ` · ~${fmtUSD(ndp.estimatedAmount)} min` : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* §3 — MTD strip: read-only ledger progress for the current month; deep-links to the Ledger */}
              {isCurrent && (
                <button className={styles.mtdStrip} onClick={() => setSimpleView('daily')}>
                  Ledger: {fmtUSD(mtd.streams.draw)} drawn · ₿{mtd.streams.buyBtc.toFixed(3)} bought · {fmtUSD(mtd.streams.paydown)} paid ›
                </button>
              )}

              {/* §3 — sign-off pointer (replaces the Log button): the Playbook informs, the Ledger signs off */}
              {isCurrent && needsSignoff && !viewerMode && (
                <button className={styles.signoffPointer} onClick={() => setSimpleView('daily')}>
                  Month {currentMonth} awaits sign-off in the Ledger →
                </button>
              )}

              {/* Preview affordances — non-current months (the overlay is read-only for daily months, §4) */}
              {!isCurrent && (
                <div className={styles.previewActions}>
                  {selectedEntry && !viewerMode && (
                    <button className={styles.previewEditBtn} onClick={() => { setLogOverlayInitialMonth(selectedMonth - 1); setLogOverlayOpen(true); }}>
                      ✎ View / edit this month
                    </button>
                  )}
                  <button className={styles.backToCurrentBtn} onClick={() => setSelectedMonth(currentMonth)}>
                    ← Back to current month
                  </button>
                </div>
              )}
            </>

          {/* B — mis-ordered CB thresholds notice (covers legacy/synced-in bad config) */}
          {cbThresholdsMisordered && (
            <p className={styles.misorderNotice}>
              ⚠ CB thresholds mis-ordered — rotation advice suspended; fix in Settings → Coinbase Loan.
            </p>
          )}

          {/* C — cumulative savings need over the remaining projection */}
          {savingsNeed > 0 && (
            <p className={`${styles.savingsNeed} ${savingsNeed >= income ? styles.savingsNeedAlert : ''}`}>
              Needs ~{fmtUSD(savingsNeed)} from savings over the next {savingsNeedMonths} month{savingsNeedMonths === 1 ? '' : 's'}
            </p>
          )}

          {/* Summary paragraph */}
          <p className={styles.planSummary}>{summaryText}</p>
        </div>

        {/* Next-month preview (§8) */}
        {!strategyDone && nextRow && (
          <p className={styles.nextMonthPreview}>
            Next month: draw ~{fmtUSD(nextRow.blocDraw)} · buy ~{nextRow.btcBought.toFixed(5)} ₿
          </p>
        )}

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
        months={advisorRows}
        collateralBtc={collateralBtc}
        openInEditMode
        onClose={() => setLogOverlayOpen(false)}
      />
    )}
    </>
  );
}
