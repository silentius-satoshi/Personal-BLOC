import { fmtUSD, shownUsd } from '../../utils/format';

/** A stat card's value, its line under it and the value's colour. */
export interface CbStatCard { value: string; sub: string; color: string }

/**
 * Sweep 2b, W2 — the CB Loan tab's AUTO-LIQ PRICE and DROP TO LIQ cards, PURE (the tab renders them as they come). With
 * nothing to seize at a price, both read "—" and say why, muted — they read "$0" and "100.0%" in green before:
 *  - nothing owed — a debt under the dust floor (`shownUsd`) is not a loan, `cbSeizurePrice`'s own rule;
 *  - no collateral — a debt with nothing pledged has no seizure price (`liqPriceOf` gives 0, and 0 is not a price).
 * With a loan and coins: the seizure price through `fmtUSD`, and the price decline to it to the tenth, red under 25%,
 * orange under 40%, else green — as before.
 */
export function cbLiqCards(
  debtUsd: number, collateralBtc: number, liqPrice: number, price: number,
): { liq: CbStatCard; drop: CbStatCard } {
  if (!shownUsd(debtUsd) || !(collateralBtc > 0)) {
    const none: CbStatCard = { value: '—', sub: shownUsd(debtUsd) ? 'no collateral' : 'nothing owed', color: 'var(--text-muted)' };
    return { liq: none, drop: none };
  }
  const drop = Math.max(0, (1 - liqPrice / price) * 100);
  return {
    liq: { value: fmtUSD(liqPrice), sub: 'at 86% LLTV', color: 'var(--text-primary)' },
    drop: {
      value: `${drop.toFixed(1)}%`, sub: 'price decline needed',
      color: drop < 25 ? 'var(--red)' : drop < 40 ? 'var(--orange)' : 'var(--green)',
    },
  };
}
