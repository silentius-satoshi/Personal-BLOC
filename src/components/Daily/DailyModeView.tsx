import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import { deriveAdvisorStart } from '../../simulation/logUtils';
import { strikeAvailableCredit, computeStrikeLtv } from '../../simulation/strikeCredit';
import { deriveForMonth, composeMonthSummary } from '../../simulation/simpleModePlan';
import { SafetyDashboard } from '../SimpleMode/SafetyDashboard';
import { selectMonthEvents, describeDayEvent } from './dailyView';
import { fmtUSD } from '../../utils/format';
import styles from './DailyModeView.module.css';

interface DailyModeViewProps {
  onOpenSettings: () => void;
}

// Strategy-month → "Month Year" (copied from SimpleModeView — kept local so Daily owns its own copy).
function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ISO yyyy-mm-dd → "Mon D" (local, no UTC shift — parse the parts).
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Daily Mode P4a — READ-ONLY day-level view. Mirrors SimpleModeView's layout (SafetyDashboard +
 * position trio + plan reference) but its activity card shows the granular dayLog for the current
 * strategy month instead of the monthly rollup. No event sheets / writes / calendar (P4b/P4c).
 */
export function DailyModeView({ onOpenSettings }: DailyModeViewProps) {
  const income     = useStore((s) => s.income);
  const expenses   = useStore((s) => s.expenses);
  const btcPrice   = useStore((s) => s.btcPrice);
  const blocApr    = useStore((s) => s.blocApr);
  const creditLine = useStore((s) => s.creditLine);

  const hasCbLoan         = useStore((s) => s.hasCbLoan);
  const cbLoanBalance     = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc   = useStore((s) => s.cbCollateralBtc);
  const cbAprPct          = useStore((s) => s.cbAprPct);
  const cbMonthlyPayment  = useStore((s) => s.cbMonthlyPayment);
  const cbPaymentStrategy = useStore((s) => s.cbPaymentStrategy);
  const cbLtvTriggerPct   = useStore((s) => s.cbLtvTriggerPct);
  const cbLtvTargetPct    = useStore((s) => s.cbLtvTargetPct);
  const cbRotateBackPct   = useStore((s) => s.cbRotateBackPct);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const advisorMonthStartBalance    = useStore((s) => s.advisorMonthStartBalance);
  const advisorActualBtcHeld        = useStore((s) => s.advisorActualBtcHeld);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const monthlyLog                  = useStore((s) => s.monthlyLog);
  const dayLog                      = useStore((s) => s.dayLog);
  const setSimpleMode               = useStore((s) => s.setSimpleMode);

  const currentMonth = getCurrentStrategyMonth(advisorStartDate);

  const { startingBlocBalance: slmBlocBal, startingBtcHeld: slmBtcHeld, startingMonth: slmStartMonth } = useMemo(
    () => deriveAdvisorStart(monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, currentMonth, pendingCollateralAdjustment, advisorMonthStartBalance),
    [monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, currentMonth, pendingCollateralAdjustment, advisorMonthStartBalance],
  );

  const advisorRows = useMemo(
    () => runAdvisor({
      btcPrice, income, expenses,
      blocApr, creditLine, blocLtvCeiling: 0.15,
      cbBalance:         hasCbLoan ? cbLoanBalance    : 0,
      cbCollateralBtc:   hasCbLoan ? cbCollateralBtc  : 1,
      cbAprPct:          hasCbLoan ? cbAprPct         : 0,
      cbMonthlyPayment:  hasCbLoan ? cbMonthlyPayment : 0,
      cbPaymentStrategy: hasCbLoan ? cbPaymentStrategy : 'monthly',
      cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
      startingBlocBalance: slmBlocBal,
      startingBtcHeld:     slmBtcHeld,
      startingMonth:       slmStartMonth,
      btcGrowthRate: 0,
    }).rows,
    [btcPrice, income, expenses, blocApr, creditLine,
     cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
     cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
     slmBlocBal, slmBtcHeld, slmStartMonth, hasCbLoan],
  );

  const currentRow = advisorRows.find((r) => r.month === currentMonth) ?? null;

  // Position — CURRENT (live) vs AFTER (projected). P4a is read-only and exposes no Pay/Skip, so the
  // AFTER projection uses the unskipped plan (skip flags treated as false).
  const currentBlocLtv = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice);
  const currentAvail   = strikeAvailableCredit(creditLine, currentBtcHeld, btcPrice, advisorActualBlocBalance);

  const expectedPaydown = currentRow ? Math.max(0, income - (hasCbLoan ? currentRow.cbPayment : 0) - currentRow.incomeToBtc) : 0;
  const eomBlocBalance  = currentRow ? slmBlocBal + currentRow.blocDraw + currentRow.blocInterest - expectedPaydown : advisorActualBlocBalance;
  const eomBtcHeld      = slmBtcHeld + (currentRow?.btcBought ?? 0);
  const eomLtv          = computeStrikeLtv(eomBlocBalance, eomBtcHeld, btcPrice);
  const availCredit     = strikeAvailableCredit(creditLine, eomBtcHeld, btcPrice, eomBlocBalance);
  const hasPaydown      = expectedPaydown > 0;

  const projBtcBought = currentRow?.btcBought ?? 0;
  const projBlocDraw  = currentRow?.blocDraw ?? 0;

  // Plan reference (read-only) — the unskipped projection + plain-English narration for this month.
  const plan = currentRow ? deriveForMonth(currentRow, income, hasCbLoan, cbPaymentStrategy) : null;
  // CB reference reflects the engine: ltvTriggered draws cbPaydownDraw (0 unless triggered); monthly pays plan.cbPayment.
  const cbRefAmount = !hasCbLoan ? 0
    : cbPaymentStrategy === 'ltvTriggered' ? (currentRow?.cbPaydownDraw ?? 0)
    : (plan?.cbPayment ?? 0);
  const cbRefLabel  = cbPaymentStrategy === 'ltvTriggered' ? 'CB paydown' : 'CB payment';
  const summaryText = currentRow && plan ? composeMonthSummary({
    month: currentMonth, isCurrent: true, isLogged: false, hasCbLoan,
    cbLtv: plan.cbLtv, triggerPct: cbLtvTriggerPct,
    draw: plan.blocDraw, btcBoughtUsd: plan.btcBoughtUsd, cbPayment: plan.cbPayment,
    rotationFired: !!currentRow.strikeRepayFired, rotationAmount: currentRow.strikeRepayDraw ?? 0,
    interest: plan.blocInterest,
    skipDraw: false, skipBtc: false, skipCb: false, unallocated: 0,
  }) : '';

  // Activity — the current month's day events, chronological.
  const monthEvents = useMemo(
    () => selectMonthEvents(dayLog, currentMonth, advisorStartDate),
    [dayLog, currentMonth, advisorStartDate],
  );

  return (
    <div className={styles.root}>
      <div className={styles.content}>

        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.brandMark}>₿</span>
            <span className={styles.brandName}>Personal ₿LOC</span>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.modeToggleBtn} onClick={() => setSimpleMode(false)} aria-label="Switch to full app">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
                <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
                <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor"/>
                <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <button className={styles.settingsBtn} onClick={onOpenSettings} title="Settings">⚙</button>
          </div>
        </div>

        <SafetyDashboard />

        <div className={styles.monthIndicator}>
          <span className={styles.monthLabel}>{getMonthLabel(advisorStartDate, currentMonth)}</span>
          <span className={styles.monthSub}>Month {currentMonth} of 12 · daily activity</span>
        </div>

        <div className={styles.cards}>

          {/* Position trio — CURRENT | THIS MONTH (proj) | AFTER */}
          <div className={styles.positionRow}>
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>CURRENT STRIKE BLOC</span>
              <span className={styles.positionStat}><span className={styles.btcAmt}>₿ {currentBtcHeld.toFixed(5)}</span> <span className={styles.parenSub}>({fmtUSD(currentBtcHeld * btcPrice)})</span></span>
              <span className={styles.positionStat}>{fmtUSD(advisorActualBlocBalance)} <span className={styles.parenSub}>({(currentBlocLtv * 100).toFixed(1)}% LTV)</span></span>
              <span className={styles.positionStat}>Avail: {fmtUSD(currentAvail.available)}</span>
            </div>

            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>THIS MONTH <span className={styles.projSuffix}>(proj)</span></span>
              <span className={`${styles.positionStat} ${projBtcBought > 0 ? styles.statGreen : styles.statMuted}`}>
                Buy: ₿ {projBtcBought > 0 ? `+${projBtcBought.toFixed(5)}` : '—'}
              </span>
              <span className={styles.positionStat}>Draw: {projBlocDraw > 0 ? fmtUSD(projBlocDraw) : '—'}</span>
            </div>

            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>AFTER THIS MONTH</span>
              <span className={styles.positionStat}><span className={styles.btcAmt}>₿ {eomBtcHeld.toFixed(5)}</span> <span className={styles.parenSub}>({fmtUSD(eomBtcHeld * btcPrice)})</span></span>
              <span className={styles.positionStat}>{fmtUSD(eomBlocBalance)} <span className={styles.parenSub}>(<span style={hasPaydown ? { color: 'var(--orange)' } : undefined}>{(eomLtv * 100).toFixed(1)}% LTV</span>)</span></span>
              <span className={styles.positionStat}>Avail: {fmtUSD(availCredit.available)}</span>
            </div>
          </div>

          {/* Activity card — the granular day journal for this month (read-only) */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>This month's activity</h3>
              {monthEvents.length > 0 && (
                <span className={styles.cardCount}>{monthEvents.length} event{monthEvents.length === 1 ? '' : 's'}</span>
              )}
            </div>
            {monthEvents.length === 0 ? (
              <p className={styles.emptyState}>No activity logged this month.</p>
            ) : (
              <ul className={styles.eventList}>
                {monthEvents.map((ev) => {
                  const d = describeDayEvent(ev);
                  return (
                    <li key={ev.id} className={styles.eventRow}>
                      <span className={styles.eventIcon} aria-hidden="true">{d.icon}</span>
                      <div className={styles.eventBody}>
                        <span className={styles.eventLabel}>{d.label}</span>
                        <span className={styles.eventDetail}>{d.detail}</span>
                      </div>
                      <span className={styles.eventDate}>{fmtDay(ev.date)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Plan reference — what the plan expects this month (read-only) */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>This month's plan <span className={styles.planRefHint}>(reference)</span></h3>
            {plan ? (
              <>
                <div className={styles.planRefGrid}>
                  <div className={styles.planRefItem}><span className={styles.planRefLabel}>Draw</span><span className={styles.planRefVal}>{fmtUSD(plan.blocDraw)}</span></div>
                  <div className={styles.planRefItem}><span className={styles.planRefLabel}>Buy BTC</span><span className={styles.planRefVal}>{fmtUSD(plan.btcBoughtUsd)}</span></div>
                  {hasCbLoan && cbRefAmount > 0 && (
                    <div className={styles.planRefItem}><span className={styles.planRefLabel}>{cbRefLabel}</span><span className={styles.planRefVal}>{fmtUSD(cbRefAmount)}</span></div>
                  )}
                  {plan.paydown > 0 && (
                    <div className={styles.planRefItem}><span className={styles.planRefLabel}>BLOC paydown</span><span className={styles.planRefVal}>{fmtUSD(plan.paydown)}</span></div>
                  )}
                </div>
                {summaryText && <p className={styles.planSummary}>{summaryText}</p>}
              </>
            ) : (
              <p className={styles.emptyState}>Strategy complete — no plan for this month.</p>
            )}
          </div>

        </div>

        <button className={styles.fullAppLink} onClick={() => setSimpleMode(false)}>
          Full App →
        </button>

      </div>
    </div>
  );
}
