export const STRIKE_MAX_DRAW_LTV = 0.50;

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
