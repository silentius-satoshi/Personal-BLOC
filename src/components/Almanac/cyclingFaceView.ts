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

export interface LensedRow {
  price: number;
  cbLtv: number;
  strikeLtv: number;
  collateralValue: number;
  equity: number;
  /** BTC that survives the debt at this price: deriveOwnership(btcHeld, debt, price).yoursBtc (S2′). */
  yoursBtc: number;
}

/**
 * Re-price ONE row at `row.price × multiplier`, holding every dollar DEBT figure and every BTC COUNT fixed.
 * Display-only: it never re-runs the engine and never touches the charts.
 *
 * ⚠ Guard (multiplier <= 0 or row.price <= 0) returns the row's OWN price/ltvs/collateralValue/equity
 * unchanged, and yoursBtc = row.btcHeld. CyclingRow carries no yoursBtc field, so there is no "own value" to
 * fall back to — the debt term contributes 0, the same convention as btcGained's zero-price guard.
 */
export function applyPriceLens(row: CyclingRow, multiplier: number): LensedRow {
  if (!(multiplier > 0) || !(row.price > 0)) {
    return {
      price: row.price,
      cbLtv: row.cbLtv,
      strikeLtv: row.strikeLtv,
      collateralValue: row.collateralValue,
      equity: row.equity,
      yoursBtc: row.btcHeld,
    };
  }
  const price = row.price * multiplier;
  const collateralValue = row.btcHeld * price;
  // ⚠ Same contract as the engine's ltvOf(): positive debt with no collateral is UNBOUNDED LTV, never 0.
  // A zero here would render a stripped position as "safe" under a price stress — the exact opposite of
  // the truth. Finite 0 remains only for the genuinely debt-free case.
  const lensLtv = (debt: number, coll: number): number =>
    coll * price > 0 ? debt / (coll * price) : debt > 0 && coll <= 0 ? Number.POSITIVE_INFINITY : 0;
  return {
    price,
    cbLtv: lensLtv(row.cbDebt, row.cbCollateralBtc),
    strikeLtv: lensLtv(row.strikeBalance, row.strikeCollateralBtc),
    collateralValue,
    equity: collateralValue - row.debt,
    yoursBtc: deriveOwnership(row.btcHeld, row.debt, price).yoursBtc,
  };
}

/** LTV fraction → display string. Positive infinity (debt with no collateral) reads as ∞, never
 *  "Infinity%" — `.toFixed(1)` on a non-finite number silently produces just that. */
export function fmtLtvPct(fraction: number): string {
  if (!Number.isFinite(fraction)) return fraction > 0 ? '∞' : '—';
  return `${(fraction * 100).toFixed(1)}%`;
}

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

export interface BtcGain {
  /** BTC accumulated — price-independent (pure counts). */
  gross: number;
  /** BTC that survives the debt on both sides (deriveOwnership, S2′). */
  yours: number;
}

/**
 * Bitcoin gained between `base` (normally row 0) and `row`.
 *
 * ⚠ `rowPriceOverride` lenses the ROW side ONLY — `base` always keeps its own real price. Base is today;
 * the lens is a what-if about the SELECTED month, so lensing both sides would silently restate the starting
 * position too. Gross ignores the override entirely (BTC counts don't move with price).
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
 * shrinks `rows` while the stored index still points past the end — `rows[stale]` is undefined and
 * applyPriceLens(undefined, …) throws on row.price. An effect runs after that render, far too late.
 */
export function clampMonth(selected: number, rowCount: number): number {
  if (!(rowCount > 0)) return 0;
  return Math.max(0, Math.min(Math.floor(selected), rowCount - 1));
}
