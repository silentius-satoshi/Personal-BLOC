import { describe, it, expect } from 'vitest';
import { liqSimLtvs, strikeLtvAtTarget } from '../liqSimulatorView';
import { fmtLtvPct } from '../../../utils/format';

// Synthetic round figures only — this repo is public.
const FIXTURE = {
  cbLoanBalance: 60_000,
  cbBalanceAfterDraw: 50_000,
  cbCollateralBtc: 2,
  strikeDrawnAfterDraw: 20_000,
  strikeCollateralBtc: 1,
  price: 80_000,
  cbLtvTriggerPct: 75,
};

describe('liqSimLtvs', () => {
  it('matches hand arithmetic for the ordinary case', () => {
    const r = liqSimLtvs(FIXTURE);
    expect(r.cbNow).toBeCloseTo(0.375, 10);
    expect(r.cbAfterDraw).toBeCloseTo(0.3125, 10);
    expect(r.strikeAfterDraw).toBeCloseTo(0.25, 10);
  });

  it('⭐ zero CB collateral renders both Coinbase LTVs as ∞, never 0.0%', () => {
    const r = liqSimLtvs({ ...FIXTURE, cbCollateralBtc: 0 });
    expect(r.cbNow).toBe(Number.POSITIVE_INFINITY);
    expect(r.cbAfterDraw).toBe(Number.POSITIVE_INFINITY);
    expect(fmtLtvPct(r.cbNow, 1)).toBe('∞');
    expect(fmtLtvPct(r.cbAfterDraw, 1)).toBe('∞');
  });

  it('⭐ zero Strike collateral renders the Strike LTV as ∞, never 0.0%', () => {
    const r = liqSimLtvs({ ...FIXTURE, strikeCollateralBtc: 0 });
    expect(r.strikeAfterDraw).toBe(Number.POSITIVE_INFINITY);
    expect(fmtLtvPct(r.strikeAfterDraw, 1)).toBe('∞');
  });

  it('no debt and no collateral is genuinely 0 — nothing-at-all is not the alarm', () => {
    const r = liqSimLtvs({
      ...FIXTURE,
      cbLoanBalance: 0, cbBalanceAfterDraw: 0, cbCollateralBtc: 0,
      strikeDrawnAfterDraw: 0, strikeCollateralBtc: 0,
    });
    expect(r.cbNow).toBe(0);
    expect(r.cbAfterDraw).toBe(0);
    expect(r.strikeAfterDraw).toBe(0);
    expect(fmtLtvPct(r.cbNow, 1)).toBe('0.0%');
  });

  it('does not depend on cbLtvTriggerPct — it is inert for these LTVs', () => {
    const low  = liqSimLtvs({ ...FIXTURE, cbLtvTriggerPct: 10 });
    const high = liqSimLtvs({ ...FIXTURE, cbLtvTriggerPct: 85 });
    expect(low).toEqual(high);
  });
});

describe('strikeLtvAtTarget', () => {
  it('matches hand arithmetic, and renders ∞ with zero collateral', () => {
    expect(strikeLtvAtTarget(15_000, 5_000, 1, 80_000)).toBeCloseTo(0.25, 10);
    expect(strikeLtvAtTarget(15_000, 5_000, 0, 80_000)).toBe(Number.POSITIVE_INFINITY);
  });
});
