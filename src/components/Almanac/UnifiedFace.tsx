import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { runCyclingSim, effectiveStrikeCapPct, CB_LIQUIDATION_PENALTY, type CyclingMode } from '../../simulation/cyclingSim';
import {
  plBandsAt, plBandAt, plConvergencePath, PL_BAND_LABEL, PL_ON_THE_LINE, PL_A_FLOOR, PL_A_FAIR, type PlBand,
} from '../../simulation/powerLaw';
import {
  cycleConvergencePath, cycleTurnsInHorizon, upcomingCycleTurns, CYCLE_PHASE_SHIFT_MAX_MONTHS, type PathKind,
} from '../../simulation/cyclePath';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { LEVEL_COLOR } from '../../simulation/safetyView';
import { deriveCbCollateral } from '../../simulation/logUtils';
import {
  applyPathStress, btcGained, clampMonth, fmtLtvPct, cashFlowAtMonth,
  refinanceFeeFraction, refinanceBreakEvenMonths, mergeMilestoneRows, fmtTurnDate, fmtPhaseShift, nextTurnsText,
  coldBeyondRecord, cbZoneLevel, strikeLiqLtvOf, strikeZoneLevel, isBelowSupport, fixedMilestoneMonths,
  verdictVsNeverDraw, coldSurvivePrice, surviveFairMultiple,
  strikeCapReading, strikeCapNote, strikeCapReadout, STRIKE_CAP_TIP,
  DEFAULT_STRIKE_CAP_PCT, DEFAULT_STRIKE_CAP_ON, STRIKE_CAP_RANGE,
} from './cyclingFaceView';
import { chartOwnershipRows, ownershipHero, modeConstraints, unfundedNote, MODE_NOTE } from './ownershipFaceView';
import { useStressLens } from './useStressLens';
import { SliderInput } from '../ui/SliderInput';
import { InfoTip } from '../ui/InfoTip';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './UnifiedFace.module.css';

/**
 * Almanac Strategy face — the ELEVENTH face. ONE engine run, TWO lenses.
 *
 * The Cycling and Ownership faces already share an engine: both call `runCyclingSim`, and their engine inputs
 * differ by one field (`mode`). So this is a VIEW merge, not an engine merge: one `useStressLens`, one
 * `engineInputs` memo, one base run plus the stress run, and both lenses read the SAME `sim` —
 *   • Position — held · yours · owed (the Ownership lens): the hero, the share bar, the chart trio.
 *   • Flywheel — the verdict vs never-draw, cash flow at the month, the refinance fee, the milestones.
 * The ₿ held on Position and the verdict on Flywheel therefore cannot disagree: there is only one run.
 *
 * ⚠ A SUMMARY, NOT THE UNION OF EVERY CARD. Nine engine controls (ten with the 4-yr cycle's timing) —
 * fewer than either parent. Income, bills and both APRs come straight from the live plan; the venue split,
 * the safety gauges, the rate sliders and the live Morpho check stay on the parent faces. Do not grow this
 * face into a third copy of both.
 *
 * Every rule comes from the shared, tested helpers (cyclingFaceView / ownershipFaceView) — no fourth copy
 * of any number. One convention per behaviour: Milestone rows JUMP THE SCRUBBER (Ownership's convention),
 * since a dead row on a face that has a scrubber is worse than a live one.
 *
 * READ-ONLY: zero store writes. Every control is session-local, seeded from the live plan.
 *
 * 🔴 THE §2 CROSSING LIVES HERE, as on both parents: the view imports the power law and the 4-yr cycle path
 * (BELIEFS) and the risk constants (FACTS), builds a plain `number[]`, and hands it to an engine that has
 * heard of neither.
 */

// Defaults mirror the Cycling face — the conservative read (Support, on the line). See CyclingFace for the
// reasoning behind each; only the Strike-cap defaults are shared definitions (cyclingFaceView).
const DEFAULT_CAP_PCT = 70;
const DEFAULT_CONVERGE_MONTHS = PL_ON_THE_LINE;
const DEFAULT_HORIZON_MONTHS = 60;
const DEFAULT_CYCLE_MONTHS = 1;
const DEFAULT_COLD_BUFFER_PCT = 30;
const DEFAULT_COLD_ON = true;
const DEFAULT_BAND: PlBand = 'floor';
const DEFAULT_INSPECT_MONTH = 24;
const DEFAULT_PHASE_SHIFT = 0;

// ⚠ The cycle's colour is --maroon-lift (5.00:1), never the raw --maroon (2.47:1 — under 3:1 for a chart line).
const PATH_META: { key: PathKind; label: string; color: string }[] = [
  { key: 'floor',    label: PL_BAND_LABEL.floor,   color: 'var(--green)' },
  { key: 'fair',     label: PL_BAND_LABEL.fair,    color: 'var(--btc)' },
  { key: 'ceiling',  label: PL_BAND_LABEL.ceiling, color: 'var(--amber)' },
  { key: 'fourYear', label: '4-yr cycle',          color: 'var(--maroon-lift)' },
];

