import { describe, it, expect } from 'vitest';
import {
  PL_A_FAIR, PL_A_FLOOR, PL_A_CEILING,
  plFairValue, plFloor, plCeiling, plBandsAt, plConvergencePath,
  type PlBand,
} from '../powerLaw';

/**
 * Power-law bands + the Cycling face's convergence price path.
 *
 * ⚠ Every assertion here is RELATIONAL, and every date is a FIXED UTC date. Absolute band dollars track
 * the start date (they grow every day), so pinning them would make this suite rot; and the path's own
 * helpers do UTC month arithmetic, so a local-time date would make the result timezone-dependent.
 */

const START = new Date(Date.UTC(2026, 7, 31));   // 2026-08-31, fixed
const BANDS: PlBand[] = ['floor', 'fair', 'ceiling'];
const ANCHOR = 78_000;

describe('plBandsAt', () => {
  it('bundles the three band prices in ascending order', () => {
    const b = plBandsAt(START);
    expect(b.floor).toBe(plFloor(START));
    expect(b.fair).toBe(plFairValue(START));
    expect(b.ceiling).toBe(plCeiling(START));
    expect(b.floor).toBeLessThan(b.fair);
    expect(b.fair).toBeLessThan(b.ceiling);
  });

  it('each band uses its OWN independent A constant (never PL_A_FAIR × scalar)', () => {
    // The bands share PL_B, so the days term cancels and each ratio is exactly the ratio of A constants.
    const b = plBandsAt(START);
    expect(b.floor / b.fair).toBeCloseTo(PL_A_FLOOR / PL_A_FAIR, 12);
    expect(b.ceiling / b.fair).toBeCloseTo(PL_A_CEILING / PL_A_FAIR, 12);
    // ...and the ceiling ratio is not a round scalar anyone would have hand-typed — it comes from 10^-16.12.
    expect(PL_A_CEILING / PL_A_FAIR).toBeGreaterThan(6);
  });
});

describe('plConvergencePath', () => {
  it('month 0 is EXACTLY the anchor price, for every band', () => {
    // Load-bearing: the face's month 0 must equal the live price the SafetyDashboard shows. Computing it
    // arithmetically drifts ~0.3% through day-of-month clamping, hence the special case in the impl.
    for (const band of BANDS) {
      expect(plConvergencePath(ANCHOR, band, START, 60, 48)[0]).toBe(ANCHOR);
    }
  });

  it('⭐ REGRESSION PIN (C1): the floor/fair ratio is NOT constant across months', () => {
    // The defect this replaces: `anchor × (days_m / days_0) ** PL_B` carries no band coefficient, so all
    // three bands share one growth ratio and the band buttons produce IDENTICAL simulations. If this ever
    // goes back to a constant ratio, the face silently stops having three scenarios.
    const floor = plConvergencePath(ANCHOR, 'floor', START, 60, 48);
    const fair = plConvergencePath(ANCHOR, 'fair', START, 60, 48);
    const ratios = [0, 12, 24, 36].map((m) => floor[m] / fair[m]);
    expect(ratios[0]).toBeCloseTo(1, 12);                       // both start at the anchor
    const distinct = new Set(ratios.map((r) => r.toFixed(6)));
    expect(distinct.size).toBe(ratios.length);                  // strictly varying
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeLessThan(ratios[i - 1]);            // and monotonically diverging
    }
  });

  it('preserves band ordering at every month past the anchor', () => {
    const floor = plConvergencePath(ANCHOR, 'floor', START, 60, 48);
    const fair = plConvergencePath(ANCHOR, 'fair', START, 60, 48);
    const ceiling = plConvergencePath(ANCHOR, 'ceiling', START, 60, 48);
    for (let m = 1; m <= 60; m++) {
      expect(floor[m]).toBeLessThan(fair[m]);
      expect(fair[m]).toBeLessThan(ceiling[m]);
    }
  });

  it('has fully converged onto the band at m >= convergeMonths', () => {
    // Past the window the weight is 0, so path[m] IS the band value — which means the ratio between two
    // paths collapses to the ratio of their A constants (the days term cancels).
    const floor = plConvergencePath(ANCHOR, 'floor', START, 60, 48);
    const fair = plConvergencePath(ANCHOR, 'fair', START, 60, 48);
    for (const m of [48, 54, 60]) {
      expect(floor[m] / fair[m]).toBeCloseTo(PL_A_FLOOR / PL_A_FAIR, 12);
    }
  });

  it('lands on the band value at the converge month, with the day-of-month clamped', () => {
    // Aug 31 + 1 month → Sep 30 (September has no 31st). convergeMonths 1 → m=1 is fully converged.
    const path = plConvergencePath(ANCHOR, 'fair', START, 1, 1);
    expect(path[1]).toBeCloseTo(plFairValue(new Date(Date.UTC(2026, 8, 30))), 9);
  });

  it('rises monotonically', () => {
    for (const band of BANDS) {
      const p = plConvergencePath(ANCHOR, band, START, 60, 48);
      for (let m = 1; m <= 60; m++) expect(p[m]).toBeGreaterThan(p[m - 1]);
    }
  });

  it('guards: non-positive anchor or converge window → a flat path, never NaN', () => {
    for (const p of [
      plConvergencePath(ANCHOR, 'fair', START, 12, 0),
      plConvergencePath(ANCHOR, 'fair', START, 12, -5),
    ]) {
      expect(p).toHaveLength(13);
      expect(p.every((v) => v === ANCHOR)).toBe(true);
    }
    const zero = plConvergencePath(0, 'fair', START, 12, 48);
    expect(zero.every((v) => v === 0)).toBe(true);
    expect(plConvergencePath(-1, 'fair', START, 3, 48).some(Number.isNaN)).toBe(false);
  });

  it('guards: month counts of 0 or below still yield a usable array', () => {
    expect(plConvergencePath(ANCHOR, 'fair', START, 0, 48)).toEqual([ANCHOR]);
    expect(plConvergencePath(ANCHOR, 'fair', START, -3, 48)).toEqual([ANCHOR]);
  });
});
