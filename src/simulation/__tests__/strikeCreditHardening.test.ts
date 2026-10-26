import { describe, it, expect } from 'vitest';
import { strikeAvailableCredit } from '../strikeCredit';

describe('strikeCredit hardening', () => {
  it('HS-01 · engine.md `STRIKE_MAX_DRAW_LTV` — fullyBackedPrice is the line over collateral at the 50% draw LTV', () => {
    // $40,000 line on 1 BTC at a 50% draw LTV: fully backed once 1 BTC is worth 40,000 / 0.5 = $80,000
    // (never the 65% cure line's 40,000 / 0.65 = $61,538).
    expect(strikeAvailableCredit(40_000, 1, 50_000, 0).fullyBackedPrice).toBe(40_000 / (1 * 0.5));
  });
});
