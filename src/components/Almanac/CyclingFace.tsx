import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { runCyclingSim, effectiveStrikeCapPct, CB_LIQUIDATION_PENALTY } from '../../simulation/cyclingSim';
import { plBandsAt, plBandAt, plConvergencePath, PL_BAND_LABEL, PL_ON_THE_LINE, PL_A_FLOOR, PL_A_FAIR, type PlBand } from '../../simulation/powerLaw';
import {
  cycleConvergencePath, cycleTurnsInHorizon, upcomingCycleTurns, CYCLE_PHASE_SHIFT_MAX_MONTHS, type PathKind,
} from '../../simulation/cyclePath';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { CB_LLTV, CB_FEE_TIER1_PCT, CB_FEE_TIER2_PCT, CB_FEE_TIER_BREAK, CB_PLATFORM_FEE_PCT } from '../../simulation/runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { LEVEL_COLOR } from '../../simulation/safetyView';
import {
  applyPathStress, debtSplit, btcGained, holdingsSplit, clampMonth,
  fmtLtvPct, refinanceFeeFraction, refinanceBreakEvenMonths, cashFlowAtMonth,
  coldBeyondRecord, mergeMilestoneRows, fmtTurnDate, fmtPhaseShift, nextTurnsText,
  cbZoneLevel, isBelowSupport, fixedMilestoneMonths, verdictVsNeverDraw, coldSurvivePrice, surviveFairMultiple,
  strikeCapReading, strikeCapNote, strikeCapReadout, STRIKE_CAP_TIP,
  DEFAULT_STRIKE_CAP_PCT, DEFAULT_STRIKE_CAP_ON, STRIKE_CAP_RANGE,
} from './cyclingFaceView';
import { useStressLens } from './useStressLens';
import { deriveCbCollateral } from '../../simulation/logUtils';
import { SliderInput } from '../ui/SliderInput';
import { InfoTip } from '../ui/InfoTip';
import { useMorphoRateOnDemand, CB_REALIZED_NET_APR } from '../../hooks/useMorphoRate';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './CyclingFace.module.css';

/**
 * Almanac Cycling face — draw bills on Strike, refinance into Coinbase every N months, route every
 * purchase to the Coinbase collateral pool, stop drawing at a CB LTV cap. Verdict vs "never draw".
 *
 * 🔴 THE §2 CROSSING LIVES HERE, deliberately and visibly: this view imports the power law and the 4-yr
 * cycle path (BELIEFS) AND the risk constants (FACTS), builds a plain `number[]` price path, and hands it
 * to an engine that has never heard of either. The same shape OutlookProjection/MonthBreakdown already use.
 *
 * READ-ONLY: zero store writes — not even a pin. Every control is seeded from the live plan and
 * overridden only in session-local state, so nothing here can touch the owner's numbers.
 */

// ⚠ FACE-LOCAL DEFAULT, NOT `cbLtvTriggerPct`. The owner's trigger (75%) is the PAYDOWN threshold — the
// point where the advisor routes income at Coinbase. This is a STOP-DRAWING cap: related policy, different
// action. Seeding from the trigger would also open the face on a run that LIQUIDATES at month 83, i.e. the
// default view would argue against the very strategy it exists to demonstrate. The owner's trigger is one
// tap away as a labelled preset instead.
// ⚠ 70, not 50. It is still FACE-LOCAL and still NOT `cbLtvTriggerPct` (the owner's trigger is the
// PAYDOWN threshold — a different action from stopping the draw). 50 was chosen when the opening CB LTV
// was 50.58%, so the cap bound immediately and the default view stopped drawing at month 1 — with the
// faces now opening ON THE LINE at support, that made the whole default frame inert. At 70 the draw runs
// and the honest cost is visible instead: peak CB LTV ~69% (Cycling) / ~70% (Ownership), about 16 points
// under the 86% liquidation line, for roughly +0.73 ₿ over the horizon. Verified NOT to liquidate on any
// band, out to 240 months. ⚠ The cap bounds the DRAW, not the refinance sweep, so peak LTV can end a
// month just past it (70.1% observed) — see the unbounded-refinance note in the review.
const DEFAULT_CAP_PCT = 70;
// ⚠ The face OPENS on the line (month 1 sits on the band) — the conservative read. `REVERT_PRESET_MONTHS`
// is what the "Back to reverting" chip restores, and MUST stay distinct from the default or the chip
// becomes a no-op that silently toggles nothing.
const DEFAULT_CONVERGE_MONTHS = PL_ON_THE_LINE;
const REVERT_PRESET_MONTHS = 48;      // one cycle
const DEFAULT_HORIZON_MONTHS = 60;
// 1, matching the Ownership face. Sweeping monthly keeps the expensive 13% Strike balance parked for one
// month instead of three: on the default frame Strike interest HALVES ($5,470 → $2,677) and peak Strike
// LTV drops 24.0% → 9.2%. The cost is ~$892 more CB interest (debt lands there sooner) and ~1.2pt of peak
// CB LTV (68.9% → 70.1%), since nothing is parked away from Coinbase. Net ≈ −$1,900 total interest, same
// bitcoin held — purchases follow income, not the sweep.
const DEFAULT_CYCLE_MONTHS = 1;
// Cold-storage sweep, OFF until the owner turns it on. When enabled it opens at 30 — the buffer that
// matches a 60% CB LTV, i.e. surviving a 30% overshoot of the FITTED cycle-bottom floor (25.3% of fair).
// Deliberately NOT the 50–70% an earlier draft proposed: those survive down to 18%/11% of fair, which is
// 2x–3.3x deeper than any bottom on record, and they push the first withdrawal out by five to eight years
// to buy a scenario nothing calibrates. See cyclingSim's coldStoreBufferPct docblock.
const DEFAULT_COLD_BUFFER_PCT = 30;
// ⚠ The sweep is ON by default. The default view is the Support band, where the sweep is FREE — identical
// total stack, coins simply relocated out of reach — so defaulting it off was hiding the safest version of
// the strategy behind a toggle. It is NOT free on a flat or falling path; the tip on the card says so and
// the liquidation month is on the chart either way.
const DEFAULT_COLD_ON = true;
const DEFAULT_BAND: PlBand = 'floor';         // Support — the only band that has ever acted like one
const DEFAULT_INSPECT_MONTH = 24;             // open the scrubber at 2.0 yr, not at the far end
const DEFAULT_PHASE_SHIFT = 0;                // the 4-yr cycle on schedule

