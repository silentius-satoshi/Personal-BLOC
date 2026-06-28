import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import { deriveAdvisorStart } from '../../simulation/logUtils';
import { strikeAvailableCredit, computeStrikeLtv } from '../../simulation/strikeCredit';
import { deriveForMonth, composeMonthSummary } from '../../simulation/simpleModePlan';
import { SafetyDashboard } from '../SimpleMode/SafetyDashboard';
import { selectMonthEvents, describeDayEvent } from './dailyView';
import { fmtUSD } from '../../utils/format';
import type { DayEvent } from '../../simulation/types';
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

// Map an event kind → its log-row dot/ring + amount tone (presentation; describeDayEvent stays generic).
function eventTone(kind: DayEvent['kind']): { dot: string; ring: boolean; amt: string } {
  switch (kind) {
    case 'buy':      return { dot: styles.dotO, ring: false, amt: styles.amtPos };
    case 'paydown':  return { dot: styles.dotG, ring: false, amt: styles.amtNeu };
    case 'draw':     return { dot: styles.dotN, ring: false, amt: styles.amtNeu };
    case 'deposit':  return { dot: styles.dotG, ring: false, amt: styles.amtNeu };
    case 'withdraw': return { dot: styles.dotY, ring: false, amt: styles.amtNeu };
    case 'balanceReading':
    case 'cbCollateralReading': return { dot: '', ring: true, amt: styles.amtAnchor };
  }
}

const clampPct = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : a > 0 ? 100 : 0);

