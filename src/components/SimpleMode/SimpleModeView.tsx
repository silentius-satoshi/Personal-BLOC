import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth, isStrategyComplete, getTier, getNdpStatus, type AdvisorTier } from '../../simulation/runAdvisor';
import { getCollateralForTier } from '../../simulation/runBlocYearOne';
import { deriveAdvisorStart } from '../../simulation/logUtils';
import { classifyLtv } from '../../simulation/runCoinbaseLoan';
import { fmtUSD } from '../../utils/format';
import { MonthlyLogOverlay } from '../Advisor/MonthlyLogOverlay';
import { MonthlyLogSection, type MonthlyLogSectionHandle } from '../Advisor/MonthlyLogSection';
import styles from './SimpleModeView.module.css';

interface SimpleModeViewProps {
  onOpenSettings: () => void;
}

function SimpleModeCheckItem({ checked, onChange, label, amount, animating, editableAmount, defaultAmount, onAmountSave }: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; amount: string; animating?: boolean;
  editableAmount?: boolean; defaultAmount?: number; onAmountSave?: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <label className={`${styles.checkItem} ${checked ? styles.checkItemDone : ''} ${animating ? styles.checkItemPop : ''}`}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.checkLabel}>{label}</span>
      <span className={styles.checkAmount}>
        {editableAmount && editing ? (
          <input
            type="number"
            className={styles.amountInput}
            defaultValue={defaultAmount}
            autoFocus
            onClick={(e) => e.preventDefault()}
            onBlur={(e) => { onAmountSave?.(parseFloat(e.target.value) || 0); setEditing(false); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { onAmountSave?.(parseFloat((e.target as HTMLInputElement).value) || 0); setEditing(false); }
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : editableAmount ? (
          <span className={styles.editableCheckAmount} onClick={(e) => { e.preventDefault(); setEditing(true); }}>
            {amount}
          </span>
        ) : (
          amount
        )}
      </span>
    </label>
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
  const cbLtvTriggerPct    = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct     = useStore((s) => s.cbLtvTargetPct);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);
  const setAdvisorActualBtcHeld     = useStore((s) => s.setAdvisorActualBtcHeld);
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const advisorChecklist            = useStore((s) => s.advisorChecklist);
  const setAdvisorChecklist         = useStore((s) => s.setAdvisorChecklist);
  const ndpLastPaidDate             = useStore((s) => s.ndpLastPaidDate);
  const setNdpLastPaidDate          = useStore((s) => s.setNdpLastPaidDate);

  const advisorSkipBlocDraw  = useStore((s) => s.advisorSkipBlocDraw);
  const advisorSkipCbPayment = useStore((s) => s.advisorSkipCbPayment);
  const advisorSkipBtcBuying = useStore((s) => s.advisorSkipBtcBuying);
  const setAdvisorSkipBlocDraw  = useStore((s) => s.setAdvisorSkipBlocDraw);
  const setAdvisorSkipCbPayment = useStore((s) => s.setAdvisorSkipCbPayment);
  const setAdvisorSkipBtcBuying = useStore((s) => s.setAdvisorSkipBtcBuying);
  const hasCbLoan            = useStore((s) => s.hasCbLoan);

  const btcBuyingUnit    = useStore((s) => s.btcBuyingUnit);
  const setBtcBuyingUnit = useStore((s) => s.setBtcBuyingUnit);

  const setSimpleMode = useStore((s) => s.setSimpleMode);

  const setIncome     = useStore((s) => s.setIncome);
  const setExpenses   = useStore((s) => s.setExpenses);
  const setCreditLine = useStore((s) => s.setCreditLine);

  const activeTier       = useStore((s) => s.activeTier);
  const cbAprPct         = useStore((s) => s.cbAprPct);
  const monthlyLog       = useStore((s) => s.monthlyLog);

  // Feature 2
  const [showTierTip, setShowTierTip] = useState(false);
  // Feature 5
  const [justChecked, setJustChecked] = useState<string | null>(null);
  // Feature 6
  const [showMonthBanner, setShowMonthBanner] = useState(false);
  const prevMonth = useRef<number | null>(null);
  // Change 1 (iter 2) — setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [modalDraft, setModalDraft] = useState({
    income, expenses, creditLine,
    blocBalance: advisorActualBlocBalance,
    btcHeld: advisorActualBtcHeld,
  });
  const SATS_PER_BTC = 100_000_000;

  // Change 3 — custom amounts
  const [customBlocDraw,  setCustomBlocDraw]  = useState<number | null>(null);
  const [customBtcBuying, setCustomBtcBuying] = useState<number | null>(null); // stored as BTC
  // Change 4 — one-shot apply
  const [projectionApplied, setProjectionApplied] = useState(false);
  // Monthly log overlay
  const [logOverlayOpen, setLogOverlayOpen]               = useState(false);
  const [logOverlayInitialMonth, setLogOverlayInitialMonth] = useState(0);
  const logSectionRef    = useRef<MonthlyLogSectionHandle>(null);
  const logSectionDivRef = useRef<HTMLDivElement>(null);

  const currentMonth    = getCurrentStrategyMonth(advisorStartDate);
  const strategyDone    = isStrategyComplete(advisorStartDate);
  const collateralBtc   = getCollateralForTier(activeTier, expenses, btcPrice, advisorActualBtcHeld);

  const { startingBlocBalance: slmBlocBal, startingBtcHeld: slmBtcHeld, startingMonth: slmStartMonth } = useMemo(
    () => deriveAdvisorStart(monthlyLog, advisorActualBtcHeld || collateralBtc, advisorActualBlocBalance, currentMonth),
    [monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, advisorStartDate, collateralBtc, currentMonth],
  );

  const advisorRows = useMemo(
    () => {
      const rows = runAdvisor({
        btcPrice, income, expenses,
        blocApr, creditLine, collateralBtc, blocLtvCeiling: 0.15,
        cbBalance:        hasCbLoan ? cbLoanBalance    : 0,
        cbCollateralBtc:  hasCbLoan ? cbCollateralBtc  : 1,
        cbAprPct:         hasCbLoan ? cbAprPct         : 0,
        cbMonthlyPayment:  hasCbLoan ? cbMonthlyPayment  : 0,
        cbPaymentStrategy: hasCbLoan ? cbPaymentStrategy : 'monthly',
        cbLtvTriggerPct,
        cbLtvTargetPct,
        startingBlocBalance: slmBlocBal,
        startingBtcHeld:     slmBtcHeld,
        startingMonth:       slmStartMonth,
        btcGrowthRate: 0,
      }).rows;
      return rows;
    },
    [btcPrice, income, expenses, blocApr, creditLine, collateralBtc,
     cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
     cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct,
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
  const btcBuyingUsdEquivalent = effectiveBtcAmount * btcPrice;
  const btcBuyingDisplayValue  =
    btcBuyingUnit === 'sats'
      ? Math.round(effectiveBtcAmount * SATS_PER_BTC)
      : effectiveBtcAmount;

  const btcAccumulatedThisMonth = advisorChecklist.btcBuying && effectiveBtcAmount > 0
    ? effectiveBtcAmount
    : 0;

  const expectedPaydown    = currentRow
    ? Math.max(0, income - (hasCbLoan ? currentRow.cbPayment : 0) - currentRow.incomeToBtc)
    : 0;

  // True end-of-month projections from AdvisorMonthRow + skip flags
  const eomBlocBalance: number = currentRow
    ? slmBlocBal + (advisorSkipBlocDraw ? 0 : currentRow.blocDraw) + currentRow.blocInterest - expectedPaydown
    : advisorActualBlocBalance;
  const eomBtcHeld: number = slmBtcHeld + (advisorSkipBtcBuying ? 0 : (currentRow?.btcBought ?? 0));
  const eomLtv: number     = eomBtcHeld * btcPrice > 0 ? eomBlocBalance / (eomBtcHeld * btcPrice) : 0;

  const hasProjection =
    Math.abs(eomBlocBalance - advisorActualBlocBalance) > 0.01 ||
    Math.abs(eomBtcHeld - slmBtcHeld) > 1e-9;

  // Change 2 — THIS MONTH column
  const cashBalanceThisMonth = advisorChecklist.btcBuying ? 0 : expectedBtcBuying;
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

  const totalItems = (showFiatRow ? 1 : 0) + (hasCbLoan ? 1 : 0) + 2;
  const doneCount  = [
    advisorChecklist.blocDraw,
    showFiatRow && advisorChecklist.fiatCoverage,
    hasCbLoan && advisorChecklist.cbPayment,
    advisorChecklist.btcBuying,
  ].filter(Boolean).length;
  const allDone = doneCount === totalItems;

  const tierBadgeClass = styles[`tier${currentTier}`];
  const cardTierClass  = styles[`cardTier${currentTier}`];

  const isDefaultSetup = income === 5000 && expenses === 4000 && advisorActualBlocBalance === 0;

  const tierTip: Record<AdvisorTier, string> = {
    4: 'Safe — full BTC buying strategy active',
    3: 'Watch — CB LTV elevated, extra payment directed there',
    2: 'Warning — BLOC draw halved, 50% income to CB paydown',
    1: 'Emergency — stop BLOC draws, all income to CB paydown',
  };

  // Feature 6 — new month banner
  useEffect(() => {
    if (prevMonth.current !== null && prevMonth.current !== advisorChecklist.month) {
      setShowMonthBanner(true);
      const t = setTimeout(() => setShowMonthBanner(false), 4000);
      return () => clearTimeout(t);
    }
    prevMonth.current = advisorChecklist.month;
  }, [advisorChecklist.month]);

  // Change 4 — reset applied flag when checklist or custom amounts change
  useEffect(() => {
    setProjectionApplied(false);
  }, [advisorChecklist.blocDraw, advisorChecklist.btcBuying, customBlocDraw, customBtcBuying]);

  // Change 4 — auto-dismiss confirmation after 2s
  useEffect(() => {
    if (!projectionApplied) return;
    const t = setTimeout(() => setProjectionApplied(false), 2000);
    return () => clearTimeout(t);
  }, [projectionApplied]);

  const fireCheck = (key: string, patch: Parameters<typeof setAdvisorChecklist>[0], value: boolean) => {
    if (value) {
      setJustChecked(key);
      setTimeout(() => setJustChecked(null), 350);
    }
    setAdvisorChecklist(patch);
  };

  const openSetupModal = () => {
    setModalDraft({ income, expenses, creditLine, blocBalance: advisorActualBlocBalance, btcHeld: advisorActualBtcHeld });
    setShowSetupModal(true);
  };

  const handleSaveSetup = () => {
    setIncome(modalDraft.income);
    setExpenses(modalDraft.expenses);
    setCreditLine(modalDraft.creditLine);
    setAdvisorActualBlocBalance(modalDraft.blocBalance);
    setAdvisorActualBtcHeld(modalDraft.btcHeld);
    setShowSetupModal(false);
  };

  const handleBtcBuyingChange = (raw: string) => {
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) { setCustomBtcBuying(null); return; }
    setCustomBtcBuying(btcBuyingUnit === 'sats' ? n / SATS_PER_BTC : n);
  };

  const handleApply = () => {
    setAdvisorActualBlocBalance(eomBlocBalance);
    if (Math.abs(eomBtcHeld - slmBtcHeld) > 1e-9) setAdvisorActualBtcHeld(eomBtcHeld);
    if (advisorChecklist.ndpPayment) {
      setNdpLastPaidDate(new Date().toISOString().split('T')[0]);
    }
    setCustomBlocDraw(null);
    setCustomBtcBuying(null);
    setProjectionApplied(true);
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

      {/* Feature 6 — new month banner */}
      {showMonthBanner && (
        <div className={styles.newMonthBanner}>
          ✦ New month — here's your plan for{' '}
          {new Date().toLocaleDateString('en-US', { month: 'long' })}
        </div>
      )}

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
              <span className={styles.positionStat}>Avail: {fmtUSD(Math.max(0, creditLine - eomBlocBalance))}</span>
              {hasCbLoan && cbPaymentStrategy === 'ltvTriggered' && (
                <>
                  <span className={styles.positionStat} style={{ color: cbBufferAffordable ? 'var(--green)' : 'var(--red)' }}>
                    CB buffer: {fmtUSD(cbPaydownBuffer)}
                  </span>
                  <span className={styles.positionStatHint}>to reach {cbLtvTargetPct}% LTV</span>
                </>
              )}
              <span className={`${styles.ndpBadge} ${styles[`ndp_${ndp.status}`]}`}>
                {ndp.status === 'never'    && 'NDP — not recorded'}
                {ndp.status === 'ok'       && `NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'upcoming' && `⚠ NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'soon'     && `⚠ NDP: ${ndp.daysRemaining}d`}
                {ndp.status === 'overdue'  && '⛔ NDP overdue'}
              </span>
            </div>

            {/* Center — THIS MONTH (Change 2) */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>THIS MONTH</span>
              <span className={`${styles.positionStat} ${btcAccumulatedThisMonth > 0 ? styles.statGreen : styles.statMuted}`}>
                ₿ {btcAccumulatedThisMonth > 0 ? `+${btcAccumulatedThisMonth.toFixed(5)}` : '—'}
              </span>
              <span className={`${styles.positionStat} ${cashBalanceThisMonth > 0 ? styles.statAmber : styles.statMuted}`}>
                Cash: {cashBalanceThisMonth > 0 ? fmtUSD(cashBalanceThisMonth) : '—'}
              </span>
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
        {allDone ? (
          <div className={`${styles.card} ${styles.cardDone}`}>
            <div className={styles.doneIcon}>✓</div>
            <h3 className={styles.doneTitle}>Month {currentMonth} complete</h3>
            <p className={styles.doneSub}>
              {strategyDone
                ? 'Year complete — update your start date in Settings to begin Year 2'
                : `Come back next month`
              }
            </p>
            <button
              className={styles.undoBtn}
              onClick={() => setAdvisorChecklist({
                month: currentMonth,
                blocDraw: false, cbPayment: false,
                btcBuying: false, fiatCoverage: false,
              })}
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
                className={`${styles.tierBadgeFull} ${tierBadgeClass}`}
                onClick={() => setShowTierTip((v) => !v)}
              >
                TIER {currentTier} — {tierStatusText[currentTier]}
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
                      onClick={() => { setAdvisorSkipBlocDraw(false); fireCheck('blocDraw', { blocDraw: true }, true); }}
                    >Pay</button>
                    <button
                      className={`${styles.actionPill} ${advisorSkipBlocDraw ? styles.pillSkipActive : ''}`}
                      onClick={() => { setAdvisorSkipBlocDraw(true); fireCheck('blocDraw', { blocDraw: true }, true); }}
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
                {showFiatRow && (
                  <div className={styles.actionRow}>
                    <span className={styles.actionIcon}>≡</span>
                    <div className={styles.actionLabelGroup}>
                      <span className={styles.actionLabel}>Cover from savings</span>
                    </div>
                    <span className={styles.actionAmount}>{fmtUSD(expectedFiatGap)}</span>
                    <div className={styles.paySkipGroup}>
                      <button
                        className={`${styles.actionPill} ${advisorChecklist.fiatCoverage ? styles.pillPay : ''}`}
                        onClick={() => fireCheck('fiatCoverage', { fiatCoverage: !advisorChecklist.fiatCoverage }, !advisorChecklist.fiatCoverage)}
                      >Pay</button>
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
                      onClick={() => { setAdvisorSkipCbPayment(false); fireCheck('cbPayment', { cbPayment: true }, true); }}
                    >Pay</button>
                    <button
                      className={`${styles.actionPill} ${advisorSkipCbPayment ? styles.pillSkipActive : ''}`}
                      onClick={() => { setAdvisorSkipCbPayment(true); fireCheck('cbPayment', { cbPayment: true }, true); }}
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
                    onClick={() => { setAdvisorSkipBtcBuying(false); fireCheck('btcBuying', { btcBuying: true }, true); }}
                  >Pay</button>
                  <button
                    className={`${styles.actionPill} ${advisorSkipBtcBuying ? styles.pillSkipActive : ''}`}
                    onClick={() => { setAdvisorSkipBtcBuying(true); fireCheck('btcBuying', { btcBuying: true }, true); }}
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

            <div className={styles.progress}>{doneCount} of {totalItems} done</div>

            {hasProjection && !projectionApplied && (
              <button className={styles.applyBtn} onClick={handleApply}>
                Apply to next month →
              </button>
            )}
            {projectionApplied && (
              <p className={styles.applyConfirm}>✓ Applied to next month</p>
            )}

            {!strategyDone && (
              <button
                className={styles.logThisMonthOutlineBtn}
                onClick={() => {
                  logSectionDivRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  logSectionRef.current?.focusMonth(currentMonth - 1);
                }}
              >
                Log this month
              </button>
            )}
          </div>
        )}

        {/* Monthly Log section */}
        <div ref={logSectionDivRef}>
          <MonthlyLogSection
            ref={logSectionRef}
            months={advisorRows}
            onOpenOverlay={(idx) => {
              setLogOverlayInitialMonth(idx);
              setLogOverlayOpen(true);
            }}
          />
        </div>

        {/* Standalone NDP card */}
        {ndp.status !== 'ok' && (
          <div className={`${styles.ndpStatusCard} ${
            ndp.status === 'overdue' ? styles.ndpStatusOverdue :
            ndp.status === 'soon'    ? styles.ndpStatusSoon    :
                                       styles.ndpStatusUpcoming
          }`}>
            <span className={styles.ndpStatusIcon}>
              {ndp.status === 'overdue' ? '⛔' : '⚠'}
            </span>
            <div className={styles.actionLabelGroup}>
              <span className={styles.actionLabel}>Non-Draw Payment</span>
              <span className={styles.actionSub}>
                {ndp.status === 'never'   ? 'Never recorded' :
                 ndp.status === 'overdue' ? 'Overdue — pay Strike now' :
                                            `Due in ${ndp.daysRemaining} days`}
              </span>
            </div>
            {ndpMinimum > 0 && <span className={styles.actionAmount}>{fmtUSD(ndpMinimum)} min.</span>}
            <div className={styles.paySkipGroup}>
              <button
                className={`${styles.actionPill} ${advisorChecklist.ndpPayment ? styles.pillPay : ''}`}
                onClick={() => fireCheck('ndpPayment', { ndpPayment: !advisorChecklist.ndpPayment }, !advisorChecklist.ndpPayment)}
              >Pay</button>
            </div>
          </div>
        )}

        {/* Change 1 (iter 2) — setup prompt + modal */}
        {isDefaultSetup && (
          <>
            <button className={styles.setupPrompt} onClick={openSetupModal}>
              ⚙ Set up your numbers to personalize this plan
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
        )}

      </div>

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
    </>
  );
}