// The three power-law bands plus the opt-in 4-yr cycle. ⚠ The cycle's colour is --maroon-lift, not --maroon:
// the raw token measures 2.47:1 on --surface, under the 3:1 minimum for text AND for a chart line. One entry,
// four consumers — the path buttons, the path note, the BTC-price tile and the price chart line.
const PATH_META: { key: PathKind; label: string; color: string }[] = [
  { key: 'floor',    label: PL_BAND_LABEL.floor,   color: 'var(--green)' },
  { key: 'fair',     label: PL_BAND_LABEL.fair,    color: 'var(--btc)' },
  { key: 'ceiling',  label: PL_BAND_LABEL.ceiling, color: 'var(--amber)' },
  { key: 'fourYear', label: '4-yr cycle',          color: 'var(--maroon-lift)' },
];

interface Overlay {
  pathKind?: PathKind;
  /** 4-yr cycle only: months the schedule runs late (+) or early (−). A robustness check, not a fit. */
  phaseShiftMonths?: number;
  convergeMonths?: number;
  months?: number;
  income?: number;
  expenses?: number;
  cycleMonths?: number;
  cbLtvCapPct?: number;
  /** Strike LTV cap, as a percentage — 0 = off. Session-local like every other control. */
  strikeLtvCapPct?: number;
  coldStoreBufferPct?: number;
  strikeAprPct?: number;
  cbAprPct?: number;
}

const fmtK = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? '−' : ''}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${n < 0 ? '−' : ''}$${Math.round(a / 1_000)}k`;
  return `${n < 0 ? '−' : ''}$${Math.round(a)}`;
};
const fmtSigned = (n: number): string => `${n >= 0 ? '+' : '−'}${fmtUSD(Math.abs(n))}`;
const fmtBtc = (n: number): string => `${n.toFixed(4)} ₿`;
const fmtHorizon = (v: number): string => {
  const y = Math.floor(v / 12), m = v % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y}y ${m}m`;
};

interface TipItem { name?: string; dataKey?: string | number; value?: number; color?: string }
function ChartTip({ active, payload, label, money }: {
  active?: boolean; payload?: TipItem[]; label?: string | number; money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className={styles.tooltipRow}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{p.value == null ? '—' : money ? fmtUSD(p.value) : `${p.value.toFixed(1)}%`}</strong>
        </div>
      ))}
    </div>
  );
}

