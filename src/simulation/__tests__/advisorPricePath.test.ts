import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdvisor, type AdvisorInputs } from '../runAdvisor';
import { cycleConvergencePath, cycleMultAt } from '../cyclePath';
import { plFairValue, addMonths, PL_ON_THE_LINE } from '../powerLaw';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
// The engine's own fallback expression, verbatim — so equality below is exact, not approximate.
const cagr = (p: number, g: number, m: number) => p * Math.pow(1 + g, m / 12);

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const BASE: AdvisorInputs = {
  btcPrice: 80_000, income: 4_000, expenses: 3_000,
  blocApr: 13, creditLine: 20_000, blocLtvCeiling: 0.15,
  cbBalance: 30_000, cbCollateralBtc: 1, cbAprPct: 6, cbMonthlyPayment: 0,
  cbPaymentStrategy: 'monthly', cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
  startingBlocBalance: 2_000, startingBtcHeld: 0.5, startingMonth: 1, btcGrowthRate: 0.3,
};

// Explicit field pick (not a destructure of a price field) so the golden was capturable at HEAD, BEFORE the
// pricePath change — it pins the operating plan's pre-change behaviour, not the new code against itself.
const golden = (inputs: AdvisorInputs) => runAdvisor(inputs).rows.map((r) => ({
  month: r.month, tier: r.tier,
  blocBalance: Math.round(r.blocBalance * 100) / 100,
  cbBalance:   Math.round(r.cbBalance * 100) / 100,
  cbLtv:       Math.round(r.cbLtv * 1e6) / 1e6,
  btcHeld:     Math.round(r.btcHeld * 1e8) / 1e8,
  btcBought:   Math.round(r.btcBought * 1e8) / 1e8,
}));

