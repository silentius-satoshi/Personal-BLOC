export const STRIKE_MAX_DRAW_LTV = 0.50;

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