export default function CyclingFace() {
  const s = useStore(useShallow((st) => ({
    btcPrice: st.btcPrice,
    btcPriceMode: st.btcPriceMode,   // 'live' polls; 'manual' is the owner typing — see useStressLens
    income: st.income,
    expenses: st.expenses,
    blocApr: st.blocApr,
    cbAprPct: st.cbAprPct,
    creditLine: st.creditLine,
    cbLtvTriggerPct: st.cbLtvTriggerPct,
    strikeCollateralBtc: st.getCurrentBtcHeld(),   // reading-anchored, Strike-only (v20)
    strikeBalance: st.advisorActualBlocBalance,
    // Derive INSIDE the selector so the value stays a primitive — `useShallow` keeps comparing numbers
    // and neither dep array below changes. Mirrors :101's Strike leg: both legs read through their derive.
    cbCollateralBtc: deriveCbCollateral(st.dayLog, st.cbCollateralBtc),
    cbLoanBalance: st.cbLoanBalance,
    cbLoanBalanceAsOf: st.cbLoanBalanceAsOf,
  })));

  const [overlay, setOverlay] = useState<Overlay>({});
  const set = <K extends keyof Overlay>(k: K, v: Overlay[K]) => setOverlay((o) => ({ ...o, [k]: v }));
  const dirty = Object.keys(overlay).length > 0;

  // Live seeds — every control reads `overlay[k] ?? live`, so nothing is ever written back.
  const pathKind: PathKind = overlay.pathKind ?? DEFAULT_BAND;
  const phaseShiftMonths = overlay.phaseShiftMonths ?? DEFAULT_PHASE_SHIFT;
  const pathColor = PATH_META.find((p) => p.key === pathKind)!.color;
  const convergeMonths = overlay.convergeMonths ?? DEFAULT_CONVERGE_MONTHS;
  const months = overlay.months ?? DEFAULT_HORIZON_MONTHS;
  const income = overlay.income ?? s.income;
  const expenses = overlay.expenses ?? s.expenses;
  const cycleMonths = overlay.cycleMonths ?? DEFAULT_CYCLE_MONTHS;
  const capPct = overlay.cbLtvCapPct ?? DEFAULT_CAP_PCT;
  // The Strike-side twin of the CB stop (0 = off). The engine clamps it a buffer inside the 70% call;
  // `strikeCapEff` is that clamped value, so the readout names the cap the run actually used.
  const strikeCapPct = overlay.strikeLtvCapPct ?? (DEFAULT_STRIKE_CAP_ON ? DEFAULT_STRIKE_CAP_PCT : 0);
  const strikeCapEff = effectiveStrikeCapPct(strikeCapPct, STRIKE_MARGIN_CALL_LTV);
  const coldBufferPct = overlay.coldStoreBufferPct ?? (DEFAULT_COLD_ON ? DEFAULT_COLD_BUFFER_PCT : 0);   // 0 = sweep off
  // The engine clamps the sweep floor to the draw cap; mirror that here so the copy states the REAL
  // threshold rather than the raw one the slider implies.
  const coldRawLtvPct = CB_LLTV * 100 * (1 - coldBufferPct / 100);
  const coldClamped   = coldRawLtvPct > capPct;
  const coldLtvPct    = Math.min(coldRawLtvPct, capPct);
  // 🔴 §2 crossing, done HERE in the view (never in the engine): the buffer is path-relative to the
  // engine; only the view knows it is being read against the Support line, and only the view can say
  // what that means against the regression line the bands are actually defined from.
  const bandDateLabel = (m: number) => {
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + m, 1));
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const strikeAprPct = overlay.strikeAprPct ?? s.blocApr;
  const cbAprPct = overlay.cbAprPct ?? s.cbAprPct;

  // ⚠ UTC-midnight of the LOCAL calendar day — the repo's date-only convention. A local-midnight Date west
  // of UTC would land on the previous UTC day and shift every band value, making the path tz-dependent.
  const startDate = useMemo(() => new Date(todayLocalISO()), []);
  // The accrual boundary crossed HERE, so the engine stays clock-free (the EmergencyConsole pattern).
  const cbDebt = useMemo(
    () => accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf),
    [s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf],
  );

  // ⚠ DECLARED ABOVE `pricePath` ON PURPOSE. The spot poll rewrites `s.btcPrice` every few seconds;
  // feeding that straight into the path rebuilt it under an engaged lens and tripped the reset effect
  // below, so a stress scenario could not outlive one quote. `anchorPrice` holds still while stressed.
  const { lens, setLens, anchorPrice, priceHeld, livePrice, drift } = useStressLens(s.btcPrice, s.btcPriceMode);

  // The 4-yr cycle oscillates support ↔ fair on cycleModel's schedule; the bands ride one line. Both take the
  // same held anchor, so the stress-lens anchor split carries over unchanged. In the else branch `pathKind`
  // narrows to PlBand — no cast.
  const pricePath = useMemo(
    () => (pathKind === 'fourYear'
      ? cycleConvergencePath(anchorPrice, startDate, months, convergeMonths, phaseShiftMonths)
      : plConvergencePath(anchorPrice, pathKind, startDate, months, convergeMonths)),
    [anchorPrice, pathKind, startDate, months, convergeMonths, phaseShiftMonths],
  );

  // 🔴 ON-DEMAND ONLY — never polls. The Almanac's background network surface stays the consented
  // useChainTip alone; this fires when the owner taps. Writes to the session overlay, never the store.
  const morpho = useMorphoRateOnDemand();
  const liveApy = morpho.rate.borrowApy;

  // Opt-in "on the line": month 1 lands ON the band, so the path opens with a visible step.
  const onTheLine = convergeMonths === PL_ON_THE_LINE;
  const lineStep = pricePath.length > 1 && pricePath[0] > 0 ? pricePath[1] / pricePath[0] - 1 : 0;
  const stepPct = `${lineStep >= 0 ? '+' : '−'}${Math.abs(lineStep * 100).toFixed(1)}%`;

  // Engine inputs shared by the base run and the stress run. `defendCbLtv` is AUTOMATIC and ON: the
  // faces model the strategy WITH its cap-defense policy (the same Strike→CB paydown the Advisor's
  // ltvTriggered mode runs), not an undefended hypothetical.
  const engineInputs = useMemo(() => ({
    startYear: startDate.getUTCFullYear(),
    strikeCollateralBtc: s.strikeCollateralBtc,
    strikeBalance: s.strikeBalance,
    strikeCreditLine: s.creditLine,
    strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
    strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
    cbCollateralBtc: s.cbCollateralBtc,
    cbDebt,
    income, expenses, strikeAprPct, cbAprPct, cycleMonths,
    cbLtvCapPct: capPct,
    strikeLtvCapPct: strikeCapPct,
    coldStoreBufferPct: coldBufferPct,
    defendCbLtv: true,
  }), [
    startDate, s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    cbDebt, income, expenses, strikeAprPct, cbAprPct, cycleMonths, capPct, strikeCapPct, coldBufferPct,
  ]);

  const baseSim = useMemo(() => runCyclingSim({ ...engineInputs, pricePath }), [engineInputs, pricePath]);
  const baseRowCount = baseSim.rows.length;

  // ── Month scrubber + price stress ─────────────────────────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(Math.min(DEFAULT_INSPECT_MONTH, baseRowCount - 1));

  // ⚠ CLAMP AT RENDER TIME, NOT IN AN EFFECT. The Horizon slider is step=1, so ONE leftward tick shrinks
  // `rows` while `selectedMonth` still points past the end — every `row.*` read would blow up. An effect
  // runs AFTER that render, far too late. Everything below reads `monthIdx`/`selRow`; `rows[selectedMonth]`
  // must never appear.
  const monthIdx = clampMonth(selectedMonth, baseRowCount);

  // The stress rollout: months from the selected month onward carry the lens factor (the band path keeps
  // its SHAPE), and the WHOLE face switches to that run — projection, charts, milestones, venue split.
  const stressPath = useMemo(() => applyPathStress(pricePath, monthIdx, lens), [pricePath, monthIdx, lens]);
  const sim = useMemo(
    () => (lens === 1 ? baseSim : runCyclingSim({ ...engineInputs, pricePath: stressPath })),
    [lens, baseSim, engineInputs, stressPath],
  );

  const {
    rows, last, stopMonth, liqMonth, creditExhaustedMonth, drawingResumedMonth,
    firstDefenseMonth, defenseExhaustedMonth, totalDefenseDrawnUsd, defenseCount,
    firstTopUpMonth, topUpExhaustedMonth, totalTopUpBtc, totalTopUpFromColdBtc, totalTopUpFromStrikeBtc,
  } = sim;
  const defenseActive = defenseCount > 0;
  // What the Strike cap did — defended / short / yielded / called — in the words the face shows.
  const capReading = strikeCapReading(sim, strikeCapEff);
  const capWarn = capReading.state === 'called' || capReading.state === 'short' || capReading.state === 'yielded';
  // The first month NEITHER lever could hold the stop. While the shift alone ran short the top-up covers
  // it, so its exhaustion is the real residual; if no top-up ever fired, the shift's is.
  const unhedgedMonth = totalTopUpBtc > 0 ? topUpExhaustedMonth : defenseExhaustedMonth;

  const selRow = rows[monthIdx] ?? last;
  const atEnd = monthIdx === rows.length - 1;
  const gained = btcGained(selRow, rows[0]);

  // Break-even on the refinance: the fee is paid once per dollar moved, the rate saving accrues forever.
  // ⚠ Use the run's REALIZED blended fee, not tier 1: the fee is marginal (2% below the $250k break, 1%
  // above), so assuming 2% overstates the fee and understates the break-even once the balance crosses it.
  const feeFraction = refinanceFeeFraction(sim.totalCbFees, sim.totalRefinancedUsd);
  const feeBreakEvenMonths = refinanceBreakEvenMonths(feeFraction, strikeAprPct, cbAprPct);

  // The SUPPORT line at the selected month — the deepest fitted drawdown. The stress may go below it;
  // doing so is flagged, never blocked (the range stays honest, the label says what it means).
  const supportAtMonth = plBandAt('floor', startDate, monthIdx);
  // ⚠ A float-equality guard, not a gate — see isBelowSupport (cyclingFaceView), the one definition.
  const belowSupport = isBelowSupport(selRow.price, supportAtMonth);
  // The cold-storage InfoTip's fair-value translation, read off the DISPLAYED path at the inspected month —
  // so it is right on every path (it used to report the Support answer everywhere) and moves with the lens.
  const fairAtMonth = plBandAt('fair', startDate, monthIdx);
  const surviveMult = surviveFairMultiple(selRow.price, fairAtMonth, coldBufferPct);
  const coldDeeperThanRecord = coldBeyondRecord(selRow.price, supportAtMonth, coldBufferPct);

  // Write the clamped value back so re-growing the horizon doesn't snap to a stale index.
  useEffect(() => { setSelectedMonth((m) => Math.min(m, baseRowCount - 1)); }, [baseRowCount]);

  // Mirrors the engine-inputs memo — if an input is added to runCyclingSim, add it here too, or a stress
  // scenario survives an input change and silently reports against the wrong position. (Changing the
  // month/input clears the stress so the face returns to "as modeled".) `pathKind` and `phaseShiftMonths`
  // need no entry: they flow through `pricePath`. ⚠ This comment alone let `coldBufferPct` drift out of the
  // list; __tests__/resetMirror.test.ts now fails if any engine input (bar startDate) is missing.
  useEffect(() => { setLens(1); }, [
    monthIdx,
    pricePath, cbDebt,
    s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    income, expenses, strikeAprPct, cbAprPct, cycleMonths, capPct, strikeCapPct, coldBufferPct,
  ]);

  const bands = plBandsAt(startDate);
  const openingBtc = s.strikeCollateralBtc + s.cbCollateralBtc;
  const openingDebt = cbDebt + s.strikeBalance;
  const verdict = verdictVsNeverDraw(sim, 'cycle');
  const wins = verdict.wins;
  const cagr = anchorPrice > 0 && months > 0
    ? ((last.price / anchorPrice) ** (12 / months) - 1) * 100
    : 0;

  // The shared CB gauge — but banded against CB_LLTV, the LTV this projection actually liquidates at.
  // (The dashboard's cbLiqFrac comes from the owner's entered liq price, a TODAY anchor that says nothing
  // about a position five years out.) The trigger boundary is still the owner's own setting.
  const cbZone = (ltv: number): string => LEVEL_COLOR[cbZoneLevel(ltv, s.cbLtvTriggerPct)];

  const chartRows = useMemo(() => rows.map((r) => ({
    year: r.yearLabel,
    // ⚠ null not NaN: +(Infinity).toFixed(2) silently coerces to NaN, which recharts drops for free but
    // reads as an accident. A gap is the honest shape for "collateral gone, debt surviving".
    cbLtvPct: Number.isFinite(r.cbLtv) ? +(r.cbLtv * 100).toFixed(2) : null,
    price: Math.round(r.price),
    collateral: Math.round(r.collateralValue),
    debt: Math.round(r.debt),
  })), [rows]);
  const tickEvery = Math.max(1, Math.floor(rows.length / 8));

  const milestones = fixedMilestoneMonths(months);
  // 4-yr cycle only: turns inside the horizon become peak/trough rows. View-only, derived from the shifted
  // schedule — the SAME source the path note reads (unclipped), so the two can never disagree.
  const horizonTurns = useMemo(
    () => (pathKind === 'fourYear' ? cycleTurnsInHorizon(startDate, months, phaseShiftMonths) : []),
    [pathKind, startDate, months, phaseShiftMonths],
  );
  const milestoneRows = mergeMilestoneRows(milestones, horizonTurns);
  const nextTurns = pathKind === 'fourYear' ? upcomingCycleTurns(startDate, 2, phaseShiftMonths) : [];

  const statTiles: Array<readonly [string, string, string, string]> = [
    ['BTC held', fmtBtc(selRow.btcHeld), `from ${openingBtc.toFixed(4)} ₿`, 'var(--green)'],
    ['Total debt', fmtK(selRow.debt), `from ${fmtK(openingDebt)}`, 'var(--orange)'],
    ['CB LTV', fmtLtvPct(selRow.cbLtv),
      // In a defended month the headline sits at the cap — show the shock that was absorbed right there.
      selRow.defended && selRow.cbLtvPreDefense !== null
        ? `defended from ${fmtLtvPct(selRow.cbLtvPreDefense)}`
        : `stop ${capPct}% · liq ${(CB_LLTV * 100).toFixed(0)}%`,
      cbZone(selRow.cbLtv)],
    ['Net equity', fmtK(selRow.equity),
      atEnd ? `never-draw: ${fmtK(sim.baselineEquity)}` : `at month ${monthIdx}`,
      atEnd ? (wins ? 'var(--green)' : 'var(--amber)') : (selRow.equity >= 0 ? 'var(--green)' : 'var(--red)')],
    ['BTC price', fmtK(selRow.price), `from ${fmtK(anchorPrice)}`, pathColor],
    // Gross is price-independent (BTC counts); yours discounts the debt at the scenario price.
    ['BTC gained', `${gained.gross >= 0 ? '+' : '−'}${Math.abs(gained.gross).toFixed(3)} ₿`,
      `yours ${gained.yours >= 0 ? '+' : '−'}${Math.abs(gained.yours).toFixed(3)} ₿`,
      gained.gross >= 0 ? 'var(--green)' : 'var(--red)'],
    // ⚠ NOT month-scoped: CyclingRow carries no per-row cumulative interest, and adding one would be
    // an engine change. The sub-label says "full horizon" so it reads as the odd one out on purpose.
    ['Strike interest', fmtK(sim.totalStrikeInterest), `full horizon · ${(months / 12).toFixed(1)} yrs`, 'var(--text-secondary)'],
  ];
  if (defenseActive) {
    statTiles.push([
      'Debt shifted', fmtK(totalDefenseDrawnUsd),
      `${defenseCount} mo · CB → Strike${unhedgedMonth !== null ? ` · unheld from mo ${unhedgedMonth}` : ''}`,
      'var(--btc)',
    ]);
  }

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Cycling</div>
        <div className={styles.framing}>Draw on Strike, refinance to Coinbase, never sell.</div>
      </div>

      <div className={styles.seedRow}>
        <span className={styles.seedLabel}>
          Seeded from your live plan · {fmtBtc(openingBtc)} against {fmtUSD(openingDebt)}
        </span>
        {dirty && (
          <button type="button" className={styles.ghostBtn} onClick={() => setOverlay({})}>Reset to live</button>
        )}
      </div>

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
              onClick={() => set('pathKind', p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className={styles.note}>
          {pathKind === 'fourYear' ? (
            // ⚠ An oscillating path tracks no line: no "sits on" / "tracks the line" phrasing here, and no
            // PL_BAND_LABEL[pathKind] — that is a Record<PlBand>, which 'fourYear' is not.
            <>
              Starts at {priceHeld ? 'the held' : "today's live"} {fmtUSD(anchorPrice)} and {onTheLine ? 'rides' : 'reverts toward'}{' '}
              the <span style={{ color: pathColor }}>4-yr cycle</span> — tops on the fair line, troughs on the
              support line. {nextTurns.length > 0 && `${nextTurnsText(nextTurns)}. `}Today at {PL_BAND_LABEL.floor}{' '}
              {fmtK(bands.floor)} · {PL_BAND_LABEL.fair} {fmtK(bands.fair)}.
              {onTheLine && ` Month 1 steps ${stepPct} to ${fmtUSD(pricePath[1] ?? 0)} and follows the cycle from there.`}
            </>
          ) : (
            <>
              Starts at {priceHeld ? 'the held' : "today's live"} {fmtUSD(anchorPrice)} and {onTheLine ? 'sits on' : 'reverts toward'}{' '}
              the power-law{' '}
              <span style={{ color: pathColor }}>
                {PL_BAND_LABEL[pathKind].toLowerCase()}
              </span> line — today at {PL_BAND_LABEL.floor} {fmtK(bands.floor)} ·{' '}
              {PL_BAND_LABEL.fair} {fmtK(bands.fair)} · {PL_BAND_LABEL.ceiling} {fmtK(bands.ceiling)}.
              {onTheLine && ` Month 1 steps ${stepPct} to ${fmtUSD(pricePath[1] ?? 0)} and tracks the line from there.`}
            </>
          )}
        </p>
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
            <p className={styles.noteQuiet}>
              A robustness check, not a calibration: does the answer survive the cycle running late or
              early? The schedule is an idealized cadence — if the liquidation month or the coins banked swing
              hard with a few months of timing, the plan depends on the calendar more than it should.
            </p>
          </div>
        )}
        <p className={styles.noteQuiet}>
          Implied <strong>{cagr.toFixed(1)}%</strong>/yr over {(months / 12).toFixed(1)} years.
        </p>
      </section>

      {/* 2 · VERDICT */}
      <div className={`${styles.verdict} ${liqMonth !== null ? styles.verdictBad : wins ? styles.verdictGood : styles.verdictWarn}`}>
        {liqMonth !== null ? (
          <>
            <div className={styles.verdictHead}>
              Liquidated at month {liqMonth} ({(liqMonth / 12).toFixed(1)} years)
            </div>
            <div className={styles.verdictSub}>
              Coinbase LTV reached {(CB_LLTV * 100).toFixed(0)}%. Morpho liquidates instantly — no cure
              window, {(CB_LIQUIDATION_PENALTY * 100).toFixed(2)}% penalty. It seized{' '}
              <strong>{fmtBtc(sim.seizedBtc ?? 0)}</strong>, leaving{' '}
              <strong>{fmtBtc(sim.survivorBtc ?? 0)}</strong>.
              {sim.deficiencyUsd !== null && (
                <> <strong className={styles.deficiency}>{fmtUSD(sim.deficiencyUsd)} of debt survives
                the liquidation.</strong> Both facilities are full-recourse.</>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={styles.verdictHead}>
              {wins ? 'Cycling wins' : 'Cycling loses'} — {fmtSigned(verdict.equityDelta)} equity
              vs paying bills from income
            </div>
            <div className={styles.verdictSub}>
              {fmtBtc(last.btcHeld)} vs {fmtBtc(sim.baselineBtc)} (
              {verdict.btcDelta >= 0 ? '+' : '−'}
              {Math.abs(verdict.btcDelta).toFixed(4)} ₿)
              {stopMonth !== null && (drawingResumedMonth === null
                ? ` · drawing stopped at month ${stopMonth}`
                : ` · drawing paused at month ${stopMonth}, resumed at ${drawingResumedMonth}`)}
            </div>
          </>
        )}
      </div>

      {defenseActive && (
        <p className={styles.noteQuiet}>
          LTV stop defense: {fmtK(totalDefenseDrawnUsd)} of Coinbase debt shifted to Strike across {defenseCount}{' '}
          month{defenseCount === 1 ? '' : 's'}{firstDefenseMonth !== null ? `, starting month ${firstDefenseMonth}` : ''}.
          {totalTopUpBtc > 0 && (
            <> When the line ran short, {fmtBtc(totalTopUpBtc)} of collateral was moved into Coinbase —
            {' '}{fmtBtc(totalTopUpFromColdBtc)} from cold storage, {fmtBtc(totalTopUpFromStrikeBtc)} from the
            Strike pledge{firstTopUpMonth !== null ? `, starting month ${firstTopUpMonth}` : ''}.</>
          )}
          {unhedgedMonth !== null
            ? ` From month ${unhedgedMonth} even the available collateral could not hold the ${capPct}% stop — the residual is unhedged.`
            : ` The ${capPct}% stop held; the refinance shifts the debt back to Coinbase as the price recovers.`}
        </p>
      )}
      {/* The Strike cap holding the line is a success, not a warning — so it is a quiet line here, while a
          short, a yield or a call goes in the constraints box below. */}
      {capReading.state === 'defended' && <p className={styles.noteQuiet}>{strikeCapNote(capReading)}</p>}

      {/* 3 · STATS — follow the scrubber + lens; "Strike interest" cannot (see below). */}
      <div className={styles.statGrid}>
        {statTiles.map(([label, value, sub, color]) => (
          <div key={label} className={styles.stat}>
            <span className={styles.cardLabel}>{label}</span>
            <div className={styles.statValue} style={{ color }}>{value}</div>
            <div className={styles.statSub}
              style={label === 'BTC gained' ? { color: gained.yours >= 0 ? 'var(--green)' : 'var(--red)' } : undefined}>
              {sub}
            </div>
          </div>
        ))}
      </div>

      {/* 3b · SCRUBBER + LENS — one card holding both range inputs. */}
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
          {/* Always lead with the PRICE — "as modeled" alone made the reader hunt for the number the
              whole card is about. Matches the Ownership face's Price lens readout. */}
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
        {/* The market keeps ticking while the scenario holds still — the anchor freezes the projection,
            never the face. Only shown while held, so "as modeled" stays uncluttered. */}
        {priceHeld && (
          <p className={styles.noteQuiet}>
            Anchored {fmtUSD(anchorPrice)} · spot {fmtUSD(livePrice)}{' '}
            <span style={{ color: drift >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {drift >= 0 ? '+' : '−'}{Math.abs(drift * 100).toFixed(1)}%
            </span>
          </p>
        )}
        <p className={styles.noteQuiet}>
          Stress from this month forward — the projection, charts, and holdings all follow. The starting
          price is held while stressed, so a live tick can't wipe your scenario — spot above keeps updating.
          Changing the month or any input resets.
        </p>
        <p className={styles.noteQuiet}>
          Support line at this month: {fmtUSD(supportAtMonth)}.
        </p>
        {belowSupport && (
          <p className={styles.noteQuiet} style={{ color: 'var(--amber)' }}>
            Below the power-law support line — outside the fitted drawdown envelope. The simulation keeps
            running, but nothing calibrates this depth.
          </p>
        )}
      </section>

      {/* 3c · HOLDINGS BY VENUE — THREE venues: Strike-pledged, Coinbase-pledged, and cold (unpledged). */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Holdings by venue</span>
        {(() => {
          const h = holdingsSplit(selRow);
          const d = debtSplit(selRow);
          const pct = (n: number) => (h.combined > 0 ? (n / h.combined) * 100 : 0);
          return (
            <>
              <div className={styles.venueBar}>
                <span className={styles.venueSegStrike} style={{ width: `${pct(h.strike)}%` }} />
                <span className={styles.venueSegCb} style={{ width: `${pct(h.coinbase)}%` }} />
                {h.cold > 0 && <span className={styles.venueSegCold} style={{ width: `${pct(h.cold)}%` }} />}
              </div>
              <div className={styles.venueRow}>
                <span className={styles.venueDotStrike} />
                <span className={styles.venueName}>Strike</span>
                <span className={styles.venueBtc}>{h.strike.toFixed(4)} ₿</span>
                <span className={styles.venueUsd}>{fmtK(h.strike * selRow.price)}</span>
              </div>
              <div className={styles.venueRow}>
                <span className={styles.venueDotCb} />
                <span className={styles.venueName}>Coinbase</span>
                <span className={styles.venueBtc}>{h.coinbase.toFixed(4)} ₿</span>
                <span className={styles.venueUsd}>{fmtK(h.coinbase * selRow.price)}</span>
              </div>
              {h.cold > 0 && (
                <div className={styles.venueRow}>
                  <span className={styles.venueDotCold} />
                  <span className={styles.venueName}>Cold storage</span>
                  <span className={styles.venueBtc}>{h.cold.toFixed(4)} ₿</span>
                  <span className={styles.venueUsd}>{fmtK(h.cold * selRow.price)}</span>
                </div>
              )}
              <div className={`${styles.venueRow} ${styles.venueCombined}`}>
                <span className={styles.venueDotNone} />
                <span className={styles.venueName}>Combined</span>
                <span className={styles.venueBtc}>{h.combined.toFixed(4)} ₿</span>
                <span className={styles.venueUsd}>{fmtK(h.combined * selRow.price)}</span>
              </div>
              {/* Debt sits with its venue: a refinance/debt shift moves DOLLARS, never coins, so this is
                  where the cap defense is visible. */}
              <p className={styles.noteQuiet}>
                Debt · {fmtK(d.strikeUsd)} Strike · {fmtK(d.coinbaseUsd)} Coinbase
                {d.shiftedUsd > 0 && ` · ${fmtK(d.shiftedUsd)} shifted this month`}
              </p>
            </>
          );
        })()}
      </section>

      {/* 4a · COLD STORAGE — sits between the venue split (which now shows a cold segment) and the CB LTV
          chart, because it is the control that MOVES the segment and MOVES the curve. The long-form
          reasoning lives in the InfoTip, not in three paragraphs of body copy nobody re-reads. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>
          Cold storage
          <InfoTip label="About the cold-storage sweep">
            <p>
              Each month, any Coinbase collateral above what your chosen break requires moves to cold
              storage — <strong>unpledged, in no LTV, and not seizable</strong>. Equivalent to a{' '}
              <strong>{coldLtvPct.toFixed(1)}% CB LTV</strong>
              {coldClamped && ` — clamped by your ${capPct}% CB LTV stop, since the sweep is never looser than the cap`}.
            </p>
            <p>
              <strong>Calibrate against the regression line, not Support.</strong> Support is a parallel
              line at {(PL_A_FLOOR / PL_A_FAIR * 100).toFixed(1)}% of fair and its constant was fitted to
              the cycle bottoms — it already is the deepest drawdown on record, so “% below Support” prices
              nothing on its own. At {coldBufferPct}% below the modeled price at {bandDateLabel(monthIdx)}{' '}
              ({fmtUSD(selRow.price)}) you are asking to survive down to{' '}
              <strong>{(surviveMult * 100).toFixed(1)}% of fair</strong>
              {' '}({(surviveMult / (PL_A_FLOOR / PL_A_FAIR)).toFixed(2)}× the fitted floor). This reads the path
              at the inspected month, so it changes with the path you pick and moves with the price stress.
              {coldDeeperThanRecord && ' That is deeper than any bottom ever recorded — you are paying years of waiting for a scenario nothing calibrates.'}
            </p>
            <p>
              <strong>Not free safety.</strong> Swept coins are gone, so every later month starts from a
              smaller base: on a rising path that costs nothing, on a flat one it trades stack for time, and
              on a falling one it pulls liquidation forward. Watch the liquidation month, not just the ₿.
            </p>
          </InfoTip>
        </span>
        <div className={styles.presetRow}>
          <button type="button" className={styles.ghostBtn}
            onClick={() => set('coldStoreBufferPct', coldBufferPct > 0 ? 0 : DEFAULT_COLD_BUFFER_PCT)}>
            {coldBufferPct > 0 ? 'Turn sweep off' : 'Sweep to cold storage'}
          </button>
        </div>
        {coldBufferPct > 0 && (
          <>
            {/* ⚠ The headline is the OUTCOME, not the constraint. "Survive a break of 30%" is the rule the
                engine follows; "₿4.99 into your own custody" is the thing the owner actually wants, and
                leading with the rule made the card read like a risk setting rather than a plan. */}
            <div className={styles.coldHead}>
              <span className={styles.coldBig}>{sim.totalColdBtc.toFixed(3)} ₿</span>
              <span className={styles.coldBigSub}>
                into your own custody by {bandDateLabel(rows.length - 1)}
              </span>
            </div>
            <div className={styles.coldSplit}>
              <span><span className={styles.venueDotCb} /> {sim.totalColdFromCb.toFixed(3)} ₿ from Coinbase</span>
              <span><span className={styles.venueDotStrike} /> {sim.totalColdFromStrike.toFixed(3)} ₿ from Strike</span>
              {sim.totalColdRetrievedBtc > 0 && (
                <span>− {sim.totalColdRetrievedBtc.toFixed(3)} ₿ retrieved for the top-up</span>
              )}
            </div>
            <div className={styles.sliderStack}>
              {/* The knob is a PRICE, not a percentage. "Survive a drop to $61,236" is a decision you can
                  make; "survive a break of 30%" is arithmetic you have to do first. The % rides along. */}
              <SliderInput label="Keep me safe down to" value={coldBufferPct}
                onChange={(v) => set('coldStoreBufferPct', v)}
                min={5} max={80} step={1}
                display={fmtUSD(coldSurvivePrice(selRow.price, coldBufferPct))}
                minLabel="closer" maxLabel="deeper" />
            </div>
            <p className={styles.noteQuiet}>
              That is <strong>{coldBufferPct}% below</strong> the modeled price at {bandDateLabel(monthIdx)}
              {' '}({fmtUSD(selRow.price)}), and it holds Coinbase at {coldLtvPct.toFixed(1)}% LTV.
              {sim.firstColdMonth !== null
                ? ` First coins move ${bandDateLabel(sim.firstColdMonth)}.`
                : ' Nothing moves yet on this path — the honest answer for a while.'}
            </p>
          </>
        )}
      </section>

      {/* 4 · CB LTV */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Coinbase LTV over time</span>
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={chartRows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid stroke="var(--line-2)" strokeDasharray="2 4" />
            <XAxis dataKey="year" stroke="var(--text-faint)" tick={{ fontSize: 9 }} interval={tickEvery} />
            <YAxis stroke="var(--text-faint)" tick={{ fontSize: 9 }} domain={[0, 100]} />
            <Tooltip content={<ChartTip />} />
            <ReferenceLine y={CB_LLTV * 100} stroke="var(--red)" strokeDasharray="4 3"
              label={{ value: `LIQ ${(CB_LLTV * 100).toFixed(0)}%`, fill: 'var(--red)', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={capPct} stroke="var(--amber)" strokeDasharray="4 3"
              label={{ value: `STOP ${capPct}%`, fill: 'var(--amber)', fontSize: 9, position: 'insideBottomRight' }} />
            {/* ⚠ The `cond && <Element/>` form is required, NOT a fragment. Recharts walks its DIRECT
                children to discover series/reference lines; a fragment wrapper makes it render axes and
                grid with no lines and no error. `&&` yields a single element or `false`, both of which
                recharts handles. Never wrap conditional chart children in <>…</>. */}
            {stopMonth !== null && <ReferenceLine x={rows[stopMonth]?.yearLabel} stroke="var(--text-faint)" strokeDasharray="2 2" />}
            {liqMonth !== null && <ReferenceLine x={rows[liqMonth]?.yearLabel} stroke="var(--red)" />}
            <Line type="monotone" dataKey="cbLtvPct" name="CB LTV" stroke="var(--btc)" strokeWidth={2}
              dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* 5 · PAIRED CHARTS */}
      <div className={styles.pair}>
        <section className={styles.card}>
          <span className={styles.cardLabel}>BTC price path</span>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartRows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="var(--line-2)" strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke="var(--text-faint)" tick={{ fontSize: 9 }} interval={tickEvery} />
              <YAxis stroke="var(--text-faint)" tick={{ fontSize: 9 }} tickFormatter={fmtK} width={52} />
              <Tooltip content={<ChartTip money />} />
              <Line type="monotone" dataKey="price" name="BTC" isAnimationActive={false} dot={false}
                strokeWidth={2} stroke={pathColor} />
            </LineChart>
          </ResponsiveContainer>
        </section>
        <section className={styles.card}>
          <span className={styles.cardLabel}>Collateral value vs debt</span>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartRows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="var(--line-2)" strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke="var(--text-faint)" tick={{ fontSize: 9 }} interval={tickEvery} />
              <YAxis stroke="var(--text-faint)" tick={{ fontSize: 9 }} tickFormatter={fmtK} width={52} />
              <Tooltip content={<ChartTip money />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="collateral" name="Collateral" stroke="var(--green)"
                strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="debt" name="Debt" stroke="var(--red)"
                strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* 6 · CONTROLS */}
      <div className={styles.pair}>
        <section className={styles.card}>
          <span className={styles.cardLabel}>Cash flow</span>
          <div className={styles.sliderStack}>
            <SliderInput label="Monthly income" value={income} onChange={(v) => set('income', v)}
              min={0} max={20000} step={100} display={fmtUSD(income)} minLabel="$0" maxLabel="$20k" />
            <SliderInput label="Monthly bills (drawn)" value={expenses} onChange={(v) => set('expenses', v)}
              min={0} max={20000} step={100} display={fmtUSD(expenses)} minLabel="$0" maxLabel="$20k" />
          </div>
          {(() => {
            // ⚠ Follows the SCRUBBED month, not a static formula. "Surplus buys bitcoin" is only true
            // once the cap has stopped the draw; while drawing, the line pays the bill and the whole
            // income buys. Scrub past the cap and this sentence changes — that IS the flywheel.
            const cf = cashFlowAtMonth(selRow, income, expenses, true);
            return (
              <p className={styles.noteQuiet}>
                {cf.mode === 'drawing' ? (
                  <>
                    Month {monthIdx}: the line pays your {fmtUSD(cf.lineFundedUsd)} of bills, so all{' '}
                    <strong>{fmtUSD(cf.buysUsd)}/mo buys bitcoin</strong> — not just the{' '}
                    {fmtUSD(Math.max(0, income - expenses))} left over.
                    {cf.incomeCoveredUsd > 0
                      && ` Your paycheck covers ${fmtUSD(cf.incomeCoveredUsd)} the line couldn't reach.`}
                    {' '}Those bills become {strikeAprPct}% debt until they move to Coinbase.
                  </>
                ) : (
                  <>
                    Month {monthIdx}: borrowing paused — the loan hit your {capPct}% ceiling. Your paycheck
                    pays the bills again, so only <strong>{fmtUSD(cf.buysUsd)}/mo buys bitcoin</strong>{' '}
                    until the price recovers.
                  </>
                )}
              </p>
            );
          })()}
        </section>
        <section className={styles.card}>
          <span className={styles.cardLabel}>Strategy</span>
          <div className={styles.sliderStack}>
            <SliderInput label="Refinance cycle" value={cycleMonths} onChange={(v) => set('cycleMonths', v)}
              min={1} max={12} step={1} display={`${cycleMonths} mo`} minLabel="1 mo" maxLabel="12 mo" />
            <SliderInput label="CB LTV stop" value={capPct} onChange={(v) => set('cbLtvCapPct', v)}
              min={20} max={85} step={1} display={`${capPct}%`} minLabel="20%" maxLabel="85%" />
          </div>
          <div className={styles.presetRow}>
            <button type="button" className={styles.ghostBtn} onClick={() => set('cbLtvCapPct', s.cbLtvTriggerPct)}>
              Use my paydown trigger ({s.cbLtvTriggerPct}%)
            </button>
          </div>
          <p className={styles.noteQuiet}>
            Your trigger is when the advisor routes income at Coinbase — a different action from stopping
            the draw, so this stop is its own setting and starts at {DEFAULT_CAP_PCT}%. When a fall pushes CB
            LTV over it, the projection draws from Strike and pays Coinbase down; if the line runs short it
            moves collateral in — cold storage first, then the Strike pledge. The refinance shifts the debt
            back as the price recovers.
          </p>
          {/* The Strike-side twin of the stop above. A face-local 44px range, NOT ui/SliderInput — that
              component is shared with Mining/Living, and a track change would relayout three surfaces. */}
          <div className={styles.shiftBlock}>
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
        </section>

      </div>

      <section className={styles.card}>
        <span className={styles.cardLabel}>Rates (both variable in reality)</span>
        <div className={styles.sliderPair}>
          <SliderInput label="Strike APR" value={strikeAprPct} onChange={(v) => set('strikeAprPct', v)}
            min={0} max={25} step={0.25} display={`${strikeAprPct}%`} minLabel="0%" maxLabel="25%" />
          <SliderInput label="Coinbase APR" value={cbAprPct} onChange={(v) => set('cbAprPct', v)}
            min={0} max={20} step={0.25} display={`${cbAprPct}%`} minLabel="0%" maxLabel="20%" />
        </div>
        <div className={styles.presetRow}>
          {liveApy !== null ? (
            <button type="button" className={styles.ghostBtn}
              onClick={() => set('cbAprPct', Number((liveApy + CB_PLATFORM_FEE_PCT).toFixed(2)))}>
              Use live {(liveApy + CB_PLATFORM_FEE_PCT).toFixed(2)}%
            </button>
          ) : (
            <button type="button" className={styles.ghostBtn} onClick={morpho.fetchNow} disabled={morpho.loading}>
              {morpho.loading ? 'checking Morpho…' : morpho.fetched ? 'Retry live rate' : 'Check live rate'}
            </button>
          )}
          {liveApy !== null && (
            <button type="button" className={styles.ghostBtn} onClick={morpho.fetchNow} disabled={morpho.loading}>
              {morpho.loading ? 'refreshing…' : 'Refetch'}
            </button>
          )}
        </div>
        <p className={styles.noteQuiet}>
          {liveApy !== null
            ? `Morpho cbBTC/USDC (Base) is ${liveApy.toFixed(2)}% right now — ${(liveApy + CB_PLATFORM_FEE_PCT).toFixed(2)}% once Coinbase's ${CB_PLATFORM_FEE_PCT}% platform fee is on top, which is what you actually pay. `
            : morpho.error ? 'Morpho market rate unavailable. ' : ''}
          The Coinbase APR here is ALL-IN: Morpho's market rate plus Coinbase's {CB_PLATFORM_FEE_PCT}%
          platform fee, which is billed onto the balance monthly.
          This loan has cost {CB_REALIZED_NET_APR.p10}–{CB_REALIZED_NET_APR.p90}% all-in over{' '}
          {CB_REALIZED_NET_APR.months} months since {CB_REALIZED_NET_APR.since} (max {CB_REALIZED_NET_APR.max}%) —
          one cycle, so it says what has happened, not what can. While the draw stop binds, the rate is a
          cost rather than a danger — peak CB LTV moves under a point across a 3–16% range, because the
          stop absorbs it into less accumulation. Set the stop high enough that it no longer binds and the
          rate moves the liquidation DATE instead: at an 85% stop, 1.5 extra points pulls it in 7 months.
          {' '}Each sweep to Coinbase also pays their origination fee — {CB_FEE_TIER1_PCT * 100}% under{' '}
          {fmtK(CB_FEE_TIER_BREAK)}, {CB_FEE_TIER2_PCT * 100}% above, added to principal so it compounds.
          This run: {fmtUSD(Math.round(sim.totalCbFees))} over {sim.cbFeeCount} borrows — a blended{' '}
          {(feeFraction * 100).toFixed(2)}% of the amount moved.
          {feeBreakEvenMonths !== null
            && ` The Strike→Coinbase move still pays for itself after ~${feeBreakEvenMonths.toFixed(1)} months at that blended fee.`}
        </p>
      </section>

      {/* 7 · CONSTRAINTS + MILESTONES */}
      {(creditExhaustedMonth !== null || capWarn) && (
        <div className={styles.constraints}>
          {creditExhaustedMonth !== null && (
            <div>
              Strike credit exhausted at month {creditExhaustedMonth} —{' '}
              {fmtUSD(rows[creditExhaustedMonth].strikeShortfall)}/mo of bills funded from income thereafter.
            </div>
          )}
          {/* A call, a short, or the survival guard's yield — the Strike cap's reading, one definition. */}
          {capWarn && <div>{strikeCapNote(capReading)}</div>}
        </div>
      )}

      <section className={styles.card}>
        <span className={styles.cardLabel}>Milestones</span>
        <div className={styles.msWrap}>
          <table className={styles.msTable}>
            <thead>
              <tr>
                <th className={`${styles.msTh} ${styles.msYear}`}>Year</th>
                <th className={styles.msTh}>Price</th>
                <th className={styles.msTh}>BTC</th>
                {/* Only when the sweep is on — an always-zero column is noise on a table this dense. */}
                {coldBufferPct > 0 && <th className={styles.msTh}>Cold</th>}
                <th className={styles.msTh}>Debt</th>
                <th className={styles.msTh}>CB LTV</th>
                <th className={styles.msTh}>Equity</th>
                <th className={styles.msTh}>BTC gained</th>
              </tr>
            </thead>
            <tbody>
              {milestoneRows.map(({ month: m, turn }) => {
                const r = rows[m];
                if (!r) return null;
                // The table follows the scenario — under stress these rows come from the stressed run.
                const g = btcGained(r, rows[0]);
                return (
                  <tr key={m} className={r.postLiquidation ? styles.msPost : undefined}>
                    <td className={`${styles.msTd} ${styles.msYear}`}>
                      {Number.isInteger(m / 12) ? m / 12 : (m / 12).toFixed(1)}
                      {r.defended && <span className={styles.msFlag} title="debt shifted to Strike"> ⇄</span>}
                      {r.postLiquidation && <span className={styles.msFlag}> post-liq</span>}
                      {/* A 4-yr cycle turn, with its REAL date — the row can sit up to a month off the turn. */}
                      {turn && (
                        <span className={styles.msTurn}>
                          {turn.kind === 'high' ? 'peak' : 'trough'} · {fmtTurnDate(turn.date)}
                        </span>
                      )}
                    </td>
                    <td className={styles.msTd}>{fmtK(r.price)}</td>
                    <td className={styles.msTd}>
                      <span className={styles.btcPre}>₿</span>{r.btcHeld.toFixed(3)}
                    </td>
                    {/* ⚠ Cold is a SUBSET of the BTC column, not an addition to it — btcHeld is all three
                        pools. Shown in the cold accent so it reads as "…of which this is out of reach". */}
                    {coldBufferPct > 0 && (
                      <td className={`${styles.msTd} ${styles.msCold}`}>
                        <span className={styles.btcPre}>₿</span>{r.coldBtc.toFixed(3)}
                      </td>
                    )}
                    <td className={styles.msTd}>{fmtK(r.debt)}</td>
                    <td className={styles.msTd} style={{ color: cbZone(r.cbLtv) }}>
                      {fmtLtvPct(r.cbLtv)}
                    </td>
                    <td className={`${styles.msTd} ${styles.msEquity}`}>{fmtK(r.equity)}</td>
                    {/* Gross = BTC accumulated. Yours = what survives the debt. On a post-liquidation row
                        yours drops hard — shown, never clamped. */}
                    <td className={styles.msTd}>
                      <div className={styles.gainGross}>
                        {g.gross >= 0 ? '+' : '−'}{Math.abs(g.gross).toFixed(3)}
                      </div>
                      <div className={styles.gainNet}
                        style={{ color: g.yours >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {g.yours >= 0 ? '+' : '−'}{Math.abs(g.yours).toFixed(3)} yours
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.disclaimer}>
        <strong>A pattern, not a forecast.</strong> The power law is a historical regression, not a
        guarantee. Personal ₿LOC deliberately firewalls it from all risk math — liquidation thresholds never
        import projection data. Treat the bands as scenarios to stress-test against, never as expected
        outcomes. Both facilities are full-recourse; Morpho liquidates instantly at{' '}
        {(CB_LLTV * 100).toFixed(0)}% LLTV with no cure window. Not financial advice.
      </div>
    </div>
  );
}
