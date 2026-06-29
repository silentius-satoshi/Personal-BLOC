import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import { deriveAdvisorStart } from '../../simulation/logUtils';
import { strikeAvailableCredit } from '../../simulation/strikeCredit';
import { deriveForMonth, composeMonthSummary } from '../../simulation/simpleModePlan';
import { SafetyDashboard } from '../SimpleMode/SafetyDashboard';
import { describeDayEvent } from './dailyView';
import { Calendar } from './Calendar';
import { buildDayActivity, buildMonthRollup } from './calendarModel';
import { EventSheet, isEditableKind } from './EventSheet';
import { MonthEventsModal } from './MonthEventsModal';
import { ViewToggle } from '../Layout/ViewToggle';
import { fmtUSD } from '../../utils/format';
import type { DayEvent } from '../../simulation/types';
import styles from './DailyModeView.module.css';

interface DailyModeViewProps {
  onOpenSettings: () => void;
  simpleView: 'monthly' | 'daily';
  setSimpleView: (v: 'monthly' | 'daily') => void;
}

// Strategy-month → "Month Year" (copied from SimpleModeView — kept local so Daily owns its own copy).
function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Today as ISO yyyy-mm-dd (UTC — matches calendarModel's UTC date math).
const todayISO = () => new Date().toISOString().split('T')[0];

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
export function DailyModeView({ onOpenSettings, simpleView, setSimpleView }: DailyModeViewProps) {
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
  const viewerMode                  = useStore((s) => s.viewerMode);

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
  const currentAvail = strikeAvailableCredit(creditLine, currentBtcHeld, btcPrice, advisorActualBlocBalance);

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

  // ── Calendar state ──
  const [logExpanded, setLogExpanded]       = useState(false);
  const [sheetOpen, setSheetOpen]           = useState(false);   // P4b — event-entry sheet (add/edit)
  const [editEvent, setEditEvent]           = useState<DayEvent | undefined>(undefined);
  const [monthModalOpen, setMonthModalOpen] = useState(false);   // P4c-1b — month-events modal
  const [scope, setScope]                   = useState<'week' | 'month'>('week');
  const [selectedDay, setSelectedDay]       = useState<string>(todayISO());

  // ── Activity — scope-driven (P4c-1b). Week → the selected day; Month → the month rollup. ──
  const dayActivity = useMemo(() => buildDayActivity(dayLog, selectedDay), [dayLog, selectedDay]);
  const monthRollup = useMemo(() => buildMonthRollup(dayLog, advisorStartDate, currentMonth), [dayLog, advisorStartDate, currentMonth]);
  const isMonth = scope === 'month';
  const view    = isMonth ? monthRollup : dayActivity;

  const today        = todayISO();
  const netUsd       = view.netBtc * btcPrice;
  const plannedDraw  = plan?.blocDraw ?? 0;
  const plannedPay   = plan?.paydown ?? 0;
  const plannedBuy   = plan?.btcBought ?? 0;
  const drawFill     = clampPct(view.streams.draw, plannedDraw);
  const payFill      = clampPct(view.streams.paydown, plannedPay);
  const buyFill      = clampPct(view.streams.buyBtc, plannedBuy);

  const actTitle   = isMonth ? getMonthLabel(advisorStartDate, currentMonth)
    : (selectedDay === today ? 'Today' : fmtDay(selectedDay));
  const actWhen    = isMonth ? `Month ${currentMonth} · month-to-date` : fmtDay(selectedDay);
  const actUsdText = view.netBtc > 0 ? `+${fmtUSD(netUsd)} stacked`
    : isMonth
      ? (monthRollup.events.length > 0 ? 'no Bitcoin bought yet' : 'no activity yet this month')
      : (dayActivity.events.length > 0 ? 'no Bitcoin bought this day' : 'nothing logged this day');

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

        <ViewToggle simpleView={simpleView} setSimpleView={setSimpleView} />

        <SafetyDashboard />

        <div className={styles.cards}>

          {/* Position trio — Strike BLOC collateral / Strike BLOC balance / Avail credit */}
          <div className={styles.trioCard}>
            <div className={styles.trio}>
              <div className={styles.trioCell}>
                <span className={`${styles.trioNum} ${styles.trioNumBtc}`}>₿ {currentBtcHeld.toFixed(5)}</span>
                <span className={styles.trioLab}>Strike BLOC collateral</span>
              </div>
              <div className={styles.trioCell}>
                <span className={styles.trioNum}>{fmtUSD(advisorActualBlocBalance)}</span>
                <span className={styles.trioLab}>Strike BLOC balance</span>
              </div>
              <div className={styles.trioCell}>
                <span className={styles.trioNum}>{fmtUSD(currentAvail.available)}</span>
                <span className={styles.trioLab}>Avail credit</span>
              </div>
            </div>
          </div>

          {/* P4c-1a — Week|Month calendar (render + select only; does NOT yet drive the activity card) */}
          <Calendar
            dayLog={dayLog}
            advisorStartDate={advisorStartDate}
            currentMonth={currentMonth}
            scope={scope}
            selectedDay={selectedDay}
            monthLabel={getMonthLabel(advisorStartDate, currentMonth)}
            onScopeChange={setScope}
            onSelectDay={setSelectedDay}
          />

          {/* Activity aggregate — net BTC + draw/paydown/buy streams (scope-driven: day or month rollup) */}
          <div className={styles.card}>
            <div className={styles.actHead}>
              <span className={styles.actTitle}>{actTitle}</span>
              <span className={styles.actWhen}>{actWhen}</span>
            </div>
            <div className={styles.actBig}>{view.netBtc >= 0 ? '+' : ''}{view.netBtc.toFixed(4)} ₿</div>
            <div className={styles.actUsd}>{actUsdText}</div>
            <div className={styles.streams}>
              <div className={styles.stream}>
                <span className={styles.streamLabel}>Draw</span>
                <span className={styles.streamVal}>{fmtUSD(view.streams.draw)} / {fmtUSD(plannedDraw)}</span>
                <div className={styles.track}><div className={`${styles.fill} ${styles.fillDraw}`} style={{ width: `${drawFill}%` }} /></div>
              </div>
              <div className={styles.stream}>
                <span className={styles.streamLabel}>Paydown</span>
                <span className={`${styles.streamVal} ${plannedPay > 0 ? '' : styles.streamValMuted}`}>
                  {plannedPay > 0 ? `${fmtUSD(view.streams.paydown)} / ${fmtUSD(plannedPay)}` : '—'}
                </span>
                <div className={styles.track}><div className={`${styles.fill} ${styles.fillPaydn}`} style={{ width: `${payFill}%` }} /></div>
              </div>
              <div className={styles.stream}>
                <span className={styles.streamLabel}>Buy ₿</span>
                <span className={styles.streamVal}>₿{view.streams.buyBtc.toFixed(4)} / {plannedBuy.toFixed(4)}</span>
                <div className={styles.track}><div className={`${styles.fill} ${styles.fillBuy}`} style={{ width: `${buyFill}%` }} /></div>
              </div>
            </div>
            {isMonth && <div className={styles.actFoot}>Interest capitalized this month <b>{fmtUSD(plan?.blocInterest ?? 0)}</b></div>}
          </div>

          {/* Log section — Week: editable per-event log; Month: read-only summed rollup + "from N entries" */}
          {isMonth ? (
            <div>
              <div className={styles.logHead}>
                <span className={styles.logTitle}>Month {currentMonth} rollup</span>
                <span className={styles.logSub}>
                  {monthRollup.entryCount > 0 ? (
                    <button className={styles.entriesBtn} onClick={() => setMonthModalOpen(true)}>
                      from {monthRollup.entryCount} day {monthRollup.entryCount === 1 ? 'entry' : 'entries'}
                    </button>
                  ) : 'no entries'}
                </span>
              </div>
              {monthRollup.events.length === 0 ? (
                <div className={styles.empty}>No activity logged this month.</div>
              ) : (
                <div className={styles.logList}>
                  <div className={styles.logRow}>
                    <span className={styles.logTime}>sum</span>
                    <span className={styles.logType}><span className={`${styles.dot} ${styles.dotN}`} />Drawn (expenses)</span>
                    <span className={`${styles.logAmt} ${styles.amtNeu}`}>{fmtUSD(monthRollup.streams.draw)}</span>
                  </div>
                  <div className={styles.logRow}>
                    <span className={styles.logTime}>sum</span>
                    <span className={styles.logType}><span className={`${styles.dot} ${styles.dotO}`} />Bought bitcoin</span>
                    <span className={`${styles.logAmt} ${styles.amtPos}`}>+₿{monthRollup.streams.buyBtc.toFixed(4)}</span>
                  </div>
                  {monthRollup.streams.paydown > 0 && (
                    <div className={styles.logRow}>
                      <span className={styles.logTime}>sum</span>
                      <span className={styles.logType}><span className={`${styles.dot} ${styles.dotG}`} />BLOC paydown</span>
                      <span className={`${styles.logAmt} ${styles.amtNeu}`}>{fmtUSD(monthRollup.streams.paydown)}</span>
                    </div>
                  )}
                  <div className={styles.logRow}>
                    <span className={styles.logTime}>sum</span>
                    <span className={styles.logType}><span className={`${styles.dot} ${styles.dotR}`} />Interest capitalized</span>
                    <span className={`${styles.logAmt} ${styles.amtCost}`}>{fmtUSD(plan?.blocInterest ?? 0)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className={styles.logHead}>
                <span className={styles.logTitle}>{selectedDay === today ? "Today's log" : `${fmtDay(selectedDay)} log`}</span>
                <span className={styles.logSub}>{dayActivity.events.length} event{dayActivity.events.length === 1 ? '' : 's'}</span>
              </div>
              {dayActivity.events.length === 0 ? (
                <div className={styles.empty}>Nothing logged this day.</div>
              ) : (
                <>
                  <div className={styles.logList}>
                    {dayActivity.events.slice(0, logExpanded ? dayActivity.events.length : 5).map((ev) => {
                      const d = describeDayEvent(ev);
                      const tone = eventTone(ev.kind);
                      const editable = !viewerMode && isEditableKind(ev.kind);
                      const openEdit = () => { setEditEvent(ev); setSheetOpen(true); };
                      return (
                        <div
                          key={ev.id}
                          className={`${styles.logRow} ${editable ? styles.logRowClickable : ''}`}
                          role={editable ? 'button' : undefined}
                          tabIndex={editable ? 0 : undefined}
                          onClick={editable ? openEdit : undefined}
                          onKeyDown={editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(); } } : undefined}
                        >
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
                  {dayActivity.events.length > 5 && (
                    <button className={styles.logMoreBtn} onClick={() => setLogExpanded((x) => !x)}>
                      {logExpanded ? 'Show less' : `Show more (${dayActivity.events.length - 5} more)`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

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

      {/* P4c-1b — month-events modal (read-only for viewers; editable rows reuse the P4b-2 edit sheet) */}
      <MonthEventsModal
        open={monthModalOpen}
        month={currentMonth}
        events={monthRollup.events}
        advisorStartDate={advisorStartDate}
        viewerMode={viewerMode}
        onClose={() => setMonthModalOpen(false)}
        onEditEvent={(ev) => { setMonthModalOpen(false); setEditEvent(ev); setSheetOpen(true); }}
      />

      {/* P4b-1 add / P4b-2 edit — Daily-only write path. FAB opens add mode; a log-row tap opens edit mode.
          Hidden for read-only viewers. */}
      {!viewerMode && (
        <>
          <button className={styles.fab} onClick={() => { setEditEvent(undefined); setSheetOpen(true); }} aria-label="Log an event">+</button>
          <EventSheet
            open={sheetOpen}
            editEvent={editEvent}
            onClose={() => { setSheetOpen(false); setEditEvent(undefined); }}
          />
        </>
      )}
    </div>
  );
}
