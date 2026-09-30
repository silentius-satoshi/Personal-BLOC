import { Fragment, memo, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Customized,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { runCyclingSim, effectiveStrikeCapPct } from '../../simulation/cyclingSim';
import { plBandsAt, plConvergencePath, addMonths, PL_BAND_LABEL, PL_ON_THE_LINE } from '../../simulation/powerLaw';
import { cycleConvergencePath, upcomingCycleTurns, type PathKind } from '../../simulation/cyclePath';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { STRIKE_MAX_DRAW_LTV, STRIKE_LINE_MIN_USD, STRIKE_LINE_MAX_USD } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { deriveCbCollateral } from '../../simulation/logUtils';
import { placementPlan, suggestedLineUsd, type PlacementInput } from '../../simulation/placement';
import { evaluatePaths, worstCasePath, sameSeries } from '../../simulation/planSearch';
import { usePowerLawData } from '../../hooks/usePowerLawData';
import { strikeHoldFrom } from '../Tools/crashPlaybookView';
import {
  applyPathStress, clampMonth, verdictVsNeverDraw, verdictBasisClause, nextTurnsText, isBelowSupport, fmtTurnDate,
  DEFAULT_STRIKE_CAP_PCT, DEFAULT_STRIKE_CAP_ON,
} from './cyclingFaceView';
import {
  DEFAULT_SUPPORT_POLICY_SETTINGS, DEFAULT_BREAKER_REARM_MONTHS, effectivePolicySettings,
  shownBtc, ZONE_COLOR, ZONE_LABEL, ZONE_LETTER, type SupportPolicySettings,
} from './supportPolicyView';
import {
  buildSupportPath, supportPolicyFor, supportAtDates, breakerFromHistory, holdMonthsFrom,
} from './supportPolicyInputs';
import {
  buildChartSeries, cliffPath, chartDomain, xExtent, pathOnSupport, type DecisionChartSeries,
} from './decisionChartView';
import {
  moveCard, moveCardText, planSchedule, planOutcome, coinbaseLoanLine, scheduleToText, crashNote, consoleLinkLabel,
  decisionDisclaimer, pathSublabel, pathNoun, pathNote, scheduleHeader, breakerReading, outcomeTiles,
  scheduleFileName, manualPriceNote, stressNote, fmtBtc3, BELOW_SUPPORT_NOTE, DECISION_FRAMING, ON_SUPPORT_NOTE,
  SCHEDULE_KEEP_HEADER, SCHEDULE_KEEP_KEY,
  type DecisionPath, type LineAction, type MoveTone,
} from './decisionView';
import SupportPolicyCard from './SupportPolicyCard';
import { useStressLens } from './useStressLens';
import { SliderInput } from '../ui/SliderInput';
import { downloadBlob } from '../../lib/backup/downloadFile';
import {
  timeTicks, tickDensity, fmtTimeTick, logTicks, priceTickFormatter, type Domain, type Scales, type View,
} from '../../lib/chartZoom';
import { useChartZoom } from '../../hooks/useChartZoom';
import { ChartZoomFrame } from '../ui/ChartZoomFrame';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './DecisionFace.module.css';

/**
 * Almanac Decision face — the TWELFTH face. THE MOVE for this month, then the MODELED plan it starts.
 *
 * ONE run, many lenses (D8): one `engineInputs` memo, one base run plus the stress run, and every card reads the
 * SAME `sim`. `evaluatePaths` only picks the Worst (modeled) crown — never a second truth.
 *
 * THE MOVE is the engine's own steps 5 and 9, previewed at today's anchor and support (`placementPlan`), so the card,
 * the run and the schedule are one plan. The run starts from the move exactly when the move is MADE (D10, v1.6):
 * `placement.seeded`, and the support policy is on — off, the card names no move, so the run starts from the store's
 * own balances. The breaker and Strike's hold are the policy's memory, rebuilt from prices and logged deposits (D14).
 *
 * 🔴 THE FACE COMPOSES NO COPY (I31). Every sentence comes from `decisionView.ts`; this file holds labels only.
 * 🔴 READ-ONLY: zero store writes. Every control is a session overlay; "Reset to live" clears it.
 * 🔴 THE §2 CROSSING LIVES HERE, as on the parents: the power law and the 4-yr cycle (BELIEFS) become plain
 * `number[]` paths before the engine sees them. The two worst options are face-local (D2): each resolves to a
 * `number[]`, and neither ever indexes a band table.
 *
 * Scope is §7's list — a decision, compact evidence, and tap-through. No cash-flow sentences (D12), no milestone
 * table, and no cycle-timing control: the 4-yr path runs at phase shift 0 (G10).
 */

// Face-local defaults mirror the Cycling face — the loop this face schedules. Only the Strike-cap defaults are
// shared definitions. The Coinbase defense line, the Strike cap, the cold sweep and the cadence have no control
// here: they are constants, so they sit outside every dependency list.
const CAP_PCT = 70;
const STRIKE_CAP_PCT = DEFAULT_STRIKE_CAP_ON ? DEFAULT_STRIKE_CAP_PCT : 0;
const STRIKE_CAP_EFF = effectiveStrikeCapPct(STRIKE_CAP_PCT, STRIKE_MARGIN_CALL_LTV);
const COLD_BUFFER_PCT = 30;   // used only if the owner turns the policy off
const CYCLE_MONTHS = 1;
const DEFAULT_CONVERGE_MONTHS = PL_ON_THE_LINE;
const REVERT_PRESET_MONTHS = 48;   // what the chip restores — distinct from the default, or the toggle is a no-op
const DEFAULT_HORIZON_MONTHS = 60;
const DEFAULT_PATH: DecisionPath = 'floor';
const DEFAULT_INSPECT_MONTH = 1;   // this month, so a stress starts now
const LINE_STEP_USD = 500;
/** The body class the Print button sets. ⚠ The same literal gates the print rules in DecisionFace.module.css. */
const PRINT_CLASS = 'decision-print';

// ⚠ The cycle's colour is --maroon-lift (5.00:1), never the raw --maroon (2.47:1). The ORDER is the paths' order.
const PATH_META: { key: PathKind; label: string; color: string }[] = [
  { key: 'floor',    label: PL_BAND_LABEL.floor,   color: 'var(--green)' },
  { key: 'fair',     label: PL_BAND_LABEL.fair,    color: 'var(--btc)' },
  { key: 'ceiling',  label: PL_BAND_LABEL.ceiling, color: 'var(--amber)' },
  { key: 'fourYear', label: '4-yr cycle',          color: 'var(--maroon-lift)' },
];
const PATH_KINDS: PathKind[] = PATH_META.map((p) => p.key);
const metaOf = (k: PathKind) => PATH_META.find((p) => p.key === k)!;
const WORST_META: { key: 'worstStitched' | 'worstModeled'; label: string }[] = [
  { key: 'worstStitched', label: 'Worst (stitched)' },
  { key: 'worstModeled', label: 'Worst (modeled)' },
];
const STITCHED_COLOR = 'var(--text-primary)';

const TONE_CLASS: Record<MoveTone, string> = {
  plain: '', good: styles.toneGood, warn: styles.toneWarn, bad: styles.toneBad,
};
const TONE_COLOR: Record<MoveTone, string> = {
  plain: 'var(--text-primary)', good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)',
};

