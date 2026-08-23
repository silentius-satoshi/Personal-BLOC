import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import { runAdvisor, getCurrentStrategyMonth, isStrategyComplete, getNdpStatus } from '../../simulation/runAdvisor';
import { deriveAdvisorStart, bucketEventToMonth } from '../../simulation/logUtils';
import { strikeAvailableCredit, BLOC_OPERATING_CEILING } from '../../simulation/strikeCredit';
import { deriveForMonth, composeMonthSummary, minPaymentStatus } from '../../simulation/simpleModePlan';
import { SafetyDashboard } from '../SimpleMode/SafetyDashboard';
import { describeDayEvent } from './dailyView';
import { Calendar } from './Calendar';
import { buildDayActivity, buildMonthRollup } from './calendarModel';
import { EventSheet, isEditableKind } from './EventSheet';
import { MonthEventsModal } from './MonthEventsModal';
import { Snackbar } from '../ui/Snackbar';
import { ReviewSheet } from './ReviewSheet';
import type { SheetType } from './eventSheetModel';
import { ViewToggle } from '../Layout/ViewToggle';
import { HeaderNavCluster } from '../Layout/HeaderNavCluster';
import { BackupNagCard } from '../Entry/BackupNagCard';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import type { DayEvent } from '../../simulation/types';
import styles from './DailyModeView.module.css';

interface DailyModeViewProps {
  onOpenSettings: () => void;
  onOpenAlmanac:  () => void;
  simpleView: 'dashboard' | 'monthly' | 'daily';
  setSimpleView: (v: 'dashboard' | 'monthly' | 'daily') => void;
}

