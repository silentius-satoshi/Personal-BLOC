export const STRIKE_MAX_DRAW_LTV = 0.50;

// The 15% Strike/BLOC operating ceiling — the LTV the advisor keeps the Strike BLOC at in steady state
// (blocTarget = btcHeld × price × this). SINGLE definition for the advisor path (runAdvisor's blocLtvCeiling
// param): every view passes this instead of a bare 0.15 literal, and emergencyModel consumes it for its
// firepower/floor math. (The separate tier-minimum 0.15 in runBLOC/runBlocYearOne/TierCards is a different
// concept and stays local.)
export const BLOC_OPERATING_CEILING = 0.15;

/** Strike BLOC LTV = drawn balance ÷ collateral value. Guards a zero/empty collateral → 0. */
export function computeStrikeLtv(blocBalance: number, btcHeld: number, price: number): number {
  return btcHeld * price > 0 ? blocBalance / (btcHeld * price) : 0;
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
