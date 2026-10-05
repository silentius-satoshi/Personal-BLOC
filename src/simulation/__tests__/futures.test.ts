import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  priceFutures, futureSeed, FUTURES_SEED, FUTURES_COUNT, FUTURES_MAX_MONTHS, type PriceFuture,
} from '../pricePaths';
import { runFutures, futureOutcome, quantile, type FuturesInputs } from '../monteCarlo';
import { runCyclingSim, allInEquity, baselineAllInEquity } from '../cyclingSim';
import { plBandAt } from '../powerLaw';
import { deriveOwnership } from '../ownership';
import { STRIKE_MAX_DRAW_LTV } from '../strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';

/**
 * The futures (spec pbloc-spec-policy-v2-lenses-v1): the belief side (pricePaths) and the engine side (monteCarlo).
 * Every assertion carries a tag, and each named mutation (MF1–MF33, the spec's §5) turns its own tag red. Round
 * synthetic figures only.
 */
const ROOT = process.cwd();
const read = (f: string): string => readFileSync(join(ROOT, 'src/simulation', f), 'utf8');
const importsOf = (src: string): string[] => [...src.matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]);

const START = new Date('2026-10-04T00:00:00Z');
/** The calibration sample: 1,000 futures, whatever count the faces run (D-3 — §9 may cut FUTURES_COUNT to 300). */
const FAMILY = 1000;
const futures = (months: number, count: number, seed = FUTURES_SEED, anchorPrice = 84_000): PriceFuture[] =>
  priceFutures({ anchorPrice, startDate: START, months, count, seed });

