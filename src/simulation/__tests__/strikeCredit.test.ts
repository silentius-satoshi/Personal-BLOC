import { describe, it, expect } from 'vitest';
import { strikeAvailableCredit } from '../strikeCredit';

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