// Strategy-month → "Month Year" (copied from SimpleModeView — kept local so Daily owns its own copy).
function getMonthLabel(advisorStartDate: string, monthNum: number): string {
  const [y, m] = advisorStartDate.split('-').map(Number);
  const d = new Date(y, m - 1 + (monthNum - 1), 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// P2 — UTC ±days shift of a yyyy-mm-dd string (week paging).
function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
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
    case 'minPayment': return { dot: styles.dotR, ring: false, amt: styles.amtNeu };
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
export function DailyModeView({ onOpenSettings, onOpenAlmanac, simpleView, setSimpleView }: DailyModeViewProps) {
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
  const blocMinPaymentSource = useStore((s) => s.blocMinPaymentSource);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const advisorMonthStartBalance    = useStore((s) => s.advisorMonthStartBalance);
  const setAdvisorMonthStartBalance = useStore((s) => s.setAdvisorMonthStartBalance);
  const currentBtcHeld              = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored current Strike collateral (v20)
  const advisorStartDate            = useStore((s) => s.advisorStartDate);
  const monthlyLog                  = useStore((s) => s.monthlyLog);
  const dayLog                      = useStore((s) => s.dayLog);
  const setSimpleMode               = useStore((s) => s.setSimpleMode);
  const viewerMode                  = useStore((s) => s.viewerMode);
  const confirmMonth                = useStore((s) => s.confirmMonth);
  const deleteDayEvent              = useStore((s) => s.deleteDayEvent);          // P2 — swipe-to-delete
  const undoDayEventDeletion        = useStore((s) => s.undoDayEventDeletion);    // P2 — snackbar undo
  // §2/§2b — sign-off details context
  const blocStatementMinimum    = useStore((s) => s.blocStatementMinimum);
  const blocMinPaymentDueDay    = useStore((s) => s.blocMinPaymentDueDay);
  const setBlocStatementMinimum = useStore((s) => s.setBlocStatementMinimum);
  const ndpLastPaidDate         = useStore((s) => s.ndpLastPaidDate);
  const setNdpLastPaidDate      = useStore((s) => s.setNdpLastPaidDate);

  const currentMonth = getCurrentStrategyMonth(advisorStartDate);

  // P4c-3b-ii — the LEDGER's viewed month (Month scope). Defaults to / resets to currentMonth; clamped
  // 1…currentMonth (no future, no Month 0). The calendar grid, activity rollup, reconcile + Review key off
  // this; the PLAN reference card + advisor projection stay currentMonth (Daily=ledger, Monthly=planner).
  const [viewedMonth, setViewedMonth] = useState(currentMonth);
  const safeViewedMonth = Math.min(Math.max(1, viewedMonth), currentMonth);

  // P4c-3b — reconcile state (for the VIEWED month). confirmed/provisional are ORTHOGONAL; the banner shows
  // iff UNCONFIRMED (confirm-as-provisional sets confirmed:true → banner gone, even though provisional
  // persists). Copy branches on provisional. A month with no entry yet → no banner. undefined ⇒ confirmed.
  const viewedEntry   = monthlyLog.find((m) => m.month === safeViewedMonth);
  const needsConfirm  = viewedEntry ? viewedEntry.confirmed === false : false;
  const isProvisional = viewedEntry?.provisional === true;
  const needsReview   = needsConfirm;

  const { startingBlocBalance: slmBlocBal, startingBtcHeld: slmBtcHeld, startingMonth: slmStartMonth } = useMemo(
    () => deriveAdvisorStart(monthlyLog, currentBtcHeld, advisorActualBlocBalance, currentMonth, advisorMonthStartBalance),
    [monthlyLog, currentBtcHeld, advisorActualBlocBalance, currentMonth, advisorMonthStartBalance],
  );

  const advisorRows = useMemo(
    () => runAdvisor({
      btcPrice, income, expenses,
      blocApr, creditLine, blocLtvCeiling: BLOC_OPERATING_CEILING,
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
      blocMinPaymentSource,
    }).rows,
    [btcPrice, income, expenses, blocApr, creditLine,
     cbLoanBalance, cbCollateralBtc, cbAprPct, cbMonthlyPayment,
     cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
     slmBlocBal, slmBtcHeld, slmStartMonth, hasCbLoan, blocMinPaymentSource],
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
    month: currentMonth, isLogged: false, hasCbLoan,
    cbLtv: plan.cbLtv, triggerPct: cbLtvTriggerPct,
    draw: plan.blocDraw, btcBoughtUsd: plan.btcBoughtUsd, cbPayment: plan.cbPayment,
    rotationFired: !!currentRow.strikeRepayFired, rotationAmount: currentRow.strikeRepayDraw ?? 0,
    interest: plan.blocInterest,
    minPayment: plan.minPayment,
  }) : '';

  // §2b — the current month's Strike minimum: owed figure + status chip for the plan reference card.
  const isIncomeSource = blocMinPaymentSource === 'income';
  const strikeMinEstimate = Math.round(advisorActualBlocBalance * (blocApr / 100 / 12));
  const strikeMinOwed = blocStatementMinimum ?? strikeMinEstimate;
  const minPaidCurrentMonth = dayLog
    .filter((e) => e.kind === 'minPayment' && bucketEventToMonth(e.date, advisorStartDate) === currentMonth)
    .reduce((sum, e) => sum + (e as Extract<DayEvent, { kind: 'minPayment' }>).amount, 0);
  const curMinStatus = minPaymentStatus({
    source: blocMinPaymentSource, paidSoFar: minPaidCurrentMonth, owed: strikeMinOwed,
    dueDay: blocMinPaymentDueDay, todayDay: Number(todayLocalISO().split('-')[2]), isCurrent: true,
  });

  // ── Calendar state ──
  const [logExpanded, setLogExpanded]       = useState(false);
  const [sheetOpen, setSheetOpen]           = useState(false);   // P4b — event-entry sheet (add/edit)
  const [editEvent, setEditEvent]           = useState<DayEvent | undefined>(undefined);
  const [monthModalOpen, setMonthModalOpen] = useState(false);   // P4c-1b — month-events modal
  const [reviewOpen, setReviewOpen]         = useState(false);    // P4c-3b — reconcile Review sheet
  const [sheetInitialType, setSheetInitialType] = useState<SheetType | undefined>(undefined); // P4c-3b — add-mode initial type
  const [scope, setScope]                   = useState<'week' | 'month'>('week');
  const [selectedDay, setSelectedDay]       = useState<string>(todayLocalISO());
  const [undoEvent, setUndoEvent]           = useState<DayEvent | null>(null);    // P2 — deleted event held for undo

  // P4c-3b-ii — entering Month scope opens on the current month; navigate back from there.
  useEffect(() => { if (scope === 'month') setViewedMonth(currentMonth); }, [scope, currentMonth]);

  // ── Activity — scope-driven (P4c-1b). Week → the selected day; Month → the VIEWED month's rollup. ──
  const dayActivity = useMemo(() => buildDayActivity(dayLog, selectedDay), [dayLog, selectedDay]);
  const monthRollup = useMemo(() => buildMonthRollup(dayLog, advisorStartDate, safeViewedMonth), [dayLog, advisorStartDate, safeViewedMonth]);
  const isMonth = scope === 'month';
  const view    = isMonth ? monthRollup : dayActivity;

  const today        = todayLocalISO();
  const netUsd       = view.netBtc * btcPrice;
  const plannedDraw  = plan?.blocDraw ?? 0;
  const plannedPay   = plan?.paydown ?? 0;
  const plannedBuy   = plan?.btcBought ?? 0;
  const drawFill     = clampPct(view.streams.draw, plannedDraw);
  const payFill      = clampPct(view.streams.paydown, plannedPay);
  const buyFill      = clampPct(view.streams.buyBtc, plannedBuy);

  const actTitle   = isMonth ? getMonthLabel(advisorStartDate, safeViewedMonth)
    : (selectedDay === today ? 'Today' : fmtDay(selectedDay));
  const actWhen    = isMonth ? `Month ${safeViewedMonth} · month-to-date` : fmtDay(selectedDay);
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
          <HeaderNavCluster
            active="journal"
            onDashboard={() => setSimpleView('dashboard')}
            onJournal={() => setSimpleView('daily')}
            onFullMode={() => setSimpleMode(false)}
            onAlmanac={onOpenAlmanac}
            onSettings={onOpenSettings}
          />
        </div>

        {/* R2c-5 — the backup nag also rides the Journal (an owner who lives here would never see the dashboard
            one). Self-gating + owner-only twice over: this surface is the !viewerMode branch of AppShell's
            renderOwnerJournal, AND the card gates on keyProvenance === 'generated' (null for a viewer).
            `backupNagDismissed` is session state, so a dismiss here also dismisses on the dashboard — one nag,
            one dismiss. Clears reactively when the ceremony stamps backupVerifiedAt. */}
        <BackupNagCard />

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
            currentMonth={safeViewedMonth}
            scope={scope}
            selectedDay={selectedDay}
            monthLabel={getMonthLabel(advisorStartDate, safeViewedMonth)}
            onScopeChange={setScope}
            onSelectDay={setSelectedDay}
            onPrevMonth={() => setViewedMonth((m) => Math.max(1, m - 1))}
            onNextMonth={() => setViewedMonth((m) => Math.min(currentMonth, m + 1))}
            canPrevMonth={safeViewedMonth > 1}
            canNextMonth={safeViewedMonth < currentMonth}
            onPrevWeek={() => setSelectedDay((d) => shiftDay(d, -7))}
            onNextWeek={() => setSelectedDay((d) => shiftDay(d, 7))}
            canPrevWeek={selectedDay > advisorStartDate}   // don't page before the strategy start
            canNextWeek={selectedDay < today}              // don't page into a fully-future week
            onLongPressDay={(iso) => {
              if (viewerMode || iso > today) return;       // same future guard as the FAB
              setSelectedDay(iso); setEditEvent(undefined); setSheetInitialType(undefined); setSheetOpen(true);
            }}
          />

          {/* P4c-3b — reconcile banner: Month scope, owner-only, when the VIEWED month is unconfirmed.
              Copy differs for a provisional month (needs a reading) vs a clean unconfirmed one. */}
          {isMonth && !viewerMode && needsReview && (
            <div className={styles.reconcileBanner}>
              <div className={styles.reconcileText}>
                <span className={styles.reconcileTitle}>
                  {isProvisional ? `Month ${safeViewedMonth} needs a balance reading` : `Month ${safeViewedMonth} — confirm your log`}
                </span>
                <span className={styles.reconcileSub}>
                  {isProvisional
                    ? "A logged day is missing its balances, so this month's figures are estimated."
                    : "Review this month's activity and sign off."}
                </span>
              </div>
              <button className={styles.reconcileBtn} onClick={() => setReviewOpen(true)}>Review</button>
            </div>
          )}

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
                <span className={styles.logTitle}>Month {safeViewedMonth} rollup</span>
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
                          data-testid={editable ? 'log-row' : undefined}
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
                {/* §2b — Strike minimum line + status chip (income: PAID/DUE/MISSED; roll: capitalize · Nth) */}
                <div className={styles.pbRow}>
                  <span className={`${styles.dot} ${styles.dotR}`} />
                  <span>
                    <span className={styles.pbLab}>Strike minimum</span>{' '}
                    {isIncomeSource
                      ? <span className={`${styles.minChip} ${styles[`minChip_${curMinStatus}`]}`}>{curMinStatus}</span>
                      : <span className={styles.pbNote}>· {blocMinPaymentDueDay}th</span>}
                  </span>
                  <span className={styles.pbAmt}>{fmtUSD(isIncomeSource ? strikeMinOwed : (plan.blocInterest))}</span>
                </div>
                {summaryText && <div className={styles.pbNotebox}>{summaryText}</div>}
              </>
            ) : (
              <div className={styles.empty}>{isStrategyComplete(advisorStartDate) ? 'Strategy complete — no plan for this month.' : 'No plan for this month.'}</div>
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
        month={safeViewedMonth}
        events={monthRollup.events}
        advisorStartDate={advisorStartDate}
        viewerMode={viewerMode}
        onClose={() => setMonthModalOpen(false)}
        onEditEvent={(ev) => { setMonthModalOpen(false); setEditEvent(ev); setSheetOpen(true); }}
        onDeleteEvent={(ev) => { deleteDayEvent(ev.id); setUndoEvent(ev); }}
      />

      {/* P2 — undo the last swipe-delete (5s). undoDayEventDeletion re-adds with a fresh ts, beating the
          already-published tombstone via edit-after-delete (mergeRecords). Lives here so it survives the modal. */}
      <Snackbar
        open={!!undoEvent}
        message="Event deleted"
        actionLabel="Undo"
        onAction={() => { if (undoEvent) undoDayEventDeletion(undoEvent); }}
        onDismiss={() => setUndoEvent(null)}
      />

      {/* P4b-1 add / P4b-2 edit — Daily-only write path. FAB opens add mode; a log-row tap opens edit mode.
          Hidden for read-only viewers. */}
      {!viewerMode && (
        <>
          {/* P4c-2 — future days can't be logged; the FAB greys out until today or a past day is selected. */}
          <button
            className={styles.fab}
            disabled={selectedDay > today}
            onClick={() => { setEditEvent(undefined); setSheetInitialType(undefined); setSheetOpen(true); }}
            aria-label="Log an event"
            title={selectedDay > today ? "Can't log a future date" : 'Log an event'}
          >+</button>
          <EventSheet
            open={sheetOpen}
            editEvent={editEvent}
            targetDate={selectedDay}
            initialType={sheetInitialType}
            onClose={() => { setSheetOpen(false); setEditEvent(undefined); setSheetInitialType(undefined); }}
          />
          {/* §2 — the SIGN-OFF (reconcile Review sheet); owner-only (the banner gates !viewerMode). The
              confirm is ONE atomic confirmMonth(month, extras); side-effects mirror the corrections build. */}
          <ReviewSheet
            open={reviewOpen}
            month={safeViewedMonth}
            rollup={monthRollup}
            isProvisional={isProvisional}
            source={blocMinPaymentSource}
            strikeMinPrefill={monthRollup.streams.minPayment > 0 ? monthRollup.streams.minPayment : strikeMinOwed}
            statementIsSet={monthRollup.streams.minPayment > 0 || blocStatementMinimum != null}
            ndpActive={blocMinPaymentSource === 'roll' && getNdpStatus(ndpLastPaidDate, advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * BLOC_OPERATING_CEILING, blocApr).status !== 'ok'}
            ndpPrefill={getNdpStatus(ndpLastPaidDate, advisorActualBlocBalance > 0 ? advisorActualBlocBalance : creditLine * BLOC_OPERATING_CEILING, blocApr).estimatedAmount}
            onClose={() => setReviewOpen(false)}
            onConfirm={(extras) => {
              confirmMonth(safeViewedMonth, extras);
              // Side-effects (mirror the corrections build): income → fresh statement + stamp the NDP clock
              // (an external minimum IS a non-draw payment); roll → stamp when an NDP was recorded.
              if (blocMinPaymentSource === 'income') { setBlocStatementMinimum(null); setNdpLastPaidDate(todayLocalISO()); }
              else if (extras.ndpPaid !== undefined) { setNdpLastPaidDate(todayLocalISO()); }
              // Carry: the signed month's ENDING Strike balance is the NEXT month's start base — ONLY when the month
              // just signed is immediately before the active month (a past-month sign-off via the ‹›nav must not
              // clobber the current base). Narrowed to a number: a provisional month may leave strikeBal absent.
              if (safeViewedMonth === currentMonth - 1) {
                const e = useStore.getState().monthlyLog.find((m) => m.month === safeViewedMonth);
                if (e && typeof e.strikeBal === 'number') setAdvisorMonthStartBalance(e.strikeBal);
              }
              setReviewOpen(false);
            }}
            onAddReading={() => { setReviewOpen(false); setEditEvent(undefined); setSheetInitialType('setBalance'); setSheetOpen(true); }}
          />
        </>
      )}
    </div>
  );
}
