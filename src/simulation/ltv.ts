/**
 * THE loan-to-value definition. ZERO IMPORTS — a leaf every engine and view can reach.
 *
 * 🔴 ONE RULE, ONE PLACE. Before this module the same ratio was hand-written FIVE times (cbDefense,
 * cyclingSim, strikeCredit, cbMetrics, runCoinbaseLoan) and a sixth copy drifted into LiqSimulator,
 * where it reported **0.0%** for a loan with no collateral behind it — the worst position the app can
 * describe, rendered as the safest, in the panel someone opens during a margin call. Never open-code
 * this ratio again; import it. `__tests__/ltv.test.ts` fails the build if a new copy appears.
 *
 * The three cases, and why each is what it is:
 *  - collateral value > 0        → the honest ratio.
 *  - debt > 0 AND collateral ≤ 0 → **∞**. Debt with nothing behind it is not a healthy 0% position,
 *                                  and 0 reads as perfectly safe. Render it with `fmtLtvPct` ("∞").
 *  - everything else             → 0. ⚠ This DELIBERATELY includes "collateral > 0 but price is 0":
 *                                  an unpriced position is a normal zero-price guard, not an unbacked
 *                                  loan. Nothing-at-all (no debt, no collateral) is not the alarm either.
 */
export function ltvOf(debt: number, collateralBtc: number, price: number): number {
  return collateralBtc * price > 0
    ? debt / (collateralBtc * price)
    : debt > 0 && collateralBtc <= 0 ? Number.POSITIVE_INFINITY : 0;
}

/**
 * Same rule for a caller that already holds the collateral's USD value.
 *
 * ⚠ It still takes `collateralBtc`, and that is the whole point: a zero USD value can mean EITHER no
 * coins OR no price, and only the first is ∞. Dropping the third argument would collapse the two and
 * report ∞ for an unpriced-but-backed position.
 */
export function ltvOfUsd(debt: number, collateralUsd: number, collateralBtc: number): number {
  return collateralUsd > 0
    ? debt / collateralUsd
    : debt > 0 && collateralBtc <= 0 ? Number.POSITIVE_INFINITY : 0;
}
