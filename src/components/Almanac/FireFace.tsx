import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { useStore } from '../../store/useStore';
import { plConvergencePath, PL_BAND_LABEL, PL_ON_THE_LINE } from '../../simulation/powerLaw';
import { cycleConvergencePath, CYCLE_PHASE_SHIFT_MAX_MONTHS, type PathKind } from '../../simulation/cyclePath';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { usePowerLawData } from '../../hooks/usePowerLawData';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { logTicks } from '../../lib/chartZoom';
import { fireInputsOf, FIRE_INPUT_RANGES, FIRE_TAX_PCT_DEFAULT } from '../../lib/fireInputs';
import { todayLocalISO } from '../../utils/format';
import { applyPathStress, clampMonth, fmtPhaseShift, MS_TABLE } from './cyclingFaceView';
import { fireDockTabs, monthReadout, stressPct } from './controlDockView';
import { useStressLens } from './useStressLens';
import { planCbCollateralOf, planCbLoanBalanceOf } from './planRun';
import ControlDock, { type DockPanel } from './ControlDock';
import MilestoneSwitchTable from './MilestoneSwitchTable';
import FireScale from './FireScale';
import { fireReplayReadings, replayPathsAt } from './fireReplays';
import {
  FIRE_TITLE, FIRE_FRAMING, firePathName, firePathHead, firePositionLine, fireEngineOf, fireRunOf, replayRunsOf,
  historyStateOf, capacityOf, fireTiles, replaysCard, fireChartPoints, fireChartDomain, chartHasGap, fireTooltipLines,
  stopMarkerLabel, fireYearTicks, fireYearTick, fireBtcTick, inspectedLine, anchoredLine, stressLine, dollarsNote,
  STOP_CARD, spendHint, SCALE_TITLE, SCALE_NONE, fireScale, REPLAYS_TITLE, REPLAYS_INFO, REPLAYS_INFO_LABEL, CHART_TITLE,
  CHART_OWNED, CHART_NEEDED, CHART_EMPTY, CHART_GAP_NOTE, MS_VIEWS_FIRE, MS_LABEL, MS_SWITCH_LABEL, MS_YEAR_HEAD,
  fireMilestoneRows, MODEL_TITLE, MODEL_RULES, MODEL_LIMITS_TITLE, MODEL_LIMITS, MODEL_CREDITS, FIRE_DISCLAIMER, DOCK_WORDS,
  FOUR_YEAR_LABEL, revertChipLabel, horizonDisplay, type FirePoint, type FireTile,
} from './fireFaceView';
import { NumberInput } from '../ui/NumberInput';
import { SliderInput } from '../ui/SliderInput';
import { InfoTip } from '../ui/InfoTip';
import styles from './FireFace.module.css';

/**
 * Almanac FIRE face — the THIRTEENTH face (batch 1 build 4; the FIRE plan's Run 2, the sell lane): how many years of
 * spending the owner's bitcoin covers if they sell it to live, on the price path they pick. Build 3's engine as built;
 * every word from fireFaceView (I31 — this face composes none).
 *
 * 🔴 THE §2 CROSSING LIVES HERE (as on the parents): the face builds the price path from the HELD anchor (useStressLens —
 *    never the polled quote), takes `months` prices (months 0 … months − 1 — the engine's horizon is the path's length),
 *    and hands plain arrays to the view and to fireReplays, the replays' one belief crossing.
 * 🔴 It writes ONLY its own device-local inputs (`fireInputs`, D3 A) and the shared inflation (Living's input too) — and
 *    reads its inputs once a change, through `fireInputsOf` memoised on the stored object, so the lens reset never fires on
 *    a render. Its own buttons are inert for a viewer (D-1); its number fields already are.
 * ⚠ D1 A′: no simulation here — the four Paths, the replays and the break-even only. The borrow lane is build 5's.
 */

type Overlay = { pathKind?: PathKind; convergeMonths?: number; phaseShiftMonths?: number; months?: number };

const DEFAULT_HORIZON_MONTHS = 240;      // D10 — the faces' cap
const DEFAULT_INSPECT_MONTH = 1;         // Decision's: a stress starts at the first modelled month; today stays today's price
const REVERT_PRESET_MONTHS = 48;         // what the chip restores — distinct from the default, or the toggle is a no-op
const TONE: Record<FireTile['tone'], string | undefined> = { plain: undefined, good: 'var(--green)', bad: 'var(--red)' };
const PATHS: { key: PathKind; label: string }[] = [
  { key: 'floor', label: PL_BAND_LABEL.floor },
  { key: 'fair', label: PL_BAND_LABEL.fair },
  { key: 'ceiling', label: PL_BAND_LABEL.ceiling },
  { key: 'fourYear', label: FOUR_YEAR_LABEL },
];