describe('the price futures — a seeded belief leaf', () => {
  it('SEEDED — the same request gives the same futures; another seed, others; each future its own generator', () => {
    // MF1 (every future from future 0's seed) turns DISTINCT red; MF24 (Math.random) turns SEEDED red
    const a = futures(24, 50);
    expect(futures(24, 50), 'SEEDED').toEqual(a);
    expect(futures(24, 50, FUTURES_SEED + 1), 'SEEDED: another seed').not.toEqual(a);
    expect(new Set(a.map((f) => f.prices[24])).size, 'DISTINCT').toBe(50);
    expect(futureSeed(2026, 0), 'SEEDED: the mix').not.toBe(futureSeed(2026, 1));
  });

  it('PREFIX — 300 futures are the first 300 of 1,000, and a shorter horizon is a prefix of a longer one', () => {
    // MF2 (drawing each future only to the horizon) turns PREFIX months red; MF31 (a count of 100) the faces' count
    const long = futures(FUTURES_MAX_MONTHS, 40);
    expect(futures(FUTURES_MAX_MONTHS, 25), 'PREFIX count').toEqual(long.slice(0, 25));
    const short = futures(60, 40);
    short.forEach((f, i) => {
      expect(f.regime, `PREFIX months: future ${i}`).toBe(long[i].regime);
      expect(f.prices, `PREFIX months: future ${i}`).toEqual(long[i].prices.slice(0, 61));
    });
    // R13 — the faces run 1,000 futures, or §9's 300, and nothing else
    expect([1000, 300], "PREFIX: the faces' count").toContain(FUTURES_COUNT);
  });

  it('ANCHOR — every future opens exactly at the anchor, has months + 1 prices, all finite and positive', () => {
    // MF3 (month 0 taken from the curve) turns ANCHOR red
    for (const f of futures(120, 200, FUTURES_SEED, 97_531)) {
      expect(f.prices[0], 'ANCHOR').toBe(97_531);
      expect(f.prices).toHaveLength(121);
      expect(f.prices.every((p) => Number.isFinite(p) && p > 0), 'ANCHOR: finite, positive').toBe(true);
    }
  });

  it('JUNK — a non-positive anchor or a bad horizon gives flat futures, never NaN', () => {
    expect(priceFutures({ anchorPrice: 0, startDate: START, months: 3, count: 2, seed: 1 }).map((f) => f.prices))
      .toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(priceFutures({ anchorPrice: 50_000, startDate: START, months: Number.NaN, count: 1, seed: 1 })[0].prices)
      .toEqual([50_000]);
    expect(priceFutures({ anchorPrice: 50_000, startDate: new Date(Number.NaN), months: 2, count: 1, seed: 1 })[0].prices)
      .toEqual([50_000, 50_000, 50_000]);
  });

  it('REGIMES — 70% ordinary, 15% a lost decade, 10% a support break, 5% a supercycle (1,000 futures, ±3–5 points)', () => {
    const n: Record<string, number> = {};
    for (const f of futures(12, FAMILY)) n[f.regime] = (n[f.regime] ?? 0) + 1;
    expect(n.ordinary, 'REGIMES ordinary').toBeGreaterThan(650);
    expect(n.ordinary, 'REGIMES ordinary').toBeLessThan(750);
    expect(n.lostDecade, 'REGIMES lostDecade').toBeGreaterThan(110);
    expect(n.lostDecade, 'REGIMES lostDecade').toBeLessThan(190);
    expect(n.supportBreak, 'REGIMES supportBreak').toBeGreaterThan(70);
    expect(n.supportBreak, 'REGIMES supportBreak').toBeLessThan(130);
    expect(n.supercycle, 'REGIMES supercycle').toBeGreaterThan(30);
    expect(n.supercycle, 'REGIMES supercycle').toBeLessThan(70);
  });

  it('CALIBRATION — the memo\'s harshness: ordinary futures dip under the model\'s support, the worst month a crash', () => {
    // The memo's targets (pbloc-memo-strategy-architecture-v1 §3): the deepest month-end under support, 0.82 × at the
    // median and 0.61 × at the 10th percentile; the worst single month, −35% at the median. Measured: 0.80 / 0.59 / −34%.
    // MF4 (no shocks) and MF5 (troughs higher, LogU 1.1–2.3 × support) turn the dip's median red
    const support = Array.from({ length: 241 }, (_, m) => plBandAt('floor', START, m));
    const dips: number[] = [], worst: number[] = [];
    for (const f of futures(240, FAMILY).filter((x) => x.regime === 'ordinary')) {
      let dip = Infinity, w = 0;
      for (let m = 1; m <= 240; m++) {
        dip = Math.min(dip, f.prices[m] / support[m]);
        w = Math.min(w, f.prices[m] / f.prices[m - 1] - 1);
      }
      dips.push(dip); worst.push(w);
    }
    dips.sort((a, b) => a - b); worst.sort((a, b) => a - b);
    expect(quantile(dips, 0.5), 'CALIBRATION dip p50').toBeGreaterThan(0.75);
    expect(quantile(dips, 0.5), 'CALIBRATION dip p50').toBeLessThan(0.85);
    expect(quantile(dips, 0.1), 'CALIBRATION dip p10').toBeGreaterThan(0.52);
    expect(quantile(dips, 0.1), 'CALIBRATION dip p10').toBeLessThan(0.66);
    expect(quantile(worst, 0.5), 'CALIBRATION worst').toBeGreaterThan(-0.40);
    expect(quantile(worst, 0.5), 'CALIBRATION worst').toBeLessThan(-0.28);
  });

  it('WALL — pricePaths imports only the two belief leaves', () => {
    // MF6 (pricePaths importing the engine) turns this red
    expect(importsOf(read('pricePaths.ts')).sort(), 'WALL pricePaths').toEqual(['./cycleModel', './powerLaw']);
  });
});

// ── The engine over the futures ────────────────────────────────────────────────────────────────────────────────────

