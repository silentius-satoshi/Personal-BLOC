/**
 * Debt-shift defense — the shared pure math for holding a Coinbase LTV stop.
 *
 * The doctrine (the Almanac faces, matching the Advisor's ltvTriggered playbook): when a price fall pushes
 * CB LTV over the stop, draw from Strike and PAY THE COINBASE LOAN DOWN to the stop — shifting the dollar
 * debt from Coinbase to Strike — then let the normal refinance sweep the debt back to the cheaper facility
 * as the price recovers. No BTC is bought or pledged, so total debt is unchanged by the shift itself.
 *
 * When the Strike line cannot fully restore the stop, the FALLBACK is a collateral top-up (`topUpToCbLtv`):
 * move BTC from the cold reserve first, then the Strike collateral the line no longer needs, into the
 * Coinbase pool — growing the denominator instead of shrinking the numerator.
 *
 * 🔴 Pure leaf: imports NOTHING (no store, no power law, no cyclingSim). The lender ratios arrive as plain
 * numbers, so the engine, the two faces' stress readout, and the Emergency Console can all share ONE
 * capacity definition and can never drift.
 */
import { ltvOf } from './ltv';

/**
 * Strike draw capacity — the engine-consistent headroom: `min(creditLine, collateral × price × maxDrawLtv)
 * − drawn`, floored at 0. This is the same constraint the cycling engine's expense draw uses; the Emergency
 * Console passes no credit line (Infinity), which reduces it to the 50%-LTV line exactly.
 */
export function strikeDrawCapacity(
  strikeCollateralBtc: number,
  strikeBalance: number,
  price: number,
  maxDrawLtv: number,
  creditLine: number = Number.POSITIVE_INFINITY,
): number {
  if (!(strikeCollateralBtc > 0) || !(price > 0) || !(maxDrawLtv > 0)) return 0;
  const ltvCap = strikeCollateralBtc * price * maxDrawLtv;
  const limit = Math.min(Number.isFinite(creditLine) ? creditLine : Number.POSITIVE_INFINITY, ltvCap);
  return Math.max(0, limit - Math.max(0, strikeBalance));
}

export interface CbDefenseInput {
  cbDebt: number;
  cbCollateralBtc: number;
  strikeCollateralBtc: number;
  strikeBalance: number;
  price: number;
  /** The CB LTV to restore, as a percentage (e.g. 70). */
  targetCbLtvPct: number;
  creditLine: number;
  maxDrawLtv: number;
  /** Strike's margin-call LTV — reporting only (the new margin-call price after the draw). */
  marginLtv: number;
}

export interface CbDefenseResult {
  targetCbLtv: number;          // fraction
  /** Paydown that would bring CB LTV exactly to the target at this price. */
  paydownNeededUsd: number;
  /** Strike headroom available to fund it. */
  capacityUsd: number;
  /** What can actually be drawn now. */
  drawUsd: number;
  /** paydownNeededUsd − drawUsd; > 0 means the cap cannot be fully held. */
  shortfallUsd: number;
  fullyDefended: boolean;
  cbDebtAfter: number;
  cbLtvAfter: number;
  skLtvAfter: number;
  skMarginCallPriceAfter: number;
  /** Price at which the POST-defense CB LTV returns to the target — "reversible above $R". */
  recoveryPrice: number;
}


/**
 * How far INSIDE its margin-call line the emergency top-up leaves Strike.
 *
 * Bounding `strikeAvailable` at `marginLtv` itself put an exhausting top-up EXACTLY ON the call line, so
 * cyclingSim's `strikeLtv >= strikeMarginLtv` fired in the same month — a second liquidation, not a last
 * resort. Exported as a named constant so a future spec can make it an input without touching call sites.
 */
export const TOPUP_MARGIN_BUFFER = 0.05;

/**
 * Compute the debt-shift defense at `price`: how much CB debt must move to Strike to restore the cap, how
 * much Strike can actually fund, and the post-defense position. Guarded so a zero/negative price or
 * collateral never produces NaN — a capacity of 0 with a positive shortfall is the honest answer there.
 */