/**
 * Daily Mode P4a — READ-ONLY day-level view. Mirrors SimpleModeView's data (SafetyDashboard + position
 * trio + plan reference) but its activity card shows the granular dayLog for the current strategy month.
 * Presentation aligned to mode-toggle-preview.html (layered surfaces, divided trio, two-part activity
 * card [aggregate streams + per-event log], terminal playbook plan card). No event sheets / writes / calendar.
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

  const [logExpanded, setLogExpanded] = useState(false);

  // Aggregate the (already-read) month events into display totals — READ-ONLY (no writes, no new reads).
  const agg = useMemo(() => {
    let totalDraw = 0, totalPaydown = 0, totalBuyBtc = 0, netBtc = 0;
    for (const ev of monthEvents) {
      if      (ev.kind === 'draw')    totalDraw += ev.amount;
      else if (ev.kind === 'paydown') totalPaydown += ev.amount;
      else if (ev.kind === 'buy')   { totalBuyBtc += ev.amount; netBtc += ev.amount; }
      else if (ev.kind === 'deposit'  && ev.target === 'strike') netBtc += ev.amount;
      else if (ev.kind === 'withdraw' && ev.target === 'strike') netBtc -= ev.amount;
    }
    return { totalDraw, totalPaydown, totalBuyBtc, netBtc };
  }, [monthEvents]);

  const netUsd       = agg.netBtc * btcPrice;
  const plannedDraw  = plan?.blocDraw ?? 0;
  const plannedPay   = plan?.paydown ?? 0;
  const plannedBuy   = plan?.btcBought ?? 0;
  const drawFill     = clampPct(agg.totalDraw, plannedDraw);
  const payFill      = clampPct(agg.totalPaydown, plannedPay);
  const buyFill      = clampPct(agg.totalBuyBtc, plannedBuy);
  const actUsdText   = agg.netBtc > 0 ? `+${fmtUSD(netUsd)} stacked`
    : monthEvents.length > 0 ? 'no Bitcoin bought yet'
    : 'no activity yet this month';

  return (
    <div className={styles.root}>
      <div className={styles.content}>

        <div className={styles.appbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>₿</span>
            <span className={styles.brandName}>Personal ₿LOC</span>
          </div>
          <div className={styles.hbtns}>
            <button className={styles.iconBtn} onClick={() => setSimpleMode(false)} aria-label="Switch to full app">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
                <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7"/>
                <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor"/>
                <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <button className={styles.iconBtn} onClick={onOpenSettings} aria-label="Settings">⚙</button>
          </div>
        </div>

        <SafetyDashboard />

        <div className={styles.cards}>

          {/* Position trio — CURRENT | THIS MONTH (proj) | AFTER — matches Monthly (SimpleModeView) format */}
          <div className={styles.positionRow}>

            {/* Box 1 — CURRENT STRIKE BLOC */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>CURRENT STRIKE BLOC</span>
              <span className={styles.positionStat}><span className={styles.btcAmt}>₿ {currentBtcHeld.toFixed(5)}</span> <span className={styles.parenSub}>({fmtUSD(currentBtcHeld * btcPrice)})</span></span>
              <span className={styles.positionStat}>{fmtUSD(advisorActualBlocBalance)} <span className={styles.parenSub}>({(currentBlocLtv * 100).toFixed(1)}% LTV)</span></span>
              <span className={styles.positionStat}>Avail: {fmtUSD(currentAvail.available)}</span>
            </div>

            {/* Box 2 — THIS MONTH (projected; P4a is read-only, no logging UI) */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>THIS MONTH<span className={styles.projSuffix}> (proj)</span></span>
              <span className={`${styles.positionStat} ${projBtcBought > 0 ? styles.statGreen : styles.statMuted}`}>
                Buy: ₿ {projBtcBought > 0 ? `+${projBtcBought.toFixed(5)}` : '—'}
              </span>
              <span className={styles.positionStat}>Draw: {projBlocDraw > 0 ? fmtUSD(projBlocDraw) : '—'}</span>
            </div>

            {/* Box 3 — AFTER THIS MONTH */}
            <div className={styles.positionCol}>
              <span className={styles.positionTitle}>AFTER THIS MONTH</span>
              <span className={styles.positionStat}><span className={styles.btcAmt}>₿ {eomBtcHeld.toFixed(5)}</span> <span className={styles.parenSub}>({fmtUSD(eomBtcHeld * btcPrice)})</span></span>
              <span className={styles.positionStat}>{fmtUSD(eomBlocBalance)} <span className={styles.parenSub}>(<span style={hasPaydown ? { color: 'var(--orange)' } : undefined}>{(eomLtv * 100).toFixed(1)}% LTV</span>)</span></span>
              <span className={styles.positionStat}>Avail: {fmtUSD(availCredit.available)}</span>
            </div>

          </div>

          {/* Activity aggregate — net BTC + draw/paydown/buy streams (read-only rollup of this month's events) */}
          <div className={styles.card}>
            <div className={styles.actHead}>
              <span className={styles.actTitle}>This month</span>
              <span className={styles.actWhen}>{getMonthLabel(advisorStartDate, currentMonth)} · month-to-date</span>
            </div>
            <div className={styles.actBig}>{agg.netBtc >= 0 ? '+' : ''}{agg.netBtc.toFixed(4)} ₿</div>
            <div className={styles.actUsd}>{actUsdText}</div>
            <div className={styles.streams}>
              <div className={styles.stream}>
                <span className={styles.streamLabel}>Draw</span>
                <span className={styles.streamVal}>{fmtUSD(agg.totalDraw)} / {fmtUSD(plannedDraw)}</span>
                <div className={styles.track}><div className={`${styles.fill} ${styles.fillDraw}`} style={{ width: `${drawFill}%` }} /></div>
              </div>
              <div className={styles.stream}>
                <span className={styles.streamLabel}>Paydown</span>
                <span className={`${styles.streamVal} ${plannedPay > 0 ? '' : styles.streamValMuted}`}>
                  {plannedPay > 0 ? `${fmtUSD(agg.totalPaydown)} / ${fmtUSD(plannedPay)}` : '—'}
                </span>
                <div className={styles.track}><div className={`${styles.fill} ${styles.fillPaydn}`} style={{ width: `${payFill}%` }} /></div>
              </div>
              <div className={styles.stream}>
                <span className={styles.streamLabel}>Buy ₿</span>
                <span className={styles.streamVal}>₿{agg.totalBuyBtc.toFixed(4)} / {plannedBuy.toFixed(4)}</span>
                <div className={styles.track}><div className={`${styles.fill} ${styles.fillBuy}`} style={{ width: `${buyFill}%` }} /></div>
              </div>
            </div>
            <div className={styles.actFoot}>Interest capitalized this month <b>{fmtUSD(plan?.blocInterest ?? 0)}</b></div>
          </div>

          {/* Per-event log — the granular day journal for this month (read-only) */}
          <div>
            <div className={styles.logHead}>
              <span className={styles.logTitle}>This month's log</span>
              <span className={styles.logSub}>{monthEvents.length} event{monthEvents.length === 1 ? '' : 's'}</span>
            </div>
            {monthEvents.length === 0 ? (
              <div className={styles.empty}>No activity logged this month.</div>
            ) : (
              <>
                <div className={styles.logList}>
                  {monthEvents.slice(0, logExpanded ? monthEvents.length : 5).map((ev) => {
                    const d = describeDayEvent(ev);
                    const tone = eventTone(ev.kind);
                    return (
                      <div key={ev.id} className={styles.logRow}>
                        <span className={styles.logTime}>{fmtDay(ev.date)}</span>
                        <span className={styles.logType}>
                          {tone.ring ? <span className={styles.ring} /> : <span className={`${styles.dot} ${tone.dot}`} />}
                          {d.label}
                        </span>
                        <span className={`${styles.logAmt} ${tone.amt}`}>{d.detail}</span>
                      </div>
                    );
                  })}
                </div>
                {monthEvents.length > 5 && (
                  <button className={styles.logMoreBtn} onClick={() => setLogExpanded((x) => !x)}>
                    {logExpanded ? 'Show less' : `Show more (${monthEvents.length - 5} more)`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Plan reference — terminal/playbook treatment of what the plan expects this month (read-only) */}
          <div className={styles.pbcard}>
            <div className={styles.pbHead}>This month's plan <span className={styles.pbRef}>· reference</span></div>
            {plan ? (
              <>
                <div className={styles.pbSub}>
                  <span>Month {currentMonth} of 12 · <span className={styles.pbLtv}>LTV {(plan.blocLtv * 100).toFixed(1)}%</span></span>
                  <span>BTC {fmtUSD(btcPrice)}</span>
                </div>
                <div className={styles.pbRow}>
                  <span className={`${styles.dot} ${styles.dotY}`} />
                  <span><span className={styles.pbLab}>Draw</span> <span className={styles.pbNote}>(expenses)</span></span>
                  <span className={styles.pbAmt}>{fmtUSD(plan.blocDraw)}</span>
                </div>
                <div className={styles.pbRow}>
                  <span className={`${styles.dot} ${styles.dotO}`} />
                  <span><span className={styles.pbLab}>Buy Bitcoin</span></span>
                  <span className={styles.pbAmt}>{fmtUSD(plan.btcBoughtUsd)}</span>
                </div>
                {hasCbLoan && cbRefAmount > 0 && (
                  <div className={styles.pbRow}>
                    <span className={`${styles.dot} ${styles.dotR}`} />
                    <span><span className={styles.pbLab}>{cbRefLabel}</span></span>
                    <span className={styles.pbAmt}>{fmtUSD(cbRefAmount)}</span>
                  </div>
                )}
                {plan.paydown > 0 && (
                  <div className={styles.pbRow}>
                    <span className={`${styles.dot} ${styles.dotG}`} />
                    <span><span className={styles.pbLab}>LoC Paydown</span></span>
                    <span className={styles.pbAmt}>{fmtUSD(plan.paydown)}</span>
                  </div>
                )}
                {summaryText && <div className={styles.pbNotebox}>{summaryText}</div>}
              </>
            ) : (
              <div className={styles.empty}>Strategy complete — no plan for this month.</div>
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