const BASE: FuturesInputs = {
  startYear: 2026, strikeCollateralBtc: 2, strikeBalance: 0, strikeCreditLine: 60_000,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
  cbCollateralBtc: 1, cbDebt: 50_000, openingColdBtc: 1, income: 6_000, expenses: 5_000,
  strikeAprPct: 13, cbAprPct: 6, cycleMonths: 1, cbLtvCapPct: 70, strikeLtvCapPct: 60, coldStoreBufferPct: 30,
  defendCbLtv: true, mode: 'cycle',
};
/** A 45% month: Coinbase opens month 2 at 91% LTV — past 86%. */
const GAP = [100_000, 100_000, 55_000, 55_000, 60_000, 70_000, 80_000];
const FLAT = new Array<number>(7).fill(100_000);
const withPolicy = (inputs: FuturesInputs): FuturesInputs => ({
  ...inputs,
  supportPolicy: {
    supportPath: new Array<number>(7).fill(60_000), cbStopAtSupportPct: 45, strikeStopAtSupportPct: 50,
    accumulateBelow: 2, payDownAbove: 3, bearBufferMonths: 12, openingCashUsd: 0,
    strikeCureLtv: 0.65, strikePartialLiqLtv: 0.85, strikeRetrieveMaxLtv: 0.40, breakerRearmMonths: 6,
  },
});

describe('the futures\' batch runner — the engine side of the wall', () => {
  it('QUANTILE — linear between the nearest ranks; empty → NaN', () => {
    // MF9 (the lower rank only, no interpolation) turns this red
    const xs = [1, 2, 3, 4, 5];
    expect([0.1, 0.5, 0.9].map((p) => quantile(xs, p)), 'QUANTILE').toEqual([1.4, 3, 4.6]);
    expect(quantile([], 0.5), 'QUANTILE empty').toBeNaN();
  });

  it('OUTCOME — the engine\'s own last row: yours, cold, the all-in verdict', () => {
    const r = runCyclingSim({ ...BASE, pricePath: FLAT });
    const o = futureOutcome(BASE, FLAT);
    expect(o.yoursBtc, 'OUTCOME yours').toBe(deriveOwnership(r.last.btcHeld, r.last.debt, r.last.price).yoursBtc);
    expect(o.coldBtc, 'OUTCOME cold').toBe(r.last.coldBtc);
    expect(o.beatsNeverDraw, 'OUTCOME beats').toBe(allInEquity(r) > baselineAllInEquity(r));
    expect(o.seized, 'OUTCOME seized').toBe(false);
  });

  it('SEIZED — a loan Morpho takes during the month counts, even where the month-end reading rescued it (policy off)', () => {
    // MF7 (seized read from liqMonth alone) turns SEIZED off red
    const r = runCyclingSim({ ...BASE, pricePath: GAP });
    // The premise: no policy, so the month-end rescue ran — yet the engine's own test saw the loan open past 86%.
    expect([r.policyApplied, r.liqMonth, r.firstOpenPastLltvMonth], 'SEIZED premise').toEqual([false, null, 2]);
    expect(futureOutcome(BASE, GAP).seized, 'SEIZED off').toBe(true);
    // With the policy, the run itself seizes on the way down.
    const p = runCyclingSim({ ...withPolicy(BASE), pricePath: GAP });
    expect([p.policyApplied, p.liqMonth, p.seizedOnTheWayDown], 'SEIZED on: premise').toEqual([true, 2, true]);
    expect(futureOutcome(withPolicy(BASE), GAP).seized, 'SEIZED on').toBe(true);
  });

  it('SUMMARY — the counts and spreads are the futures\' own; countsSeizures follows the applied policy', () => {
    // MF8 (countsSeizures always true) turns COUNTS off red
    const paths = [GAP, FLAT, FLAT.map((x) => x * 1.2)];
    const each = paths.map((p) => futureOutcome(withPolicy(BASE), p));
    const s = runFutures(withPolicy(BASE), paths);
    expect([s.count, s.months], 'SUMMARY size').toEqual([3, 6]);
    expect(s.seized, 'SUMMARY seized').toBe(each.filter((o) => o.seized).length);
    expect(s.beatsNeverDraw, 'SUMMARY beats').toBe(each.filter((o) => o.beatsNeverDraw).length);
    const ys = each.map((o) => o.yoursBtc).sort((a, b) => a - b);
    expect(s.yoursBtc, 'SUMMARY yours').toEqual({ p10: quantile(ys, 0.1), p50: quantile(ys, 0.5), p90: quantile(ys, 0.9) });
    expect(s.countsSeizures, 'COUNTS on').toBe(true);
    expect(runFutures(BASE, paths).countsSeizures, 'COUNTS off').toBe(false);
    expect(runFutures({ ...withPolicy(BASE), mode: 'hold' }, paths).countsSeizures, 'COUNTS hold').toBe(false);
  });

  it('WALL — monteCarlo imports the engine and the ownership leaf only, never a belief', () => {
    // MF10 (monteCarlo importing a belief) turns this red
    expect(importsOf(read('monteCarlo.ts')).sort(), 'WALL monteCarlo').toEqual(['./cyclingSim', './ownership']);
  });
});

