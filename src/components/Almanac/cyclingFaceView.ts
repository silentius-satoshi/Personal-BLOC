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