describe('runAdvisor — the operating plan is untouched by the pricePath input', () => {
  it('⭐ monthly strategy, no path — golden captured at HEAD 07ab7a2', () => {
    expect(golden(BASE)).toMatchInlineSnapshot(`
      [
        {
          "blocBalance": 5054.17,
          "btcBought": 0.05,
          "btcHeld": 0.55,
          "cbBalance": 30150,
          "cbLtv": 0.376875,
          "month": 1,
          "tier": 4,
        },
        {
          "blocBalance": 6745.89,
          "btcBought": 0.0318518,
          "btcHeld": 0.5818518,
          "cbBalance": 30300.75,
          "cbLtv": 0.370568,
          "month": 2,
          "tier": 4,
        },
        {
          "blocBalance": 7294.31,
          "btcBought": 0.01726384,
          "btcHeld": 0.59911564,
          "cbBalance": 30452.25,
          "cbLtv": 0.364367,
          "month": 3,
          "tier": 4,
        },
        {
          "blocBalance": 7676.76,
          "btcBought": 0.01487798,
          "btcHeld": 0.61399363,
          "cbBalance": 30604.52,
          "cbLtv": 0.358269,
          "month": 4,
          "tier": 4,
        },
        {
          "blocBalance": 8041.3,
          "btcBought": 0.01430372,
          "btcHeld": 0.62829735,
          "cbBalance": 30757.54,
          "cbLtv": 0.352274,
          "month": 5,
          "tier": 4,
        },
        {
          "blocBalance": 8410.52,
          "btcBought": 0.01400255,
          "btcHeld": 0.6422999,
          "cbBalance": 30911.33,
          "cbLtv": 0.346379,
          "month": 6,
          "tier": 4,
        },
        {
          "blocBalance": 8788.01,
          "btcBought": 0.01374657,
          "btcHeld": 0.65604647,
          "cbBalance": 31065.88,
          "cbLtv": 0.340582,
          "month": 7,
          "tier": 4,
        },
        {
          "blocBalance": 9174.51,
          "btcBought": 0.01350195,
          "btcHeld": 0.66954842,
          "cbBalance": 31221.21,
          "cbLtv": 0.334883,
          "month": 8,
          "tier": 4,
        },
        {
          "blocBalance": 9570.3,
          "btcBought": 0.01326356,
          "btcHeld": 0.68281198,
          "cbBalance": 31377.32,
          "cbLtv": 0.329279,
          "month": 9,
          "tier": 4,
        },
        {
          "blocBalance": 9975.62,
          "btcBought": 0.01303056,
          "btcHeld": 0.69584254,
          "cbBalance": 31534.2,
          "cbLtv": 0.323768,
          "month": 10,
          "tier": 4,
        },
        {
          "blocBalance": 10390.71,
          "btcBought": 0.01280273,
          "btcHeld": 0.70864527,
          "cbBalance": 31691.87,
          "cbLtv": 0.31835,
          "month": 11,
          "tier": 4,
        },
        {
          "blocBalance": 10815.79,
          "btcBought": 0.01257993,
          "btcHeld": 0.7212252,
          "cbBalance": 31850.33,
          "cbLtv": 0.313023,
          "month": 12,
          "tier": 4,
        },
      ]
    `);
  });

  it('⭐ ltvTriggered strategy, no path, mid-year start — golden captured at HEAD 07ab7a2', () => {
    expect(golden({
      ...BASE, cbPaymentStrategy: 'ltvTriggered', cbBalance: 55_000, startingMonth: 5, btcGrowthRate: -0.3,
    })).toMatchInlineSnapshot(`
      [
        {
          "blocBalance": 5054.17,
          "btcBought": 0.05,
          "btcHeld": 0.55,
          "cbBalance": 55275,
          "cbLtv": 0.690938,
          "month": 5,
          "tier": 2,
        },
        {
          "blocBalance": 6406.72,
          "btcBought": 0.02917046,
          "btcHeld": 0.57917046,
          "cbBalance": 55551.38,
          "cbLtv": 0.715341,
          "month": 6,
          "tier": 1,
        },
        {
          "blocBalance": 6548.93,
          "btcBought": 0.01380038,
          "btcHeld": 0.59297085,
          "cbBalance": 55829.13,
          "cbLtv": 0.740607,
          "month": 7,
          "tier": 1,
        },
        {
          "blocBalance": 14289.28,
          "btcBought": 0,
          "btcHeld": 0.59297085,
          "cbBalance": 47563.94,
          "cbLtv": 0.65,
          "month": 8,
          "tier": 1,
        },
        {
          "blocBalance": 13476.58,
          "btcBought": 0,
          "btcHeld": 0.59297085,
          "cbBalance": 47801.76,
          "cbLtv": 0.672958,
          "month": 9,
          "tier": 2,
        },
        {
          "blocBalance": 12655.08,
          "btcBought": 0,
          "btcHeld": 0.59297085,
          "cbBalance": 48040.77,
          "cbLtv": 0.696727,
          "month": 10,
          "tier": 2,
        },
        {
          "blocBalance": 11824.67,
          "btcBought": 0,
          "btcHeld": 0.59297085,
          "cbBalance": 48280.98,
          "cbLtv": 0.721335,
          "month": 11,
          "tier": 1,
        },
        {
          "blocBalance": 10985.27,
          "btcBought": 0,
          "btcHeld": 0.59297085,
          "cbBalance": 48522.38,
          "cbLtv": 0.746813,
          "month": 12,
          "tier": 1,
        },
      ]
    `);
  });

  it('⭐ no path ≡ a path of the explicit CAGR values — full rows, both strategies', () => {
    const fixtures: AdvisorInputs[] = [
      BASE,
      { ...BASE, cbPaymentStrategy: 'ltvTriggered', cbBalance: 55_000, startingMonth: 5, btcGrowthRate: -0.3 },
    ];
    for (const inputs of fixtures) {
      const path = Array.from({ length: 13 - inputs.startingMonth }, (_, m) => cagr(inputs.btcPrice, inputs.btcGrowthRate, m));
      expect(runAdvisor({ ...inputs, pricePath: path }).rows).toEqual(runAdvisor(inputs).rows);
    }
  });
});

describe('runAdvisor — pricePath', () => {
  it('⭐ a path overrides the CAGR — every row is priced from the path, and the price reaches the math', () => {
    const path = [80_000, 70_000, 60_000, 65_000, 90_000, 100_000, 110_000, 95_000, 85_000, 120_000, 130_000, 125_000];
    const rows = runAdvisor({ ...BASE, btcGrowthRate: 0.5, pricePath: path }).rows;
    expect(rows.map((r) => r.btcPrice)).toEqual(path);
    rows.forEach((r, m) => expect(r.cbLtv).toBeCloseTo(r.cbBalance / (BASE.cbCollateralBtc * path[m]), 12));
  });

  it('indexes by MONTHS ELAPSED from startingMonth, not by absolute month', () => {
    const path = [80_000, 81_000, 82_000, 83_000, 84_000, 85_000, 86_000, 87_000];
    const rows = runAdvisor({ ...BASE, startingMonth: 5, pricePath: path }).rows;
    expect(rows[0].month).toBe(5);
    expect(rows.map((r) => r.btcPrice)).toEqual(path);   // path[0] → month 5, path[3] → month 8
  });

  it('⭐ degenerate entries fall through to the CAGR — they never poison a row', () => {
    const g = 0.3;
    const cases: number[][] = [
      [],
      [80_000, 81_000],                  // short
      [80_000, NaN, 82_000],
      [80_000, 0, 82_000],
      [80_000, -5_000, 82_000],
      [80_000, Infinity, 82_000],
    ];
    for (const path of cases) {
      const rows = runAdvisor({ ...BASE, btcGrowthRate: g, pricePath: path }).rows;
      rows.forEach((r, m) => {
        expect(Number.isFinite(r.btcPrice) && r.btcPrice > 0).toBe(true);
        expect(Number.isFinite(r.cbLtv)).toBe(true);
        const v = path[m];
        const usable = typeof v === 'number' && Number.isFinite(v) && v > 0;
        expect(r.btcPrice).toBe(usable ? v : cagr(BASE.btcPrice, g, m));
      });
    }
  });

  it('a rising and a falling path diverge in the tier logic', () => {
    // ⚠ 'monthly' on purpose. Under ltvTriggered a rising path fills CB UP to target (reverse rotation) and a
    // falling one pays it DOWN to target, so both can end at the same CB LTV and this would tie.
    const rising  = Array.from({ length: 12 }, (_, m) => 80_000 * (1 + 0.04 * m));
    const falling = Array.from({ length: 12 }, (_, m) => 80_000 * (1 - 0.03 * m));
    const up   = runAdvisor({ ...BASE, btcGrowthRate: 0, pricePath: rising }).rows;
    const down = runAdvisor({ ...BASE, btcGrowthRate: 0, pricePath: falling }).rows;
    expect(up[up.length - 1].cbLtv).toBeLessThan(down[down.length - 1].cbLtv);
  });
});

