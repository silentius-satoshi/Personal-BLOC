import { ltvOf } from './ltv';

export const STRIKE_MAX_DRAW_LTV = 0.50;

// Strike's published margin-call terms beyond the 70% call itself (STRIKE_MARGIN_CALL_LTV, emergencyModel):
// a call must be CURED back to this LTV within 72 hours, else collateral is sold down to it.
export const STRIKE_CURE_LTV = 0.65;
// Collateral can leave the Strike pool only at or below this LTV (and must stay under the 50% line after).
// The support policy's migration obeys it. ⚠ The cycling engine imports NEITHER constant — the view passes them
// in as plain numbers, like strikeMaxDrawLtv, so the engine stays a leaf.
export const STRIKE_RETRIEVE_MAX_LTV = 0.40;

// The 15% Strike/BLOC operating ceiling — the LTV the advisor keeps the Strike BLOC at in steady state
// (blocTarget = btcHeld × price × this). SINGLE definition for the advisor path (runAdvisor's blocLtvCeiling
// param): every view passes this instead of a bare 0.15 literal, and emergencyModel consumes it for its
// firepower/floor math. (The separate tier-minimum 0.15 in runBLOC/runBlocYearOne/TierCards is a different
// concept and stays local.)
export const BLOC_OPERATING_CEILING = 0.15;

/** Strike BLOC LTV = drawn balance ÷ collateral value. Positive debt with no collateral is immediately unsafe. */
export function computeStrikeLtv(blocBalance: number, btcHeld: number, price: number): number {
  return ltvOf(blocBalance, btcHeld, price);
}

export function strikeAvailableCredit(
  creditLine:    number,
  collateralBtc: number,
  btcPrice:      number,
  drawn:         number,
) {
  const ltvCap  = collateralBtc * btcPrice * STRIKE_MAX_DRAW_LTV;
  const limit   = Math.min(creditLine, ltvCap);
  return {
    available:        Math.max(0, limit - drawn),
    limit,
    binding:          ltvCap < creditLine ? 'collateral' as const : 'line' as const,
    fullyBackedPrice: collateralBtc > 0 ? creditLine / (collateralBtc * STRIKE_MAX_DRAW_LTV) : 0,
  };
}
