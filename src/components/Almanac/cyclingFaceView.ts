import type { CyclingRow } from '../../simulation/cyclingSim';
import { deriveOwnership } from '../../simulation/ownership';

/**
 * Pure display math for the Almanac Cycling face. No React, no store, no imports from powerLaw/cycleModel —
 * only a TYPE import of CyclingRow plus the ownership leaf (the single definition of yoursBtc, S2′).
 * Extracted so it is testable without a render harness (the repo has none).
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
  return {
    price,
    cbLtv: row.cbCollateralBtc * price > 0 ? row.cbDebt / (row.cbCollateralBtc * price) : 0,
    strikeLtv: row.strikeCollateralBtc * price > 0 ? row.strikeBalance / (row.strikeCollateralBtc * price) : 0,
    collateralValue,
    equity: collateralValue - row.debt,
    yoursBtc: deriveOwnership(row.btcHeld, row.debt, price).yoursBtc,
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
  combined: number;
}

/** Where the stack sits. TWO VENUES — a cold-storage reserve is not modeled (it would need engine changes). */
export function holdingsSplit(row: CyclingRow): HoldingsSplit {
  return {
    strike: row.strikeCollateralBtc,
    coinbase: row.cbCollateralBtc,
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
