import { describe, it, expect } from 'vitest';
import { resolveStrikeCall } from '../supportPolicy';

/** Hardening 1 · engine — resolveStrikeCall at its boundary (HE-26). Round synthetic figures only. */
describe('Hardening 1 · resolveStrikeCall', () => {
  it('HE-26 · almanac.md § Support-anchored policy step 8 ("at/over the partial liquidation LTV (85%) the sale is immediate") — at exactly 85% the sale is immediate, cash untouched', () => {
    const c = resolveStrikeCall({ strikeBalance: 85_000, strikeCollateralBtc: 1, price: 100_000, callLtv: 0.7, cureLtv: 0.65,
      partialLiqLtv: 0.85, cashUsd: 100_000, coldBtc: 0 });
    expect(85_000 / (1 * 100_000)).toBe(0.85);   // the fixture IS the boundary
    expect(c.state).toBe('soldImmediate');
    expect(c.cureCashUsd).toBe(0);
    expect(c.cureColdBtc).toBe(0);
    // Sold down to 65%: (85,000 − s·P) / ((1 − s)·P) = 0.65  ⇒  s = (85,000 − 0.65·P) / (0.35·P).
    expect(c.soldBtc).toBeCloseTo((85_000 - 0.65 * 100_000) / ((1 - 0.65) * 100_000), 12);
  });
});