export function defendCbLtv(input: CbDefenseInput): CbDefenseResult {
  const target = input.targetCbLtvPct / 100;
  const collateralValue = input.cbCollateralBtc * input.price;
  const paydownNeededUsd = target > 0 && collateralValue > 0
    ? Math.max(0, input.cbDebt - target * collateralValue)
    : Math.max(0, input.cbDebt);
  const capacityUsd = strikeDrawCapacity(
    input.strikeCollateralBtc,
    input.strikeBalance,
    input.price,
    input.maxDrawLtv,
    input.creditLine,
  );
  const drawUsd = Math.min(paydownNeededUsd, capacityUsd);
  const shortfallUsd = Math.max(0, paydownNeededUsd - drawUsd);
  const cbDebtAfter = Math.max(0, input.cbDebt - drawUsd);
  const newSkDrawn = Math.max(0, input.strikeBalance) + drawUsd;
  const recoveryPrice = target > 0 && input.cbCollateralBtc > 0
    ? cbDebtAfter / (target * input.cbCollateralBtc)
    : 0;
  return {
    targetCbLtv: target,
    paydownNeededUsd,
    capacityUsd,
    drawUsd,
    shortfallUsd,
    fullyDefended: shortfallUsd <= 0,
    cbDebtAfter,
    cbLtvAfter: ltvOf(cbDebtAfter, input.cbCollateralBtc, input.price),
    // ⚠ BOTH LTVs route through `ltvOf` — the whole point of this module is one definition that cannot
    // drift. A `skValue > 0 ? … : 0` fallback reported 0% for a Strike balance with NO collateral behind
    // it: the worst position in the app rendered as perfectly safe. Any consumer must use `fmtLtvPct`.
    skLtvAfter: ltvOf(newSkDrawn, input.strikeCollateralBtc, input.price),
    skMarginCallPriceAfter:
      input.marginLtv > 0 && input.strikeCollateralBtc > 0
        ? newSkDrawn / (input.strikeCollateralBtc * input.marginLtv)
        : 0,
    recoveryPrice,
  };
}

export interface CbTopUpInput {
  cbDebt: number;
  cbCollateralBtc: number;
  price: number;
  /** The CB LTV to restore, as a percentage (e.g. 70). */
  targetCbLtvPct: number;
  /** The unpledged reserve — the FIRST source: no lender constraint, no Strike side effect. */
  coldBtc: number;
  strikeCollateralBtc: number;
  strikeBalance: number;
  /** Strike's margin-call LTV. The LAST-resort bound is a `TOPUP_MARGIN_BUFFER` STEP INSIDE it, never it:
   *  the line's own backing may be sacrificed, but the top-up must not walk Strike onto its own call. */
  marginLtv: number;
}

export interface CbTopUpResult {
  targetCbLtv: number;
  /** BTC that must be added to CB to reach the target. */
  requiredBtc: number;
  fromColdBtc: number;
  fromStrikeBtc: number;
  topUpBtc: number;
  /** requiredBtc − topUpBtc; > 0 means even both sources cannot restore the target. */
  shortfallBtc: number;
  fullyDefended: boolean;
  cbLtvAfter: number;
}

/**
 * Emergency collateral top-up: grow the CB denominator from the cold reserve first, then from the Strike
 * collateral above `marginLtv × (1 − TOPUP_MARGIN_BUFFER)` — the true last resort, which sacrifices the
 * 50% line backing but STOPS A BUFFER SHORT of the margin call rather than landing on it.
 * Pure; guarded so zero price / zero collateral never yields NaN.
 */
export function topUpToCbLtv(input: CbTopUpInput): CbTopUpResult {
  const target = input.targetCbLtvPct / 100;
  const canPrice = target > 0 && input.price > 0;
  const requiredBtc = canPrice ? Math.max(0, input.cbDebt / (target * input.price) - input.cbCollateralBtc) : 0;
  const fromColdBtc = Math.min(requiredBtc, Math.max(0, input.coldBtc));
  const remaining = requiredBtc - fromColdBtc;
  // ⚠ Bounded a buffer INSIDE the call line, never on it. Consequence to expect: a leg already inside the
  // buffer now yields ZERO available collateral where it previously yielded a sliver taken right up to the
  // call. Zero is the correct answer there — the sliver bought nothing and triggered the margin call.
  const bound = input.marginLtv * (1 - TOPUP_MARGIN_BUFFER);
  const strikeAvailable = canPrice && bound > 0
    ? Math.max(0, input.strikeCollateralBtc - Math.max(0, input.strikeBalance) / (bound * input.price))
    : 0;
  const fromStrikeBtc = Math.min(remaining, strikeAvailable);
  const topUpBtc = fromColdBtc + fromStrikeBtc;
  const shortfallBtc = Math.max(0, requiredBtc - topUpBtc);
  return {
    targetCbLtv: target,
    requiredBtc,
    fromColdBtc,
    fromStrikeBtc,
    topUpBtc,
    shortfallBtc,
    fullyDefended: shortfallBtc <= 0,
    cbLtvAfter: ltvOf(input.cbDebt, input.cbCollateralBtc + topUpBtc, input.price),
  };
}