// ⚠ NAMED TRAP — the month-1 step (its third occurrence; see cyclePath.test.ts "Trap 1"). On the line,
// path[0] is the live price EXACTLY and path[1..] sits ON the modelled curve, so month 0→1 is a
// discontinuity whose SIGN depends on the anchor. Invisible when you reason about "the path" instead of
// path[0] vs path[1]. Fixed UTC dates + synthetic anchors — never today or the live price.
describe('the 4-yr cycle path at a 12-month horizon — the month-1 step', () => {
  const START = utc('2026-09-13');
  const onCurve = (m: number) => { const d = addMonths(START, m); return plFairValue(d) * cycleMultAt(d); };

  it('⭐ the step is SIGNED by the anchor — down from $80k, up from $60k', () => {
    const hi = cycleConvergencePath(80_000, START, 12, PL_ON_THE_LINE);
    const lo = cycleConvergencePath(60_000, START, 12, PL_ON_THE_LINE);
    expect(hi[1] / hi[0] - 1).toBeLessThan(-0.15);
    expect(lo[1] / lo[0] - 1).toBeGreaterThan(0.05);
  });

  it('⭐ month 0 is the anchor exactly and month 1 onward sits ON the curve (the on-the-line decision)', () => {
    const path = cycleConvergencePath(80_000, START, 12, PL_ON_THE_LINE);
    expect(path[0]).toBe(80_000);
    for (let m = 1; m <= 12; m++) expect(Math.abs(path[m] / onCurve(m) - 1)).toBeLessThan(1e-12);
  });

  it('a 12-month segment is NOT always monotone — mid-2029 holds the top AND a fall', () => {
    // Pinned so nobody writes "the segment is monotone" into copy or a test again.
    const path = cycleConvergencePath(390_000, utc('2029-06-13'), 12, PL_ON_THE_LINE);
    expect(path.slice(1).some((v, i) => v > path[i])).toBe(true);
    expect(path.slice(1).some((v, i) => v < path[i])).toBe(true);
  });

  it('the step reaches the engine — a step down lifts month-1 CB LTV on its own', () => {
    const path = cycleConvergencePath(80_000, START, 12, PL_ON_THE_LINE);
    const rows = runAdvisor({ ...BASE, btcGrowthRate: 0, pricePath: path }).rows;
    expect(rows[1].cbLtv / rows[0].cbLtv).toBeGreaterThan(1.15);
  });
});

describe('only OutlookProjection may hand runAdvisor a pricePath', () => {
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? tsxFiles(p) : e.name.endsWith('.tsx') ? [p] : [];
    });
  }

  it('⭐ no other runAdvisor caller passes one — the operating plan (Advisor/Simple/Daily) stays flat', () => {
    const dir = fileURLToPath(new URL('../../components', import.meta.url));
    const callers = tsxFiles(dir).filter((f) => /\brunAdvisor\(/.test(readFileSync(f, 'utf8')));
    // The Almanac faces name a local `pricePath` for cyclingSim — that is not runAdvisor, so filter to callers.
    const offenders = callers.filter((f) => !f.endsWith('OutlookProjection.tsx') && /\bpricePath\b/.test(readFileSync(f, 'utf8')));
    expect(callers.length).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
    expect(readFileSync(join(dir, 'Advisor', 'OutlookProjection.tsx'), 'utf8')).toMatch(/pricePath: cyclePricePath/);
  });
});
