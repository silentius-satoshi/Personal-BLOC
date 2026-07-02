import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth, isStrategyComplete, getTier, getNdpStatus } from '../../simulation/runAdvisor';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { deriveAdvisorStart, computeExpenseReanchor } from '../../simulation/logUtils';
import { strikeAvailableCredit, computeStrikeLtv } from '../../simulation/strikeCredit';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { deriveForMonth, isOperatingMonth, composeMonthSummary } from '../../simulation/simpleModePlan';
import { fmtUSD, todayLocalISO, toLocalISO } from '../../utils/format';
import { MonthlyLogOverlay } from '../Advisor/MonthlyLogOverlay';
import { OutlookProjection } from '../Advisor/OutlookProjection';
import { SafetyDashboard } from './SafetyDashboard';
import { ViewToggle } from '../Layout/ViewToggle';
import { accruedCbBalance, barLevel, type SafetyLevel } from '../../simulation/cbMetrics';
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

function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

function ConfirmLogSheet({
  monthNum, monthLabel,
  drawAmount, skipDraw, onBlocDrawChange,
  cbPayment, skipCb, showCbRow, cbRowLabel, onCbPaymentChange,
  btcPrice, skipBtc,
  interest, onInterestChange, isIncomeSource,
  confirmBtcBought, onBtcBoughtChange,
  isFullyAllocated,
  ndpDone, ndpAmount,
  showNdpRow, ndpChecked, onNdpChange,
  ndpAmountPaid, onNdpAmountChange,
  onConfirm, onCancel,
}: {
  monthNum: number; monthLabel: string;
  drawAmount: number; skipDraw: boolean; onBlocDrawChange: (v: number) => void;
  cbPayment: number; skipCb: boolean; showCbRow: boolean; cbRowLabel: string; onCbPaymentChange: (v: number) => void;
  btcPrice: number; skipBtc: boolean;
  interest: number; onInterestChange: (v: number) => void; isIncomeSource: boolean;
  confirmBtcBought: number; onBtcBoughtChange: (v: number) => void;
  isFullyAllocated: boolean;
  ndpDone: boolean; ndpAmount: number;
  showNdpRow?: boolean; ndpChecked?: boolean; onNdpChange?: (v: boolean) => void;
  ndpAmountPaid: number; onNdpAmountChange?: (v: number) => void;
  onConfirm: () => void; onCancel: () => void;
}) {
  return createPortal(
    <div className={styles.confirmOverlay} onClick={onCancel}>
      <div className={styles.confirmSheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.confirmHeader}>
          <span className={styles.confirmTitle}>Confirm Month {monthNum}</span>
          <span className={styles.confirmSub}>{monthLabel}</span>
        </div>
        <div className={styles.confirmRows}>
          {skipDraw ? (
            <div className={styles.confirmRow}>
              <span>BLOC draw</span>
              <span>Skipped</span>
            </div>
          ) : (
            <div className={`${styles.confirmRow} ${styles.confirmRowExpenses}`}>
              <span>BLOC draw</span>
              <div className={styles.confirmExpensesField}>
                <span className={styles.confirmExpensesPrefix}>$</span>
                <input
                  type="number"
                  className={styles.confirmExpensesInput}
                  value={drawAmount}
                  step={100}
                  onChange={(e) => onBlocDrawChange(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          )}
          {showCbRow && (
            skipCb ? (
              <div className={styles.confirmRow}>
                <span>{cbRowLabel}</span>
                <span>Skipped</span>
              </div>
            ) : (
              <div className={`${styles.confirmRow} ${styles.confirmRowExpenses}`}>
                <span>{cbRowLabel}</span>
                <div className={styles.confirmExpensesField}>
                  <span className={styles.confirmExpensesPrefix}>$</span>
                  <input
                    type="number"
                    className={styles.confirmExpensesInput}
                    value={cbPayment}
                    step={100}
                    onChange={(e) => onCbPaymentChange(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
            )
          )}
          {skipBtc ? (
            <div className={styles.confirmRow}>
              <span>BTC bought</span>
              <span>Skipped</span>
            </div>
          ) : (
            <div className={`${styles.confirmRow} ${styles.confirmRowExpenses}`}>
              <span>BTC bought this month <span style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>(~{fmtUSD(confirmBtcBought * btcPrice)})</span></span>
              <div className={styles.confirmExpensesField}>
                <span className={styles.confirmExpensesPrefix}>₿</span>
                <input
                  type="number"
                  className={styles.confirmExpensesInput}
                  value={confirmBtcBought}
                  step={0.00000001}
                  onChange={(e) => onBtcBoughtChange(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          )}
          {ndpDone && ndpAmount > 0 && (
            <div className={styles.confirmRow}>
              <span>NDP</span>
              <span>paid {fmtUSD(ndpAmount)}</span>
            </div>
          )}
          <div className={`${styles.confirmRow} ${styles.confirmRowExpenses}`}>
            <span>{isIncomeSource ? 'Strike minimum paid' : 'Interest /mo'}</span>
            <div className={styles.confirmExpensesField}>
              <span className={styles.confirmExpensesPrefix}>$</span>
              <input
                type="number"
                className={styles.confirmExpensesInput}
                value={interest}
                step={1}
                onChange={(e) => onInterestChange(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
          {isFullyAllocated && (
            <div className={`${styles.confirmRow} ${styles.confirmRowAlloc}`}>
              Income fully allocated ✓
            </div>
          )}
          {showNdpRow && (
            <>
              <label className={styles.confirmRow}>
                <span>NDP payment made this year</span>
                <input
                  type="checkbox"
                  checked={!!ndpChecked}
                  onChange={(e) => onNdpChange?.(e.target.checked)}
                />
              </label>
              {ndpChecked && (
                <div className={`${styles.confirmRow} ${styles.confirmRowExpenses}`}>
                  <span>NDP amount</span>
                  <div className={styles.confirmExpensesField}>
                    <span className={styles.confirmExpensesPrefix}>$</span>
                    <input
                      type="number"
                      className={styles.confirmExpensesInput}
                      value={ndpAmountPaid}
                      step={1}
                      onChange={(e) => onNdpAmountChange?.(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className={styles.confirmActions}>
          <button className={styles.confirmCancelBtn} onClick={onCancel}>Cancel</button>
          <button className={styles.confirmPrimaryBtn} onClick={onConfirm}>Confirm & advance</button>
        </div>
      </div>
    </div>,
    document.body,
  );
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
  const cbCollateralBtc    = useStore((s) => s.cbCollateralBtc);
  const cbLiquidationPrice = useStore((s) => s.cbLiquidationPrice);
  const cbMonthlyPayment   = useStore((s) => s.cbMonthlyPayment);
  const cbPaymentStrategy  = useStore((s) => s.cbPaymentStrategy);
  const cbLoanBalanceAsOf  = useStore((s) => s.cbLoanBalanceAsOf);
  const setCbLoanBalance      = useStore((s) => s.setCbLoanBalance);
  const setCbLoanBalanceAsOf  = useStore((s) => s.setCbLoanBalanceAsOf);
  const cbLtvTriggerPct    = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct     = useStore((s) => s.cbLtvTargetPct);
  const cbRotateBackPct    = useStore((s) => s.cbRotateBackPct);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const advisorMonthStartBalance    = useStore((s) => s.advisorMonthStartBalance);
  const setAdvisorMonthStartBalance = useStore((s) => s.setAdvisorMonthStartBalance);
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());
  const adjustCurrentCollateral     = useStore((s) => s.adjustCurrentCollateral);
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const ndpLastPaidDate             = useStore((s) => s.ndpLastPaidDate);
  const setNdpLastPaidDate          = useStore((s) => s.setNdpLastPaidDate);

  const advisorSkipBlocDraw  = useStore((s) => s.advisorSkipBlocDraw);
  const advisorSkipCbPayment = useStore((s) => s.advisorSkipCbPayment);
  const advisorSkipBtcBuying = useStore((s) => s.advisorSkipBtcBuying);
  const viewerMode           = useStore((s) => s.viewerMode);   // read-only viewer → hide/disable mutation controls
  const setAdvisorSkipBlocDraw  = useStore((s) => s.setAdvisorSkipBlocDraw);
  const setAdvisorSkipCbPayment = useStore((s) => s.setAdvisorSkipCbPayment);
  const setAdvisorSkipBtcBuying = useStore((s) => s.setAdvisorSkipBtcBuying);
  const hasCbLoan            = useStore((s) => s.hasCbLoan);

  const strikeLiquidationLtvPct = useStore((s) => s.strikeLiquidationLtvPct);
  const blocMinPaymentSource    = useStore((s) => s.blocMinPaymentSource);
  const blocStatementMinimum    = useStore((s) => s.blocStatementMinimum);
  const setBlocStatementMinimum = useStore((s) => s.setBlocStatementMinimum);
  const showPlanStrikeBar       = useStore((s) => s.showPlanStrikeBar);
  const showPlanCbBar           = useStore((s) => s.showPlanCbBar);

  const setSimpleMode = useStore((s) => s.setSimpleMode);

  const setIncome     = useStore((s) => s.setIncome);
  const setExpenses   = useStore((s) => s.setExpenses);
  const expenseReanchorDismissedAt    = useStore((s) => s.expenseReanchorDismissedAt);
  const setExpenseReanchorDismissedAt = useStore((s) => s.setExpenseReanchorDismissedAt);
  const setCreditLine = useStore((s) => s.setCreditLine);

  const activeTier       = useStore((s) => s.activeTier);
  const cbAprPct         = useStore((s) => s.cbAprPct);
  const monthlyLog       = useStore((s) => s.monthlyLog);
  const upsertLogEntry   = useStore((s) => s.upsertLogEntry);
  const deleteLogEntry   = useStore((s) => s.deleteLogEntry);

  // Change 1 (iter 2) — setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalDraft, setModalDraft] = useState({
    income, expenses, creditLine,
    blocBalance: advisorActualBlocBalance,
    monthStartBalance: advisorMonthStartBalance,
    btcHeld: currentBtcHeld,
  });

  // Change 3 — custom amounts
  const [customBlocDraw,  setCustomBlocDraw]  = useState<number | null>(null);
  const [customCbPayment, setCustomCbPayment] = useState<number | null>(null);
  const [customInterest,  setCustomInterest]  = useState<number | null>(null);
  const [customBtcBuying, setCustomBtcBuying] = useState<number | null>(null); // stored as BTC
  // Confirm sheet
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);
  const [confirmBtcBought, setConfirmBtcBought] = useState(0);
  const [ndpAmountPaid, setNdpAmountPaid]       = useState(0);
  // Inline Strike-statement entry (income-mode allocation row)
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

  // Strike minimum payment source (Simple Mode Corrections A). In 'income' mode the monthly minimum
  // (accrued interest) is paid from income rather than capitalizing — it reduces income available for
  // BTC/paydown; the user-entered statement figure overrides the one-month-interest estimate. In 'roll'
  // mode effectiveMin === 0 so every downstream figure is byte-identical to before.
  const isIncomeSource    = blocMinPaymentSource === 'income';
  const strikeMinEstimate = currentRow?.blocInterest ?? 0;   // one month's accrued interest (model hint)
  const effectiveMin      = isIncomeSource ? (blocStatementMinimum ?? strikeMinEstimate) : 0;

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

  // ltvTriggered suspends CB-tier rules (the trigger IS the safety mechanism) — mirror the engine
  // (runAdvisor.ts:166/181/185): full expense draw, income-funded BTC buying, no tier gating. Tier
  // halving/zeroing applies only in monthly mode.
  const isLtvTriggered = hasCbLoan && cbPaymentStrategy === 'ltvTriggered';
  const expectedBlocDraw = isLtvTriggered
    ? Math.min(expenses, Math.max(0, creditLine - advisorActualBlocBalance))   // tiers suspended (matches runAdvisor:166)
    : currentTier === 1 ? 0
      : currentTier === 2
        ? Math.min(expenses * 0.5, Math.max(0, creditLine - advisorActualBlocBalance))
        : Math.min(expenses, Math.max(0, creditLine - advisorActualBlocBalance));
  const expectedFiatGap   = Math.max(0, expenses - expectedBlocDraw);
  const expectedCbPayment = advisorSkipCbPayment ? 0 : (currentRow?.cbPayment ?? 0);
  const expectedBtcBuying = advisorSkipBtcBuying ? 0
    : isLtvTriggered ? Math.max(0, income - expectedCbPayment - effectiveMin)  // tiers suspended (matches runAdvisor:185; cbPayment=0 in this mode); income-source min competes for income
      : currentTier === 1 ? 0
        : Math.max(0, income - expectedCbPayment - effectiveMin);

  // Change 3 — effective amounts (override when user enters custom). In income mode the "interest"
  // field IS the Strike minimum paid from income (statement ?? estimate); in roll mode it's the
  // capitalizing interest (byte-identical to before).
  const effectiveDrawAmount = customBlocDraw ?? expectedBlocDraw;
  const effectiveInterest   = customInterest ?? (isIncomeSource ? effectiveMin : (currentRow?.blocInterest ?? 0));

  // THIS MONTH shows what's LEFT to draw this month: full-month plan minus what you've already drawn
  // (live − start-of-month). The full draw still feeds the confirm sheet + loggedStrikeBal + AFTER projection.
  const alreadyDrawnThisMonth = Math.max(0, advisorActualBlocBalance - slmBlocBal);
  const remainingDraw         = Math.max(0, expectedBlocDraw - alreadyDrawnThisMonth);

  // CB payment: per-mode projected seed (ltvTriggered → BLOC-funded cbPaydownDraw, monthly →
  // income-funded cbPayment), overridable in the confirm sheet. Matches the re-anchor source exactly.
  const projectedCbAmount = advisorSkipCbPayment ? 0
    : cbPaymentStrategy === 'ltvTriggered' ? (currentRow?.cbPaydownDraw ?? 0)
    : (currentRow?.cbPayment ?? 0);
  const effectiveCbPayment = customCbPayment ?? projectedCbAmount;

  // CB row shows when there's a payment in play: always in monthly mode; ltvTriggered only once fired.
  const showCbRow = hasCbLoan && (cbPaymentStrategy === 'monthly'
    || (cbPaymentStrategy === 'ltvTriggered' && !!currentRow?.cbLtvTriggered));

  // BTC buying: default is (income − CB payment) ÷ price; custom override stored as BTC
  const defaultBtcAmount =
    btcPrice > 0 ? Math.max(0, expectedBtcBuying / btcPrice) : 0;
  const effectiveBtcAmount    = customBtcBuying ?? defaultBtcAmount;

  const expectedPaydown    = currentRow
    ? Math.max(0, income - (hasCbLoan ? currentRow.cbPayment : 0) - currentRow.incomeToBtc - (currentRow.blocMinPayment ?? 0))
    : 0;

  // True end-of-month projections from AdvisorMonthRow + skip flags. In income mode the minimum is
  // paid from income (does NOT capitalize) — only the engine's shortfall re-capitalizes; in roll mode
  // the full interest capitalizes (byte-identical).
  const eomBlocBalance: number = currentRow
    ? slmBlocBal + (advisorSkipBlocDraw ? 0 : currentRow.blocDraw)
      + (isIncomeSource ? (currentRow.blocMinShortfall ?? 0) : currentRow.blocInterest) - expectedPaydown
    : advisorActualBlocBalance;
  const eomBtcHeld: number = slmBtcHeld + (advisorSkipBtcBuying ? 0 : (currentRow?.btcBought ?? 0));
  const eomLtv: number     = computeStrikeLtv(eomBlocBalance, eomBtcHeld, btcPrice);
  const currentBlocLtv: number = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice);   // matches the Strike dashboard bar
  const availCredit        = strikeAvailableCredit(creditLine, eomBtcHeld, btcPrice, eomBlocBalance);   // AFTER-this-month basis
  const currentAvail       = strikeAvailableCredit(creditLine, currentBtcHeld, btcPrice, advisorActualBlocBalance);   // CURRENT basis

  // Logged Strike balance/LTV reflect the EDITED draw + interest (effectiveDrawAmount/effectiveInterest)
  // — what the user confirms in the sheet — substituting them for the projected currentRow values.
  const loggedStrikeBal: number = currentRow
    ? slmBlocBal + (advisorSkipBlocDraw ? 0 : effectiveDrawAmount)
      + (isIncomeSource ? Math.max(0, effectiveInterest - income) : effectiveInterest) - expectedPaydown
    : advisorActualBlocBalance;
  const loggedStrikeLtv: number = computeStrikeLtv(loggedStrikeBal, eomBtcHeld, btcPrice);

  // Change 2 — THIS MONTH column: actuals from the log entry when logged, projections otherwise
  const currentEntry = monthlyLog.find((e) => e.month === currentMonth);
  const ndpMinimum = advisorActualBlocBalance > 0
    ? advisorActualBlocBalance * (blocApr / 100 / 12)
    : 0;

  const allocatedFromIncome = expectedPaydown
    + (advisorSkipBtcBuying ? 0 : expectedBtcBuying)
    + (hasCbLoan && cbPaymentStrategy === 'monthly' && !advisorSkipCbPayment ? expectedCbPayment : 0)
    + effectiveMin;   // income-source minimum is an income allocation (0 in roll mode)

  // CB runway/paydown indicator (ltvTriggered only), banded to match the engine: below the 75% trigger we're
  // deliberately idle → show RUNWAY (headroom before the trigger); at/above it the engine draws → show the
  // PAYDOWN to the 65% target. Reuses currentCbLtv (:332).
  const cbTriggered = hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && currentCbLtv >= cbLtvTriggerPct / 100;
  const cbRunwayToTrigger = hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
    ? Math.max(0, cbCollateralBtc * btcPrice * (cbLtvTriggerPct / 100) - cbLoanBalance) : 0;
  const cbPaydownToTarget = hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
    ? Math.max(0, cbLoanBalance - cbCollateralBtc * btcPrice * (cbLtvTargetPct / 100)) : 0;
  const cbPaydownAffordable = cbPaydownToTarget <= Math.max(0, creditLine - advisorActualBlocBalance);
  const isFullyAllocated   = income > 0 && Math.abs(income - allocatedFromIncome) < 1;

  // ── Month scrubber — projection-vs-reality split (spec v2) ─────────────────────────────────
  // Snap the selection to "now" whenever the real month advances; free scrubbing within a session.
  useEffect(() => { setSelectedMonth(currentMonth); }, [currentMonth]);

  const isCurrent     = isOperatingMonth(selectedMonth, currentMonth);
  const selectedRow   = advisorRows.find((r) => r.month === selectedMonth) ?? currentRow;
  const selectedEntry = monthlyLog.find((e) => e.month === selectedMonth);
  const selectedPlan  = selectedRow ? deriveForMonth(selectedRow, income, hasCbLoan, cbPaymentStrategy) : null;

  // Skip-aware EoM CB LTV for the CURRENT month: in monthly mode a skipped payment leaves the balance
  // un-paid → use the start-of-month CB LTV; otherwise the advisor's post-payment cbLtv stands.
  // (ltvTriggered CB is event-driven, never income-skipped.)
  const eomCbLtv = !hasCbLoan ? 0
    : (cbPaymentStrategy === 'monthly' && advisorSkipCbPayment)
      ? currentCbLtv
      : (currentRow?.cbLtv ?? currentCbLtv);

  // Bar inputs for the SELECTED month — current = skip-adjusted reality; other = projection / actuals.
  const barStrikeLtv = isCurrent ? eomLtv
    : selectedEntry ? selectedEntry.strikeLtv
    : (selectedRow?.blocLtv ?? 0);
  const barCbLtv = isCurrent ? eomCbLtv
    : selectedEntry ? (selectedEntry.cbLtv ?? 0)
    : (selectedRow?.cbLtv ?? 0);

  // Action-row display values for the SELECTED month.
  const rowDrawUsd  = isCurrent ? effectiveDrawAmount : (selectedPlan?.blocDraw ?? 0);
  const rowBtcAmt   = isCurrent ? effectiveBtcAmount
    : selectedEntry ? selectedEntry.btcBought
    : (selectedPlan?.btcBought ?? 0);
  const rowBtcUsd   = isCurrent ? expectedBtcBuying
    : selectedEntry ? selectedEntry.btcBought * btcPrice
    : (selectedPlan?.btcBoughtUsd ?? 0);
  const rowInterest = isCurrent ? (currentRow?.blocInterest ?? 0) : (selectedRow?.blocInterest ?? 0);
  const rowCbPayUsd = isCurrent ? expectedCbPayment : (selectedPlan?.cbPayment ?? 0);
  // Strike minimum paid from income (>0 → income source; drives the narration + allocation row).
  const rowMinPayment = isCurrent ? effectiveMin : (selectedRow?.blocMinPayment ?? 0);

  // Income→BLOC paydown (Smart BLOC structure on the reality engine): current = skip-adjusted
  // expectedPaydown, selected = clean selectedPlan.paydown. Drives the conditional LoC Paydown row,
  // the Buy Bitcoin %/(after paydown) subtext, and the INCOME bar's paydown segment.
  const rowPaydownUsd = isCurrent ? expectedPaydown : (selectedPlan?.paydown ?? 0);
  const hasPaydown    = rowPaydownUsd > 0;
  const rowBuyPct     = income > 0 ? rowBtcUsd / income : 1;
  const rowPaydownPct = income > 0 ? rowPaydownUsd / income : 0;

  // Demoted "this month also" strip reads the SELECTED row's flags (scrubbing shows that month's alerts).
  const sCbTriggered = hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && !!selectedRow?.cbLtvTriggered;
  const sCapped      = sCbTriggered && !!selectedRow?.cbPaydownCapped;
  const sRepayFired  = hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && !!selectedRow?.strikeRepayFired;
  const sFiatGap     = isCurrent ? expectedFiatGap : (selectedRow?.fiatGap ?? 0);

  const summaryText = composeMonthSummary({
    month: selectedMonth, isCurrent, isLogged: !!selectedEntry, hasCbLoan,
    cbLtv: barCbLtv, triggerPct: cbLtvTriggerPct,
    draw: rowDrawUsd, btcBoughtUsd: rowBtcUsd, cbPayment: rowCbPayUsd,
    rotationFired: sRepayFired, rotationAmount: selectedRow?.strikeRepayDraw ?? 0,
    interest: rowInterest,
    minPayment: rowMinPayment,
    skipDraw: advisorSkipBlocDraw,
    skipBtc:  advisorSkipBtcBuying,
    skipCb:   advisorSkipCbPayment && cbPaymentStrategy === 'monthly',
    unallocated: Math.max(0, income - allocatedFromIncome),
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
  // NDP recording happens at log time via the confirm sheet (no stored intent flag)
  const [ndpPayThisMonth, setNdpPayThisMonth] = useState(false);

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
    setAdvisorActualBlocBalance(modalDraft.blocBalance);
    setAdvisorMonthStartBalance(modalDraft.monthStartBalance);
    // btcHeld edits are reality edits — a dated adjustment, never the baseline
    if (modalDraft.btcHeld !== useStore.getState().getCurrentBtcHeld()) {
      adjustCurrentCollateral(modalDraft.btcHeld);
    }
    setShowSetupModal(false);
  };

  const handleApply = (confirmedBtcBought: number) => {
    const [ey, em] = advisorStartDate.split('-').map(Number);
    const entryDate = toLocalISO(new Date(ey, em - 1 + (currentMonth - 1), 1));
    upsertLogEntry({
      month:          currentMonth,
      date:           entryDate,
      btcBought:      confirmedBtcBought,
      income:         currentRow?.incomeToBtc ?? 0,
      paydown:        expectedPaydown,
      strikeBal:      loggedStrikeBal,
      strikeLtv:      loggedStrikeLtv,
      ...(hasCbLoan ? { cbBal: currentRow?.cbBalance ?? 0, cbLtv: currentRow?.cbLtv ?? 0 } : {}),
      ...(ndpPayThisMonth && ndpActionActive ? { ndpPaid: ndpAmountPaid } : {}),
      ...(isIncomeSource ? { strikeMinPaid: effectiveInterest, strikeMinSource: 'income' as const } : { strikeMinSource: 'roll' as const }),
      loggedAt:       Date.now(),
      btcHeld:        0,
      expensesActual: effectiveDrawAmount,
    });
    // Re-anchor the store CB balance by this month's actual paydown (ltvTriggered → BLOC-funded
    // cbPaydownDraw, monthly → income-funded cbPayment). Liq price is NOT auto-updated (needs the
    // Coinbase oracle figure re-entered manually via the dashboard).
    const cbPaymentThisMonth = effectiveCbPayment;   // edited amount (defaults to the per-mode projection)
    if (hasCbLoan && cbPaymentThisMonth > 0) {
      const accrued = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
      setCbLoanBalance(Math.max(0, accrued - cbPaymentThisMonth));
      setCbLoanBalanceAsOf(todayLocalISO());
    }
    if (ndpPayThisMonth) {
      setNdpLastPaidDate(todayLocalISO());
    }
    // Income-source months: fresh statement each month + an external minimum IS a non-draw payment,
    // so stamp the NDP clock (keeps the annual window trivially fresh should the owner switch to roll).
    if (isIncomeSource) {
      setBlocStatementMinimum(null);
      setNdpLastPaidDate(todayLocalISO());
    }
    setNdpPayThisMonth(false);
    setEditingMin(false);
    setCustomBlocDraw(null);
    setCustomCbPayment(null);
    setCustomInterest(null);
    setCustomBtcBuying(null);
    setShowConfirmSheet(false);
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
              {currentEntry ? (
                <span className={`${styles.positionStat} ${currentEntry.btcBought > 0 ? styles.statGreen : styles.statMuted}`}>
                  Buy: ₿ {currentEntry.btcBought > 0 ? `+${currentEntry.btcBought.toFixed(5)}` : '—'}
                </span>
              ) : (
                <span className={`${styles.positionStat} ${!advisorSkipBtcBuying && effectiveBtcAmount > 0 ? styles.statGreen : styles.statMuted}`}>
                  Buy: ₿ {advisorSkipBtcBuying || effectiveBtcAmount <= 0 ? '—' : `+${effectiveBtcAmount.toFixed(5)}`}
                </span>
              )}
              {/* Draw anchors on the MONTH's total (matching the Buy line's basis); the remaining draw
                  is a parenthetical that counts down as the month's draws are logged. */}
              <span className={styles.positionStat}>
                Draw: {advisorSkipBlocDraw ? '—' : fmtUSD(effectiveDrawAmount)}
                {!advisorSkipBlocDraw && remainingDraw < effectiveDrawAmount && (
                  <span className={styles.parenSub}> ({fmtUSD(remainingDraw)} left)</span>
                )}
              </span>
              {/* Strike monthly minimum — shown in both source modes (income = paid; roll = capitalizes). */}
              <span className={styles.positionStat}>
                Min: {fmtUSD(blocStatementMinimum ?? strikeMinEstimate)}
                {isIncomeSource
                  ? <span className={`${styles.chip} ${blocStatementMinimum != null ? styles.chipStatement : styles.chipEst}`}>{blocStatementMinimum != null ? 'statement' : 'est.'}</span>
                  : <span className={styles.parenSub}> (rolls into balance)</span>}
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

          {/* Body — logged completion (current), else action rows (operate or preview) */}
          {isCurrent && isLogged ? (
            <div className={styles.loggedNote}>
              <span className={styles.loggedNoteIcon}>✓</span>
              <span className={styles.loggedNoteText}>
                Month {currentMonth} logged — {strategyDone ? 'year complete' : 'come back next month'}
              </span>
              <button className={styles.undoBtn} onClick={() => { setLogOverlayInitialMonth(currentMonth - 1); setLogOverlayOpen(true); }}>
                ✎ Edit this month
              </button>
              <button className={styles.undoBtn} onClick={() => deleteLogEntry(currentMonth)}>← Undo</button>
            </div>
          ) : (
            <>
              <div className={styles.dotRows}>
                {/* Buy Bitcoin */}
                <div className={styles.dotRow}>
                  <span className={`${styles.dot} ${styles.dotGreen}`} />
                  <div className={styles.dotLabelGroup}>
                    <span className={styles.dotLabel}>Buy Bitcoin</span>
                    <span className={styles.dotSub}>
                      {isCurrent && advisorSkipBtcBuying
                        ? 'skipped this month'
                        : `~${fmtUSD(rowBtcUsd)} ${hasPaydown ? '(after paydown)' : '(100% of income)'}`}
                    </span>
                  </div>
                  {isCurrent && (
                    <div className={styles.paySkipGroup}>
                      <button disabled={viewerMode} className={`${styles.actionPill} ${!advisorSkipBtcBuying ? styles.pillPay : ''}`} onClick={() => setAdvisorSkipBtcBuying(false)}>Pay</button>
                      <button disabled={viewerMode} className={`${styles.actionPill} ${advisorSkipBtcBuying ? styles.pillSkipActive : ''}`} onClick={() => setAdvisorSkipBtcBuying(true)}>Skip</button>
                    </div>
                  )}
                  <div className={styles.dotRightInner}>
                    {!(isCurrent && advisorSkipBtcBuying) && <span className={styles.dotPct}>{fmtPct(rowBuyPct)}</span>}
                    <span className={styles.dotAmount}>
                      {isCurrent && advisorSkipBtcBuying ? <span className={styles.skippedText}>Skipped</span> : `${rowBtcAmt.toFixed(5)} ₿`}
                    </span>
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
                    {isCurrent && (
                      <div className={styles.paySkipGroup}>
                        <button disabled={viewerMode} className={`${styles.actionPill} ${!advisorSkipBlocDraw ? styles.pillPay : ''}`} onClick={() => setAdvisorSkipBlocDraw(false)}>Pay</button>
                        <button disabled={viewerMode} className={`${styles.actionPill} ${advisorSkipBlocDraw ? styles.pillSkipActive : ''}`} onClick={() => setAdvisorSkipBlocDraw(true)}>Skip</button>
                      </div>
                    )}
                    <span className={styles.dotAmount}>
                      {isCurrent && advisorSkipBlocDraw ? <span className={styles.skippedText}>Skipped</span> : fmtUSD(rowDrawUsd)}
                    </span>
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
                    {isCurrent && (
                      <div className={styles.paySkipGroup}>
                        <button disabled={viewerMode} className={`${styles.actionPill} ${!advisorSkipCbPayment ? styles.pillPay : ''}`} onClick={() => setAdvisorSkipCbPayment(false)}>Pay</button>
                        <button disabled={viewerMode} className={`${styles.actionPill} ${advisorSkipCbPayment ? styles.pillSkipActive : ''}`} onClick={() => setAdvisorSkipCbPayment(true)}>Skip</button>
                      </div>
                    )}
                    <span className={styles.dotAmount}>
                      {isCurrent && advisorSkipCbPayment ? <span className={styles.skippedText}>Skipped</span> : fmtUSD(rowCbPayUsd)}
                    </span>
                  </div>
                )}

                {/* Strike minimum — income source only (roll mode carries it via the Interest row below) */}
                {isIncomeSource && rowMinPayment > 0 && (
                  <div className={styles.dotRow}>
                    <span className={`${styles.dot} ${styles.dotRed}`} />
                    <div className={styles.dotLabelGroup}>
                      <span className={styles.dotLabel}>Strike minimum · due the 15th</span>
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
                          <span className={`${styles.chip} ${isCurrent && blocStatementMinimum != null ? styles.chipStatement : styles.chipEst}`}>
                            {isCurrent && blocStatementMinimum != null ? 'statement' : 'est.'}
                          </span>
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
                        {ndpMinimum > 0 ? ` · ~${fmtUSD(ndpMinimum)} min` : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Log button — current month only (hidden for read-only viewers) */}
              {isCurrent && !strategyDone && !viewerMode && (
                <button
                  className={styles.logThisMonthBtn}
                  onClick={() => { setConfirmBtcBought(advisorSkipBtcBuying ? 0 : (currentRow?.btcBought ?? 0)); setNdpAmountPaid(ndpMinimum); setShowConfirmSheet(true); }}
                >
                  Log this month & continue
                </button>
              )}

              {/* Preview affordances — non-current months */}
              {!isCurrent && (
                <div className={styles.previewActions}>
                  {selectedEntry && !viewerMode && (
                    <button className={styles.previewEditBtn} onClick={() => { setLogOverlayInitialMonth(selectedMonth - 1); setLogOverlayOpen(true); }}>
                      ✎ Edit this month
                    </button>
                  )}
                  <button className={styles.backToCurrentBtn} onClick={() => setSelectedMonth(currentMonth)}>
                    ← Back to current month
                  </button>
                </div>
              )}
            </>
          )}

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

    {showConfirmSheet && (
      <ConfirmLogSheet
        monthNum={currentMonth}
        monthLabel={getMonthLabel(advisorStartDate, currentMonth)}
        drawAmount={effectiveDrawAmount}
        skipDraw={advisorSkipBlocDraw}
        onBlocDrawChange={setCustomBlocDraw}
        cbPayment={effectiveCbPayment}
        skipCb={advisorSkipCbPayment}
        showCbRow={showCbRow}
        cbRowLabel={cbPaymentStrategy === 'ltvTriggered' ? 'CB paydown' : 'CB payment'}
        onCbPaymentChange={setCustomCbPayment}
        btcPrice={btcPrice}
        skipBtc={advisorSkipBtcBuying}
        interest={effectiveInterest}
        onInterestChange={setCustomInterest}
        isIncomeSource={isIncomeSource}
        confirmBtcBought={confirmBtcBought}
        onBtcBoughtChange={setConfirmBtcBought}
        isFullyAllocated={isFullyAllocated}
        ndpDone={ndpPayThisMonth && ndpActionActive}
        ndpAmount={ndpAmountPaid}
        showNdpRow={ndpActionActive}
        ndpChecked={ndpPayThisMonth}
        onNdpChange={setNdpPayThisMonth}
        ndpAmountPaid={ndpAmountPaid}
        onNdpAmountChange={setNdpAmountPaid}
        onConfirm={() => handleApply(confirmBtcBought)}
        onCancel={() => setShowConfirmSheet(false)}
      />
    )}
    </>
  );
}
