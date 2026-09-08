import type { CyclingRow } from '../../simulation/cyclingSim';
import { deriveOwnership } from '../../simulation/ownership';
import { btcGained } from './cyclingFaceView';

/**
 * Ownership face display math (S3). REUSES the Cycling lens rather than defining a second one (B1):
 * `applyPriceLens` / `btcGained` / `clampMonth` / `holdingsSplit` come straight from cyclingFaceView —
 * S3's own draft `applyPriceLens` was a near-verbatim copy of the shipped one, and its "each LTV is
 * recomputed against ITS OWN pool" note describes behaviour that already ships there. This module adds
 * only the ownership-specific bits. Pure, store-free, type-only imports (the testable-leaf rule).
 *
 * 🔴 Must never be imported by anything in the risk core (same discipline as cyclingFaceView).
 */

/** S3's gain adapter (B2): ownership-named view of the SAME definition `btcGained` uses — delegates, so
 *  the two can never drift. `rowPriceOverride` lenses the ROW side ONLY; `base` keeps its own real price. */
export function ownershipGained(row: CyclingRow, base: CyclingRow, rowPriceOverride?: number) {
  return btcGained(row, base, rowPriceOverride);
}

export interface OwnershipChartRow {
  m: number;
  held: number;
  yours: number;
  owed: number;
  cbLtv: number;
  strikeLtv: number;
  price: number;
  liq: number;
}

/** Chart series for the three ownership views (held/owed/yours · LTV · price & liq). `yours`/`owed` read
 *  deriveOwnership — the definition, never an open-coded subtraction. */
export function chartOwnershipRows(rows: CyclingRow[], cbLiqLtv: number): OwnershipChartRow[] {
  return rows.map((r) => {
    const o = deriveOwnership(r.btcHeld, r.debt, r.price);
    return {
      m: r.m,
      held: +r.btcHeld.toFixed(4),
      yours: +o.yoursBtc.toFixed(4),
      owed: +o.lendersBtc.toFixed(4),
      cbLtv: +(r.cbLtv * 100).toFixed(1),
      strikeLtv: +(r.strikeLtv * 100).toFixed(1),
      price: Math.round(r.price),
      liq: Math.round(r.cbCollateralBtc > 0 ? r.cbDebt / (cbLiqLtv * r.cbCollateralBtc) : 0),
    };
  });
}

