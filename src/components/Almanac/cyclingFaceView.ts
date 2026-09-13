import type { CyclingRow } from '../../simulation/cyclingSim';
import { deriveOwnership } from '../../simulation/ownership';
import { CB_FEE_TIER1_PCT } from '../../simulation/runCoinbaseLoan';

/**
 * Pure display math for the Almanac Cycling face. No React, no store, no imports from powerLaw/cycleModel —
 * a TYPE import of CyclingRow, the ownership leaf (the single definition of yoursBtc, S2′), and the
 * zero-import Coinbase fee constant (the refinance break-even fallback). Extracted so it is testable
 * without a render harness (the repo has none).
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
