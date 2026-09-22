import type { CyclingRow, CyclingResult, CyclingMode } from '../../simulation/cyclingSim';
import { deriveOwnership } from '../../simulation/ownership';
import { CB_FEE_TIER1_PCT, CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { cbBarLevel, barLevel, type SafetyLevel } from '../../simulation/cbMetrics';
import { STRIKE_MAX_DRAW_LTV } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';

/**
 * Pure display math for the Almanac Cycling face. No React, no store, no imports from powerLaw/cycleModel —
 * TYPE imports of the engine's row/result/mode, the ownership leaf (the single definition of yoursBtc, S2′),
 * the zero-import Coinbase constants (the refinance break-even fallback, CB_LLTV for the zone band), the
 * shared gauge rules (cbMetrics' barLevel/cbBarLevel), the Strike draw ceiling (strikeCredit) and the Strike
 * margin-call line (emergencyModel) — every one a leaf. Extracted so it is testable without a render harness
 * (the repo has none).
 *
 * Architecture invariant 2 (one definition of every risk number via cbMetrics / computeStrikeLtv) governs
 * the user's LIVE position. These are projected hypotheticals on a speculative price path — routing them
 * through cbMetrics would be wrong, since those helpers read store state. Same reasoning as cyclingSim.ts's
 * local ltvOf(). This module must never be imported by anything in the risk core.
 */

/**
 * The price-stress rollout: months from `fromMonth` onward are multiplied by `factor`, so the selected
 * band path keeps its SHAPE (support/fair/resistance) with the stress applied. Months before `fromMonth`
 * are untouched — they already happened. Identity when the factor is 1 (reference-preserving, so the
 * memo sees the same path) or non-positive/non-finite.
 */
export function applyPathStress(pricePath: number[], fromMonth: number, factor: number): number[] {
  if (factor === 1 || !(factor > 0) || !Number.isFinite(factor)) return pricePath;
  const from = Math.max(0, Math.floor(fromMonth));
  return pricePath.map((p, i) => (i >= from ? p * factor : p));
}

export interface DebtSplit {
  /** Strike BLOC debt (the drawn balance). */
  strikeUsd: number;
  /** Coinbase loan debt. */
  coinbaseUsd: number;
  combinedUsd: number;
  /** CB debt shifted to Strike by the cap defense THIS month (0 when the month wasn't defended). */
  shiftedUsd: number;
}

/** Where the DOLLAR debt sits — the refinance / debt-shift counterpart of `holdingsSplit`, which is BTC-only.
 *  A debt shift moves no coins, so this is the only place the defense is visible in venue terms. */
export function debtSplit(row: CyclingRow): DebtSplit {
  return {
    strikeUsd: row.strikeBalance,
    coinbaseUsd: row.cbDebt,
    combinedUsd: row.strikeBalance + row.cbDebt,
    shiftedUsd: row.defenseDrawnUsd,
  };
}

/** Re-exported so the Almanac keeps its existing import site, but there is ONE definition app-wide —
 *  see utils/format. A second copy is how half the surfaces ended up still printing "Infinity%". */
export { fmtLtvPct } from '../../utils/format';

/**
 * The run's realized blended origination-fee fraction: fees paid ÷ cash refinanced. The fee is MARGINAL
 * (2% under $250k, 1% above), so assuming tier 1 overstates the fee — and understates the break-even —
 * for any run whose standing balance crosses the bracket. Falls back to tier 1 when nothing was moved.
 */
export function refinanceFeeFraction(totalCbFees: number, totalRefinancedUsd: number): number {
  return totalRefinancedUsd > 0 && Number.isFinite(totalRefinancedUsd)
    ? totalCbFees / totalRefinancedUsd
    : CB_FEE_TIER1_PCT;
}

/**
 * Months for the refinance to pay for itself: fee% ÷ rate-spread%, ×12. Both scale with the amount, so
 * it is amount-independent. Null when Coinbase is not actually cheaper (no saving to break even against).
 */
export function refinanceBreakEvenMonths(
  feeFraction: number,
  strikeAprPct: number,
  cbAprPct: number,
): number | null {
  const spreadPct = strikeAprPct - cbAprPct;
  if (!(spreadPct > 0) || !(feeFraction > 0) || !Number.isFinite(feeFraction)) return null;
  return (feeFraction * 100 / spreadPct) * 12;
}

/**
 * What is actually buying bitcoin at a given month, in plain terms.
 *
 * ⚠ THE BUG THIS REPLACES: the Cash flow card said "Surplus $X/mo buys bitcoin", where X was
 * `income − expenses`. While the flywheel is DRAWING that understates it by the whole expense figure —
 * where the surplus is a quarter of income it understates the flywheel 4x. `income − expenses`
 * is the never-draw BASELINE, the thing the strategy is measured against, not the strategy itself.
 *
 * The distinction is real, so the copy has to follow the month:
 *  • drawing  — the credit line paid the bill, so ALL of income buys (less any part the line could not
 *               fund). The bill becomes Strike debt: accumulation is LEVERED, not free.
 *  • stopped  — the cap has halted the draw, so income pays the bill itself and only the surplus buys.
 *  • no-draw modes — surplus retires the named leg(s) first, and whatever survives buys.
 */
export type BuyMode = 'drawing' | 'stopped' | 'noDraw';

export interface CashFlowAtMonth {
  mode: BuyMode;
  /** Dollars buying bitcoin this month — straight from the engine, never re-derived. */
  buysUsd: number;
  /** Bill dollars the credit line funded this month (0 unless drawing). */
  lineFundedUsd: number;
  /** Bill dollars income had to cover because the line could not (0 when fully funded). */
  incomeCoveredUsd: number;
  /** True when `buysUsd` exceeds the surplus — i.e. the line is doing the work. */
  leveraged: boolean;
}

export function cashFlowAtMonth(
  row: Pick<CyclingRow, 'btcBoughtUsd' | 'strikeDrawn' | 'strikeShortfall'>,
  income: number,
  expenses: number,
  isCycleMode: boolean,
): CashFlowAtMonth {
  const surplus = Math.max(0, income - expenses);
  const drawing = isCycleMode && (row.strikeDrawn > 0 || row.strikeShortfall > 0);
  const mode: BuyMode = !isCycleMode ? 'noDraw' : drawing ? 'drawing' : 'stopped';
  return {
    mode,
    buysUsd: row.btcBoughtUsd,
    lineFundedUsd: drawing ? row.strikeDrawn : 0,
    incomeCoveredUsd: drawing ? row.strikeShortfall : 0,
    leveraged: row.btcBoughtUsd > surplus + 1e-9,
  };
}

export interface BtcGain {
  /** BTC accumulated — price-independent (pure counts). */
  gross: number;
  /** BTC that survives the debt on both sides (deriveOwnership, S2′). */
  yours: number;
}

/**
 * Bitcoin gained between `base` (normally row 0) and `row`.
 *
 * ⚠ `rowPriceOverride` re-prices the ROW side ONLY — `base` always keeps its own real price. Base is today,
 * so overriding both sides would silently restate the starting position too. Gross ignores the override
 * entirely (BTC counts don't move with price).
 */
export function btcGained(row: CyclingRow, base: CyclingRow, rowPriceOverride?: number): BtcGain {
  const rowPrice = rowPriceOverride ?? row.price;
  const rowYours = deriveOwnership(row.btcHeld, row.debt, rowPrice).yoursBtc;
  const baseYours = deriveOwnership(base.btcHeld, base.debt, base.price).yoursBtc;
  return { gross: row.btcHeld - base.btcHeld, yours: rowYours - baseYours };
}

export interface HoldingsSplit {
  strike: number;
  coinbase: number;
  /** Unpledged, self-custodied. 0 unless the cold-storage sweep is on. */
  cold: number;
  combined: number;
}

/**
 * Where the stack sits. THREE VENUES now — the cold-storage reserve IS modeled (engine: coldStoreBufferPct).
 * ⚠ `cold` is the only one of the three that is not collateral for anything: it backs no loan, sits in no
 * LTV denominator, and cannot be seized. `strike` and `coinbase` are both pledged, to different lenders.
 */
export function holdingsSplit(row: CyclingRow): HoldingsSplit {
  return {
    strike: row.strikeCollateralBtc,
    coinbase: row.cbCollateralBtc,
    cold: row.coldBtc,
    combined: row.btcHeld,
  };
}

/**
 * Clamp a selected month index to the current row count.
 *
 * ⚠ MUST be applied at RENDER time, not in an effect. The Horizon slider is step=1, so one leftward tick
 * shrinks `rows` while the stored index still points past the end — `rows[stale]` is undefined and every
 * `row.*` read below throws. An effect runs after that render, far too late.
 */
export function clampMonth(selected: number, rowCount: number): number {
  if (!(rowCount > 0)) return 0;
  return Math.max(0, Math.min(Math.floor(selected), rowCount - 1));
}

// ── the cold-storage record threshold ─────────────────────────────────────────────────────────────

/**
 * Survive-to floor that triggers the "deeper than any bottom ever recorded" warning, as a fraction of the
 * support line. On the Support path this is exactly the old `coldBufferPct > 45` rule (1 − 45/100 = 0.55).
 */
export const COLD_RECORD_SUPPORT_FRACTION = 0.55;

/**
 * Does a cold-storage buffer of `bufferPct` below `price` ask to survive deeper than any recorded bottom —
 * below 0.55× the support line at that month?
 *
 * PATH-AWARE by construction: it compares PRICES (the modeled price vs the support line at the same month),
 * so on Fair or Resistance a 45% buffer no longer reads as "deeper than any bottom" just because it would be
 * on Support. It replaces an inline `coldBufferPct > 45` that ignored the path entirely.
 *
 * ⚠ Compare PRICES, never multiples. `surviveMult < (PL_A_FLOOR / PL_A_FAIR) * 0.55` looks equivalent but is
 * not: plFloor(d)/plFairValue(d) is not bit-equal to PL_A_FLOOR/PL_A_FAIR, and at a 45% buffer that form
 * fires in 32 of 240 months on Support, so the warning flickers as you scrub.
 *
 * ⚠ The `1e-9` is a PRECAUTION, not a fix for a live defect. At exactly 45, `1 − 45/100 === 0.55`, so the
 * test reduces to `price < supportAtMonth`. On Support both sides are the same value (exact). On the 4-yr
 * path they are built differently (fair × CYCLE_LOW_MULT vs A_FLOOR × d^B), but that product is only
 * evaluated exactly on a row landing on a low turn, and all 7 such rows sit at or above support. The guard
 * stops a future constant or schedule change from flipping one of them into a flicker — and because no
 * real path reaches it today, the tests pin it on synthetic values.
 *
 * Plain numbers only: this module stays free of powerLaw/cycleModel imports.
 */
export function coldBeyondRecord(price: number, supportAtMonth: number, bufferPct: number): boolean {
  return price * (1 - bufferPct / 100) < supportAtMonth * COLD_RECORD_SUPPORT_FRACTION * (1 - 1e-9);
}

// ── Milestones with cycle turns ───────────────────────────────────────────────────────────────────

/** A cycle turn mapped to a Milestones row. Structurally the shape cyclePath.cycleTurnsInHorizon returns —
 *  declared here, not imported, so this module keeps its no-belief-imports property. */
export interface MilestoneTurn {
  month: number;
  kind: 'high' | 'low';
  date: Date;
}

export interface MilestoneRow {
  month: number;
  /** Set when a cycle turn is marked on this row — it keeps the turn label even on a fixed row. */
  turn: MilestoneTurn | null;
}

/**
 * Merge the fixed milestone rows (12/24/36/60/120, already clipped to the horizon) with the cycle turns,
 * sorted by month, one row per month. A turn that lands on a fixed row KEEPS its turn label — on the
 * default view (start 2026-09-12, 60 months) the 2029 top lands on row 36, which is a fixed row.
 *
 * Takes plain arrays on purpose: the caller fetches the turns from cyclePath, so this module never imports
 * a belief.
 */
export function mergeMilestoneRows(fixed: readonly number[], turns: readonly MilestoneTurn[]): MilestoneRow[] {
  const byMonth = new Map<number, MilestoneRow>();
  for (const month of fixed) byMonth.set(month, { month, turn: null });
  for (const turn of turns) byMonth.set(turn.month, { month: turn.month, turn });
  return [...byMonth.values()].sort((a, b) => a.month - b.month);
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A turn's real calendar date ("5 Oct 2026"). UTC — turn dates are UTC-midnight instants, and a shifted
 * turn can carry a time of day, which must not roll the displayed date in a behind-UTC zone.
 * ⚠ Built from a fixed month table, NOT toLocaleDateString: locale month abbreviations vary by runtime
 * (Node's ICU renders en-GB September as "Sept"), so the same turn would read differently per device.
 */
export function fmtTurnDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The path note's turn clause: "Next low 5 Oct 2026, next high 3 Sep 2029". '' when nothing is upcoming.
 *  Fed from cyclePath.upcomingCycleTurns (the UNCLIPPED schedule), never from the horizon-clipped turns. */
export function nextTurnsText(turns: readonly { kind: 'high' | 'low'; date: Date }[]): string {
  return turns
    .map((t, i) => `${i === 0 ? 'Next' : 'next'} ${t.kind === 'high' ? 'high' : 'low'} ${fmtTurnDate(t.date)}`)
    .join(', ');
}

/** The 4-yr cycle timing readout: "on schedule" / "+3 mo late" / "−2 mo early" (positive = late). */
export function fmtPhaseShift(months: number): string {
  if (!Number.isFinite(months) || months === 0) return 'on schedule';
  return months > 0 ? `+${months} mo late` : `−${Math.abs(months)} mo early`;
}

// ── the price-stress ANCHOR ───────────────────────────────────────────────────────────────────────

/**
 * Does the price-stress lens hold its anchor price?
 *
 * ⚠ WHY THIS EXISTS. `useBtcPrice` polls spot every 10s and pushes to the store whenever the price
 * moves 0.1% (≈$80 on an $80k coin — seconds, not minutes) OR 60s elapse, whichever comes first. Each
 * push changed `s.btcPrice`, which rebuilt `pricePath`, which tripped the "an input changed, drop the
 * now-stale scenario" effect on both Almanac faces — so an engaged lens died on its own within a
 * minute (usually seconds) and the face snapped back to "as modeled", losing the whole scenario.
 *
 * The reset effect is CORRECT and stays exactly as it is: a stress run measured against inputs that
 * have since moved reports the wrong position. The defect is that a background quote is not an owner
 * input, and a what-if measured against a drifting anchor is not reproducible in the first place. So
 * while the lens is engaged the anchor is held, and the reset effect simply never sees a change.
 *
 * Held ONLY for the live feed. In `manual` mode nothing polls (the push is gated on
 * `btcPriceMode === 'live'`), so every price change there IS the owner typing one — it must still
 * clear the scenario, exactly as before.
 */
export function isAnchorHeld(lens: number, priceMode: 'live' | 'manual'): boolean {
  return priceMode === 'live' && lens !== 1;
}

/**
 * The price the projection is built from: the held anchor, else the live quote.
 *
 * ⚠ THE `?? livePrice` FALLBACK IS LOAD-BEARING, not defensive. The anchor is latched in an effect,
 * which runs AFTER the render that engages the lens. On that one render `held` is already true while
 * `anchor` is still null, and falling back to the live quote makes the engaging render reproduce the
 * price the previous render used — so engaging the lens never itself changes `pricePath` and cannot
 * trip the reset effect it is trying to survive. Latching the price inside the drag handler instead
 * would reintroduce that race: the handler closes over the price of the render that built it, so a
 * poll landing between render and drag would latch a STALE anchor, change `pricePath`, and kill the
 * scenario at the instant of its birth.
 */
export function stressAnchorPrice(livePrice: number, anchor: number | null, held: boolean): number {
  if (!held) return livePrice;
  return Number.isFinite(anchor) && (anchor as number) > 0 ? (anchor as number) : livePrice;
}

/**
 * How far spot has run from the held anchor, as a fraction. 0 when nothing is held.
 *
 * ⚠ THE ANCHOR FREEZES THE SCENARIO, NOT THE FACE. Holding the anchor keeps `pricePath` — and so the
 * whole projection — still while the owner reads it; it must NOT also blind them to the market. The
 * store quote keeps arriving and the face keeps re-rendering on it (only the *path* memo is insulated),
 * so spot and this drift stay live at the poll's own cadence while the scenario underneath holds.
 *
 * Which side each number belongs on: anything DESCRIBING THE SCENARIO reads the anchor (the path, the
 * engine run, the CAGR denominator, "starts at") or it would describe a run that never happened;
 * anything reporting THE MARKET reads spot. Mixing the two is how a face ends up claiming a projection
 * started from a price it never used.
 */
export function anchorDrift(livePrice: number, anchorPrice: number, held: boolean): number {
  // ⚠ `Number.isFinite` on BOTH, not just `> 0`: Infinity passes `> 0` and would report a flat −100%
  // drift (live/Infinity − 1), painting the readout red on a coin that never moved.
  if (!held || !Number.isFinite(anchorPrice) || !(anchorPrice > 0) || !Number.isFinite(livePrice)) return 0;
  return livePrice / anchorPrice - 1;
}

// ── Shared face rules — extracted from the Cycling/Ownership JSX so each has ONE definition ──────────
// Each of these used to live inline in a parent face's render body, where no test could reach it (the
// repo has no render harness). A third face (the Strategy face) needs the same rules; a third inline copy
// is how two faces end up disagreeing about the same number. Every helper here is the parent's expression
// moved verbatim — the parents now call it — and each is pinned in cyclingFaceView.test.ts.

/**
 * The Coinbase LTV zone for a projected row — the shared gauge, banded against CB_LLTV, the LTV the
 * projection actually liquidates at. ⚠ NOT the dashboard's cbLiqFrac: that comes from the owner's entered
 * liq price, a TODAY anchor that says nothing about a position five years out. The trigger boundary is
 * still the owner's own setting.
 */
export function cbZoneLevel(ltv: number, cbLtvTriggerPct: number): SafetyLevel {
  return cbBarLevel(ltv, cbLtvTriggerPct, CB_LLTV);
}

/** Strike's partial-liquidation LTV as a fraction, from the owner's setting; falls back to the published
 *  85% when the setting is missing, zero, negative or not a number. */
export function strikeLiqLtvOf(strikeLiquidationLtvPct: number): number {
  return strikeLiquidationLtvPct > 0 ? strikeLiquidationLtvPct / 100 : 0.85;
}

/** The Strike LTV zone: watch from the 50% draw ceiling, act at the liquidation LTV (`strikeLiqLtvOf`). */
export function strikeZoneLevel(strikeLtv: number, strikeLiqLtv: number): SafetyLevel {
  return barLevel(strikeLtv, STRIKE_MAX_DRAW_LTV, strikeLiqLtv);
}

/**
 * Is the inspected price under the power-law support line at that month?
 *
 * ⚠ A float-equality guard, not a gate. On the 4-yr path the price is fair × multiple — a different
 * construction from the support line's A_FLOOR × d^B — so a row landing exactly on a low turn could compute
 * one float step under support. A genuinely below-support path (the stress lens, or a slow convergence
 * from a spot under support) still trips it. Plain numbers: this module never imports the power law.
 */
export function isBelowSupport(price: number, supportAtMonth: number): boolean {
  return price < supportAtMonth * (1 - 1e-9);
}

/** The fixed Milestones rows, before any cycle turns are merged in (`mergeMilestoneRows`). */
export const MILESTONE_MONTHS = [12, 24, 36, 60, 120] as const;

/** The fixed Milestones rows that fall inside the horizon. */
export function fixedMilestoneMonths(horizonMonths: number): number[] {
  return MILESTONE_MONTHS.filter((m) => m <= horizonMonths);
}

export type NeverDrawVerdictKind = 'liquidated' | 'baseline' | 'wins' | 'loses';

export interface NeverDrawVerdict {
  /** Liquidation outranks everything; `hold` IS the never-draw baseline (C3), so there is nothing to
   *  compare; otherwise the run wins or loses on end equity. */
  kind: NeverDrawVerdictKind;
  /** The raw equity comparison, independent of `kind` — the Net-equity tile colours on it even when the
   *  run liquidated, exactly as the Cycling face always has. */
  wins: boolean;
  equityDelta: number;
  btcDelta: number;
}

/** The verdict against the never-draw baseline on the SAME price path. */
export function verdictVsNeverDraw(
  sim: Pick<CyclingResult, 'liqMonth' | 'last' | 'baselineEquity' | 'baselineBtc'>,
  mode: CyclingMode,
): NeverDrawVerdict {
  const wins = sim.last.equity > sim.baselineEquity;
  const kind: NeverDrawVerdictKind = sim.liqMonth !== null ? 'liquidated'
    : mode === 'hold' ? 'baseline'
    : wins ? 'wins' : 'loses';
  return {
    kind,
    wins,
    equityDelta: sim.last.equity - sim.baselineEquity,
    btcDelta: sim.last.btcHeld - sim.baselineBtc,
  };
}

/** The price the cold-storage buffer survives down to. The knob is a PRICE, not a percentage — "survive a
 *  drop to $61,236" is a decision; "survive a break of 30%" is arithmetic you have to do first. */
export function coldSurvivePrice(price: number, coldBufferPct: number): number {
  return price * (1 - coldBufferPct / 100);
}

/**
 * The cold buffer's survive-to price as a multiple of the FAIR line at the same month — the fair-value
 * translation the engine's docblock requires wherever the knob appears, so it can never be read as more
 * precise than it is. 0 when the fair line is not positive.
 */
export function surviveFairMultiple(price: number, fairAtMonth: number, coldBufferPct: number): number {
  return fairAtMonth > 0 ? (price / fairAtMonth) * (1 - coldBufferPct / 100) : 0;
}

// ── The Strike LTV cap — one definition for all three faces (Cycling, Ownership, Strategy) ───────────

/**
 * ⚠ 60, between the 50% draw ceiling and the 70% margin call. 50 would bind the instant any price fall
 * follows a full draw — Strike is drawable TO 50%, so a cap there thrashes every month. 65 leaves five
 * points of cushion below the call. 60 gives ten points either side, and costs 0.1060 ₿ of reserve on the
 * 4-yr fixture against 0.0665 ₿ at 65 and 0.2088 ₿ at 50.
 */
export const DEFAULT_STRIKE_CAP_PCT = 60;
/**
 * ⚠ ON by default. Verified a NO-OP on the default Support / on-the-line view (byte-identical ₿ held, cold
 * and equity), so the shipped default frame is untouched; it changes only the paths that actually fall.
 */
export const DEFAULT_STRIKE_CAP_ON = true;
/** The face slider. The engine clamps anything above 66.5 (0.70 × 0.95 — a buffer inside the call, never
 *  on it), so 67 and 68 run as 66.5 and the readout says "max". */
export const STRIKE_CAP_RANGE = { min: 50, max: 68, step: 1 } as const;

/**
 * The Strike-cap slider readout: 'off', the requested cap, or — for 67/68, which the engine clamps — the
 * cap it actually runs, marked "max". Pass the raw slider value and effectiveStrikeCapPct's result.
 */
export function strikeCapReadout(rawPct: number, effectivePct: number): string {
  if (!(rawPct > 0) || !(effectivePct > 0)) return 'off';
  return effectivePct < rawPct ? `${effectivePct.toFixed(1)}% — max` : `${rawPct}%`;
}

/**
 * The Strike-cap InfoTip copy, shared by all three faces. The first line is the spec's; the second is the
 * survival guard's disclosure — without it the tip would promise the cap more than it delivers.
 */
export const STRIKE_CAP_TIP: readonly string[] = [
  "Strike lends to 50% and calls the loan at 70%. This moves bitcoin out of cold storage into the Strike collateral pool to hold the line — Coinbase is served first out of what's left over.",
  'One thing outranks the cap: when Coinbase would otherwise be liquidated, Strike gives way. Morpho liquidates instantly at 86% with no cure window; Strike gives 72 hours to cure.',
];

export type StrikeCapState = 'off' | 'idle' | 'defended' | 'short' | 'yielded' | 'called';

export interface StrikeCapReading {
  /** Precedence: called > yielded > short > defended > idle. `off` only when the cap is off AND no call. */
  state: StrikeCapState;
  /** The cap the engine RAN, as a percentage (effectiveStrikeCapPct) — 0 when off. */
  capPct: number;
  /** BTC moved cold → Strike across the run. */
  movedBtc: number;
  firstTopUpMonth: number | null;
  exhaustedMonth: number | null;
  /** First month the survival guard made Strike give way so Coinbase could live. */
  yieldMonth: number | null;
  marginMonth: number | null;
  /** Coinbase's liquidation month — decides whether "gave way to keep Coinbase alive" is TRUE. */
  liqMonth: number | null;
}

/**
 * What the Strike cap did on this run, for the faces to say in plain words. `capPct` is the EFFECTIVE cap
 * (pass effectiveStrikeCapPct's result, never the raw slider value). A margin call outranks everything —
 * with the cap on or off, a call is a call.
 */
export function strikeCapReading(
  sim: Pick<CyclingResult,
    'strikeMarginMonth' | 'firstSurvivalYieldMonth' | 'strikeTopUpExhaustedMonth' | 'firstStrikeTopUpMonth'
    | 'totalStrikeTopUpBtc' | 'liqMonth'>,
  capPct: number,
): StrikeCapReading {
  const on = capPct > 0;
  const state: StrikeCapState = sim.strikeMarginMonth !== null ? 'called'
    : !on ? 'off'
    : sim.firstSurvivalYieldMonth !== null ? 'yielded'
    : sim.strikeTopUpExhaustedMonth !== null ? 'short'
    : sim.firstStrikeTopUpMonth !== null ? 'defended'
    : 'idle';
  return {
    state,
    capPct: on ? capPct : 0,
    movedBtc: sim.totalStrikeTopUpBtc,
    firstTopUpMonth: sim.firstStrikeTopUpMonth,
    exhaustedMonth: sim.strikeTopUpExhaustedMonth,
    yieldMonth: sim.firstSurvivalYieldMonth,
    marginMonth: sim.strikeMarginMonth,
    liqMonth: sim.liqMonth,
  };
}

const capLabel = (capPct: number): string => `${Number.isInteger(capPct) ? capPct : capPct.toFixed(1)}%`;

/**
 * The yield sentence, or '' when the guard never bound. ⚠ COPY TRUTH: "to keep Coinbase alive" only when
 * Coinbase actually survived — a yield can precede a later liquidation, and then the sentence says so.
 */
export function strikeYieldSentence(r: StrikeCapReading): string {
  if (r.yieldMonth === null) return '';
  return r.liqMonth === null
    ? `Strike gave way to keep Coinbase alive in month ${r.yieldMonth}.`
    : `Strike gave way to Coinbase in month ${r.yieldMonth}, but Coinbase was still liquidated in month ${r.liqMonth}.`;
}

/**
 * One plain-words line per state. Shared by the faces' state lines and the Strike-cap InfoTip's live line.
 * ⚠ `defended` must never read as a margin call — holding the line IS the success case.
 */
export function strikeCapNote(r: StrikeCapReading): string {
  const call = `${(STRIKE_MARGIN_CALL_LTV * 100).toFixed(0)}%`;
  const moved = `${r.movedBtc.toFixed(4)} ₿`;
  switch (r.state) {
    case 'off':
      return 'Strike LTV cap is off — nothing moves bitcoin into the Strike pool.';
    case 'idle':
      return `Strike never reached the ${capLabel(r.capPct)} cap on this path — nothing moved.`;
    case 'defended':
      return `Strike held at ${capLabel(r.capPct)} by moving ${moved} out of cold storage, first at month ${r.firstTopUpMonth}.`;
    case 'short':
      return `From month ${r.exhaustedMonth} cold storage could not hold Strike at ${capLabel(r.capPct)} — it slipped past the cap `
        + `but stayed under the ${call} call.${r.movedBtc > 0 ? ` ${moved} moved out of cold in all.` : ''}`;
    case 'yielded':
      return strikeYieldSentence(r);
    case 'called': {
      const y = strikeYieldSentence(r);
      return `Strike LTV crosses ${call} at month ${r.marginMonth} — margin-call territory on the Strike leg.${y ? ` ${y}` : ''}`;
    }
  }
}
