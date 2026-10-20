import { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { buildMonthRollup } from '../Daily/calendarModel';
import { minPaymentStatus } from '../../simulation/simpleModePlan';
import type { NdpInfo } from '../../simulation/runAdvisor';
import { todayLocalISO } from '../../utils/format';
import type { MonthPlaybookLine } from '../Tools/crashPlaybookView';
import type { PlanMonth } from '../Almanac/usePlanMonth';
import { crashNote } from '../Almanac/decisionView';
import {
  planMonthActions, planStatus, planAfter, monthTrack, planMonthSummary, planSwitchNote, planRowDot, planRowNoteColor,
  planRowAmountColor, planBreakerLine, loggedMonthRows, loggedMonthAfter, loggedMonthStatus, venueSegments, VENUE_COLOR,
  planMinimumOwed, planMinimumLine, planInterestRollsLine, planNdpLine, planLedgerParts, planNextMonthLine,
  planSavingsLine, planPriceLine, planMeterAria, planSignoffLine, planSignoffSub, PLAN_CRASH_TITLE, planGoalLine, type PlanRow,
  type PlanAfterRow, type PlanStatus, type PlanMeter,
} from '../Almanac/planMonthView';
import styles from './SimpleModeView.module.css';

const OUTCOME_COLOR = { held: 'var(--green)', short: 'var(--amber)', doom: 'var(--red)' } as const;

export interface PlanMonthCardProps {
  /** The plan of record's run — the host's ONE run (`usePlanCardInputs`), shared with its month log (Run 3). */
  pm: PlanMonth;
  /** The strategy year's month (1–12) — what the Ledger signs off (D-R2-3). */
  currentMonth: number;
  strategyDone: boolean;
  /** The Emergency Console's line when today is a crash day (D13); null otherwise. */
  crashLine: MonthPlaybookLine | null;
  ndp: NdpInfo;
  ndpActionActive: boolean;
  onOpenLedger: () => void;
  onEditMonth: (month: number) => void;
}

/** A label with its venue words coloured (Strike white, Coinbase blue, cold storage orange). */
export function VenueText({ text }: { text: string }) {
  return (
    <>
      {venueSegments(text).map((sg, i) => (
        <span key={i} style={sg.venue !== null ? { color: VENUE_COLOR[sg.venue] } : undefined}>{sg.text}</span>
      ))}
    </>
  );
}

function Rows({ rows }: { rows: PlanRow[] }) {
  return (
    <ul className={styles.pmList}>
      {rows.map((r) => {
        const d = planRowDot(r);
        return (
          <li key={r.key} className={`${styles.pmRow} ${r.muted ? styles.pmMuted : ''}`}>
            <span className={styles.pmDot} style={{ background: d.background, borderColor: d.ring ?? 'transparent' }} />
            <span className={styles.pmLabel}>
              {r.muted ? r.label : <VenueText text={r.label} />}
              {r.note && <span className={styles.pmNote} style={{ color: planRowNoteColor(r) }}>{r.note}</span>}
            </span>
            <span className={styles.pmAmt} style={{ color: planRowAmountColor(r) }}>{r.amount}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Status({ st }: { st: PlanStatus }) {
  return (
    <div className={`${styles.pmStatus} ${styles[`pmStatus_${st.tone}`] ?? ''}`}>
      <p className={styles.pmStatusTitle}>{st.title}</p>
      {st.body && <p className={styles.pmStatusBody}>{st.body}</p>}
      {st.fixes.length > 0 && (
        <details className={styles.pmFix}>
          <summary>To be within it today</summary>
          {st.fixes.map((f) => <p key={f}>{f}</p>)}
        </details>
      )}
    </div>
  );
}

function Meter({ m }: { m: PlanMeter }) {
  return (
    <div className={styles.pmMeter} role="img"
      aria-label={planMeterAria(m)}>
      <div className={styles.pmMeterTrack}>
        <div className={styles.pmMeterFill} style={{ width: `${Math.min(100, m.atSupport * 100)}%`, background: m.over ? 'var(--amber)' : 'var(--green)' }} />
        <span className={styles.pmMeterTick} style={{ left: `${m.limit * 100}%` }} />
        <span className={`${styles.pmMeterTick} ${styles.pmMeterTickSeize}`} style={{ left: `${m.seize * 100}%` }} />
      </div>
      <div className={styles.pmMeterLabels}>
        <span style={{ left: `${m.limit * 100}%` }}>limit {Math.round(m.limit * 100)}%</span>
        <span className={styles.pmMeterLabelEnd}>seizes {Math.round(m.seize * 100)}%</span>
      </div>
    </div>
  );
}

function After({ head, rows, meter }: { head: string; rows: PlanAfterRow[]; meter: PlanMeter | null }) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className={styles.pmHead}>{head}</p>
      <dl className={styles.pmAfter}>
        {rows.map((r) => (
          <div key={r.key}>
            <div className={styles.pmAfterRow}>
              <dt style={r.venue !== null ? { color: VENUE_COLOR[r.venue] } : undefined}>{r.label}</dt>
              <dd style={r.tone === 'warn' ? { color: 'var(--amber)' } : undefined}>{r.value}</dd>
            </div>
            {r.key === 'cb' && meter && <Meter m={meter} />}
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * The plan of record's Monthly Playbook (Run 2, D-R2-2 + D-R2-8): one card, one month, each fact once. The scrubber
 * picks the month — this month and the rest of the strategy year from the plan's run (D4 + D-R2-3), a past month from
 * the Ledger. Every word comes from `planMonthView` (I31); this component composes none. Run 3: THIS MONTH and the
 * full-mode Advisor tab both show it, each passing its own one run (`usePlanCardInputs`).
 */
export function PlanMonthCard({
  pm, currentMonth, strategyDone, crashLine, ndp, ndpActionActive, onOpenLedger, onEditMonth,
}: PlanMonthCardProps) {
  const monthlyLog = useStore((s) => s.monthlyLog);
  const viewerMode = useStore((s) => s.viewerMode);
  const dayLog = useStore((s) => s.dayLog);
  const advisorStartDate = useStore((s) => s.advisorStartDate);
  const btcPrice = useStore((s) => s.btcPrice);
  const minSource = useStore((s) => s.blocMinPaymentSource);
  const dueDay = useStore((s) => s.blocMinPaymentDueDay);
  const statementMin = useStore((s) => s.blocStatementMinimum);
  const noteDismissed = useStore((s) => s.planNoteDismissed);
  const setNoteDismissed = useStore((s) => s.setPlanNoteDismissed);

  // The scrubber: "now" by default; snaps to the current month when the real month advances.
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  useEffect(() => { setSelectedMonth(currentMonth); }, [currentMonth]);
  const isCurrent = selectedMonth === currentMonth;
  const isPast = selectedMonth < currentMonth;
  // The card's month k (current or later) is the run's month k − currentMonth + 1 — one run for the month and the year.
  const runMonth = selectedMonth - currentMonth + 1;
  const row = !isPast ? (pm.run.sim.rows.find((r) => r.m === runMonth) ?? null) : null;
  const supportAt = (m: number): number => pm.run.supportPath[Math.min(m, pm.run.supportPath.length - 1)];
  const cbStop = pm.run.placementInput.cbStop;
  const entry = monthlyLog.find((e) => e.month === selectedMonth);
  const currentEntry = monthlyLog.find((e) => e.month === currentMonth);
  const needsSignoff = !strategyDone && (currentEntry ? currentEntry.confirmed === false : true);
  const mtd = buildMonthRollup(dayLog, advisorStartDate, currentMonth).streams;

  // §2b — the minimum's ledger status (income mode): the statement's figure when entered, else the plan's month-1 interest.
  const planRow1 = pm.run.sim.rows.find((r) => r.m === 1) ?? pm.run.sim.last;
  const minOwed = planMinimumOwed(statementMin, planRow1.strikeInterestUsd);
  const minLine = planMinimumLine(minOwed, dueDay);
  const minStatus = minPaymentStatus({
    source: minSource, paidSoFar: mtd.minPayment, owed: minOwed,
    dueDay, todayDay: Number(todayLocalISO().split('-')[2]), isCurrent: true,
  });

  const status: PlanStatus | null = isPast ? loggedMonthStatus(entry, selectedMonth)
    : row ? planStatus(pm.run.sim, pm.run.placement, runMonth, {
      monthsBackUnder: pm.monthsBackUnder, cbStop, support0: pm.run.supportPath[0], coldBtc: pm.coldBtc,
    }) : null;
  const crash = isCurrent && crashLine !== null;
  const rows = isPast ? (entry ? loggedMonthRows(entry) : []) : row ? planMonthActions(pm.run.sim, pm.run.placement, runMonth) : [];
  const after = row ? planAfter(row, supportAt(runMonth), cbStop, pm.run.sim.policyApplied) : null;
  const breakerLine = isCurrent ? planBreakerLine(pm.breaker) : null;
  // BL14 (G1-C) — the goal line: the run's own figure for the month against the saved goal (null with none).
  const goal = pm.run.engineInputs.goalNetBtc ?? null;
  const goalLine = row ? planGoalLine(row, goal) : null;
  const rollsLine = row ? planInterestRollsLine(row.strikeInterestUsd, dueDay) : null;
  const why = row ? planMonthSummary(pm.run.sim, pm.run.placement, runMonth, supportAt(runMonth), goal) : '';
  // The savings need: bills nothing paid, over the plan's months left in the strategy year.
  const savingsLine = planSavingsLine(pm.run.sim, 12 - currentMonth + 1);
  const nextLine = planNextMonthLine(pm.run.sim);
  const ledger = planLedgerParts(mtd);

  return (
    <>
      {/* D8 — the one-time note, dismissed once on this device. */}
      {!noteDismissed && !viewerMode && (
        <div className={styles.planNote}>
          <span className={styles.planNoteText}>{planSwitchNote(cbStop)}</span>
          <button className={styles.planNoteClose} onClick={() => setNoteDismissed(true)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* One status colour per card: the plan's own (no Advisor tier border beside it). */}
      <div className={styles.card}>
        <div className={styles.scrubHeader}>
          <div className={styles.scrubHeaderTop}>
            <div className={styles.scrubTitleGroup}>
              <h3 className={styles.planTitle}>
                Monthly Playbook <span className={styles.planTitleSep}>·</span> Month <span className={styles.scrubMonthNum}>{selectedMonth}</span> of 12
              </h3>
              <span className={`${styles.scrubBadge} ${isCurrent ? styles.scrubBadgeCurrent : entry ? styles.scrubBadgeLogged : styles.scrubBadgeProjected}`}>
                {isCurrent ? 'CURRENT' : entry ? '✓ LOGGED' : isPast ? 'PAST' : 'PROJECTED'}
              </span>
            </div>
          </div>
          {!isPast && (
            <div className={styles.scrubMeta}>
              <span className={styles.scrubLtv}>{planPriceLine(btcPrice, supportAt(runMonth))}</span>
            </div>
          )}
          <input
            type="range"
            className={styles.scrubSlider}
            style={{ background: monthTrack(pm.run.sim, currentMonth) }}
            min={1} max={12} step={1}
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            aria-label="Scrub through months"
          />
          <div className={styles.scrubMonthLabels}>
            {[1, 3, 6, 9, 12].map((m) => <span key={m} className={styles.scrubMonthTick}>M{m}</span>)}
          </div>
        </div>

        <div className={styles.pm}>
          {crash && crashLine ? (
            <div className={`${styles.pmStatus} ${styles.pmStatus_bad}`}>
              <p className={styles.pmStatusTitle}>{PLAN_CRASH_TITLE}</p>
              {crashLine.pastLiquidation && <p className={styles.pmStatusBody} style={{ color: 'var(--red)' }}>{crashLine.pastLiquidation}</p>}
              <p className={styles.pmStatusBody}>{crashLine.order}</p>
              {crashLine.gap && <p className={styles.pmStatusBody}>{crashLine.gap}</p>}
              {crashLine.steps.map((step) => <p key={step} className={styles.pmStatusBody}>{step}</p>)}
              <p className={styles.pmStatusBody} style={{ color: OUTCOME_COLOR[crashLine.outcome.kind] }}>{crashLine.outcome.text}</p>
            </div>
          ) : status && <Status st={status} />}
          {breakerLine && <p className={styles.pmFoot} style={{ marginLeft: 0 }}>{breakerLine}</p>}
          {goalLine && <p className={styles.pmFoot} style={{ marginLeft: 0 }}>{goalLine}</p>}

          {rows.length > 0 && (
            <>
              <p className={styles.pmHead}>{isPast ? `What month ${selectedMonth} recorded` : isCurrent ? 'To do this month' : `The plan for month ${selectedMonth}`}</p>
              <Rows rows={rows} />
            </>
          )}
          {!isPast && row && (
            <>
              {crash && <p className={styles.pmFoot}>{crashNote(true)}</p>}
              {minSource === 'income' ? (minLine && (
                <p className={styles.pmFoot}>
                  {minLine}{isCurrent && <span className={`${styles.minChip} ${styles[`minChip_${minStatus}`]}`}>{minStatus}</span>}
                </p>
              )) : (rollsLine && <p className={styles.pmFoot}>{rollsLine}</p>)}
              {isCurrent && ndpActionActive && (
                <p className={styles.pmFoot} style={ndp.status === 'soon' || ndp.status === 'overdue' ? { color: 'var(--amber)' } : undefined}>
                  {planNdpLine(ndp)}
                </p>
              )}
            </>
          )}

          {after && <After head={isCurrent ? 'After this month' : `After month ${selectedMonth}`} rows={after.rows} meter={after.meter} />}
          {isPast && entry && <After head="At month-end" rows={loggedMonthAfter(entry)} meter={null} />}
        </div>

        {/* The Ledger, once: the sign-off pointer carries the month's progress; signed off, the strip alone. */}
        {isCurrent && (needsSignoff && !viewerMode ? (
          <button className={styles.signoffPointer} onClick={onOpenLedger}>
            {planSignoffLine(currentMonth)}{' '}→
            <span className={styles.signoffSub}>{planSignoffSub(ledger)}</span>
          </button>
        ) : (
          <button className={styles.mtdStrip} onClick={onOpenLedger}>
            {ledger !== null ? `Ledger: ${ledger}` : 'Ledger'} ›
          </button>
        ))}

        {!isCurrent && (
          <div className={styles.previewActions}>
            {isPast && entry && !viewerMode && (
              <button className={styles.previewEditBtn} onClick={() => onEditMonth(selectedMonth)}>✎ View / edit this month</button>
            )}
            <button className={styles.backToCurrentBtn} onClick={() => setSelectedMonth(currentMonth)}>← Back to current month</button>
          </div>
        )}

        {!isPast && savingsLine && <p className={styles.savingsNeed}>{savingsLine}</p>}

        {why && (
          <details className={styles.pmWhy}>
            <summary>Why this plan?</summary>
            <p>{why}</p>
          </details>
        )}
      </div>

      {/* Hidden in the strategy year's last month, as before Run 2 (its next month is past the Ledger's year). */}
      {!strategyDone && currentMonth < 12 && nextLine && <p className={styles.nextMonthPreview}>{nextLine}</p>}
    </>
  );
}
