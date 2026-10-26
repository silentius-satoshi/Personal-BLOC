import { describe, it, expect } from 'vitest';
import { breakEvenGrowth, steadyPath, BREAK_EVEN_BRACKET } from '../fireBreakEven';
import { fireTimeline, type FireInputs } from '../fire';

/**
 * The break-even growth (FIRE plan M3; D1 A′ — batch 1 build 3): the lowest STEADY yearly growth at which the plan lasts
 * the horizon, its stop month held fixed — the one fixed-rate quantity, a yardstick and never a path (R3). Its steady paths
 * are built with Math.pow, so every figure here is compared to a tolerance, never an exact golden (R7). Every assertion
 * carries a tag; each planted bug in `build-3-mutations.json` turns its own tag red. ⚠ SYNTHETIC round figures.
 */

const BASE: FireInputs = {
  btc: 1, otherUsd: 0, savingsUsd: 0, spendUsd: 0, retirementIncomeUsd: 0, stopMonth: 0,
  inflation: 0.02, otherMonthlyFactor: 1, wBtc: 0.04, wOther: 0.04, taxRate: 0, basisUsdPerBtc: null,
};
const P0 = 100_000;
const flat = (n: number): number[] => new Array<number>(n).fill(P0);

describe('⭐ M3 — the break-even reproduces M3 under M3\'s setup, to ±0.001 (% a year)', () => {
  // M3: a bitcoin-only pot withdrawing a fixed share of its opening value a year (÷ 12 a month), raised 2% every 12 months
  // from month 0, at the start of months 0 … N−1, price_m = price_0 × (1 + g)^(m/12); no tax, no other assets, stopping now.
  const M3: [number, number, number][] = [[0.04, -0.267, 3.225], [0.08, 7.287, 9.362], [0.12, 13.265, 14.524], [0.25, 30.799, 31.010]];
  for (const [rate, at240, at360] of M3) {
    it(`${rate * 100}% a year → ${at240} / ${at360}`, () => {
      for (const [months, want] of [[240, at240], [360, at360]] as const) {
        const be = breakEvenGrowth({ ...BASE, spendUsd: (rate * P0) / 12 }, flat(months));
        expect(be.reason, `M3 ${rate} ${months} a figure`).toBeNull();
        expect(Math.abs(be.yearlyGrowth! * 100 - want), `M3 ${rate} over ${months} months`).toBeLessThanOrEqual(0.001);
      }
    });
  }
});

/** Fixtures for the sweep — other assets, the tax, a later stop month, a gap, retirement income, a negative return. */
const FIXTURES: [string, FireInputs][] = [
  ['bitcoin only, 8%', { ...BASE, spendUsd: (0.08 * P0) / 12 }],
  ['a 30% tax', { ...BASE, spendUsd: (0.08 * P0) / 12, taxRate: 0.3 }],
  ['the tax over an owner\'s basis', { ...BASE, spendUsd: (0.08 * P0) / 12, taxRate: 0.3, basisUsdPerBtc: 20_000 }],
  ['other assets at +0.5% a month', { ...BASE, otherUsd: 50_000, otherMonthlyFactor: 1.005, spendUsd: (0.1 * P0) / 12 }],
  ['other assets at −0.5% a month', { ...BASE, otherUsd: 50_000, otherMonthlyFactor: 0.995, spendUsd: (0.08 * P0) / 12 }],
  ['a stop at month 60, with savings', { ...BASE, spendUsd: 1_500, stopMonth: 60, savingsUsd: 1_000 }],
  ['a stop at month 36, a $500 gap and the tax', { ...BASE, spendUsd: 600, stopMonth: 36, savingsUsd: -500, taxRate: 0.3 }],
  ['retirement income beside other assets', { ...BASE, spendUsd: 1_200, retirementIncomeUsd: 300, taxRate: 0.3, otherUsd: 20_000, otherMonthlyFactor: 1.004 }],
];
const GRID = Array.from({ length: 301 }, (_, i) => Math.round((-0.5 + i * 0.005) * 1_000) / 1_000);