/** The four price paths as buttons — the dock's Path panel (the face has no price-path card). */
function PathPicker({ pathKind, onPick }: { pathKind: PathKind; onPick: (k: PathKind) => void }) {
  return (
    <div className={styles.bandRow}>
      {PATHS.map((p) => (
        <button key={p.key} type="button" aria-pressed={pathKind === p.key}
          className={`${styles.bandBtn} ${pathKind === p.key ? styles.bandBtnOn : ''}`} onClick={() => onPick(p.key)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

function FireTip({ active, payload }: { active?: boolean; payload?: { payload: FirePoint }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{p.label}</div>
      {fireTooltipLines(p).map((l) => (
        <div key={l.name} className={styles.tooltipRow}><span>{l.name}</span><strong>{l.value}</strong></div>
      ))}
    </div>
  );
}

export default function FireFace() {
  const s = useStore(useShallow((st) => ({
    btcPrice: st.btcPrice,
    btcPriceMode: st.btcPriceMode,   // 'live' polls; 'manual' is the owner typing — see useStressLens
    income: st.income,
    expenses: st.expenses,
    inflationRate: st.inflationRate,   // one field, two editors: the Living tab's input too
    strikeCollateralBtc: st.getCurrentBtcHeld(),   // reading-anchored, Strike-only (v20)
    strikeBalance: st.advisorActualBlocBalance,
    cbCollateralBtc: planCbCollateralOf(st),   // D-R2-4 — none with the Coinbase loan switched off
    openingColdBtc: st.getCurrentColdBtc(),   // the real cold reserve: in ₿ held, never passed to the netting again
    cbLoanBalance: planCbLoanBalanceOf(st),   // D-R2-4 — 0 with the Coinbase loan switched off
    cbAprPct: st.cbAprPct,
    cbLoanBalanceAsOf: st.cbLoanBalanceAsOf,
    fireInputs: st.fireInputs,
    viewerMode: st.viewerMode,
    setFireInputs: st.setFireInputs,
    setInflationRate: st.setInflationRate,
  })));

  const [overlay, setOverlay] = useState<Overlay>({});
  const set = <K extends keyof Overlay>(k: K, v: Overlay[K]) => setOverlay((o) => ({ ...o, [k]: v }));
  const pathKind: PathKind = overlay.pathKind ?? 'floor';   // Support
  const convergeMonths = overlay.convergeMonths ?? PL_ON_THE_LINE;   // on the line
  const phaseShiftMonths = overlay.phaseShiftMonths ?? 0;
  const months = overlay.months ?? DEFAULT_HORIZON_MONTHS;
  const onTheLine = convergeMonths === PL_ON_THE_LINE;

  // ⚠ UTC-midnight of the LOCAL calendar day — the repo's date-only convention (OwnershipFace's), frozen at mount.
  const startISO = useMemo(() => todayLocalISO(), []);
  const startDate = useMemo(() => new Date(startISO), [startISO]);

  // ⚠ DECLARED ABOVE THE PATH ON PURPOSE: the held anchor, never the polled quote.
  const { lens, setLens, anchorPrice, priceHeld, livePrice, drift } = useStressLens(s.btcPrice, s.btcPriceMode);
  const pricePath = useMemo(
    () => (pathKind === 'fourYear'
      ? cycleConvergencePath(anchorPrice, startDate, months, convergeMonths, phaseShiftMonths)
      : plConvergencePath(anchorPrice, pathKind, startDate, months, convergeMonths)).slice(0, months),
    [anchorPrice, pathKind, startDate, months, convergeMonths, phaseShiftMonths],
  );

  const [selectedMonth, setSelectedMonth] = useState(DEFAULT_INSPECT_MONTH);
  // ⚠ CLAMP AT RENDER TIME (the crash fix).
  const monthIdx = clampMonth(selectedMonth, pricePath.length);
  const stressPath = useMemo(() => applyPathStress(pricePath, monthIdx, lens), [pricePath, monthIdx, lens]);

  const cbDebt = useMemo(
    () => accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf),
    [s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf],
  );
  const openingBtc = s.strikeCollateralBtc + s.cbCollateralBtc + s.openingColdBtc;
  const openingDebt = cbDebt + s.strikeBalance;

  // 🔴 The face's own inputs, read ONCE A CHANGE through the one rule — never once a render (the lens reset would fire).
  const fi = useMemo(() => fireInputsOf(s.fireInputs), [s.fireInputs]);
  const engineInputs = useMemo(() => fireEngineOf({
    openingBtc, coldBtc: s.openingColdBtc, openingDebtUsd: openingDebt,
    incomeUsd: s.income, expensesUsd: s.expenses, inflationPct: s.inflationRate,
  }, fi), [openingBtc, s.openingColdBtc, openingDebt, s.income, s.expenses, s.inflationRate, fi]);

  // The run on the displayed path: the timeline and the break-even (which holds its own stop).
  const run = useMemo(() => fireRunOf(engineInputs, stressPath), [engineInputs, stressPath]);
  const stop = run.result.stopMonth;

  // The replays — from the history the app loads (one fetch a visit), spliced at the face's own stop, held.
  const { historical, loading: historyLoading, error: historyError } = usePowerLawData();
  const readings = useMemo(() => fireReplayReadings(historical, startDate), [historical, startDate]);
  const replayPaths = useMemo(() => replayPathsAt(stressPath, startDate, stop, readings), [stressPath, startDate, stop, readings]);
  const runs = useMemo(() => (stop === null ? [] : replayRunsOf(run.x, stop, replayPaths)), [run.x, stop, replayPaths]);
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const history = historyStateOf({ loading: historyLoading, error: historyError, online });
  const capacity = useMemo(() => capacityOf(run.result, runs, history, fi.bufferPct), [run.result, runs, history, fi.bufferPct]);

  useEffect(() => { setSelectedMonth((m) => Math.min(m, pricePath.length - 1)); }, [pricePath.length]);
  // ⚠ MIRRORS the engine-inputs memo (fireWiring's RESET MIRROR), plus the path and the month: a stress measured against
  // inputs that have since moved would describe a run that never happened.
  useEffect(() => { setLens(1); }, [
    pricePath, monthIdx,
    openingBtc, s.openingColdBtc, openingDebt, s.income, s.expenses, s.inflationRate, fi,
  ]);

  const resetInputs = () => s.setFireInputs(null);

  // ── the view's words and figures ──
  const pathName = firePathName({ label: pathKind === 'fourYear' ? `the ${FOUR_YEAR_LABEL}` : PL_BAND_LABEL[pathKind], onTheLine, revertMonths: convergeMonths });
  const pathHead = firePathHead(pathName, startISO, pricePath.length);
  const position = firePositionLine(engineInputs.facts, stressPath[0] ?? 0, run.result.uncoveredDebtUsd);
  const tiles = fireTiles({ run, fi, startISO, capacity });
  const card = replaysCard({ run, runs, history, capacity, startISO, bufferPct: fi.bufferPct });
  const points = useMemo(() => fireChartPoints(run.result, startISO), [run.result, startISO]);
  const domain = useMemo(() => fireChartDomain(points), [points]);
  const yTicks = useMemo(() => (domain ? logTicks(domain) : []), [domain]);
  const stopLabel = stopMarkerLabel(stop, pricePath.length);
  const scale = fireScale(run);
  const msTable = useMediaQuery(MS_TABLE);
  const msRows = useMemo(() => fireMilestoneRows(run.result, startISO), [run.result, startISO]);
  const stress = stressPct(lens);
  const notes = [
    inspectedLine(run.result, monthIdx, startISO),
    anchoredLine(anchorPrice, livePrice, drift, priceHeld),
    stressLine(lens, monthIdx, startISO),
    chartHasGap(points) && domain !== null ? CHART_GAP_NOTE : null,
    dollarsNote(s.inflationRate),
  ].filter((n): n is string => n !== null);

  // ── the control dock: Month · Stress · Path ──
  const dockContent: Record<string, ReactNode> = {
    month: (
      <>
        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>{DOCK_WORDS.month}</span>
          <span className={styles.scrubValue}>{monthReadout(monthIdx)}</span>
        </div>
        <input
          type="range" className={styles.scrub}
          min={0} max={Math.max(0, pricePath.length - 1)} step={1} value={monthIdx}
          onChange={(e) => setSelectedMonth(Number(e.target.value))}
          aria-label={DOCK_WORDS.month}
        />
      </>
    ),
    stress: (
      <>
        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>{DOCK_WORDS.stress}</span>
          <span className={styles.scrubValue}>
            {stress === null ? DOCK_WORDS.asModeled : (
              <span style={{ color: lens > 1 ? 'var(--green)' : 'var(--red)' }}>{stress}</span>
            )}
          </span>
        </div>
        <input
          type="range" className={styles.scrub}
          min={0.35} max={2.2} step={0.01} value={lens}
          onChange={(e) => setLens(Number(e.target.value))}
          aria-label={DOCK_WORDS.stressAria}
        />
      </>
    ),
    path: (
      <>
        <span className={styles.cardLabel}>{DOCK_WORDS.path}</span>
        <PathPicker pathKind={pathKind} onPick={(k) => set('pathKind', k)} />
        <div className={styles.presetRow}>
          <button type="button" className={styles.ghostBtn}
            onClick={() => set('convergeMonths', onTheLine ? REVERT_PRESET_MONTHS : PL_ON_THE_LINE)}>
            {onTheLine ? revertChipLabel(REVERT_PRESET_MONTHS) : DOCK_WORDS.onTheLine}
          </button>
        </div>
        <SliderInput
          label={DOCK_WORDS.horizon} value={months} onChange={(v) => set('months', v)}
          min={12} max={240} step={1} display={horizonDisplay(months)} minLabel={DOCK_WORDS.minYears} maxLabel={DOCK_WORDS.maxYears}
        />
        {pathKind === 'fourYear' && (
          <div className={styles.shiftBlock}>
            <div className={styles.scrubHead}>
              <span className={styles.cardLabel}>{DOCK_WORDS.timing}</span>
              <span className={styles.scrubValue}>{fmtPhaseShift(phaseShiftMonths)}</span>
            </div>
            <input
              type="range" className={styles.scrub}
              min={-CYCLE_PHASE_SHIFT_MAX_MONTHS} max={CYCLE_PHASE_SHIFT_MAX_MONTHS} step={1}
              value={phaseShiftMonths}
              onChange={(e) => set('phaseShiftMonths', Number(e.target.value))}
              aria-label={DOCK_WORDS.timing}
            />
          </div>
        )}
      </>
    ),
  };
  const dockPanels: DockPanel[] = fireDockTabs({ monthIdx, lens, path: pathKind })
    .map((t) => ({ ...t, live: t.id === 'month' || t.id === 'stress', content: dockContent[t.id] }));

  const R = FIRE_INPUT_RANGES;
  return (
    <div className={`${styles.face} ${styles.faceDocked}`}>
      <div className={styles.head}>
        <div className={styles.title}>{FIRE_TITLE}</div>
        <div className={styles.framing}>{FIRE_FRAMING}</div>
      </div>

      <div className={styles.seedRow}>
        <span className={styles.seedLabel}>{pathHead}</span>
      </div>
      {position.map((line) => <p key={line} className={styles.noteQuiet}>{line}</p>)}

      {/* 1 · the chart — ₿ you own and ₿ you'd need, a point a month, on a log axis; a gap is never a zero. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>{CHART_TITLE}</span>
        <p className={styles.noteQuiet}>
          <span style={{ color: 'var(--btc)' }}>{CHART_OWNED}</span>{' · '}
          <span style={{ color: 'var(--text-secondary)' }}>{CHART_NEEDED}</span>
        </p>
        {domain === null ? (
          <p className={styles.note}>{CHART_EMPTY}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="m" type="number" domain={[0, Math.max(0, pricePath.length - 1)]} ticks={fireYearTicks(pricePath.length)}
                tickFormatter={(m: number) => fireYearTick(startISO, m)} stroke="var(--text-muted)" fontSize={10} />
              <YAxis type="number" scale="log" domain={domain} ticks={yTicks} allowDataOverflow tickFormatter={fireBtcTick}
                stroke="var(--text-muted)" fontSize={10} width={44} />
              <Tooltip content={<FireTip />} isAnimationActive={false} wrapperStyle={{ transitionProperty: 'none' }} />
              {stopLabel !== null && stop !== null && (
                <ReferenceLine x={stop} stroke="var(--amber)" strokeDasharray="4 3"
                  label={{ value: stopLabel, fill: 'var(--amber)', fontSize: 10, position: 'insideTopLeft' }} />
              )}
              <ReferenceLine x={monthIdx} stroke="var(--text-faint)" />
              <Line type="monotone" dataKey="owned" stroke="var(--btc)" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="needed" stroke="var(--text-secondary)" dot={false} strokeDasharray="5 4" connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {notes.map((n) => <p key={n} className={styles.noteQuiet}>{n}</p>)}
      </section>

      {/* 2 · the tiles — six, under the path's name. */}
      <div className={styles.statGrid}>
        {tiles.map((t) => (
          <div key={t.key} className={styles.stat}>
            <span className={styles.cardLabel}>{t.label}</span>
            <div className={styles.statValue} style={{ color: TONE[t.tone] }}>{t.value}</div>
            <div className={styles.statSub}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* 3 · Stop working — the face's own inputs, on this device only (D3 A). */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>{STOP_CARD.title}</span>
        <div className={styles.bandRow}>
          {STOP_CARD.choices.map((c) => (
            <button key={c.key} type="button" aria-pressed={fi.stopChoice === c.key}
              className={`${styles.bandBtn} ${fi.stopChoice === c.key ? styles.bandBtnOn : ''}`}
              onClick={() => s.setFireInputs({ stopChoice: c.key })} disabled={s.viewerMode}>
              {c.label}
            </button>
          ))}
        </div>
        <div className={styles.sliderStack}>
          {fi.stopChoice === 'years' && (
            <NumberInput label={STOP_CARD.years} ariaLabel={STOP_CARD.years} value={fi.stopYears}
              onChange={(v) => s.setFireInputs({ stopYears: Math.round(v) })}
              min={R.stopYears.min} max={R.stopYears.max} step={1} decimals={0} save="leave" />
          )}
          <NumberInput label={STOP_CARD.spend} ariaLabel={STOP_CARD.spend} value={fi.spendUsd ?? s.expenses}
            onChange={(v) => s.setFireInputs({ spendUsd: v })} subtext={spendHint(s.expenses, fi.spendUsd !== null)}
            prefix="$" min={R.spendUsd.min} max={R.spendUsd.max} step={100} save="leave" />
        </div>
        <details className={styles.fold}>
          <summary className={styles.cardLabel}>{STOP_CARD.assumptions}</summary>
          <div className={styles.sliderStack}>
            <NumberInput label={STOP_CARD.otherUsd} ariaLabel={STOP_CARD.otherUsd} value={fi.otherUsd}
              onChange={(v) => s.setFireInputs({ otherUsd: v })}
              prefix="$" min={R.otherUsd.min} max={R.otherUsd.max} step={1000} save="leave" />
            <NumberInput label={STOP_CARD.retirementIncome} ariaLabel={STOP_CARD.retirementIncome} value={fi.retirementIncomeUsd}
              onChange={(v) => s.setFireInputs({ retirementIncomeUsd: v })} subtext={STOP_CARD.retirementIncomeHint}
              prefix="$" min={R.retirementIncomeUsd.min} max={R.retirementIncomeUsd.max} step={100} save="leave" />
            <NumberInput label={STOP_CARD.buffer} ariaLabel={STOP_CARD.buffer} value={fi.bufferPct}
              onChange={(v) => s.setFireInputs({ bufferPct: v })} subtext={STOP_CARD.bufferHint}
              min={R.bufferPct.min} max={R.bufferPct.max} step={1} save="leave" />
            <NumberInput label={STOP_CARD.wBtc} ariaLabel={STOP_CARD.wBtc} value={fi.wBtcPct}
              onChange={(v) => s.setFireInputs({ wBtcPct: v })} subtext={STOP_CARD.ratesHint}
              min={R.wBtcPct.min} max={R.wBtcPct.max} step={0.5} save="leave" />
            <NumberInput label={STOP_CARD.wOther} ariaLabel={STOP_CARD.wOther} value={fi.wOtherPct}
              onChange={(v) => s.setFireInputs({ wOtherPct: v })}
              min={R.wOtherPct.min} max={R.wOtherPct.max} step={0.5} save="leave" />
            <NumberInput label={STOP_CARD.otherReturn} ariaLabel={STOP_CARD.otherReturn} value={fi.otherReturnPct ?? s.inflationRate}
              onChange={(v) => s.setFireInputs({ otherReturnPct: v })} subtext={STOP_CARD.otherReturnHint}
              min={R.otherReturnPct.min} max={R.otherReturnPct.max} step={0.5} save="leave" />
            <NumberInput label={STOP_CARD.tax} ariaLabel={STOP_CARD.tax} value={fi.taxPct ?? FIRE_TAX_PCT_DEFAULT}
              onChange={(v) => s.setFireInputs({ taxPct: v })} subtext={STOP_CARD.taxHint}
              min={R.taxPct.min} max={R.taxPct.max} step={1} save="leave" />
            <NumberInput label={STOP_CARD.basis} ariaLabel={STOP_CARD.basis} value={fi.basisUsdPerBtc ?? 0}
              onChange={(v) => s.setFireInputs({ basisUsdPerBtc: v > 0 ? v : null })} subtext={STOP_CARD.basisHint}
              prefix="$" min={R.basisUsdPerBtc.min} max={R.basisUsdPerBtc.max} step={100} save="leave" />
            <NumberInput label={STOP_CARD.inflation} ariaLabel={STOP_CARD.inflation}
              value={s.inflationRate} onChange={s.setInflationRate} subtext={STOP_CARD.inflationHint}
              min={0} max={10} step={0.1} save="leave" />
          </div>
        </details>
        <div className={styles.presetRow}>
          <button type="button" className={styles.ghostBtn} onClick={resetInputs} disabled={s.viewerMode}>{STOP_CARD.reset}</button>
        </div>
        <p className={styles.noteQuiet}>{STOP_CARD.resetHint}</p>
        <p className={styles.noteQuiet}>{STOP_CARD.device}</p>
      </section>

      {/* 4 · the scale — years of funded spending, no names (F2). */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>{SCALE_TITLE}</span>
        {scale === null ? (
          <p className={styles.noteQuiet}>{SCALE_NONE}</p>
        ) : (
          <FireScale max={scale.max} you={scale.you} marks={scale.marks} ariaLabel={scale.ariaLabel} />
        )}
      </section>

      {/* 5 · the replays — from the history the app loads; nothing when it hasn't. */}
      <section className={styles.card}>
        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>{REPLAYS_TITLE}</span>
          <InfoTip label={REPLAYS_INFO_LABEL}>{REPLAYS_INFO}</InfoTip>
        </div>
        {card.state !== null && <p className={styles.note}>{card.state}</p>}
        {card.lines.map((l) => <p key={l} className={styles.noteQuiet}>{l}</p>)}
        {card.capacity !== null && <p className={styles.note}>{card.capacity}</p>}
        {card.breakEven !== null && <p className={styles.noteQuiet}>{card.breakEven}</p>}
      </section>

      {/* 6 · the Milestones — a row a year; the table from 768 px, the switch table under it (one markup at a time). */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>{MS_LABEL}</span>
        <div className={styles.msWrap}>
          {msTable ? (
            <table className={styles.msTable}>
              <thead>
                <tr>
                  <th className={`${styles.msTh} ${styles.msYear}`}>{MS_YEAR_HEAD}</th>
                  <th className={styles.msTh}>Price</th>
                  <th className={styles.msTh}>₿ owned</th>
                  <th className={styles.msTh}>Other assets</th>
                  <th className={styles.msTh}>Portfolio</th>
                  <th className={styles.msTh}>Years funded</th>
                  <th className={styles.msTh}>₿ needed</th>
                </tr>
              </thead>
              <tbody>
                {msRows.map((r) => (
                  <tr key={r.month} className={r.post ? styles.msPost : undefined}>
                    <td className={`${styles.msTd} ${styles.msYear}`}>
                      {r.year}
                      {r.flags.map((f) => <span key={f.text} className={styles.msFlag}>{' '}{f.text}</span>)}
                      {r.turn !== null && <span className={styles.msTurn}>{r.turn}</span>}
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.label} className={styles.msTd} style={c.color ? { color: c.color } : undefined}>{c.value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <MilestoneSwitchTable rows={msRows} views={MS_VIEWS_FIRE} label={MS_LABEL} switchLabel={MS_SWITCH_LABEL}
              yearHead={MS_YEAR_HEAD} />
          )}
        </div>
      </section>

      {/* 7 · the model card — the rules in words, what it leaves out, and the credits. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>{MODEL_TITLE}</span>
        {MODEL_RULES.map((r) => <p key={r} className={styles.noteQuiet}>{r}</p>)}
        <span className={styles.cardLabel}>{MODEL_LIMITS_TITLE}</span>
        {MODEL_LIMITS.map((r) => <p key={r} className={styles.noteQuiet}>{r}</p>)}
        {MODEL_CREDITS.map((c) => (
          <p key={c.text} className={styles.noteQuiet}>
            {c.href === null ? c.text : <a className={styles.link} href={c.href} target="_blank" rel="noopener noreferrer">{c.text}</a>}
          </p>
        ))}
      </section>

      <div className={styles.disclaimer}><strong>{FIRE_DISCLAIMER.lead}</strong>{' '}{FIRE_DISCLAIMER.body}</div>

      <ControlDock panels={dockPanels} />
    </div>
  );
}