const MODE_META: { key: CyclingMode; label: string }[] = [
  { key: 'cycle', label: 'Cycle' },
  { key: 'hold', label: 'Hold' },
  { key: 'clearStrike', label: 'Clear Strike' },
  { key: 'clearBoth', label: 'Clear both' },
];

interface Overlay {
  pathKind?: PathKind;
  /** 4-yr cycle only: months the schedule runs late (+) or early (−). A robustness check, not a fit. */
  phaseShiftMonths?: number;
  convergeMonths?: number;
  months?: number;
  cycleMonths?: number;
  cbLtvCapPct?: number;
  /** 0 = off. */
  strikeLtvCapPct?: number;
  /** 0 = sweep off. */
  coldStoreBufferPct?: number;
  mode?: CyclingMode;
}

const fmtK = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? '−' : ''}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${n < 0 ? '−' : ''}$${Math.round(a / 1_000)}k`;
  return `${n < 0 ? '−' : ''}$${Math.round(a)}`;
};
const fmtSigned = (n: number): string => `${n >= 0 ? '+' : '−'}${fmtUSD(Math.abs(n))}`;
const fmtBtc = (n: number): string => `${n.toFixed(4)} ₿`;
const sBtc = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} ₿`;
const fmtHorizon = (v: number): string => {
  const y = Math.floor(v / 12), m = v % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y}y ${m}m`;
};

interface TipItem { name?: string; dataKey?: string | number; value?: number; color?: string }
function ChartTip({ active, payload, label, kind }: {
  active?: boolean; payload?: TipItem[]; label?: string | number; kind?: 'pct' | 'btc' | 'money';
}) {
  if (!active || !payload?.length) return null;
  const fmt = (v: number): string => (kind === 'btc' ? `${v.toFixed(3)} ₿` : kind === 'money' ? fmtUSD(v) : `${v.toFixed(1)}%`);
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>month {label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className={styles.tooltipRow}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{p.value == null ? '—' : fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function UnifiedFace() {
  const s = useStore(useShallow((st) => ({
    btcPrice: st.btcPrice,
    btcPriceMode: st.btcPriceMode,   // 'live' polls; 'manual' is the owner typing — see useStressLens
    income: st.income,
    expenses: st.expenses,
    blocApr: st.blocApr,
    cbAprPct: st.cbAprPct,
    creditLine: st.creditLine,
    cbLtvTriggerPct: st.cbLtvTriggerPct,
    strikeLiquidationLtvPct: st.strikeLiquidationLtvPct,
    strikeCollateralBtc: st.getCurrentBtcHeld(),   // reading-anchored, Strike-only (v20)
    strikeBalance: st.advisorActualBlocBalance,
    // Derived INSIDE the selector so the value stays a primitive (the parents' precedent).
    cbCollateralBtc: deriveCbCollateral(st.dayLog, st.cbCollateralBtc),
    cbLoanBalance: st.cbLoanBalance,
    cbLoanBalanceAsOf: st.cbLoanBalanceAsOf,
  })));

  const [overlay, setOverlay] = useState<Overlay>({});
  const set = <K extends keyof Overlay>(k: K, v: Overlay[K]) => setOverlay((o) => ({ ...o, [k]: v }));
  const dirty = Object.keys(overlay).length > 0;

  const pathKind: PathKind = overlay.pathKind ?? DEFAULT_BAND;
  const phaseShiftMonths = overlay.phaseShiftMonths ?? DEFAULT_PHASE_SHIFT;
  const pathColor = PATH_META.find((p) => p.key === pathKind)!.color;
  const convergeMonths = overlay.convergeMonths ?? DEFAULT_CONVERGE_MONTHS;
  const months = overlay.months ?? DEFAULT_HORIZON_MONTHS;
  const cycleMonths = overlay.cycleMonths ?? DEFAULT_CYCLE_MONTHS;
  const capPct = overlay.cbLtvCapPct ?? DEFAULT_CAP_PCT;
  const strikeCapPct = overlay.strikeLtvCapPct ?? (DEFAULT_STRIKE_CAP_ON ? DEFAULT_STRIKE_CAP_PCT : 0);
  const strikeCapEff = effectiveStrikeCapPct(strikeCapPct, STRIKE_MARGIN_CALL_LTV);
  const coldBufferPct = overlay.coldStoreBufferPct ?? (DEFAULT_COLD_ON ? DEFAULT_COLD_BUFFER_PCT : 0);
  const mode: CyclingMode = overlay.mode ?? 'cycle';

  // ⚠ UTC-midnight of the LOCAL calendar day — the repo's date-only convention (see CyclingFace).
  const startDate = useMemo(() => new Date(todayLocalISO()), []);
  // The accrual boundary crossed HERE, so the engine stays clock-free.
  const cbDebt = useMemo(
    () => accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf),
    [s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf],
  );

  // ⚠ DECLARED ABOVE `pricePath` ON PURPOSE — the anchor split (useStressLens). The path is built from the
  // held anchor, never the polled quote, or a stress scenario could not outlive one tick.
  const { lens, setLens, anchorPrice, priceHeld, livePrice, drift } = useStressLens(s.btcPrice, s.btcPriceMode);

  const pricePath = useMemo(
    () => (pathKind === 'fourYear'
      ? cycleConvergencePath(anchorPrice, startDate, months, convergeMonths, phaseShiftMonths)
      : plConvergencePath(anchorPrice, pathKind, startDate, months, convergeMonths)),
    [anchorPrice, pathKind, startDate, months, convergeMonths, phaseShiftMonths],
  );

  const onTheLine = convergeMonths === PL_ON_THE_LINE;
  const lineStep = pricePath.length > 1 && pricePath[0] > 0 ? pricePath[1] / pricePath[0] - 1 : 0;
  const stepPct = `${lineStep >= 0 ? '+' : '−'}${Math.abs(lineStep * 100).toFixed(1)}%`;

  // ONE engine-inputs memo for the base run and the stress run. `defendCbLtv` is automatic, as on both parents.
  const engineInputs = useMemo(() => ({
    startYear: startDate.getUTCFullYear(),
    strikeCollateralBtc: s.strikeCollateralBtc,
    strikeBalance: s.strikeBalance,
    strikeCreditLine: s.creditLine,
    strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
    strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
    cbCollateralBtc: s.cbCollateralBtc,
    cbDebt,
    income: s.income,
    expenses: s.expenses,
    strikeAprPct: s.blocApr,
    cbAprPct: s.cbAprPct,
    cycleMonths,
    cbLtvCapPct: capPct,
    strikeLtvCapPct: strikeCapPct,
    coldStoreBufferPct: coldBufferPct,
    defendCbLtv: true,
    mode,
  }), [
    startDate, s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    cbDebt, s.income, s.expenses, s.blocApr, s.cbAprPct, cycleMonths, capPct, strikeCapPct, coldBufferPct, mode,
  ]);

  const baseSim = useMemo(() => runCyclingSim({ ...engineInputs, pricePath }), [engineInputs, pricePath]);
  const baseRowCount = baseSim.rows.length;

  const [selectedMonth, setSelectedMonth] = useState(Math.min(DEFAULT_INSPECT_MONTH, baseRowCount - 1));
  const [lensView, setLensView] = useState<'position' | 'flywheel'>('position');
  const [chartView, setChartView] = useState<'ownership' | 'ltv' | 'price'>('ownership');

  // ⚠ CLAMP AT RENDER TIME (the crash fix) — `rows[selectedMonth]` must never appear.
  const monthIdx = clampMonth(selectedMonth, baseRowCount);

  const stressPath = useMemo(() => applyPathStress(pricePath, monthIdx, lens), [pricePath, monthIdx, lens]);
  const sim = useMemo(
    () => (lens === 1 ? baseSim : runCyclingSim({ ...engineInputs, pricePath: stressPath })),
    [lens, baseSim, engineInputs, stressPath],
  );

  useEffect(() => { setSelectedMonth((m) => Math.min(m, baseRowCount - 1)); }, [baseRowCount]);

  // Mirrors the engine-inputs memo — a stress scenario measured against inputs that have since moved reports
  // the wrong position. `pathKind`/`phaseShiftMonths` flow through `pricePath`; `startDate` is the one
  // legitimate omission. __tests__/resetMirror.test.ts fails if any other engine input is missing.
  useEffect(() => { setLens(1); }, [
    monthIdx,
    pricePath, cbDebt,
    s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    s.income, s.expenses, s.blocApr, s.cbAprPct, cycleMonths, capPct, strikeCapPct, coldBufferPct, mode,
  ]);

  const { rows, last, liqMonth } = sim;
  const selRow = rows[monthIdx] ?? last;
  const atEnd = monthIdx === rows.length - 1;
  const openingBtc = s.strikeCollateralBtc + s.cbCollateralBtc;
  const openingDebt = cbDebt + s.strikeBalance;

  // ── The shared readings — every one a tested helper ──
  const capReading = strikeCapReading(sim, strikeCapEff);
  const capTone = capReading.state === 'called' ? styles.stateBad
    : capReading.state === 'short' || capReading.state === 'yielded' ? styles.stateWarn
    : capReading.state === 'defended' ? styles.stateGood
    : '';
  const verdict = verdictVsNeverDraw(sim, mode);
  const hero = ownershipHero(selRow, rows[0]);
  // cycleUnfunded reads the SAME `sim` as firstDrawMonth — the displayed run, so the stress lens moves it.
  const { degenerateCap, deficitMode, cycleUnfunded } = modeConstraints(
    mode, sim.firstDrawMonth, s.income, s.expenses, sim.totalUnfundedUsd);
  const strikeLiqLtv = strikeLiqLtvOf(s.strikeLiquidationLtvPct);
  const cbZone = (ltv: number): string => LEVEL_COLOR[cbZoneLevel(ltv, s.cbLtvTriggerPct)];
  const skZone = (ltv: number): string => LEVEL_COLOR[strikeZoneLevel(ltv, strikeLiqLtv)];

  const supportAtMonth = plBandAt('floor', startDate, monthIdx);
  const belowSupport = isBelowSupport(selRow.price, supportAtMonth);
  const surviveMult = surviveFairMultiple(selRow.price, plBandAt('fair', startDate, monthIdx), coldBufferPct);
  const coldDeeperThanRecord = coldBeyondRecord(selRow.price, supportAtMonth, coldBufferPct);

  const feeFraction = refinanceFeeFraction(sim.totalCbFees, sim.totalRefinancedUsd);
  const feeBreakEvenMonths = refinanceBreakEvenMonths(feeFraction, s.blocApr, s.cbAprPct);
  const cf = cashFlowAtMonth(selRow, s.income, s.expenses, mode === 'cycle');

  const bands = plBandsAt(startDate);
  const horizonTurns = useMemo(
    () => (pathKind === 'fourYear' ? cycleTurnsInHorizon(startDate, months, phaseShiftMonths) : []),
    [pathKind, startDate, months, phaseShiftMonths],
  );
  const milestoneRows = mergeMilestoneRows(fixedMilestoneMonths(months), horizonTurns);
  const nextTurns = pathKind === 'fourYear' ? upcomingCycleTurns(startDate, 2, phaseShiftMonths) : [];
  const chartRows = useMemo(() => chartOwnershipRows(rows, CB_LLTV), [rows]);

  // ⚠ An oscillating path tracks no line, and PL_BAND_LABEL is a Record<PlBand> that 'fourYear' is not.
  const pathNote = pathKind === 'fourYear'
    ? `${onTheLine ? 'Rides' : `Converges from ${priceHeld ? 'the held' : "today's"} ${fmtUSD(anchorPrice)} toward`} the 4-yr cycle — `
      + 'tops on the fair line, troughs on the support line.'
      + (nextTurns.length > 0 ? ` ${nextTurnsText(nextTurns)}.` : '')
      + (onTheLine ? ` Month 1 steps ${stepPct} to ${fmtUSD(pricePath[1] ?? 0)}.` : '')
    : `${onTheLine ? 'Sits on' : `Converges from ${priceHeld ? 'the held' : "today's"} ${fmtUSD(anchorPrice)} toward`} the power-law `
      + `${PL_BAND_LABEL[pathKind].toLowerCase()} line — today at ${fmtK(bands[pathKind])}.`
      + (onTheLine ? ` Month 1 steps ${stepPct} to ${fmtUSD(pricePath[1] ?? 0)}.` : '');

  const statTiles: Array<readonly [string, string, string, string]> = [
    ['BTC held', fmtBtc(selRow.btcHeld), `from ${fmtBtc(openingBtc)}`, 'var(--green)'],
    ['Total debt', fmtK(selRow.debt), `from ${fmtK(openingDebt)}`, 'var(--orange)'],
    ['CB LTV', fmtLtvPct(selRow.cbLtv),
      selRow.defended && selRow.cbLtvPreDefense !== null
        ? `defended from ${fmtLtvPct(selRow.cbLtvPreDefense)}`
        : `stop ${capPct}% · liq ${(CB_LLTV * 100).toFixed(0)}%`,
      cbZone(selRow.cbLtv)],
    ['Strike LTV', fmtLtvPct(selRow.strikeLtv),
      selRow.strikeTopUpBtc > 0
        ? `+${selRow.strikeTopUpBtc.toFixed(4)} ₿ from cold`
        : `${strikeCapPct > 0 ? `cap ${strikeCapReadout(strikeCapPct, strikeCapEff)} · ` : ''}call ${(STRIKE_MARGIN_CALL_LTV * 100).toFixed(0)}%`,
      skZone(selRow.strikeLtv)],
    ['Net equity', fmtK(selRow.equity),
      !atEnd ? `at month ${monthIdx}` : mode === 'hold' ? 'hold is the baseline' : `never-draw: ${fmtK(sim.baselineEquity)}`,
      atEnd && mode !== 'hold' ? (verdict.wins ? 'var(--green)' : 'var(--amber)') : (selRow.equity >= 0 ? 'var(--green)' : 'var(--red)')],
    ['BTC price', fmtK(selRow.price), `from ${fmtK(anchorPrice)}`, pathColor],
  ];

  const modeLabel = MODE_META.find((x) => x.key === mode)!.label;

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Strategy</div>
        <div className={styles.framing}>One run, two lenses — what you own, and what the flywheel earns.</div>
      </div>

      <div className={styles.seedRow}>
        <span className={styles.seedLabel}>
          Seeded from your live plan · {fmtBtc(openingBtc)} against {fmtUSD(openingDebt)}
        </span>
        {dirty && (
          <button type="button" className={styles.ghostBtn} onClick={() => setOverlay({})}>Reset to live</button>
        )}
      </div>

      {/* STATE LINE — the headline outcome, before any control. Liquidation first; then what the Strike cap
          did, in the same words the parents use (strikeCapNote — including the survival guard's yield). */}
      {liqMonth !== null && (
        <div className={`${styles.stateLine} ${styles.stateBad}`}>
          Coinbase liquidated at month {liqMonth} — Morpho seized {fmtBtc(sim.seizedBtc ?? 0)} at a{' '}
          {(CB_LIQUIDATION_PENALTY * 100).toFixed(2)}% penalty, leaving {fmtBtc(sim.survivorBtc ?? 0)}.
          {sim.deficiencyUsd !== null && ` ${fmtUSD(sim.deficiencyUsd)} of debt survives — both facilities are full recourse.`}
        </div>
      )}
      <div className={`${styles.stateLine} ${capTone}`}>{strikeCapNote(capReading)}</div>

      {/* 1 · PRICE PATH — the belief. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Price path</span>
        <div className={styles.bandRow}>
          {PATH_META.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`${styles.bandBtn} ${pathKind === p.key ? styles.bandBtnOn : ''}`}
              style={pathKind === p.key ? { borderColor: p.color, color: p.color } : undefined}
              aria-pressed={pathKind === p.key}
              onClick={() => set('pathKind', p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className={styles.noteQuiet}>{pathNote}</p>
        {pathKind === 'fourYear' && (
          <div className={styles.shiftBlock}>
            <div className={styles.scrubHead}>
              <span className={styles.cardLabel}>4-yr cycle timing</span>
              <span className={styles.scrubValue}>{fmtPhaseShift(phaseShiftMonths)}</span>
            </div>
            <input
              type="range" className={styles.scrub}
              min={-CYCLE_PHASE_SHIFT_MAX_MONTHS} max={CYCLE_PHASE_SHIFT_MAX_MONTHS} step={1}
              value={phaseShiftMonths}
              onChange={(e) => set('phaseShiftMonths', Number(e.target.value))}
              aria-label="4-yr cycle timing"
            />
          </div>
        )}
        <div className={styles.sliderPair}>
          <SliderInput
            label="Convergence" value={convergeMonths} onChange={(v) => set('convergeMonths', v)}
            min={PL_ON_THE_LINE} max={120} step={1}
            display={onTheLine ? 'on the line' : fmtHorizon(convergeMonths)}
            minLabel="on the line" maxLabel="10 yr"
          />
          <SliderInput
            label="Horizon" value={months} onChange={(v) => set('months', v)}
            min={12} max={240} step={1} display={fmtHorizon(months)} minLabel="1 yr" maxLabel="20 yr"
          />
        </div>
      </section>

      {/* 2 · STRATEGY — how the position is run. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Strategy</span>
        <div className={styles.segRow}>
          {MODE_META.map((x) => (
            <button key={x.key} type="button"
              className={`${styles.segBtn} ${mode === x.key ? styles.segBtnOn : ''}`}
              aria-pressed={mode === x.key}
              onClick={() => set('mode', x.key)}>
              {x.label}
            </button>
          ))}
        </div>
        <p className={styles.noteQuiet}>{MODE_NOTE[mode]}</p>
        <div className={styles.sliderPair}>
          <SliderInput label="Refinance cadence" value={cycleMonths} onChange={(v) => set('cycleMonths', v)}
            min={1} max={12} step={1} display={`${cycleMonths} mo`} minLabel="1 mo" maxLabel="12 mo" />
          <SliderInput label="Coinbase LTV stop" value={capPct} onChange={(v) => set('cbLtvCapPct', v)}
            min={20} max={85} step={1} display={`${capPct}%`} minLabel="20%" maxLabel="85%" />
        </div>

        {/* The Strike-side twin of the stop above — a face-local 44px range, never ui/SliderInput. */}
        <div className={styles.capBlock}>
          <div className={styles.scrubHead}>
            <span className={styles.cardLabel}>
              Strike LTV cap
              <InfoTip label="About the Strike LTV cap">
                {STRIKE_CAP_TIP.map((line) => <p key={line}>{line}</p>)}
                <p><strong>This run:</strong> {strikeCapNote(capReading)}</p>
              </InfoTip>
            </span>
            <span className={styles.scrubValue}>{strikeCapReadout(strikeCapPct, strikeCapEff)}</span>
          </div>
          {strikeCapPct > 0 && (
            <input
              type="range" className={styles.scrub}
              min={STRIKE_CAP_RANGE.min} max={STRIKE_CAP_RANGE.max} step={STRIKE_CAP_RANGE.step}
              value={strikeCapPct}
              onChange={(e) => set('strikeLtvCapPct', Number(e.target.value))}
              aria-label="Strike LTV cap"
            />
          )}
          <div className={styles.presetRow}>
            <button type="button" className={styles.ghostBtn}
              onClick={() => set('strikeLtvCapPct', strikeCapPct > 0 ? 0 : DEFAULT_STRIKE_CAP_PCT)}>
              {strikeCapPct > 0 ? 'Turn Strike cap off' : `Defend Strike at ${DEFAULT_STRIKE_CAP_PCT}%`}
            </button>
          </div>
        </div>

        {/* Cold storage — the knob is a PRICE; the fair-value translation rides along so the buffer can
            never be read as more precise than it is (the engine docblock's rule). */}
        <div className={styles.capBlock}>
          <div className={styles.scrubHead}>
            <span className={styles.cardLabel}>Cold storage</span>
            <span className={styles.scrubValue}>
              {coldBufferPct > 0 ? `${sim.totalColdBtc.toFixed(3)} ₿ to custody` : 'off'}
            </span>
          </div>
          {coldBufferPct > 0 && (
            <>
              <SliderInput label="Keep me safe down to" value={coldBufferPct}
                onChange={(v) => set('coldStoreBufferPct', v)} min={5} max={80} step={1}
                display={fmtUSD(coldSurvivePrice(selRow.price, coldBufferPct))} minLabel="closer" maxLabel="deeper" />
              <p className={styles.noteQuiet}>
                {coldBufferPct}% below the modeled {fmtUSD(selRow.price)} at month {monthIdx} — down to{' '}
                {(surviveMult * 100).toFixed(1)}% of fair ({(surviveMult / (PL_A_FLOOR / PL_A_FAIR)).toFixed(2)}× the
                fitted floor).
                {coldDeeperThanRecord && ' That is deeper than any bottom ever recorded.'}
              </p>
            </>
          )}
          <div className={styles.presetRow}>
            <button type="button" className={styles.ghostBtn}
              onClick={() => set('coldStoreBufferPct', coldBufferPct > 0 ? 0 : DEFAULT_COLD_BUFFER_PCT)}>
              {coldBufferPct > 0 ? 'Turn sweep off' : 'Sweep to cold storage'}
            </button>
          </div>
        </div>
      </section>

      {/* C1 + C2 + the cycle-mode unfunded gap — the constraint notices, one definition (modeConstraints). */}
      {(degenerateCap || deficitMode || cycleUnfunded) && (
        <div className={styles.constraints}>
          {degenerateCap && (
            <div>
              The draw never runs on this path at a {capPct}% stop (it opens at {fmtLtvPct(rows[0].cbLtv)} CB LTV).
              This run measures the refinance, not the strategy. Raise the stop to model the draw.
            </div>
          )}
          {deficitMode && (
            <div>
              Expenses exceed income and this mode never draws — the deficit is funded by nothing. BTC held
              stays flat and debt only accrues; the curve is optimistic exactly here.
            </div>
          )}
          {cycleUnfunded && <div>{unfundedNote(sim.firstUnfundedMonth, sim.totalUnfundedUsd)}</div>}
        </div>
      )}

      {/* 3 · SCRUBBER + LENS — one card, both range inputs. */}
      <section className={styles.card}>
        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>Inspect month</span>
          <span className={styles.scrubValue}>
            {monthIdx === 0 ? 'today' : `month ${monthIdx} · ${(monthIdx / 12).toFixed(1)} yr`}
            {selRow.postLiquidation && <span className={styles.msFlag}> post-liq</span>}
          </span>
        </div>
        <input
          type="range" className={styles.scrub}
          min={0} max={Math.max(0, rows.length - 1)} step={1} value={monthIdx}
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
        <p className={styles.noteQuiet}>
          Stress from this month forward — both lenses follow. Changing the month or any input resets.
          Support line at this month: {fmtUSD(supportAtMonth)}.
        </p>
        {belowSupport && (
          <p className={styles.noteQuiet} style={{ color: 'var(--amber)' }}>
            Below the power-law support line — outside the fitted drawdown envelope. Nothing calibrates this depth.
          </p>
        )}
      </section>

      {/* 4 · TILES — shared by both lenses, so they sit above the switch. */}
      <div className={styles.statGrid}>
        {statTiles.map(([label, value, sub, color]) => (
          <div key={label} className={styles.stat}>
            <span className={styles.cardLabel}>{label}</span>
            <div className={styles.statValue} style={{ color }}>{value}</div>
            <div className={styles.statSub}>{sub}</div>
          </div>
        ))}
      </div>

      {/* 5 · THE LENS SWITCH — thumb-sized. Both sides read the same `sim`. */}
      <div className={styles.lensSwitch} role="group" aria-label="Lens">
        {([['position', 'Position'], ['flywheel', 'Flywheel']] as const).map(([k, label]) => (
          <button key={k} type="button"
            className={`${styles.lensBtn} ${lensView === k ? styles.lensBtnOn : ''}`}
            aria-pressed={lensView === k}
            onClick={() => setLensView(k)}>
            {label}
          </button>
        ))}
      </div>

      {lensView === 'position' ? (
        <>
          {/* POSITION — the ownership lens. */}
          <div className={styles.heroEyebrow}>Yours in bitcoin · {monthIdx === 0 ? 'today' : `+${monthIdx} mo`}</div>
          <div className={`${styles.heroValue} ${lens !== 1 ? styles.heroLensed : ''}`}>{hero.yoursDisplayBtc.toFixed(4)} ₿</div>
          <div className={styles.heroLine}>
            {hero.heldBtc.toFixed(3)} held − {hero.owedBtc.toFixed(3)} owed at {fmtUSD(selRow.price)} ·{' '}
            <span style={{ color: hero.deltaVsToday >= 0 ? 'var(--green)' : 'var(--red)' }}>{sBtc(hero.deltaVsToday)} vs today</span>
          </div>
          <div
            role="img"
            aria-label={`${Math.round(hero.yoursShare * 100)} percent yours, ${Math.round(hero.lendersShare * 100)} percent owed`}
            className={styles.segBar}
          >
            <span aria-hidden="true" className={styles.segYours} style={{ width: `${hero.yoursShare * 100}%` }} />
            <span aria-hidden="true" className={styles.segLenders} style={{ width: `${hero.lendersShare * 100}%` }} />
          </div>

          {/* ⚠ Each series and reference line is a DIRECT chart child — a fragment wrapper makes recharts
              render an empty grid with no error. */}
          <section className={styles.card}>
            <div className={styles.chartSeg}>
              {([['ownership', 'Held · owed'], ['ltv', 'LTV'], ['price', 'Price & liq']] as const).map(([k, label]) => (
                <button key={k} type="button"
                  className={`${styles.chartSegBtn} ${chartView === k ? styles.chartSegOn : ''}`}
                  aria-pressed={chartView === k}
                  onClick={() => setChartView(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.chartBox}>
              {chartView === 'ownership' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                    <CartesianGrid stroke="var(--line-2)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" />
                    <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" width={44}
                      tickFormatter={(x) => `${x.toFixed(1)}₿`} />
                    <Tooltip content={<ChartTip kind="btc" />} />
                    <Legend wrapperStyle={{ fontSize: 10.5, color: 'var(--text-muted)' }} />
                    <ReferenceLine x={monthIdx} stroke="var(--line-2)" />
                    <Line type="monotone" dataKey="held" name="Held" stroke="var(--text-muted)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="yours" name="Yours" stroke="var(--btc)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="owed" name="Owed" stroke="var(--text-faint)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                    {coldBufferPct > 0 && (
                      <Line type="monotone" dataKey="cold" name="Cold" stroke="var(--btc)" strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
              {chartView === 'ltv' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                    <CartesianGrid stroke="var(--line-2)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" />
                    <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" width={40}
                      domain={[0, 95]} tickFormatter={(x) => `${x}%`} />
                    <Tooltip content={<ChartTip />} />
                    <ReferenceLine y={CB_LLTV * 100} stroke="var(--red)" strokeDasharray="4 4"
                      label={{ value: 'CB liquidation', fill: 'var(--red)', fontSize: 9.5, position: 'insideTopLeft' }} />
                    <ReferenceLine y={STRIKE_MARGIN_CALL_LTV * 100} stroke="var(--amber)" strokeDasharray="4 4"
                      label={{ value: 'Strike call', fill: 'var(--amber)', fontSize: 9.5, position: 'insideTopLeft' }} />
                    {strikeCapPct > 0 && (
                      <ReferenceLine y={strikeCapEff} stroke="var(--text-primary)" strokeDasharray="2 3"
                        label={{ value: 'Strike cap', fill: 'var(--text-primary)', fontSize: 9.5, position: 'insideBottomLeft' }} />
                    )}
                    <ReferenceLine x={monthIdx} stroke="var(--line-2)" />
                    <Line type="monotone" dataKey="cbLtv" name="Coinbase" stroke="var(--coinbase)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="strikeLtv" name="Strike" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {chartView === 'price' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                    <CartesianGrid stroke="var(--line-2)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" />
                    <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" width={48}
                      tickFormatter={(x) => `$${Math.round(x / 1000)}k`} />
                    <Tooltip content={<ChartTip kind="money" />} />
                    <ReferenceLine x={monthIdx} stroke="var(--line-2)" />
                    <Line type="monotone" dataKey="price" name="Bitcoin" stroke={pathColor} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="liq" name="CB liquidation" stroke="var(--red)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* FLYWHEEL — the cycling lens, off the SAME run. */}
          <div className={`${styles.verdict} ${
            verdict.kind === 'liquidated' ? styles.verdictBad
              : verdict.kind === 'wins' ? styles.verdictGood : styles.verdictWarn}`}>
            {verdict.kind === 'liquidated' ? (
              <>
                <div className={styles.verdictHead}>Liquidated at month {liqMonth} ({((liqMonth ?? 0) / 12).toFixed(1)} years)</div>
                <div className={styles.verdictSub}>
                  Coinbase LTV reached {(CB_LLTV * 100).toFixed(0)}% — Morpho liquidates instantly, no cure window.
                  {' '}It seized <strong>{fmtBtc(sim.seizedBtc ?? 0)}</strong>, leaving <strong>{fmtBtc(sim.survivorBtc ?? 0)}</strong>.
                  {sim.deficiencyUsd !== null && (
                    <> <strong className={styles.deficiency}>{fmtUSD(sim.deficiencyUsd)} of debt survives.</strong></>
                  )}
                </div>
              </>
            ) : verdict.kind === 'baseline' ? (
              <>
                <div className={styles.verdictHead}>Hold is the never-draw baseline</div>
                <div className={styles.verdictSub}>{MODE_NOTE.hold}</div>
              </>
            ) : (
              <>
                <div className={styles.verdictHead}>
                  {modeLabel} {verdict.wins ? 'wins' : 'loses'} — {fmtSigned(verdict.equityDelta)} equity vs paying bills from income
                </div>
                <div className={styles.verdictSub}>
                  {fmtBtc(last.btcHeld)} vs {fmtBtc(sim.baselineBtc)} ({verdict.btcDelta >= 0 ? '+' : '−'}
                  {Math.abs(verdict.btcDelta).toFixed(4)} ₿)
                  {mode === 'cycle' && sim.stopMonth !== null && (sim.drawingResumedMonth === null
                    ? ` · drawing stopped at month ${sim.stopMonth}`
                    : ` · drawing paused at month ${sim.stopMonth}, resumed at ${sim.drawingResumedMonth}`)}
                </div>
              </>
            )}
          </div>

          <section className={styles.card}>
            <span className={styles.cardLabel}>Cash flow at month {monthIdx}</span>
            <p className={styles.noteQuiet}>
              {cf.mode === 'drawing' ? (
                <>
                  The line pays your {fmtUSD(cf.lineFundedUsd)} of bills, so all{' '}
                  <strong>{fmtUSD(cf.buysUsd)}/mo buys bitcoin</strong> — not just the{' '}
                  {fmtUSD(Math.max(0, s.income - s.expenses))} left over.
                  {cf.incomeCoveredUsd > 0 && ` Your paycheck covers ${fmtUSD(cf.incomeCoveredUsd)} the line couldn't reach.`}
                  {' '}Those bills become {s.blocApr}% debt until they move to Coinbase.
                </>
              ) : cf.mode === 'stopped' ? (
                <>
                  Borrowing paused — the loan is at your {capPct}% stop. Your paycheck pays the bills again, so only{' '}
                  <strong>{fmtUSD(cf.buysUsd)}/mo buys bitcoin</strong> until the price recovers.
                </>
              ) : (
                <>
                  No draw in this strategy: <strong>{fmtUSD(cf.buysUsd)}/mo buys bitcoin</strong> — whatever the surplus
                  leaves after its repayments.
                </>
              )}
            </p>
            {mode === 'cycle' && sim.cbFeeCount > 0 && (
              <p className={styles.noteQuiet}>
                Each refinance pays Coinbase's origination fee, added to principal so it compounds: this run{' '}
                {fmtUSD(Math.round(sim.totalCbFees))} over {sim.cbFeeCount} borrows — a blended{' '}
                {(feeFraction * 100).toFixed(2)}% of the amount moved.
                {feeBreakEvenMonths !== null
                  && ` At ${s.blocApr}% vs ${s.cbAprPct}% the move pays for itself after ~${feeBreakEvenMonths.toFixed(1)} months.`}
              </p>
            )}
          </section>

          {/* MILESTONES — rows jump the scrubber (Ownership's convention). The table follows the scenario. */}
          <div className={styles.msWrap}>
            <table className={styles.msTable}>
              <thead>
                <tr>
                  <th className={`${styles.msTh} ${styles.msYear}`}>Year</th>
                  <th className={styles.msTh}>Price</th>
                  <th className={styles.msTh}>Held</th>
                  <th className={styles.msTh}>Yours</th>
                  <th className={styles.msTh}>CB LTV</th>
                  <th className={styles.msTh}>Strike LTV</th>
                  <th className={styles.msTh}>Net gain</th>
                </tr>
              </thead>
              <tbody>
                {milestoneRows.map(({ month: m, turn }) => {
                  const r = rows[m];
                  if (!r) return null;
                  const g = btcGained(r, rows[0]);
                  return (
                    <tr key={m} role="button" tabIndex={0}
                      onClick={() => setSelectedMonth(m)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMonth(m); } }}
                      className={`${styles.msRow} ${m === monthIdx ? styles.msRowOn : ''} ${r.postLiquidation ? styles.msPost : ''}`}>
                      <td className={`${styles.msTd} ${styles.msYear}`}>
                        {Number.isInteger(m / 12) ? m / 12 : (m / 12).toFixed(1)}
                        {r.defended && <span className={styles.msFlag} title="debt shifted to Strike"> ⇄</span>}
                        {r.postLiquidation && <span className={styles.msFlag}> ⚑</span>}
                        {turn && (
                          <span className={styles.msTurn}>{turn.kind === 'high' ? 'peak' : 'trough'} · {fmtTurnDate(turn.date)}</span>
                        )}
                      </td>
                      <td className={styles.msTd}>{fmtK(r.price)}</td>
                      <td className={styles.msTd}>{r.btcHeld.toFixed(3)}</td>
                      <td className={`${styles.msTd} ${styles.msYours}`}>{ownershipHero(r, rows[0]).yoursBtc.toFixed(3)}</td>
                      <td className={styles.msTd} style={{ color: cbZone(r.cbLtv) }}>{fmtLtvPct(r.cbLtv)}</td>
                      <td className={styles.msTd} style={{ color: skZone(r.strikeLtv) }}>{fmtLtvPct(r.strikeLtv)}</td>
                      <td className={styles.msTd}>
                        <div className={styles.gainNet} style={{ color: g.yours >= 0 ? 'var(--green)' : 'var(--red)' }}>{sBtc(g.yours)}</div>
                        <div className={styles.gainGross}>{sBtc(g.gross)} gross</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className={styles.disclaimer}>
        <strong>A pattern, not a forecast.</strong> The power law is a historical regression, firewalled from
        every risk calculation. Both facilities are full-recourse; Morpho liquidates instantly at{' '}
        {(CB_LLTV * 100).toFixed(0)}% with no cure window, Strike calls at{' '}
        {(STRIKE_MARGIN_CALL_LTV * 100).toFixed(0)}% with 72 hours to cure. The engine flags a Strike call but
        does not model the seizure. Not financial advice.
      </div>
    </div>
  );
}