describe('⭐ MONOTONE — lasting grows with the growth; the break-even rises with the withdrawal (F10, v0.2 §7)', () => {
  it('over the grid every fixture crosses from running out to lasting, once, and the break-even sits at the crossing', () => {
    for (const [name, x] of FIXTURES) {
      for (const months of [240, 360]) {
        const lasts = GRID.map((g) => fireTimeline(x, steadyPath(P0, g, months)).lasts);
        const first = lasts.indexOf(true);
        expect(lasts[0], `MONOTONE ${name} ${months}: runs out at the grid's floor (non-vacuous)`).toBe(false);
        expect(lasts[lasts.length - 1], `MONOTONE ${name} ${months}: lasts at its top (non-vacuous)`).toBe(true);
        expect(lasts.slice(first).every(Boolean), `MONOTONE ${name} ${months}: once lasting, always lasting`).toBe(true);
        const be = breakEvenGrowth(x, flat(months)).yearlyGrowth!;
        expect(be, `MONOTONE ${name} ${months}: above the last grid point that runs out`).toBeGreaterThan(GRID[first - 1]);
        expect(be, `MONOTONE ${name} ${months}: at or below the first that lasts`).toBeLessThanOrEqual(GRID[first]);
      }
    }
  });

  it('a higher withdrawal needs a higher break-even: M3\'s rates, and a sweep of spending on each fixture', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (const rate of [0.02, 0.04, 0.06, 0.08, 0.12, 0.25]) {
      const be = breakEvenGrowth({ ...BASE, spendUsd: (rate * P0) / 12 }, flat(240)).yearlyGrowth!;
      expect(be, `MONOTONE ${rate}`).toBeGreaterThan(previous);
      previous = be;
    }
    for (const [name, x] of FIXTURES) {
      let before = Number.NEGATIVE_INFINITY;
      for (const k of [0.8, 1, 1.2, 1.4]) {
        const be = breakEvenGrowth({ ...x, spendUsd: x.spendUsd * k }, flat(240));
        if (be.yearlyGrowth === null) continue;
        expect(be.yearlyGrowth, `MONOTONE ${name} × ${k}`).toBeGreaterThanOrEqual(before);
        before = be.yearlyGrowth;
      }
    }
  });
});

describe('⭐ NULL — nothing in the bracket lasts → null; lasting at the floor says so', () => {
  it('a draw no growth can meet gives null; a plan the other assets carry lasts at the floor', () => {
    const hopeless = breakEvenGrowth({ ...BASE, spendUsd: 2 * P0 }, flat(240));   // month 0's own price can't pay it
    expect([hopeless.yearlyGrowth, hopeless.reason, hopeless.atFloor], 'NULL nothing lasts').toEqual([null, 'nothingLasts', false]);
    const carried = breakEvenGrowth({ ...BASE, otherUsd: 10_000_000, spendUsd: 1_000 }, flat(240));
    expect([carried.yearlyGrowth, carried.atFloor, carried.reason], 'NULL lasts at the floor').toEqual([BREAK_EVEN_BRACKET[0], true, null]);
  });
});

describe('⭐ STOP FIXED — the break-even holds the face\'s stop month; \'atFi\' would move with the growth', () => {
  it('\'atFi\' is resolved once, on the face\'s own path, and held', () => {
    const x: FireInputs = { ...BASE, btc: 0.5, otherUsd: 20_000, savingsUsd: 2_000, spendUsd: 1_500, stopMonth: 'atFi', taxRate: 0.3 };
    const face = Array.from({ length: 240 }, (_, m) => 40_000 + 600 * m);
    const own = fireTimeline(x, face);
    expect(own.stopMonth, 'STOP FIXED premise: FI on the face\'s path').not.toBeNull();
    const be = breakEvenGrowth(x, face);
    expect(be.stopMonth, 'STOP FIXED the face\'s stop month').toBe(own.stopMonth);
    expect(Math.abs(be.yearlyGrowth! - breakEvenGrowth({ ...x, stopMonth: own.stopMonth! }, face).yearlyGrowth!), 'STOP FIXED held').toBeLessThan(1e-12);
    // Non-vacuous: on the steady path at that growth, FI would come in another month — a moving stop reads another plan.
    const steadyFi = fireTimeline(x, steadyPath(face[0], be.yearlyGrowth!, 240)).stopMonth;
    expect(steadyFi, 'STOP FIXED the stop would move').not.toBe(own.stopMonth);
  });
});

describe('⭐ REASONS — nothing to read, said', () => {
  it('no stop month, a stop past the horizon, junk paths and junk options', () => {
    expect(breakEvenGrowth({ ...BASE, btc: 0, savingsUsd: 10, spendUsd: 10_000, stopMonth: 'atFi' }, flat(24)).reason, 'REASONS no stop month').toBe('noStopMonth');
    expect(breakEvenGrowth({ ...BASE, spendUsd: 100, stopMonth: 24 }, flat(24)).reason, 'REASONS stop at the horizon').toBe('stopBeyondHorizon');
    expect(breakEvenGrowth({ ...BASE, spendUsd: 100 }, []).reason, 'REASONS an empty path').toBe('invalid');
    for (const opts of [{ bracket: [-1, 0.5] as const }, { bracket: [0.5, 0.2] as const }, { bracket: [Number.NaN, 1] as const }, { tol: 0 }, { tol: Number.NaN }]) {
      expect(breakEvenGrowth({ ...BASE, spendUsd: 300 }, flat(24), opts).reason, `REASONS junk options ${JSON.stringify(opts)}`).toBe('invalid');
    }
  });

  it('a steady path starts at the face\'s month-0 price and has the face\'s length', () => {
    const p = steadyPath(85_000, 0.1, 13);
    expect(p.length, 'REASONS the length').toBe(13);
    expect(p[0], 'REASONS month 0').toBe(85_000);
    expect(p[12] / p[0], 'REASONS a year later').toBeCloseTo(1.1, 12);
  });
});
