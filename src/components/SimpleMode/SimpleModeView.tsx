import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth, isStrategyComplete, getTier, getNdpStatus, type AdvisorTier } from '../../simulation/runAdvisor';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { deriveAdvisorStart, computeExpenseReanchor } from '../../simulation/logUtils';
import { strikeAvailableCredit } from '../../simulation/strikeCredit';
import { classifyLtv } from '../../simulation/runCoinbaseLoan';
import { fmtUSD } from '../../utils/format';
import { MonthlyLogOverlay } from '../Advisor/MonthlyLogOverlay';
import { MonthlyLogSection } from '../Advisor/MonthlyLogSection';
import { OutlookProjection } from '../Advisor/OutlookProjection';
import { SafetyDashboard } from './SafetyDashboard';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import styles from './SimpleModeView.module.css';

interface SimpleModeViewProps {
  onOpenSettings: () => void;
}

function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function ConfirmLogSheet({
  monthNum, monthLabel,
  drawAmount, skipDraw,
  cbPayment, skipCb, hasCbLoan,
  btcPrice, skipBtc,
  confirmExpenses, onExpensesChange,
  confirmBtcBought, onBtcBoughtChange,
  isFullyAllocated,
  ndpDone, ndpAmount,
  showNdpRow, ndpChecked, onNdpChange,
  onConfirm, onCancel,
}: {
  monthNum: number; monthLabel: string;
  drawAmount: number; skipDraw: boolean;
  cbPayment: number; skipCb: boolean; hasCbLoan: boolean;
  btcPrice: number; skipBtc: boolean;
  confirmExpenses: number; onExpensesChange: (v: number) => void;
  confirmBtcBought: number; onBtcBoughtChange: (v: number) => void;
  isFullyAllocated: boolean;
  ndpDone: boolean; ndpAmount: number;
  showNdpRow?: boolean; ndpChecked?: boolean; onNdpChange?: (v: boolean) => void;
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
          <div className={styles.confirmRow}>
            <span>BLOC draw</span>
            <span>{skipDraw ? 'Skipped' : fmtUSD(drawAmount)}</span>
          </div>
          {hasCbLoan && (
            <div className={styles.confirmRow}>
              <span>CB payment</span>
              <span>{skipCb ? 'Skipped' : fmtUSD(cbPayment)}</span>
            </div>
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
            <span>Expenses this month</span>
            <div className={styles.confirmExpensesField}>
              <span className={styles.confirmExpensesPrefix}>$</span>
              <input
                type="number"
                className={styles.confirmExpensesInput}
                value={confirmExpenses}
                step={100}
                onChange={(e) => onExpensesChange(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
          {isFullyAllocated && (
            <div className={`${styles.confirmRow} ${styles.confirmRowAlloc}`}>
              Income fully allocated ✓
            </div>
          )}
          {showNdpRow && (
            <label className={styles.confirmRow}>
              <span>NDP payment made this month</span>
              <input
                type="checkbox"
                checked={!!ndpChecked}
                onChange={(e) => onNdpChange?.(e.target.checked)}
              />
            </label>
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

function ModalField({ label, prefix, value, onChange, step = 1 }: {
  label: string; prefix?: string; value: number;
  onChange: (v: number) => void; step?: number;
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
    </div>
  );
}

export function SimpleModeView({ onOpenSettings }: SimpleModeViewProps) {
  const income    = useStore((s) => s.income);
  const expenses  = useStore((s) => s.expenses);
  const btcPrice  = useStore((s) => s.btcPrice);
  const blocApr   = useStore((s) => s.blocApr);
  const creditLine = useStore((s) => s.creditLine);

  const cbLoanBalance      = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc    = useStore((s) => s.cbCollateralBtc);
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
  const setAdvisorSkipBlocDraw  = useStore((s) => s.setAdvisorSkipBlocDraw);
  const setAdvisorSkipCbPayment = useStore((s) => s.setAdvisorSkipCbPayment);
  const setAdvisorSkipBtcBuying = useStore((s) => s.setAdvisorSkipBtcBuying);
  const hasCbLoan            = useStore((s) => s.hasCbLoan);

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

  // Feature 2
  const [showTierTip, setShowTierTip] = useState(false);
  // Change 1 (iter 2) — setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalDraft, setModalDraft] = useState({
    income, expenses, creditLine,
    blocBalance: advisorActualBlocBalance,
    btcHeld: currentBtcHeld,
  });

  // Change 3 — custom amounts
  const [customBlocDraw,  setCustomBlocDraw]  = useState<number | null>(null);
  const [customBtcBuying, setCustomBtcBuying] = useState<number | null>(null); // stored as BTC
  // Confirm sheet
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);
  const [confirmExpenses, setConfirmExpenses]   = useState(expenses);
  const [confirmBtcBought, setConfirmBtcBought] = useState(0);
  // Monthly log overlay
  const [logOverlayOpen, setLogOverlayOpen]               = useState(false);
  const [logOverlayInitialMonth, setLogOverlayInitialMonth] = useState(0);
  // This Month (operating console) / Outlook (shared scenario projection)
  const [simpleSegment, setSimpleSegment] = useState<'thisMonth' | 'outlook'>('thisMonth');

  const currentMonth    = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone    = isStrategyComplete(advisorStartDate);
  const isLogged        = monthlyLog.some((e) => e.month === currentMonth);
  const collateralBtc   = getCollateralForTier(activeTier, expenses, btcPrice, currentBtcHeld);

  const { startingBlocBalance: slmBlocBal, startingBtcHeld: slmBtcHeld, startingMonth: slmStartMonth } = useMemo(
    () => deriveAdvisorStart(monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, currentMonth, pendingCollateralAdjustment),
    [monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, advisorStartDate, currentMonth, pendingCollateralAdjustment],
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
      }).rows;
      return rows;
    },
    [btcPrice, income, expenses, blocApr, creditLine,
     cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
     cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
     slmBlocBal, slmBtcHeld, slmStartMonth, hasCbLoan],
  );
  const currentCbLtv = cbCollateralBtc * btcPrice > 0
    ? cbLoanBalance / (cbCollateralBtc * btcPrice)
    : 0;
  const currentTier = getTier(currentCbLtv);
  const cbStatus    = classifyLtv(currentCbLtv);
  const ndp         = getNdpStatus(
    ndpLastPaidDate,
    advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * 0.15,
    blocApr,
  );

  const currentRow        = advisorRows.find((r) => r.month === currentMonth) ?? null;
  const nextRow           = advisorRows.find((r) => r.month === currentMonth + 1);   // month after current; undefined at Mo 12
  const { show: showReanchor, avg: reanchorAvg } = computeExpenseReanchor(monthlyLog, expenses, expenseReanchorDismissedAt);

  const expectedBlocDraw = currentTier === 1 ? 0
    : currentTier === 2
      ? Math.min(expenses * 0.5, Math.max(0, creditLine - advisorActualBlocBalance))
      : Math.min(expenses, Math.max(0, creditLine - advisorActualBlocBalance));
  const expectedFiatGap   = Math.max(0, expenses - expectedBlocDraw);
  const expectedCbPayment = advisorSkipCbPayment ? 0 : (currentRow?.cbPayment ?? 0);
  const expectedBtcBuying = advisorSkipBtcBuying ? 0
    : currentTier === 1 ? 0 : Math.max(0, income - expectedCbPayment);
  const showFiatRow = expectedFiatGap > 0;

  // Change 3 — effective amounts (override when user enters custom)
  const effectiveDrawAmount = customBlocDraw ?? expectedBlocDraw;

  // BTC buying: default is (income − CB payment) ÷ price; custom override stored as BTC
  const defaultBtcAmount =
    btcPrice > 0 ? Math.max(0, expectedBtcBuying / btcPrice) : 0;
  const effectiveBtcAmount    = customBtcBuying ?? defaultBtcAmount;

  const expectedPaydown    = currentRow
    ? Math.max(0, income - (hasCbLoan ? currentRow.cbPayment : 0) - currentRow.incomeToBtc)
    : 0;

  // True end-of-month projections from AdvisorMonthRow + skip flags
  const eomBlocBalance: number = currentRow
    ? slmBlocBal + (advisorSkipBlocDraw ? 0 : currentRow.blocDraw) + currentRow.blocInterest - expectedPaydown
    : advisorActualBlocBalance;
  const eomBtcHeld: number = slmBtcHeld + (advisorSkipBtcBuying ? 0 : (currentRow?.btcBought ?? 0));
  const eomLtv: number     = eomBtcHeld * btcPrice > 0 ? eomBlocBalance / (eomBtcHeld * btcPrice) : 0;
  const availCredit        = strikeAvailableCredit(creditLine, eomBtcHeld, btcPrice, eomBlocBalance);

  // Change 2 — THIS MONTH column: actuals from the log entry when logged, projections otherwise
  const currentEntry = monthlyLog.find((e) => e.month === currentMonth);
  const ndpMinimum = advisorActualBlocBalance > 0
    ? advisorActualBlocBalance * (blocApr / 100 / 12)
    : 0;

  const allocatedFromIncome = expectedPaydown
    + (advisorSkipBtcBuying ? 0 : expectedBtcBuying)
    + (hasCbLoan && cbPaymentStrategy === 'monthly' && !advisorSkipCbPayment ? expectedCbPayment : 0);

  const cbPaydownBuffer    = hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
    ? Math.max(0, cbLoanBalance - cbCollateralBtc * btcPrice * (cbLtvTargetPct / 100))
    : 0;
  const cbBufferAffordable = cbPaydownBuffer <= Math.max(0, creditLine - advisorActualBlocBalance);
  const isFullyAllocated   = income > 0 && Math.abs(income - allocatedFromIncome) < 1;
  const tierStatusText: Record<AdvisorTier, string> = {
    4: 'SAFE', 3: 'WATCH', 2: 'WARNING', 1: 'EMERGENCY',
  };

  const ndpActionActive = ndp.status !== 'ok';
  // NDP recording happens at log time via the confirm sheet (no stored intent flag)
  const [ndpPayThisMonth, setNdpPayThisMonth] = useState(false);

  const tierBadgeClass = styles[`tier${currentTier}`];
  const cardTierClass  = styles[`cardTier${currentTier}`];

  const isDefaultSetup = income === 5000 && expenses === 4000 && advisorActualBlocBalance === 0;

  const tierTip: Record<AdvisorTier, string> = {
    4: 'Safe — full BTC buying strategy active',
    3: 'Watch — CB LTV elevated, extra payment directed there',
    2: 'Warning — BLOC draw halved, 50% income to CB paydown',
    1: 'Emergency — stop BLOC draws, all income to CB paydown',
  };

  const openSetupModal = () => {
    setModalDraft({ income, expenses, creditLine, blocBalance: advisorActualBlocBalance, btcHeld: currentBtcHeld });
    setShowSetupModal(true);
  };

  const handleSaveSetup = () => {
    setIncome(modalDraft.income);
    setExpenses(modalDraft.expenses);
    setCreditLine(modalDraft.creditLine);
    setAdvisorActualBlocBalance(modalDraft.blocBalance);
    // btcHeld edits are reality edits — a dated adjustment, never the baseline
    if (modalDraft.btcHeld !== useStore.getState().getCurrentBtcHeld()) {
      adjustCurrentCollateral(modalDraft.btcHeld);
    }
    setShowSetupModal(false);
  };

  const handleApply = (confirmedExpenses: number, confirmedBtcBought: number) => {
    const [ey, em] = advisorStartDate.split('-').map(Number);
    const entryDate = new Date(ey, em - 1 + (currentMonth - 1), 1).toISOString().split('T')[0];
    upsertLogEntry({
      month:          currentMonth,
      date:           entryDate,
      btcBought:      confirmedBtcBought,
      income:         currentRow?.incomeToBtc ?? 0,
      paydown:        expectedPaydown,
      strikeBal:      eomBlocBalance,
      strikeLtv:      eomLtv,
      ...(hasCbLoan ? { cbBal: currentRow?.cbBalance ?? 0, cbLtv: currentRow?.cbLtv ?? 0 } : {}),
      loggedAt:       Date.now(),
      btcHeld:        0,
      expensesActual: confirmedExpenses,
    });
    // Re-anchor the store CB balance by this month's actual paydown (ltvTriggered → BLOC-funded
    // cbPaydownDraw, monthly → income-funded cbPayment). Liq price is NOT auto-updated (needs the
    // Coinbase oracle figure re-entered manually via the dashboard).
    const cbPaymentThisMonth = cbPaymentStrategy === 'ltvTriggered'
      ? (currentRow?.cbPaydownDraw ?? 0)
      : (currentRow?.cbPayment ?? 0);
    if (hasCbLoan && cbPaymentThisMonth > 0) {
      const accrued = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
      setCbLoanBalance(Math.max(0, accrued - cbPaymentThisMonth));
      setCbLoanBalanceAsOf(new Date().toISOString().split('T')[0]);
    }
    if (ndpPayThisMonth) {
      setNdpLastPaidDate(new Date().toISOString().split('T')[0]);
    }
    setNdpPayThisMonth(false);
    setCustomBlocDraw(null);
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
          <button className={styles.settingsBtn} onClick={onOpenSettings} title="Settings">
            ⚙
          </button>
        </div>
      </div>

      <SafetyDashboard />

      {!strategyDone && (
        <div className={styles.progressRow}>
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              className={`${styles.progressDot} ${
                i + 1 < currentMonth  ? styles.dotDone :
                i + 1 === currentMonth ? styles.dotCurrent :
                                          styles.dotFuture
              }`}
            />
          ))}
          <span className={styles.progressLabel}>Month {currentMonth} of 12</span>
        </div>
      )}

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
          />
        </div>
      )}

      {(strategyDone || simpleSegment === 'thisMonth') && (
      <div className={styles.cards}>

        {/* Position card */}
        <div className={styles.card}>
          <div className={styles.positionRow}>

            {/* Left — STRIKE BLOC */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>STRIKE BLOC</span>
              <span className={styles.positionStat}>
                {fmtUSD(eomBlocBalance)}<span className={styles.projectedLabel}> end of mo</span>
              </span>
              <span className={styles.positionStat}>LTV: {(eomLtv * 100).toFixed(1)}%</span>
              <span className={styles.positionStat}>₿ {eomBtcHeld.toFixed(5)}</span>
              <span className={styles.positionStat}>Avail: {fmtUSD(availCredit.available)}</span>
              <span className={styles.positionStatHint} style={{ color: availCredit.binding === 'collateral' ? 'var(--amber)' : 'var(--text-ghost)' }}>
                {availCredit.binding === 'line'
                  ? `fully backed above ${fmtUSD(availCredit.fullyBackedPrice)}`
                  : 'collateral-limited (50% LTV)'}
              </span>
              {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && (
                <>
                  <span className={styles.positionStat} style={{ color: cbBufferAffordable ? 'var(--green)' : 'var(--red)' }}>
                    CB buffer: {fmtUSD(cbPaydownBuffer)}
                  </span>
                  <span className={styles.positionStatHint}>to reach {cbLtvTargetPct}% LTV</span>
                </>
              )}
              {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && currentRow?.strikeRepayFired && (
                <span className={styles.positionStatHint} style={{ color: 'var(--green)' }}>
                  ↩ Rotation ready — shift to the cheaper CB loan
                </span>
              )}
              <span className={`${styles.ndpBadge} ${styles[`ndp_${ndp.status}`]}`}>
                {ndp.status === 'never'    && 'NDP — not recorded'}
                {ndp.status === 'ok'       && `NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'upcoming' && `⚠ NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'soon'     && `⚠ NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'overdue'  && '⛔ NDP overdue'}
              </span>
            </div>

            {/* Center — THIS MONTH: entry actuals when logged, (proj)-labeled projections otherwise */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>THIS MONTH</span>
              {currentEntry ? (
                <>
                  <span className={`${styles.positionStat} ${currentEntry.btcBought > 0 ? styles.statGreen : styles.statMuted}`}>
                    ₿ {currentEntry.btcBought > 0 ? `+${currentEntry.btcBought.toFixed(5)}` : '—'}
                  </span>
                  <span className={`${styles.positionStat} ${styles.statMuted}`}>Cash: —</span>
                </>
              ) : (
                <>
                  <span className={`${styles.positionStat} ${!advisorSkipBtcBuying && effectiveBtcAmount > 0 ? styles.statGreen : styles.statMuted}`}>
                    ₿ {advisorSkipBtcBuying || effectiveBtcAmount <= 0 ? '—' : `+${effectiveBtcAmount.toFixed(5)}`}
                    <span className={styles.projSuffix}> (proj)</span>
                  </span>
                  <span className={`${styles.positionStat} ${expectedBtcBuying > 0 ? styles.statAmber : styles.statMuted}`}>
                    Cash: {expectedBtcBuying > 0 ? fmtUSD(expectedBtcBuying) : '—'}
                    <span className={styles.projSuffix}> (proj)</span>
                  </span>
                </>
              )}
            </div>

            {/* Right — CB LOAN */}
            {hasCbLoan && cbLoanBalance > 0 && (
              <div className={styles.positionCol}>
                <span className={styles.positionTitle}>CB LOAN</span>
                <span className={styles.positionStat}>
                  LTV: {(currentCbLtv * 100).toFixed(1)}%
                </span>
                <span className={`${styles.cbBadge} ${styles[`cb_${cbStatus}`]}`}>
                  {cbStatus.toUpperCase()}
                </span>
              </div>
            )}
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

        {/* Plan / completion card */}
        {isLogged ? (
          <div className={`${styles.card} ${styles.cardDone}`}>
            <div className={styles.doneIcon}>✓</div>
            <h3 className={styles.doneTitle}>Month {currentMonth} logged ✓</h3>
            <p className={styles.doneSub}>
              {strategyDone
                ? 'Year complete — update your start date in Settings to begin Year 2'
                : `Come back next month`
              }
            </p>
            <button
              className={styles.undoBtn}
              onClick={() => deleteLogEntry(currentMonth)}
            >
              ← Undo
            </button>
          </div>
        ) : (
          <div className={`${styles.card} ${cardTierClass}`}>
            {/* Header */}
            <div className={styles.planTitleRow}>
              <div>
                <h3 className={styles.planTitle}>Month {currentMonth} — This Month's Plan</h3>
                <div className={styles.planSubtitle}>
                  BLOC: {fmtUSD(eomBlocBalance)} · BTC: {eomBtcHeld.toFixed(5)}
                </div>
              </div>
              <button
                className={`${styles.tierBadgeFull} ${hasCbLoan && cbPaymentStrategy === 'ltvTriggered' ? styles.tier4 : tierBadgeClass}`}
                onClick={() => setShowTierTip((v) => !v)}
              >
                {hasCbLoan && cbPaymentStrategy === 'ltvTriggered'
                  ? `LTV-TRIGGERED — ${cbLtvTriggerPct}% TRIGGER / ${cbLtvTargetPct}% TARGET`
                  : `TIER ${currentTier} — ${tierStatusText[currentTier]}`}
              </button>
            </div>
            {showTierTip && (
              <p className={styles.tierTip}>
                {hasCbLoan ? tierTip[currentTier] : 'BLOC strategy running normally'}
              </p>
            )}

            {/* Section 1: FROM CREDIT LINE */}
            {expectedBlocDraw > 0 && (
              <div className={styles.planSection}>
                <div className={styles.sectionLabelRow}>
                  <span className={styles.sectionLabel}>FROM CREDIT LINE</span>
                </div>
                <div className={styles.actionRow}>
                  <span className={styles.actionIcon}>▤</span>
                  <div className={styles.actionLabelGroup}>
                    <span className={styles.actionLabel}>Draw from BLOC</span>
                    <span className={styles.actionSub}>covers monthly expenses</span>
                  </div>
                  <span className={styles.actionAmount}>
                    {advisorSkipBlocDraw ? <span className={styles.skippedText}>Skipped</span> : fmtUSD(effectiveDrawAmount)}
                  </span>
                  <div className={styles.paySkipGroup}>
                    <button
                      className={`${styles.actionPill} ${!advisorSkipBlocDraw ? styles.pillPay : ''}`}
                      onClick={() => setAdvisorSkipBlocDraw(false)}
                    >Pay</button>
                    <button
                      className={`${styles.actionPill} ${advisorSkipBlocDraw ? styles.pillSkipActive : ''}`}
                      onClick={() => setAdvisorSkipBlocDraw(true)}
                    >Skip</button>
                  </div>
                </div>
                {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && currentRow?.cbLtvTriggered && (
                  <div className={styles.actionRow}>
                    <span className={styles.actionIcon}>⚠</span>
                    <div className={styles.actionLabelGroup}>
                      <span className={styles.actionLabel}>CB LTV alert — draw from BLOC to pay down CB</span>
                    </div>
                    <span className={styles.actionAmount} style={{ color: 'var(--amber)' }}>
                      {fmtUSD(currentRow.cbPaydownDraw)}
                    </span>
                  </div>
                )}
                {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && currentRow?.cbLtvTriggered && currentRow.cbPaydownCapped && (
                  <div className={styles.actionRow}>
                    <span className={styles.actionIcon}>⚠</span>
                    <div className={styles.actionLabelGroup}>
                      <span className={styles.actionLabel} style={{ color: 'var(--amber)' }}>
                        Paydown capped — Strike credit line reached · {fmtUSD(currentRow.cbPaydownShortfall)} shortfall
                      </span>
                    </div>
                  </div>
                )}
                {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && currentRow?.strikeRepayFired && (
                  <div className={styles.actionRow} style={{ color: 'var(--green)' }}>
                    <span className={styles.actionIcon}>↩</span>
                    <div className={styles.actionLabelGroup}>
                      <span className={styles.actionLabel}>Rotate to cheap debt — Strike repaid</span>
                      <span className={styles.actionSub}>saves ~{fmtUSD(currentRow.strikeRepayDraw * (blocApr - cbAprPct) / 100)}/yr</span>
                    </div>
                    <span className={styles.actionAmount}>{fmtUSD(currentRow.strikeRepayDraw)}</span>
                  </div>
                )}
                {showFiatRow && (
                  <div className={styles.actionRow}>
                    <span className={styles.actionIcon}>≡</span>
                    <div className={styles.actionLabelGroup}>
                      <span className={styles.actionLabel}>Cover from savings</span>
                      <span className={styles.actionSub}>
                        {advisorSkipBlocDraw
                          ? '(BLOC draw skipped)'
                          : hasCbLoan && cbPaymentStrategy === 'monthly' && (currentTier === 1 || currentTier === 2)
                            ? '(BLOC draw limited by CB priority rules)'
                            : '(credit line fully drawn)'}
                      </span>
                    </div>
                    <span className={styles.actionAmount}>{fmtUSD(expectedFiatGap)}</span>
                  </div>
                )}
                {ndpActionActive && (
                  <div className={styles.actionRow}>
                    <span className={styles.actionIcon}>⚡</span>
                    <div className={styles.actionLabelGroup}>
                      <span className={styles.actionLabel}>
                        {ndp.status === 'never'
                          ? '⚠ Non-draw payment — not yet recorded'
                          : ndp.status === 'overdue'
                            ? '⚠ NDP overdue — pay Strike now'
                            : `⚠ Non-draw payment due in ${ndp.daysRemaining}d`}
                      </span>
                      {ndpMinimum > 0 && <span className={styles.actionSub}>~{fmtUSD(ndpMinimum)} minimum</span>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Section 2: FROM MONTHLY INCOME */}
            <div className={styles.planSection}>
              <div className={styles.sectionLabelRow}>
                <span className={styles.sectionLabel}>FROM MONTHLY INCOME</span>
                <span className={styles.sectionIncome}>{fmtUSD(income)}/mo</span>
              </div>
              {expectedPaydown > 0 && (
                <div className={styles.actionRow}>
                  <span className={styles.actionIcon}>⚡</span>
                  <div className={styles.actionLabelGroup}>
                    <span className={styles.actionLabel}>BLOC paydown (LTV triggered)</span>
                  </div>
                  <span className={styles.actionAmount}>{fmtUSD(expectedPaydown)}</span>
                </div>
              )}
              {hasCbLoan && cbPaymentStrategy === 'monthly' && (
                <div className={styles.actionRow}>
                  <span className={styles.actionIcon}>◎</span>
                  <div className={styles.actionLabelGroup}>
                    <span className={styles.actionLabel}>Pay CB Loan</span>
                  </div>
                  <span className={styles.actionAmount}>
                    {advisorSkipCbPayment ? <span className={styles.skippedText}>Skipped</span> : fmtUSD(expectedCbPayment)}
                  </span>
                  <div className={styles.paySkipGroup}>
                    <button
                      className={`${styles.actionPill} ${!advisorSkipCbPayment ? styles.pillPay : ''}`}
                      onClick={() => setAdvisorSkipCbPayment(false)}
                    >Pay</button>
                    <button
                      className={`${styles.actionPill} ${advisorSkipCbPayment ? styles.pillSkipActive : ''}`}
                      onClick={() => setAdvisorSkipCbPayment(true)}
                    >Skip</button>
                  </div>
                </div>
              )}
              <div className={styles.actionRow}>
                <span className={styles.actionIcon}>₿</span>
                <div className={styles.actionLabelGroup}>
                  <span className={styles.actionLabel}>Buy Bitcoin</span>
                  <span className={styles.actionSub}>→ ~{fmtUSD(expectedBtcBuying)} est.</span>
                </div>
                <span className={styles.actionAmount}>
                  {advisorSkipBtcBuying ? <span className={styles.skippedText}>Skipped</span> : `${effectiveBtcAmount.toFixed(5)} ₿`}
                </span>
                <div className={styles.paySkipGroup}>
                  <button
                    className={`${styles.actionPill} ${!advisorSkipBtcBuying ? styles.pillPay : ''}`}
                    onClick={() => setAdvisorSkipBtcBuying(false)}
                  >Pay</button>
                  <button
                    className={`${styles.actionPill} ${advisorSkipBtcBuying ? styles.pillSkipActive : ''}`}
                    onClick={() => setAdvisorSkipBtcBuying(true)}
                  >Skip</button>
                </div>
              </div>
            </div>

            {/* Income allocated banner */}
            <div className={`${styles.incomeAllocBanner} ${isFullyAllocated ? styles.allocGreen : styles.allocAmber}`}>
              <span className={styles.allocLabel}>Income allocated:</span>
              <span className={`${styles.allocValue} ${isFullyAllocated ? styles.allocValueGreen : styles.allocValueAmber}`}>
                {fmtUSD(allocatedFromIncome)} of {fmtUSD(income)}{isFullyAllocated ? ' ✓' : ''}
              </span>
            </div>

            {!strategyDone && (
              <button
                className={styles.logThisMonthBtn}
                onClick={() => { setConfirmExpenses(expenses); setConfirmBtcBought(advisorSkipBtcBuying ? 0 : (currentRow?.btcBought ?? 0)); setShowConfirmSheet(true); }}
              >
                Log this month & continue
              </button>
            )}
          </div>
        )}

        {/* Next-month preview (§8) */}
        {!strategyDone && nextRow && (
          <p className={styles.nextMonthPreview}>
            Next month: draw ~{fmtUSD(nextRow.blocDraw)} · buy ~{nextRow.btcBought.toFixed(5)} ₿
          </p>
        )}

        {/* Monthly Log section */}
        <MonthlyLogSection
          allowInlineLog={false}
          months={advisorRows}
          onOpenOverlay={(idx) => {
            setLogOverlayInitialMonth(idx);
            setLogOverlayOpen(true);
          }}
        />

        {/* Change 1 (iter 2) — setup prompt + modal (always reachable; first-run copy when defaults) */}
        <>
            <button className={styles.setupPrompt} onClick={openSetupModal}>
              {isDefaultSetup ? '⚙ Set up your numbers to personalize this plan' : '⚙ Edit your numbers'}
            </button>

            {showSetupModal && (
              <div className={styles.modalOverlay} onClick={() => setShowSetupModal(false)}>
                <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                  <h3 className={styles.modalTitle}>Quick Setup</h3>
                  <div className={styles.modalFields}>
                    <ModalField label="Monthly income"   prefix="$" value={modalDraft.income}      onChange={(v) => setModalDraft(d => ({ ...d, income: v }))} />
                    <ModalField label="Monthly expenses" prefix="$" value={modalDraft.expenses}    onChange={(v) => setModalDraft(d => ({ ...d, expenses: v }))} />
                    <ModalField label="Credit line"      prefix="$" value={modalDraft.creditLine}  onChange={(v) => setModalDraft(d => ({ ...d, creditLine: v }))} />
                    <ModalField label="Amount Drawn"      prefix="$" value={modalDraft.blocBalance} onChange={(v) => setModalDraft(d => ({ ...d, blocBalance: v }))} />
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
        onClose={() => setLogOverlayOpen(false)}
      />
    )}

    {showConfirmSheet && (
      <ConfirmLogSheet
        monthNum={currentMonth}
        monthLabel={getMonthLabel(advisorStartDate, currentMonth)}
        drawAmount={effectiveDrawAmount}
        skipDraw={advisorSkipBlocDraw}
        cbPayment={expectedCbPayment}
        skipCb={advisorSkipCbPayment}
        hasCbLoan={hasCbLoan}
        btcPrice={btcPrice}
        skipBtc={advisorSkipBtcBuying}
        confirmExpenses={confirmExpenses}
        onExpensesChange={setConfirmExpenses}
        confirmBtcBought={confirmBtcBought}
        onBtcBoughtChange={setConfirmBtcBought}
        isFullyAllocated={isFullyAllocated}
        ndpDone={ndpPayThisMonth && ndpActionActive}
        ndpAmount={ndpMinimum}
        showNdpRow={ndpActionActive}
        ndpChecked={ndpPayThisMonth}
        onNdpChange={setNdpPayThisMonth}
        onConfirm={() => handleApply(confirmExpenses, confirmBtcBought)}
        onCancel={() => setShowConfirmSheet(false)}
      />
    )}
    </>
  );
}
