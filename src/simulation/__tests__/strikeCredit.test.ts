import { describe, it, expect } from 'vitest';
import { strikeAvailableCredit, computeStrikeLtv } from '../strikeCredit';

describe('computeStrikeLtv', () => {
  it('is drawn balance ÷ collateral value', () => {
    expect(computeStrikeLtv(10_000, 1, 100_000)).toBeCloseTo(0.10);
    expect(computeStrikeLtv(30_000, 0.5, 100_000)).toBeCloseTo(0.60);
  });

  it('guards zero collateral → 0', () => {
    expect(computeStrikeLtv(10_000, 0, 100_000)).toBe(0);
  });

  it('guards zero price → 0', () => {
    expect(computeStrikeLtv(10_000, 1, 0)).toBe(0);
  });
});

describe('strikeAvailableCredit', () => {
  it('line-bound: creditLine is the binding constraint', () => {
    // ltvCap = 1 × 100_000 × 0.50 = 50_000 > line (20_000)
    const result = strikeAvailableCredit(20_000, 1, 100_000, 5_000);
    expect(result.available).toBe(15_000);
    expect(result.binding).toBe('line');
  });

  it('collateral-bound: ltvCap is the binding constraint', () => {
    // ltvCap = 0.5 × 60_000 × 0.50 = 15_000 < line (20_000)
    const result = strikeAvailableCredit(20_000, 0.5, 60_000, 5_000);
    expect(result.available).toBe(10_000);
    expect(result.binding).toBe('collateral');
  });

  it('floors at 0 when drawn exceeds the limit', () => {
    // ltvCap = 0.5 × 60_000 × 0.50 = 15_000; drawn 18_000 > 15_000
    const result = strikeAvailableCredit(20_000, 0.5, 60_000, 18_000);
    expect(result.available).toBe(0);
  });
});