interface Overlay {
  path?: DecisionPath;
  convergeMonths?: number;
  months?: number;
  /** The run's line (D11) — a what-if, never the store's. */
  creditLine?: number;
  /** The support policy's settings, patched over DEFAULT_SUPPORT_POLICY_SETTINGS. */
  supportPolicy?: Partial<SupportPolicySettings>;
}

const fmtHorizon = (v: number): string => {
  const y = Math.floor(v / 12), m = v % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y}y ${m}m`;
};
const fmtAxisUsd = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  if (v >= 1) return `$${Math.round(v)}`;
  return `$${v.toFixed(2)}`;
};

interface TipItem { name?: string; value?: number | null; color?: string }
/** The faces' token tooltip, dated in UTC through the fixed month table. */
function DecisionTip({ active, payload, label }: { active?: boolean; payload?: TipItem[]; label?: number }) {
  if (!active || !payload?.length || typeof label !== 'number') return null;
  const rows = payload.filter((p) => typeof p.value === 'number' && p.value > 0);
  if (rows.length === 0) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{fmtTurnDate(new Date(label))}</div>
      {rows.map((p) => (
        <div key={p.name} className={styles.tooltipRow}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{fmtUSD(p.value as number)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Dates × log price — the chart-zoom scales (a module constant, so the hook's inputs stay stable). */
const TIME_LOG: Scales = { x: 'linear', y: 'log' };

interface DecisionChartProps {
  chart: DecisionChartSeries;
  xRange: Domain;
  domain: Domain;
  pathColor: string;
  drawFloor: boolean;
  hasCliff: boolean;
  /** The inspected month's hairline, or null at month 0. */
  inspectT: number | null;
}

/**
 * The chart (D5, D6), with chart zoom (spec `pbloc-spec-chart-zoom-v1.md`). Memoised and fed only from the face's own
 * memos, so a pan or pinch re-renders this chart — never the schedule. VIEW ONLY: the series, their domains and the
 * seam all come from the face; zoom only chooses the axis domains and ticks.
 */
const DecisionChart = memo(function DecisionChart({
  chart, xRange, domain, pathColor, drawFloor, hasCliff, inspectT,
}: DecisionChartProps) {
  const fullView = useMemo((): View => ({ x: xRange, y: domain }), [xRange, domain]);
  const zoom = useChartZoom(fullView, TIME_LOG);
  // Explicit ticks — with per-series data recharts would otherwise tick every data point.
  const xAxis = useMemo(() => timeTicks(zoom.view.x, tickDensity(zoom.plotWidth)), [zoom.view.x, zoom.plotWidth]);
  const yTicks = useMemo(() => logTicks(zoom.view.y), [zoom.view.y]);
  const fmtPrice = useMemo(() => priceTickFormatter(yTicks, fmtAxisUsd), [yTicks]);
  const fmtDate = useCallback((t: number, i: number) => fmtTimeTick(t, xAxis.unit, i), [xAxis.unit]);
  // A per-mount gradient id — PriceChart's `priceFill` is a document-global SVG id, so a literal one could collide.
  const uid = useId();
  const gradientId = `decisionHistory${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div className={styles.chartBox}>
      <ChartZoomFrame zoom={zoom}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--btc)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--btc)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--line-2)" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={zoom.view.x} ticks={xAxis.ticks} allowDataOverflow
              allowDuplicatedCategory={false} tickFormatter={fmtDate}
              tick={{ fontSize: 10, fill: 'var(--text-faint)' }} axisLine={false} tickLine={false} />
            <YAxis type="number" scale="log" domain={zoom.view.y} ticks={yTicks} allowDataOverflow tickFormatter={fmtPrice}
              tick={{ fontSize: 10, fill: 'var(--text-faint)' }} axisLine={false} tickLine={false} width={52} />
            <Tooltip content={<DecisionTip />} active={zoom.dragging ? false : undefined} />
            <Area data={chart.history} dataKey="price" name="History" type="monotone" baseValue="dataMin"
              stroke="var(--btc)" strokeWidth={1.5} fill={`url(#${gradientId})`} dot={false}
              isAnimationActive={false} />
            <Line data={chart.support} dataKey="price" name="Support" stroke="var(--green)" strokeWidth={1.25}
              dot={false} isAnimationActive={false} connectNulls={false} />
            {drawFloor && (
              <Line data={chart.floor} dataKey="price" name="Stitched floor" stroke={STITCHED_COLOR}
                strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
            )}
            <Line data={chart.forward} dataKey="price" name="Modeled path" stroke={pathColor} strokeWidth={1.75}
              strokeDasharray="5 3" dot={false} isAnimationActive={false} />
            {hasCliff && (
              <Line data={chart.cliff} dataKey="price" name="Coinbase seizes" stroke="var(--red)"
                strokeWidth={1.25} strokeDasharray="1 3" dot={false} isAnimationActive={false}
                connectNulls={false} />
            )}
            <ReferenceLine x={chart.seamT} stroke="var(--text-faint)" strokeDasharray="2 2" />
            {inspectT !== null && <ReferenceLine x={inspectT} stroke="var(--btc)" strokeOpacity={0.55} />}
            <Customized component={zoom.probe} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartZoomFrame>
    </div>
  );
});

