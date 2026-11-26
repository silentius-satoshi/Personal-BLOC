import { describe, it, expect } from 'vitest';
import { runBlocYearOne } from '../runBlocYearOne';

/**
 * Hardening 2 — runBlocYearOne.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HE.json).
 * Round synthetic figures.
 */
describe('Hardening 2 — runBlocYearOne', () => {
  it('HE-23 · engine.md "Phase 4 priority" — creditExceeded is checked FIRST: a month that runs out of line AND pays down is phase 4', () => {
    // A 5% LTV ceiling on 1 ₿ at $100,000 forces a paydown every month, and an $8,000 line runs out in month 1.
    const r = runBlocYearOne({
      collateralBtc: 1, btcPrice: 100_000, income: 6_000, expenses: 5_000, apr: 0, ltvCeiling: 0.05, creditLine: 8_000,
      btcGrowthRate: 0,
    });
    const m1 = r.rows[1];
    expect([m1.creditExceeded, m1.paydown > 0], 'HE-23 premise: month 1 both runs out of line and pays down').toEqual([true, true]);
    expect(m1.phase, 'HE-23 the line ran out — phase 4, whatever the paydown').toBe(4);
    for (const row of r.rows.slice(1)) {
      if (row.creditExceeded) expect(row.phase, `HE-23 month ${row.month}`).toBe(4);
    }
  });
});
