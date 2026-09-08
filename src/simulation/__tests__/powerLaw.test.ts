import { describe, it, expect } from 'vitest';
import {
  PL_A_FAIR, PL_A_FLOOR, PL_A_CEILING, PL_BAND_LABEL, PL_ON_THE_LINE,
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

/** Mirrors powerLaw.ts's PRIVATE addMonths (UTC, day-of-month clamped) so the pin below can name the
 *  exact date each month lands on. START is Aug 31, so the clamp is load-bearing here: +1mo → Sep 30. */
function addUtcMonths(date: Date, months: number): Date {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(date.getUTCDate(), dim));
  return t;
}
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
    // ...and the resistance ratio is PINNED, not merely bounded: 2.4e-17 / 1.16e-17 = 2.069. A loose
    // `> 2` would silently accept the old 10^-16.12 (6.54x), which is exactly the drift this guards.
    expect(PL_A_CEILING / PL_A_FAIR).toBeCloseTo(2.069, 3);
  });

  it('band vocabulary: ONE word per band, and a key is never the word', () => {
    // The faces used to interpolate the raw key into prose, so a panel headed "Resistance" would
    // read "...reverts toward the power-law ceiling line" two lines down. One map, one word each.
    expect(PL_BAND_LABEL.floor).toBe('Support');
    expect(PL_BAND_LABEL.fair).toBe('Fair');
    expect(PL_BAND_LABEL.ceiling).toBe('Resistance');
    // 'fair' is legitimately its own word; the other two must never surface their keys.
    expect(PL_BAND_LABEL.floor.toLowerCase()).not.toBe('floor');
    expect(PL_BAND_LABEL.ceiling.toLowerCase()).not.toBe('ceiling');
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

  it('⭐ PL_ON_THE_LINE: month 1 onward IS the band, for every band', () => {
    // The "on the line" preset is not an engine branch — it is convergeMonths = 1, where the weight
    // max(0, 1 - m/1) is already 0 for every m >= 1. This pins that, so nobody "optimises" the weight
    // and silently breaks the preset.
    for (const band of BANDS) {
      const p = plConvergencePath(ANCHOR, band, START, 24, PL_ON_THE_LINE);
      expect(p[0]).toBe(ANCHOR);                                  // month 0 is still the live price
      for (const m of [1, 2, 6, 12, 24]) {
        const bandAt = plBandsAt(addUtcMonths(START, m))[band];
        expect(p[m]).toBeCloseTo(bandAt, 6);
      }
    }
  });

  it('on the line puts a real STEP at month 1 — down on support, up on the others', () => {
    // The step is the honest consequence of month 0 being pinned to the live price. Faces surface it.
    const onFloor = plConvergencePath(ANCHOR, 'floor', START, 12, PL_ON_THE_LINE);
    const onCeil = plConvergencePath(ANCHOR, 'ceiling', START, 12, PL_ON_THE_LINE);
    expect(onFloor[1]).toBeLessThan(onFloor[0]);                  // support today sits below spot
    expect(onCeil[1]).toBeGreaterThan(onCeil[0]);
    // and it is a genuine discontinuity, not a rounding wobble
    expect(Math.abs(onFloor[1] / onFloor[0] - 1)).toBeGreaterThan(0.05);
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
