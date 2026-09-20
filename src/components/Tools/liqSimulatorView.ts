import { cbMetrics } from '../../simulation/cbMetrics';
import { computeStrikeLtv } from '../../simulation/strikeCredit';

/**
 * LiqSimulator's four LTVs — extracted PURE so they can be pinned by a test. There is no render harness in
 * this repo (zero `.test.tsx`), so a figure computed inline in a component is a figure nothing can pin; the
 * `*View.ts` / `*Model.ts` convention (playbookView, outlookView, eventSheetModel, …) exists for exactly this.
 *
 * 🔴 EVERY LTV HERE ROUTES THROUGH A SHARED DEFINITION — `cbMetrics` for the Coinbase leg, `computeStrikeLtv`
 * for the Strike leg — never a local `value > 0 ? debt / value : 0`. That local fallback is what shipped, and
 * it rendered **0.0%** for a loan with NO collateral behind it: the worst position the app can describe,
 * displayed as the safest, in the one panel someone opens during a margin call.
 *
 * ⚠ There is no zero-price case to protect here. The simulator's price slider has `min={1000}`, so a zero
 * denominator can ONLY mean zero collateral — the unbacked loan, which the shared rule reports as ∞. Do not
 * "restore" a price guard: it would re-introduce the defect under a different justification.
 *
 * Callers format with `fmtLtvPct`, never `(x * 100).toFixed(…)`.
 */
export interface LiqSimLtvInputs {
  cbLoanBalance: number;
  cbBalanceAfterDraw: number;
  cbCollateralBtc: number;
  strikeDrawnAfterDraw: number;
  strikeCollateralBtc: number;
  /** The slider price (≥ 1000 by construction), not the live spot. */
  price: number;
  /** Passed straight to cbMetrics; the LTV it returns does not depend on it. */
  cbLtvTriggerPct: number;
}

export interface LiqSimLtvs {
  cbNow: number;
  cbAfterDraw: number;
  strikeAfterDraw: number;
}

export function liqSimLtvs(i: LiqSimLtvInputs): LiqSimLtvs {
  return {
    cbNow:           cbMetrics(i.cbLoanBalance,      i.cbCollateralBtc, i.price, i.cbLtvTriggerPct).ltv,
    cbAfterDraw:     cbMetrics(i.cbBalanceAfterDraw, i.cbCollateralBtc, i.price, i.cbLtvTriggerPct).ltv,
    strikeAfterDraw: computeStrikeLtv(i.strikeDrawnAfterDraw, i.strikeCollateralBtc, i.price),
  };
}

/** The Strike LTV after paying `paydownNeeded` off Coinbase with a fresh Strike draw (the targets table). */
export function strikeLtvAtTarget(
  strikeDrawn: number, paydownNeeded: number, strikeCollateralBtc: number, price: number,
): number {
  return computeStrikeLtv(strikeDrawn + paydownNeeded, strikeCollateralBtc, price);
}