export interface DecisionFaceProps {
  /** Tap-through to a parent face, or to the Emergency Console. A narrow union, so this face never imports the
   *  hub's own `Face` type back. */
  onNavigate: (face: 'cycling' | 'ownership' | 'unified' | 'defense') => void;
}

export default function DecisionFace({ onNavigate }: DecisionFaceProps) {
  const s = useStore(useShallow((st) => ({
    btcPrice: st.btcPrice,
    btcPriceMode: st.btcPriceMode,   // 'live' polls; 'manual' is the owner typing — see useStressLens
    income: st.income,
    expenses: st.expenses,
    blocApr: st.blocApr,
    cbAprPct: st.cbAprPct,
    creditLine: st.creditLine,
    cbLtvTriggerPct: st.cbLtvTriggerPct,
    cbLtvTargetPct: st.cbLtvTargetPct,
    cbPaymentStrategy: st.cbPaymentStrategy,
    hasCbLoan: st.hasCbLoan,
    strikeLiquidationLtvPct: st.strikeLiquidationLtvPct,
    strikeCollateralBtc: st.getCurrentBtcHeld(),   // reading-anchored, Strike-only (v20)
    strikeBalance: st.advisorActualBlocBalance,
    // Derived INSIDE the selector so the value stays a primitive (the parents' precedent).
    cbCollateralBtc: deriveCbCollateral(st.dayLog, st.cbCollateralBtc),
    // The owner's REAL cold reserve (real-cold spec v1). A primitive.
    openingColdBtc: st.getCurrentColdBtc(),
    cbLoanBalance: st.cbLoanBalance,
    cbLoanBalanceAsOf: st.cbLoanBalanceAsOf,
    dayLog: st.dayLog,   // Strike's 60-day hold, from logged deposits
  })));

  const [overlay, setOverlay] = useState<Overlay>({});
  const set = <K extends keyof Overlay>(k: K, v: Overlay[K]) => setOverlay((o) => ({ ...o, [k]: v }));
  const dirty = Object.keys(overlay).length > 0;

  const convergeMonths = overlay.convergeMonths ?? DEFAULT_CONVERGE_MONTHS;
  const months = overlay.months ?? DEFAULT_HORIZON_MONTHS;
  const onTheLine = convergeMonths === PL_ON_THE_LINE;
  const consoleRuns = s.hasCbLoan && s.cbPaymentStrategy === 'ltvTriggered';

  // ONE frozen "today" — the start date, the hold and the breaker seed all read it (UTC-midnight of the LOCAL day,
  // the repo's date-only convention).
  const todayISO = useMemo(() => todayLocalISO(), []);
  const startDate = useMemo(() => new Date(todayISO), [todayISO]);
  // The accrual boundary crossed HERE, so the engine stays clock-free.
  const cbDebt = useMemo(
    () => accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf),
    [s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf],
  );

  // ── The support policy — every object memoised on STABLE identities (an object built during render would rebuild
  // `engineInputs` every render and the lens reset below would kill an engaged stress).
  const policyRaw = useMemo(
    () => ({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...overlay.supportPolicy }),
    [overlay.supportPolicy],
  );
  const policySettings = useMemo(
    () => effectivePolicySettings(policyRaw, { cbLtvCapPct: CAP_PCT, strikeCapEffPct: STRIKE_CAP_EFF }),
    [policyRaw],
  );
  // 🔴 Built ONLY through buildSupportPath and NEVER stressed or phase-shifted: the lens moves the price, not the line.
  const supportPath = useMemo(() => buildSupportPath(startDate, months), [startDate, months]);
  const supportPolicy = useMemo(
    () => supportPolicyFor(policySettings, supportPath, s.expenses, s.strikeLiquidationLtvPct, 'cycle'),
    [policySettings, supportPath, s.expenses, s.strikeLiquidationLtvPct],
  );
  const setPolicy = (patch: Partial<SupportPolicySettings>) =>
    setOverlay((o) => ({ ...o, supportPolicy: { ...o.supportPolicy, ...patch } }));
  const resetPolicy = () => setOverlay(({ supportPolicy: _dropped, ...rest }) => rest);

  // ⚠ DECLARED BEFORE ANYTHING THAT PRICES — the anchor split (useStressLens). THE MOVE and every path read the held
  // anchor, never the polled quote, or a stress scenario could not outlive one tick.
  const { lens, setLens, anchorPrice, priceHeld, livePrice, drift } = useStressLens(s.btcPrice, s.btcPriceMode);

  // ── The policy's memory (D14): Strike's hold from logged deposits, the breaker from month-end prices.
  const hold = useMemo(() => strikeHoldFrom(s.dayLog, todayISO), [s.dayLog, todayISO]);
  const { historical, loading: historyLoading } = usePowerLawData();
  const breakerSeed = useMemo(
    () => breakerFromHistory(historical, startDate, DEFAULT_BREAKER_REARM_MONTHS ?? null),
    [historical, startDate],
  );
  const holdMonths = useMemo(() => holdMonthsFrom(hold.throughISO, startDate), [hold.throughISO, startDate]);

  // ── One line per run (D11): the what-if when engaged, else the owner's own.
  const runLine = overlay.creditLine ?? s.creditLine;
  const suggested = useMemo(() => suggestedLineUsd({
    expenses: s.expenses, cbDebt, cbCollateralBtc: s.cbCollateralBtc, price: anchorPrice,
    cbLtvTriggerPct: s.cbLtvTriggerPct, cbLtvTargetPct: s.cbLtvTargetPct,
  }), [s.expenses, cbDebt, s.cbCollateralBtc, anchorPrice, s.cbLtvTriggerPct, s.cbLtvTargetPct]);

  // ── THE MOVE (B1): ONE input object feeds both the plan and the card, so the card can never price its cliff
  // against a different number than the move it shows.
  const placementInput = useMemo((): PlacementInput => ({
    creditLine: runLine,
    strikeBalance: s.strikeBalance,
    strikeCollateralBtc: s.strikeCollateralBtc,
    cbDebt,
    cbCollateralBtc: s.cbCollateralBtc,
    coldBtc: s.openingColdBtc,
    price: anchorPrice,
    support: supportPath[0],
    skStop: policySettings.skStopEffPct / 100,
    cbStop: policySettings.cbStopEffPct / 100,
    cbDefenseLtv: CAP_PCT / 100,
    bufferUsd: policySettings.bearBufferMonths * s.expenses,
    accumulateBelow: policySettings.accumulateBelow,
    payDownAbove: policySettings.payDownAbove,
    inHold: hold.inHold,
    broken: breakerSeed?.state.broken ?? false,
  }), [
    runLine, s.strikeBalance, s.strikeCollateralBtc, cbDebt, s.cbCollateralBtc, s.openingColdBtc, anchorPrice,
    supportPath, policySettings, s.expenses, hold.inHold, breakerSeed,
  ]);
  const placement = useMemo(() => placementPlan(placementInput), [placementInput]);
  // D10 / v1.6 — the run starts from the move only when it is MADE. With the policy off the card names no move.
  const seedFromMove = placement.seeded && supportPolicy !== undefined;

  // ── The four modelled paths, from the held anchor. Worst (stitched) is the floor under all four.
  const paths = useMemo(() => [
    plConvergencePath(anchorPrice, 'floor', startDate, months, convergeMonths),
    plConvergencePath(anchorPrice, 'fair', startDate, months, convergeMonths),
    plConvergencePath(anchorPrice, 'ceiling', startDate, months, convergeMonths),
    cycleConvergencePath(anchorPrice, startDate, months, convergeMonths, 0),
  ], [anchorPrice, startDate, months, convergeMonths]);
  const stitched = useMemo(() => worstCasePath(paths), [paths]);
  // D3 / D4 — bit for bit, or it is a second future worth offering.
  const stitchedIsSupport = useMemo(() => sameSeries(stitched, paths[0]), [stitched, paths]);
  const rawChoice = overlay.path ?? DEFAULT_PATH;
  // A disabled option is never run, even for the render before the fallback below lands.
  const choice: DecisionPath = rawChoice === 'worstStitched' && stitchedIsSupport ? 'floor' : rawChoice;
  useEffect(() => {
    if (overlay.path === 'worstStitched' && stitchedIsSupport) setOverlay(({ path: _p, ...rest }) => rest);
  }, [overlay.path, stitchedIsSupport]);

  // ONE engine-inputs memo for the base run, the stress run and the crown. `defendCbLtv` is automatic.
  const engineInputs = useMemo(() => ({
    startYear: startDate.getUTCFullYear(),
    strikeCollateralBtc: seedFromMove ? placement.opening.strikeCollateralBtc : s.strikeCollateralBtc,
    strikeBalance: s.strikeBalance,
    strikeCreditLine: runLine,
    strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
    strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
    cbCollateralBtc: seedFromMove ? placement.opening.cbCollateralBtc : s.cbCollateralBtc,
    cbDebt,
    openingColdBtc: seedFromMove ? placement.opening.coldBtc : s.openingColdBtc,
    income: s.income,
    expenses: s.expenses,
    strikeAprPct: s.blocApr,
    cbAprPct: s.cbAprPct,
    cycleMonths: CYCLE_MONTHS,
    cbLtvCapPct: CAP_PCT,
    strikeLtvCapPct: STRIKE_CAP_PCT,
    coldStoreBufferPct: COLD_BUFFER_PCT,
    defendCbLtv: true,
    mode: 'cycle' as const,
    supportPolicy,
    openingBreaker: breakerSeed?.state,
    openingStrikeHoldMonths: holdMonths,
  }), [
    startDate, seedFromMove, placement, s.strikeCollateralBtc, s.strikeBalance, runLine, s.cbCollateralBtc, cbDebt,
    s.openingColdBtc, s.income, s.expenses, s.blocApr, s.cbAprPct, supportPolicy, breakerSeed, holdMonths,
  ]);

  // The crown reads the SAME inputs as the displayed run (D8). No cycle: `engineInputs` never reads the path.
  const crown = useMemo(() => evaluatePaths(engineInputs, paths, PATH_KINDS), [engineInputs, paths]);
  const crownKind: PathKind = PATH_KINDS[crown.worstIndex] ?? 'floor';
  const crownNoun = pathNoun(crownKind, metaOf(crownKind).label);
  // The underlying kind of the displayed path — the crown's for Worst (modeled); null for the stitched floor. It
  // feeds the path note and the colours, so no band table is ever indexed with a worst option (I19).
  const resolvedKind: PathKind | null = choice === 'worstStitched' ? null
    : choice === 'worstModeled' ? crownKind : choice;
  const pricePath = useMemo(() => {
    if (choice === 'worstStitched') return stitched;
    if (choice === 'worstModeled') return paths[crown.worstIndex] ?? paths[0];
    return paths[PATH_KINDS.indexOf(choice)];
  }, [choice, stitched, paths, crown.worstIndex]);
  const pathColor = resolvedKind === null ? STITCHED_COLOR : metaOf(resolvedKind).color;

  const baseSim = useMemo(() => runCyclingSim({ ...engineInputs, pricePath }), [engineInputs, pricePath]);
  const baseRowCount = baseSim.rows.length;
  const [selectedMonth, setSelectedMonth] = useState(DEFAULT_INSPECT_MONTH);
  // ⚠ CLAMP AT RENDER TIME (the crash fix) — `rows[selectedMonth]` must never appear.
  const monthIdx = clampMonth(selectedMonth, baseRowCount);
  const stressPath = useMemo(() => applyPathStress(pricePath, monthIdx, lens), [pricePath, monthIdx, lens]);
  const sim = useMemo(
    () => (lens === 1 ? baseSim : runCyclingSim({ ...engineInputs, pricePath: stressPath })),
    [lens, baseSim, engineInputs, stressPath],
  );
  useEffect(() => { setSelectedMonth((m) => Math.min(m, baseRowCount - 1)); }, [baseRowCount]);

  // Mirrors the engine-inputs memo — a stress measured against inputs that have since moved reports the wrong plan.
  // `startDate` is the one legitimate omission (it only feeds `pricePath`, which is here). resetMirror.test.ts fails
  // if any other engine input is missing.
  useEffect(() => { setLens(1); }, [
    monthIdx, pricePath, cbDebt, seedFromMove, placement, s.strikeCollateralBtc, s.strikeBalance, runLine,
    s.cbCollateralBtc, s.openingColdBtc, s.income, s.expenses, s.blocApr, s.cbAprPct, supportPolicy, breakerSeed,
    holdMonths,
  ]);

  const selRow = sim.rows[monthIdx] ?? sim.last;
  // Every opening figure includes the cold reserve. The move conserves the total (I2), so seeding never changes it.
  const openingBtc = s.strikeCollateralBtc + s.cbCollateralBtc + s.openingColdBtc;
  // One source for the support line at this month: the SAME path the engine's policy reads.
  const supportAtMonth = supportPath[monthIdx];
  const belowSupport = isBelowSupport(selRow.price, supportAtMonth);

  // ── THE MOVE's copy — every line from moveCard (I31). Price, support, debt and stop come from placementInput (B1).
  const breakerRead = useMemo(() => breakerReading(breakerSeed, historyLoading), [breakerSeed, historyLoading]);
  const move = useMemo(() => moveCard({
    policyApplied: sim.policyApplied,
    policyEnabled: policySettings.enabled,
    policyIgnoredReason: sim.policyIgnoredReason,
    plan: placement,
    holdThroughISO: hold.throughISO,
    holdDepositISO: hold.depositISO,
    breaker: breakerRead,
    rearmRule: DEFAULT_BREAKER_REARM_MONTHS ?? null,
    runLineUsd: runLine,
    ownerLineUsd: s.creditLine,
    suggestedLineUsd: suggested,
    expenses: s.expenses,
    bearBufferMonths: policySettings.bearBufferMonths,
    cbStop: placementInput.cbStop,
    support: placementInput.support,
    price: placementInput.price,
    cbDebt: placementInput.cbDebt,
    cbLtvTriggerPct: s.cbLtvTriggerPct,
    cbLtvTargetPct: s.cbLtvTargetPct,
    hasCbLoan: s.hasCbLoan,
    ltvTriggered: s.cbPaymentStrategy === 'ltvTriggered',
  }), [
    sim.policyApplied, policySettings, sim.policyIgnoredReason, placement, hold, breakerRead, runLine, s.creditLine,
    suggested, s.expenses, placementInput, s.cbLtvTriggerPct, s.cbLtvTargetPct, s.hasCbLoan, s.cbPaymentStrategy,
  ]);
  const onLineAction = (a: LineAction) => {
    if (a.kind === 'tryLine') set('creditLine', a.lineUsd);
    else setOverlay(({ creditLine: _c, ...rest }) => rest);
  };
  const loanLine = coinbaseLoanLine(sim, placement, s.hasCbLoan);

  // ── The chart (D5, D6) — the displayed path is the one `sim` actually ran (the stress path while engaged).
  const displayedPath = lens === 1 ? pricePath : stressPath;
  const cliff = useMemo(() => cliffPath(sim.rows), [sim.rows]);
  const chart = useMemo(
    () => buildChartSeries(historical, startDate, displayedPath, stitched, supportPath, supportAtDates, months, cliff),
    [historical, startDate, displayedPath, stitched, supportPath, months, cliff],
  );
  const domain = useMemo(() => chartDomain(chart), [chart]);
  // The chart's full extent — the unzoomed view. Chart zoom narrows the axes inside DecisionChart, never these.
  const xRange = useMemo(() => xExtent(chart), [chart]);
  const hasCliff = chart.cliff.some((p) => p.price !== null);
  // The stitched floor is always drawn — once: not when it IS the displayed path, nor on the line while it is Support.
  const drawFloor = !sameSeries(stitched, displayedPath) && !(onTheLine && stitchedIsSupport);
  // The legend note — the DISPLAYED path (a stress hides it) against the support line, bit for bit after today.
  const onSupport = pathOnSupport(displayedPath, supportPath, months);
  const inspectT = addMonths(startDate, monthIdx).getTime();
  const manualNote = manualPriceNote(s.btcPriceMode);

  // ── The schedule and its outputs — one text artifact for Copy, Download and Print.
  const schedule = useMemo(() => planSchedule(sim, placement), [sim, placement]);
  const choiceLabel = choice === 'worstStitched' ? WORST_META[0].label
    : choice === 'worstModeled' ? `${WORST_META[1].label}: ${crownNoun}`
      : metaOf(choice).label;
  const header = scheduleHeader({ todayISO, pathLabel: choiceLabel, months, openingBtc });
  const disclaimer = decisionDisclaimer(sim.policyApplied);
  const scheduleText = useMemo(
    () => scheduleToText(schedule, header, moveCardText(move), disclaimer, consoleRuns),
    [schedule, header, move, disclaimer, consoleRuns],
  );
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle');
  async function copySchedule() {
    try {
      await navigator.clipboard.writeText(scheduleText);
      setCopyState('ok');
    } catch {
      setCopyState('err');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  }
  // Execute = print, never act: the face prints a schedule and the owner performs it.
  const downloadSchedule = () =>
    downloadBlob(new Blob([scheduleText], { type: 'text/plain' }), scheduleFileName(todayISO));
  const printSchedule = () => {
    document.body.classList.add(PRINT_CLASS);
    window.print();
  };
  // C1 — the print class clears on afterprint, the next pointerdown, keydown or window focus, and on unmount — NEVER
  // synchronously after window.print(): Safari and mobile browsers return from it at once, before the page is laid
  // out for print. Clearing late is harmless (the class does nothing on screen).
  useEffect(() => {
    const clearPrint = () => document.body.classList.remove(PRINT_CLASS);
    window.addEventListener('afterprint', clearPrint);
    window.addEventListener('pointerdown', clearPrint);
    window.addEventListener('keydown', clearPrint);
    window.addEventListener('focus', clearPrint);
    return () => {
      window.removeEventListener('afterprint', clearPrint);
      window.removeEventListener('pointerdown', clearPrint);
      window.removeEventListener('keydown', clearPrint);
      window.removeEventListener('focus', clearPrint);
      clearPrint();
    };
  }, []);

  // ── The outcome strip — read off the displayed run.
  const tiles = outcomeTiles(planOutcome(sim), verdictVsNeverDraw(sim, 'cycle'), verdictBasisClause(sim), sim.last.m);

  // ── The path note.
  const bandsToday = useMemo(() => plBandsAt(startDate), [startDate]);
  const nextTurns = useMemo(() => nextTurnsText(upcomingCycleTurns(startDate, 2, 0)), [startDate]);
  const note = pathNote({
    choice,
    kind: resolvedKind,
    label: resolvedKind === null ? '' : metaOf(resolvedKind).label,
    bandTodayUsd: resolvedKind === null || resolvedKind === 'fourYear' ? null : bandsToday[resolvedKind],
    onTheLine,
    priceHeld,
    anchorPrice,
    month1Usd: pricePath.length > 1 ? pricePath[1] : null,
    nextTurns: resolvedKind === 'fourYear' ? nextTurns : '',
    stitchedIsSupport,
    worstBy: crown.worstBy,
  });

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Decision</div>
        <div className={styles.framing}>{DECISION_FRAMING}</div>
      </div>

      {/* 1 · THE MOVE — every line from moveCard; the face composes none. */}
      <section className={styles.moveCard} aria-label={move.title}>
        <span className={styles.cardLabel}>{move.title}</span>
        {move.lines.map((l) => (
          <div key={l.key}
            className={`${styles.moveLine} ${l.key === 'planOfRecord' || l.key === 'pathInvariant' ? styles.moveQuiet : ''} ${TONE_CLASS[l.tone]}`}>
            <span>{l.text}</span>
            {l.action && (
              <button type="button" className={styles.ghostBtn} onClick={() => onLineAction(l.action!)}>
                {l.action.label}
              </button>
            )}
          </div>
        ))}
      </section>

      {/* 2 · The Coinbase-loan line (decision 2). */}
      {loanLine !== null && <div className={styles.stateLine}>{loanLine}</div>}

      {/* 3 · THE CHART — history, the displayed path, the stitched floor, the support line and the cliff. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Price · history and the modeled path</span>
        {domain === null || xRange === null ? (
          <div className={styles.chartEmpty}>{historyLoading ? 'Loading price history…' : 'Price history unavailable'}</div>
        ) : (
          <DecisionChart chart={chart} xRange={xRange} domain={domain} pathColor={pathColor} drawFloor={drawFloor}
            hasCliff={hasCliff} inspectT={monthIdx > 0 ? inspectT : null} />
        )}
        <div className={styles.legend}>
          {chart.history.length > 1 && (
            <span className={styles.legendItem} style={{ color: 'var(--btc)' }}><i className={styles.legendSwatch} />History</span>
          )}
          <span className={styles.legendItem} style={{ color: pathColor }}><i className={`${styles.legendSwatch} ${styles.legendDash}`} />Modeled path</span>
          {drawFloor && (
            <span className={styles.legendItem} style={{ color: STITCHED_COLOR }}><i className={`${styles.legendSwatch} ${styles.legendDot}`} />Stitched floor</span>
          )}
          <span className={styles.legendItem} style={{ color: 'var(--green)' }}><i className={styles.legendSwatch} />Support</span>
          {hasCliff && (
            <span className={styles.legendItem} style={{ color: 'var(--red)' }}><i className={`${styles.legendSwatch} ${styles.legendDot}`} />Coinbase seizes</span>
          )}
        </div>
        {onSupport && <p className={styles.noteQuiet}>{ON_SUPPORT_NOTE}</p>}
        {domain !== null && xRange !== null && historical.length === 0 && (
          <p className={styles.noteQuiet}>{historyLoading ? 'Loading price history…' : 'Price history unavailable'}</p>
        )}
        {manualNote !== null && <p className={styles.noteQuiet}>{manualNote}</p>}
      </section>

      {/* 4 · THE SCHEDULE — the whole row jumps the scrubber (Ownership's convention); a crash row's note and its
          console link sit on a row of their own beneath it, never inside the row button (C2). */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Schedule</span>
        <p className={styles.noteQuiet}>{header}</p>
        <p className={styles.noteQuiet}>{SCHEDULE_KEEP_KEY}</p>
        <div className={styles.schedWrap}>
          <table className={styles.schedTable}>
            <thead>
              <tr>
                <th className={`${styles.schedTh} ${styles.colMonth}`}>Month</th>
                <th className={styles.schedTh}>Moves</th>
                <th className={`${styles.schedTh} ${styles.colKeep}`} data-testid="schedule-keep">{SCHEDULE_KEEP_HEADER}</th>
                <th className={`${styles.schedTh} ${styles.colZone}`}>Zone</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((r) => (
                <Fragment key={r.m}>
                  <tr role="button" tabIndex={0}
                    className={`${styles.schedRow} ${monthIdx === r.m ? styles.schedRowOn : ''} ${sim.liqMonth !== null && r.m > sim.liqMonth ? styles.schedRowPost : ''}`}
                    onClick={() => setSelectedMonth(r.m)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMonth(r.m); } }}>
                    <td className={`${styles.schedTd} ${styles.schedMonth}`}>{r.label}</td>
                    <td className={styles.schedTd}>
                      {r.actions.length === 0 ? <span className={styles.schedNone}>—</span> : (
                        <ul className={styles.schedMoves}>
                          {r.actions.map((a) => <li key={a.kind}>{a.text}</li>)}
                        </ul>
                      )}
                    </td>
                    <td className={`${styles.schedTd} ${styles.schedNum}`}>
                      {r.keepAtSupportBtc !== null && shownBtc(r.keepAtSupportBtc) ? `${fmtBtc3(r.keepAtSupportBtc)} ₿` : '—'}
                    </td>
                    <td className={`${styles.schedTd} ${styles.schedZone}`}>
                      {r.zone === null ? <span className={styles.schedNone}>—</span> : (
                        <span style={{ color: ZONE_COLOR[r.zone] }} title={ZONE_LABEL[r.zone]} aria-label={ZONE_LABEL[r.zone]}>
                          {ZONE_LETTER[r.zone]}
                        </span>
                      )}
                    </td>
                  </tr>
                  {r.crash && (
                    <tr className={styles.crashRow}>
                      <td colSpan={4}>
                        {crashNote(consoleRuns)}
                        {consoleRuns && (
                          <button type="button" className={styles.consoleLink}
                            aria-label={consoleLinkLabel(r.m)} onClick={() => onNavigate('defense')}>
                            → Emergency Console
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.presetRow}>
          <button type="button" className={styles.ghostBtn} onClick={() => { void copySchedule(); }}>
            {copyState === 'ok' ? 'Copied ✓' : copyState === 'err' ? 'Copy failed' : 'Copy'}
          </button>
          <button type="button" className={styles.ghostBtn} onClick={downloadSchedule}>Download .txt</button>
          <button type="button" className={styles.ghostBtn} onClick={printSchedule}>Print</button>
        </div>
      </section>

      {/* 5 · THE OUTCOME strip — the displayed run's horizon. */}
      <div className={styles.statGrid}>
        {tiles.map((t) => (
          <div key={t.key} className={styles.stat}>
            <span className={styles.cardLabel}>{t.label}</span>
            <div className={styles.statValue} style={{ color: TONE_COLOR[t.tone] }}>{t.value}</div>
            <div className={styles.statSub}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* 6 · WHAT-IF — every control a session overlay; changing any of them clears an engaged stress. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>What if · price path</span>
        <div className={styles.pathRow}>
          {PATH_META.map((p) => (
            <button key={p.key} type="button"
              className={`${styles.bandBtn} ${choice === p.key ? styles.bandBtnOn : ''}`}
              style={choice === p.key ? { borderColor: p.color, color: p.color } : undefined}
              aria-pressed={choice === p.key}
              onClick={() => set('path', p.key)}>
              {p.label}
            </button>
          ))}
          {WORST_META.map((w) => {
            const disabled = w.key === 'worstStitched' && stitchedIsSupport;
            return (
              <button key={w.key} type="button" disabled={disabled}
                className={`${styles.bandBtn} ${styles.pathWide} ${choice === w.key ? styles.bandBtnOn : ''}`}
                aria-pressed={choice === w.key}
                onClick={() => set('path', w.key)}>
                {w.label}
                <span className={styles.pathSub}>{pathSublabel(w.key, stitchedIsSupport, crownNoun)}</span>
              </button>
            );
          })}
        </div>
        <p className={styles.noteQuiet}>{note}</p>
        <div className={styles.sliderPair}>
          <SliderInput
            label="Reversion window" value={convergeMonths} onChange={(v) => set('convergeMonths', v)}
            min={PL_ON_THE_LINE} max={120} step={1}
            display={onTheLine ? 'on the line' : fmtHorizon(convergeMonths)}
            minLabel="on the line" maxLabel="10 yr"
          />
          <SliderInput
            label="Horizon" value={months} onChange={(v) => set('months', v)}
            min={12} max={240} step={1} display={fmtHorizon(months)} minLabel="1 yr" maxLabel="20 yr"
          />
        </div>
        <div className={styles.presetRow}>
          <button type="button" className={styles.ghostBtn}
            onClick={() => set('convergeMonths', onTheLine ? REVERT_PRESET_MONTHS : PL_ON_THE_LINE)}>
            {onTheLine ? `Back to reverting (${fmtHorizon(REVERT_PRESET_MONTHS)})` : 'On the line'}
          </button>
        </div>
      </section>

      {/* The month scrubber and the price stress — one card, the parents' markup. */}
      <section className={styles.card}>
        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>Inspect month</span>
          <span className={styles.scrubValue}>
            {monthIdx === 0 ? 'today' : `month ${monthIdx} · ${(monthIdx / 12).toFixed(1)} yr`}
          </span>
        </div>
        <input
          type="range" className={styles.scrub}
          min={0} max={Math.max(0, sim.rows.length - 1)} step={1} value={monthIdx}
          onChange={(e) => setSelectedMonth(Number(e.target.value))}
          aria-label="Inspect month"
        />
        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>Price stress</span>
          <span className={styles.scrubValue}>
            {fmtUSD(selRow.price)}
            {lens === 1 ? ' · as modeled' : (
              <>
                {' · '}
                <span style={{ color: lens > 1 ? 'var(--green)' : 'var(--red)' }}>
                  {lens > 1 ? '+' : '−'}{Math.abs((lens - 1) * 100).toFixed(0)}%
                </span>
              </>
            )}
          </span>
        </div>
        <input
          type="range" className={styles.scrub}
          min={0.35} max={2.2} step={0.01} value={lens}
          onChange={(e) => setLens(Number(e.target.value))}
          aria-label="Price stress multiplier"
        />
        {priceHeld && (
          <p className={styles.noteQuiet}>
            Anchored {fmtUSD(anchorPrice)} · spot {fmtUSD(livePrice)}{' '}
            <span style={{ color: drift >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {drift >= 0 ? '+' : '−'}{Math.abs(drift * 100).toFixed(1)}%
            </span>
          </p>
        )}
        <p className={styles.noteQuiet}>{stressNote(supportAtMonth)}</p>
        {belowSupport && <p className={`${styles.noteQuiet} ${styles.toneWarn}`}>{BELOW_SUPPORT_NOTE}</p>}
      </section>

      {/* Credit line (what-if) — one line per run (D11); the suggestion is only ever a what-if (decision 4). */}
      <section className={styles.card}>
        <SliderInput
          label="Credit line (what-if)" value={runLine} onChange={(v) => set('creditLine', v)}
          min={STRIKE_LINE_MIN_USD} max={STRIKE_LINE_MAX_USD} step={LINE_STEP_USD} display={fmtUSD(runLine)}
          minLabel={fmtUSD(STRIKE_LINE_MIN_USD)} maxLabel={fmtUSD(STRIKE_LINE_MAX_USD)}
        />
        {/* The suggestion is a floor (two months of bills or one paydown, plus a quarter), so it is offered only
            while the run's line sits below it — above it, "Suggested" would read as advice to lower the line. */}
        {runLine < suggested && (
          <div className={styles.presetRow}>
            <button type="button" className={styles.ghostBtn} onClick={() => set('creditLine', suggested)}>
              Suggested {fmtUSD(suggested)}
            </button>
          </div>
        )}
      </section>

      <SupportPolicyCard
        sim={sim} monthIdx={monthIdx} raw={policyRaw} settings={policySettings}
        onChange={setPolicy} onReset={resetPolicy} mode="cycle" expenses={s.expenses}
      />

      {dirty && (
        <div className={styles.presetRow}>
          <button type="button" className={styles.ghostBtn} onClick={() => setOverlay({})}>Reset to live</button>
        </div>
      )}

      {/* 7 · TAP-THROUGH + disclaimer. Cycling and Strategy are the Coinbase loop, so they need a loan. */}
      <div className={styles.tapRow}>
        <span className={styles.tapLabel}>Full analysis →</span>
        {s.hasCbLoan && (
          <button type="button" className={styles.ghostBtn} onClick={() => onNavigate('cycling')}>♻ Cycling</button>
        )}
        <button type="button" className={styles.ghostBtn} onClick={() => onNavigate('ownership')}>⚖ Ownership</button>
        {s.hasCbLoan && (
          <button type="button" className={styles.ghostBtn} onClick={() => onNavigate('unified')}>◈ Strategy</button>
        )}
      </div>
      <div className={styles.disclaimer}>{disclaimer}</div>

      {/* The print artifact — the same text Copy and Download produce, shown only while printing (G7). */}
      {createPortal(<pre className={styles.printArea} aria-hidden="true">{scheduleText}</pre>, document.body)}
    </div>
  );
}