/**
 * The futures report — the calibration family run against the memo's candidates on the REPRO position (1 ₿ on Strike,
 * 1 ₿ on Coinbase with $30,000 owed, a $30,000 line, $8,000 in and $6,000 out a month, 13% / 6.27%): 1,000 futures ×
 * 240 months from 2026-10-04 at $84,000. Skipped in the gate; to print it:
 *   FUTURES_REPORT=1 npx vitest run src/simulation/__tests__/futures.test.ts --reporter=verbose
 */
describe.runIf(!!process.env.FUTURES_REPORT)('FUTURES_REPORT — the rebuilt family against the memo', () => {
  it('prints the table', () => {
    const fs = futures(240, FAMILY);
    const support = Array.from({ length: 241 }, (_, m) => plBandAt('floor', START, m));
    const repro: FuturesInputs = {
      startYear: 2026, strikeCollateralBtc: 1, strikeBalance: 0, strikeCreditLine: 30_000,
      strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV, cbCollateralBtc: 1, cbDebt: 30_000,
      openingColdBtc: 0, income: 8_000, expenses: 6_000, strikeAprPct: 13, cbAprPct: 6.27, cycleMonths: 1,
      cbLtvCapPct: 70, strikeLtvCapPct: 60, coldStoreBufferPct: 30, defendCbLtv: true, mode: 'cycle',
    };
    const policy = (stop: number, acc: number, pay: number, room: number) => ({
      supportPath: support, cbStopAtSupportPct: stop, strikeStopAtSupportPct: 50, accumulateBelow: acc,
      payDownAbove: pay, bearBufferMonths: room, openingCashUsd: 0, strikeCureLtv: 0.65, strikePartialLiqLtv: 0.85,
      strikeRetrieveMaxLtv: 0.40, breakerRearmMonths: 6,
    });
    const rows: [string, FuturesInputs][] = [
      ['faces today (45 · 2.0/3.0 · 12)', { ...repro, supportPolicy: policy(45, 2, 3, 12) }],
      ['C1 (45 · 2.0/3.0 · 24)', { ...repro, supportPolicy: policy(45, 2, 3, 24) }],
      ['C3 (45 · 2.5/3.0 · 36)', { ...repro, supportPolicy: policy(45, 2.5, 3, 36) }],
      ['old defaults (60 · 1.5/2.0 · 12)', { ...repro, supportPolicy: policy(60, 1.5, 2, 12) }],
      ['policy off', repro],
    ];
    const paths = fs.map((f) => f.prices);
    const out = (s: string) => process.stdout.write(`${s}\n`);
    out('<!-- FUTURES_REPORT BEGIN -->');
    for (const [name, inputs] of rows) {
      const s = runFutures(inputs, paths);
      out(`${name}: yours ${s.yoursBtc.p10.toFixed(2)} / ${s.yoursBtc.p50.toFixed(2)} / ${s.yoursBtc.p90.toFixed(2)} ₿ · cold p50 `
        + `${s.coldBtc.p50.toFixed(2)} ₿ · beats never-draw ${(s.beatsNeverDraw / 10).toFixed(1)}% · seized ${(s.seized / 10).toFixed(1)}%`
        + ` · counts seizures ${s.countsSeizures}`);
    }
    out('<!-- FUTURES_REPORT END -->');
    expect(fs).toHaveLength(FAMILY);
  });
});
