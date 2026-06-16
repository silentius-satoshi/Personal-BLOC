import { describe, it, expect } from 'vitest';
import { cbMetrics, accruedCbBalance, barLevel, worseLevel } from '../cbMetrics';
import { CB_LLTV } from '../runCoinbaseLoan';

// Shared baseline: $60k loan, 1.48 ₿ collateral, $100k BTC, 75% trigger.
const BAL = 60_000, COLL = 1.48, PRICE = 100_000, TRIG = 75;

describe('cbMetrics', () => {
  it('computes ltv, liqPrice, triggerPrice from known inputs', () => {
    const m = cbMetrics(BAL, COLL, PRICE, TRIG);
    expect(m.ltv).toBeCloseTo(60_000 / (1.48 * 100_000), 6);        // 0.405405
    expect(m.liqPrice).toBeCloseTo(60_000 / (1.48 * CB_LLTV), 2);    // ≈ 47_140.79
    expect(m.triggerPrice).toBeCloseTo(60_000 / (1.48 * 0.75), 2);   // ≈ 54_054.05
  });

  it('pctToTrigger / pctToLiq are price-relative deltas', () => {
    const m = cbMetrics(BAL, COLL, PRICE, TRIG);
    expect(m.pctToTrigger).toBeCloseTo((m.triggerPrice - PRICE) / PRICE, 6);
    expect(m.pctToLiq).toBeCloseTo((m.liqPrice - PRICE) / PRICE, 6);
  });

  it('buffer signs: safe (LTV below trigger) → trigger/liq prices BELOW current price (negative deltas)', () => {
    const safe = cbMetrics(BAL, COLL, PRICE, TRIG);   // LTV ≈ 40% << 75%
    expect(safe.pctToTrigger).toBeLessThan(0);
    expect(safe.pctToLiq).toBeLessThan(0);
    // danger: heavy loan, low price → LTV past trigger → triggerPrice ABOVE current → positive
    const danger = cbMetrics(120_000, COLL, 50_000, TRIG);
    expect(danger.pctToTrigger).toBeGreaterThan(0);
  });

  it('guards divide-by-zero (no NaN)', () => {
    const zc = cbMetrics(BAL, 0, PRICE, TRIG);     // zero collateral → zeroed prices, finite deltas
    expect(zc.ltv).toBe(0);
    expect(zc.liqPrice).toBe(0);
    expect(zc.triggerPrice).toBe(0);
    expect(Number.isNaN(zc.pctToTrigger)).toBe(false);
    const zp = cbMetrics(BAL, COLL, 0, TRIG);      // zero price → all zero
    expect(zp.ltv).toBe(0);
    expect(zp.pctToTrigger).toBe(0);
    expect(zp.pctToLiq).toBe(0);
  });
});

describe('accruedCbBalance', () => {
  it('null asOf → unchanged (never re-anchored)', () => {
    expect(accruedCbBalance(BAL, 4.77, null)).toBe(BAL);
  });

  it('asOf = now (0 elapsed) → unchanged', () => {
    // exact ISO timestamp → ~0 days elapsed (date-only truncation is the caller's concern)
    expect(accruedCbBalance(BAL, 4.77, new Date().toISOString())).toBeCloseTo(BAL, 2);
  });

  it('30 days at 4.77% APR → compounds daily upward by the expected factor', () => {
    const asOf = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const expected = BAL * Math.pow(1 + 4.77 / 100 / 365, 30);
    expect(accruedCbBalance(BAL, 4.77, asOf)).toBeCloseTo(expected, 1);
    expect(accruedCbBalance(BAL, 4.77, asOf)).toBeGreaterThan(BAL);
  });
});

describe('activeLiqPrice authority + cushion', () => {
  // activeLiqPrice = entered when > 0, else computed cbMetrics.liqPrice (the dashboard/CoinbaseLoanMain rule)
  const pickActive = (entered: number, computed: number) => entered > 0 ? entered : computed;

  it('entered > 0 → uses entered; entered = 0 → uses computed liqPrice', () => {
    const m = cbMetrics(BAL, COLL, PRICE, TRIG);
    expect(pickActive(50_000, m.liqPrice)).toBe(50_000);
    expect(pickActive(0, m.liqPrice)).toBeCloseTo(m.liqPrice, 6);
  });

  it('cushion uses activeLiqPrice → differs from the computed-only cushion when entered diverges', () => {
    const m = cbMetrics(BAL, COLL, PRICE, TRIG);
    const entered = 52_000;                                  // higher than the ~47.1k formula price
    const cushionActive   = (PRICE - pickActive(entered, m.liqPrice)) / PRICE;
    const cushionComputed = (PRICE - m.liqPrice) / PRICE;
    expect(cushionActive).not.toBeCloseTo(cushionComputed, 3);
    expect(cushionActive).toBeLessThan(cushionComputed);     // higher entered liq price = smaller cushion
  });
});

describe('safety state selection (barLevel / worseLevel)', () => {
  it('barLevel classifies by ascending thresholds', () => {
    expect(barLevel(0.40, 0.75, 0.80)).toBe('safe');
    expect(barLevel(0.76, 0.75, 0.80)).toBe('watch');
    expect(barLevel(0.82, 0.75, 0.80)).toBe('act');
  });

  it('worseLevel takes the more severe (nearer) bar', () => {
    expect(worseLevel('safe', 'watch')).toBe('watch');
    expect(worseLevel('act', 'safe')).toBe('act');
    expect(worseLevel('safe', 'safe')).toBe('safe');
  });

  it('Strike liquidation gauge: default 85% ceiling places a known LTV correctly', () => {
    const strikeLiqLtv = 85 / 100;
    const strikeLtv = 30_000 / (1.0 * 100_000);             // 30% LTV
    expect(strikeLtv / strikeLiqLtv).toBeCloseTo(0.3529, 4); // fill fraction of the 0..85% track
    expect(barLevel(strikeLtv, strikeLiqLtv * 0.76, strikeLiqLtv * 0.82)).toBe('safe');
  });
});

describe('refactor safety — cbMetrics equals the old inline CB formulas', () => {
  it('matches CoinbaseLoanMain currentLtv + autoLiqPrice and Sidebar implied', () => {
    const m = cbMetrics(BAL, COLL, PRICE, TRIG);
    expect(m.ltv).toBeCloseTo(BAL / (COLL * PRICE), 10);          // old currentLtv
    expect(m.liqPrice).toBeCloseTo(BAL / (COLL * 0.86), 10);      // old autoLiqPrice
    expect(m.liqPrice).toBeCloseTo(BAL / (COLL * CB_LLTV), 10);   // old Sidebar implied
  });
});
