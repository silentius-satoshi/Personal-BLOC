import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cbLiqCards } from '../cbLoanCards';
import { cbMetrics } from '../../../simulation/cbMetrics';

/**
 * ⭐ W2 (Sweep 2b) — the CB Loan tab's AUTO-LIQ PRICE and DROP TO LIQ cards with nothing to seize at a price. With
 * nothing owed (a debt under the dust floor) or no collateral, both read "—" and say why, muted — they read "$0" and
 * "100.0%" in green. With a loan and coins, as before: the price through `fmtUSD`, the drop to the tenth, its colour.
 */
const MUTED = 'var(--text-muted)';
const cards = (debt: number, coll: number, price = 100_000) => cbLiqCards(debt, coll, cbMetrics(debt, coll, price, 75).liqPrice, price);

describe('W2 — the CB Loan tab with nothing to seize at a price (Sweep 2b)', () => {
  it('⭐ W2 — nothing owed — a debt under the dust floor is not a loan', () => {
    for (const debt of [0, 0.01, 0.49]) {
      const c = cards(debt, 1.2);
      expect([c.liq, c.drop], `W2 nothing owed (${debt})`)
        .toEqual([{ value: '—', sub: 'nothing owed', color: MUTED }, { value: '—', sub: 'nothing owed', color: MUTED }]);
    }
    expect(cards(0, 0).liq.sub, 'W2 nothing owed, no coins either').toBe('nothing owed');
  });

  it('⭐ W2 — no collateral — a debt with nothing pledged has no seizure price', () => {
    const c = cards(20_000, 0);
    expect([c.liq.value, c.liq.sub, c.liq.color, c.drop.value, c.drop.sub, c.drop.color], 'W2 no collateral')
      .toEqual(['—', 'no collateral', MUTED, '—', 'no collateral', MUTED]);
  });

  it('⭐ W2 — a loan — the price through fmtUSD and the drop as before', () => {
    const c = cards(20_000, 1);   // 20,000 ÷ (1 ₿ × 0.86) = $23,255.81
    expect(c.liq, 'W2 the price').toEqual({ value: '$23,256', sub: 'at 86% LLTV', color: 'var(--text-primary)' });
    expect(c.drop, 'W2 the drop').toEqual({ value: '76.7%', sub: 'price decline needed', color: 'var(--green)' });
    expect(cards(0.5, 1).liq.value, 'W2 at the floor, a loan').toBe('$1');
  });

  it('⭐ W2 — the drop\'s colour at its two boundaries', () => {
    const drop = (liq: number) => cbLiqCards(20_000, 1, liq, 100_000).drop;
    expect([drop(75_100), drop(75_000), drop(60_010), drop(60_000)].map((d) => [d.value, d.color]), 'W2 colours')
      .toEqual([['24.9%', 'var(--red)'], ['25.0%', 'var(--orange)'], ['40.0%', 'var(--orange)'], ['40.0%', 'var(--green)']]);
  });

  it('⭐ W2 WIRED — the tab renders both cards from cbLiqCards', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/CoinbaseLoan/CoinbaseLoanMain.tsx'), 'utf8');
    expect(src, 'W2 WIRED its inputs').toContain('cbLiqCards(accruedBalance, cbCollateralBtc, autoLiqPrice, btcPrice)');
    for (const k of ['liq', 'drop'] as const) {
      expect(src, `W2 WIRED ${k}`).toContain(`value={liqCards.${k}.value}\n          valueColor={liqCards.${k}.color}\n          sub={liqCards.${k}.sub}`);
    }
    expect(src, 'W2 WIRED the open-coded price gone').not.toContain('Math.round(autoLiqPrice)');
  });
});
