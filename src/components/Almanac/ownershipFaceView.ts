import type { CyclingRow } from '../../simulation/cyclingSim';
import { deriveOwnership } from '../../simulation/ownership';
import { btcGained } from './cyclingFaceView';

/**
 * Ownership face display math (S3). REUSES the shared Cycling helpers rather than defining a second set
 * (B1): `btcGained` / `clampMonth` / `holdingsSplit` / `applyPathStress` / `debtSplit` come straight from
 * cyclingFaceView. This module adds only the ownership-specific bits. Pure, store-free, type-only imports
 * (the testable-leaf rule).
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
  /** Cold-storage BTC — a SUBSET of `held`, not a fourth quantity to add to it. 0 when the sweep is off. */
  cold: number;
  /** null when non-finite (debt with no collateral) — a chart GAP, never a coerced NaN or a fake 0. */
  cbLtv: number | null;
  strikeLtv: number | null;
  price: number;
  /** null when no finite liquidation price exists (debt-free leg, or debt with no collateral). Plotting a
   *  $0 line would read as "never liquidates", which is the inverse of an unbacked position's truth. */
  liq: number | null;
}

/** Chart series for the three ownership views (held/owed/yours · LTV · price & liq). `yours`/`owed` read
 *  deriveOwnership — the definition, never an open-coded subtraction. */
export function chartOwnershipRows(rows: CyclingRow[], cbLiqLtv: number): OwnershipChartRow[] {
  return rows.map((r) => {
    const o = deriveOwnership(r.btcHeld, r.debt, r.price);
    const ltvPct = (fraction: number): number | null =>
      Number.isFinite(fraction) ? +(fraction * 100).toFixed(1) : null;
    return {
      m: r.m,
      held: +r.btcHeld.toFixed(4),
      yours: +o.yoursBtc.toFixed(4),
      owed: +o.lendersBtc.toFixed(4),
      // ⚠ `held` ALREADY includes cold (btcHeld is all three pools), so plotting cold makes visible a
      // share the Held line was otherwise hiding. It is a floor under `yours`: coins no lender can reach.
      cold: +r.coldBtc.toFixed(4),
      cbLtv: ltvPct(r.cbLtv),
      strikeLtv: ltvPct(r.strikeLtv),
      price: Math.round(r.price),
      liq: cbLiqLtv > 0 && r.cbCollateralBtc > 0 && r.cbDebt > 0
        ? Math.round(r.cbDebt / (cbLiqLtv * r.cbCollateralBtc))
        : null,
    };
  });
}

