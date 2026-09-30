import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildChartSeries, cliffPath, downsample, chartDomain, xExtent, yearTicks, MAX_HISTORY_POINTS,
} from '../decisionChartView';
import { supportAtDates, type HistoryPoint } from '../supportPolicyInputs';
import { cbMetrics } from '../../../simulation/cbMetrics';
import { runCyclingSim, type CyclingInputs } from '../../../simulation/cyclingSim';
import { minCushionOf } from '../../../simulation/planSearch';
import { addMonths } from '../../../simulation/powerLaw';
import { SP_REPRO, SUPPORT, SP_START, policyFor, pathP1, pathP2 } from '../../../simulation/__tests__/supportPolicyPaths';

/**
 * The Decision face's chart series. Round synthetic figures only — this repo is public.
 *
 * 🔴 I29: the cliff is `cbMetrics().liqPrice`, the same formula THE MOVE prints — through `cbSeizurePrice`, the ONE
 * per-row rule the Worst (modeled) ranking reads too (W1). Never a second one.
 */

const TRIGGER = 75;
const DAY = 86_400_000;
const START = SP_START;
const MONTHS = 24;

const history = (n: number): HistoryPoint[] => Array.from({ length: n }, (_, i) => ({
  timestamp: START.getTime() - (n - i) * 30 * DAY,
  price: 10_000 + i * 100,
}));

const build = (over: {
  hist?: HistoryPoint[]; forward?: number[]; floor?: number[]; support?: number[];
  months?: number; cliff?: (number | null)[];
} = {}) => {
  const hist = over.hist ?? history(40);
  const forward = over.forward ?? SUPPORT.slice(0, MONTHS + 1).map((s) => s * 1.3);
  return buildChartSeries(
    hist, START, forward,
    over.floor ?? SUPPORT.slice(0, MONTHS + 1),
    over.support ?? SUPPORT.slice(0, MONTHS + 1),
    supportAtDates,
    over.months ?? MONTHS,
    over.cliff ?? Array.from({ length: MONTHS + 1 }, () => null),
  );
};

describe('⭐ I15 — the seam is exact and the support line crosses it', () => {
  it('⭐ history ends exactly where forward begins — no gap, no double-plot', () => {
    const forward = SUPPORT.slice(0, MONTHS + 1).map((s) => s * 1.3);
    const s = build({ forward });
    expect(s.seamT).toBe(START.getTime());
    const last = s.history[s.history.length - 1];
    expect(last.t).toBe(s.seamT);
    expect(last.price).toBe(forward[0]);
    expect(s.forward[0]).toEqual({ t: s.seamT, price: forward[0] });
    // Exactly ONE point at the seam in each series — the two meet, they do not overlap.
    expect(s.history.filter((p) => p.t === s.seamT)).toHaveLength(1);
    expect(s.forward.filter((p) => p.t === s.seamT)).toHaveLength(1);
  });

  it('history is strictly before the seam, and in ascending time', () => {
    const s = build();
    for (let i = 1; i < s.history.length; i++) expect(s.history[i].t).toBeGreaterThan(s.history[i - 1].t);
    for (const p of s.history.slice(0, -1)) expect(p.t).toBeLessThan(s.seamT);
  });

  it('⭐ the support line spans BOTH halves, and is continuous across the seam', () => {
    const s = build();
    expect(s.support.length).toBeGreaterThan(s.forward.length);
    const before = s.support.filter((p) => p.t < s.seamT);
    const after = s.support.filter((p) => p.t >= s.seamT);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBe(MONTHS + 1);
    for (const p of [...before, ...after]) expect(p.price).not.toBeNull();
    // The forward half is the ENGINE's own path, month for month.
    after.forEach((p, m) => expect(p.price).toBe(SUPPORT[m]));
    // The history half is `supportAtDates` on the same dates.
    expect(before[0].price).toBe(supportAtDates([new Date(before[0].t)])[0]);
  });

  it('the forward series lands on the engine\'s own month dates', () => {
    const s = build();
    s.forward.forEach((p, m) => expect(p.t).toBe(addMonths(START, m).getTime()));
  });

  it('respects the horizon', () => {
    expect(build({ months: 6 }).forward).toHaveLength(7);
  });
});

describe('⭐ N2 — the history support line is evaluated at the KEPT points\' own dates', () => {
  // A REALISTIC history: one point every 4 days from genesis to the seam, with the zero prices bitcoin had
  // before it had a market. Both the filter (zeros) and the downsample (≥1,500 points) bite here — which is
  // exactly what 40 clean points could never expose.
  const REAL = (): HistoryPoint[] => {
    const out: HistoryPoint[] = [];
    const first = Date.parse('2009-01-03T00:00:00Z');
    const market = Date.parse('2010-07-17T00:00:00Z');
    for (let t = first; t < START.getTime(); t += 4 * DAY) {
      out.push({ timestamp: t, price: t < market ? 0 : 100 + (t - market) / (30 * DAY) * 40 });
    }
    return out;
  };

  it('⭐ every history support point is supportAtDates at its OWN date, bit for bit', () => {
    const hist = REAL();
    expect(hist.length).toBeGreaterThanOrEqual(1_500);                 // premise: big enough to downsample
    const s = build({ hist });
    const before = s.support.filter((p) => p.t < s.seamT);
    const kept = s.history.filter((p) => p.t < s.seamT);
    // PREMISE, both halves: points were FILTERED (the zeros are gone) and DOWNSAMPLED (the cap bit).
    expect(kept.length).toBeLessThan(hist.filter((p) => p.price > 0).length);
    expect(hist.filter((p) => p.price > 0).length).toBeLessThan(hist.length);
    expect(before).toHaveLength(kept.length);
    before.forEach((p, i) => {
      expect(p.t, `i${i}`).toBe(kept[i].t);
      expect(p.price, `i${i}`).toBe(supportAtDates([new Date(p.t)])[0]);
    });
  });

  it('⭐ the last pre-seam support point meets the forward half — within 1% of supportPath[0]', () => {
    const s = build({ hist: REAL() });
    const before = s.support.filter((p) => p.t < s.seamT);
    const last = before[before.length - 1].price!;
    expect(Math.abs(last / SUPPORT[0] - 1)).toBeLessThan(0.01);
  });
});

describe('⭐ downsampling', () => {
  it('⭐ keeps the first and last points, and stays monotone', () => {
    const xs = Array.from({ length: 5_000 }, (_, i) => i);
    const out = downsample(xs, 800);
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(4_999);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
  });

  it('a short series is returned whole', () => {
    expect(downsample([1, 2, 3], 800)).toEqual([1, 2, 3]);
  });

  it('⭐ a long history is capped, and still ends at the seam', () => {
    const s = build({ hist: history(5_000) });
    expect(s.history.length).toBeLessThanOrEqual(MAX_HISTORY_POINTS);
    expect(s.history[s.history.length - 1].t).toBe(s.seamT);
  });
});

describe('⭐ I16 — junk in ⇒ a GAP, never a zero, and never NaN', () => {
  it('a non-finite support point becomes null, not 0', () => {
    const support = SUPPORT.slice(0, MONTHS + 1).map((s, m) => (m === 3 ? Number.NaN : s));
    const s = build({ support });
    const forwardSupport = s.support.filter((p) => p.t >= s.seamT);
    expect(forwardSupport[3].price).toBeNull();
    expect(forwardSupport[4].price).not.toBeNull();
  });

  it('a non-positive support point becomes null too — a log axis has no floor at 0', () => {
    const support = SUPPORT.slice(0, MONTHS + 1).map((s, m) => (m === 5 ? 0 : s));
    const s = build({ support });
    expect(s.support.filter((p) => p.t >= s.seamT)[5].price).toBeNull();
  });

  it('junk history points are dropped, not plotted', () => {
    const hist: HistoryPoint[] = [
      { timestamp: Number.NaN, price: 100 },
      { timestamp: START.getTime() - 10 * DAY, price: Number.NaN },
      { timestamp: START.getTime() - 5 * DAY, price: 0 },
      { timestamp: START.getTime() - 3 * DAY, price: 50_000 },
    ];
    const s = build({ hist });
    // One real point, plus the seam.
    expect(s.history).toHaveLength(2);
    for (const p of s.history) expect(Number.isFinite(p.price)).toBe(true);
  });

  it('⭐ no NaN or ∞ reaches ANY series', () => {
    const s = build({
      forward: SUPPORT.slice(0, MONTHS + 1).map((v, m) => (m === 2 ? Number.NaN : v)),
      floor: SUPPORT.slice(0, MONTHS + 1).map((v, m) => (m === 4 ? Number.POSITIVE_INFINITY : v)),
      support: SUPPORT.slice(0, MONTHS + 1).map((v, m) => (m === 6 ? Number.NEGATIVE_INFINITY : v)),
      cliff: Array.from({ length: MONTHS + 1 }, (_, m) => (m === 8 ? Number.NaN : 1_000)),
    });
    for (const p of [...s.history, ...s.forward, ...s.floor]) expect(Number.isFinite(p.price)).toBe(true);
    for (const p of [...s.support, ...s.cliff]) {
      if (p.price !== null) expect(Number.isFinite(p.price)).toBe(true);
    }
    expect(s.cliff[8].price).toBeNull();
  });

  it('an empty history still yields the seam', () => {
    const s = build({ hist: [] });
    expect(s.history).toHaveLength(1);
    expect(s.history[0].t).toBe(s.seamT);
  });
});

describe('⭐ I29 — the cliff', () => {
  const run = (o: Partial<CyclingInputs> = {}) => runCyclingSim({
    ...SP_REPRO, pricePath: pathP1(), supportPolicy: policyFor(SUPPORT), ...o,
  });

  it('⭐ each point is cbMetrics().liqPrice — no second formula', () => {
    const r = run();
    const cliff = cliffPath(r.rows);
    r.rows.forEach((row, m) => {
      if (cliff[m] === null) return;
      expect(cliff[m]).toBe(cbMetrics(row.cbDebt, row.cbCollateralBtc, row.price, TRIGGER).liqPrice);
    });
  });

  it('⭐ on a run that never liquidates, the cliff sits UNDER the path in every month', () => {
    const r = run();
    expect(r.liqMonth).toBeNull();                              // premise
    const cliff = cliffPath(r.rows);
    let drawn = 0;
    r.rows.forEach((row, m) => {
      if (cliff[m] === null) return;
      expect(cliff[m]!, `m${m}`).toBeLessThan(row.price);
      drawn += 1;
    });
    expect(drawn).toBeGreaterThan(0);                           // non-vacuous
  });

  it('⭐ F3 — null for a balance under the dust floor: $0.40 owed draws no cliff', () => {
    const base = run().rows[0];
    expect(cliffPath([{ ...base, cbDebt: 0.4, cbCollateralBtc: 2 }])).toEqual([null]);
    // Non-vacuous: a real balance on the same collateral DOES draw one.
    expect(cliffPath([{ ...base, cbDebt: 60_000, cbCollateralBtc: 2 }])[0]).toBeGreaterThan(0);
  });

  it('⭐ null with no loan, and null with no Coinbase collateral', () => {
    // ⚠ A RUN can't be used for the no-loan case: the policy buys bitcoin and pledges it to Coinbase, then
    // refinances onto it — so a run that starts with no loan develops one. This is a per-ROW fact.
    const base = run().rows[0];
    expect(cliffPath([{ ...base, cbDebt: 0, cbCollateralBtc: 2 }])).toEqual([null]);
    expect(cliffPath([{ ...base, cbDebt: 10_000, cbCollateralBtc: 0 }])).toEqual([null]);
    // Non-vacuous: with BOTH, a cliff is drawn.
    expect(cliffPath([{ ...base, cbDebt: 10_000, cbCollateralBtc: 2 }])[0]).toBeGreaterThan(0);
  });

  it('⭐ null ON and AFTER the liquidation row — there is no loan left to seize', () => {
    // A hard drop from month 12 liquidates the loan.
    const crash = run({ pricePath: pathP2(0).map((p, m) => (m >= 12 ? p * 0.2 : p)) });
    expect(crash.liqMonth).not.toBeNull();                      // premise
    const cliff = cliffPath(crash.rows);
    const first = crash.rows.findIndex((r) => r.postLiquidation);
    expect(first).toBeGreaterThan(0);
    for (let m = first; m < cliff.length; m++) expect(cliff[m], `m${m}`).toBeNull();
    expect(cliff.slice(0, first).some((v) => v !== null)).toBe(true);
  });

  it('⭐ W1 / T1 — the ranking\'s cushion reads this cliff from month 1: min price ÷ cliff, on a safe run and a '
    + 'liquidating run', () => {
    const safe = run();
    const crash = run({ pricePath: pathP2(0).map((p, m) => (m >= 12 ? p * 0.2 : p)) });
    expect(safe.liqMonth).toBeNull();                           // premises
    expect(crash.liqMonth).not.toBeNull();
    for (const r of [safe, crash]) {
      const cliff = cliffPath(r.rows);
      // The chart still draws today's seizure price; only the cushion leaves month 0 out (T1 — today is the same on
      // every path).
      expect(cliff[0]).not.toBeNull();
      const ratios = r.rows.flatMap((row, m) => (row.m >= 1 && cliff[m] !== null ? [row.price / cliff[m]!] : []));
      expect(ratios.length).toBeGreaterThan(0);                 // non-vacuous
      expect(minCushionOf(r.rows)).toBe(Math.min(...ratios));
    }
    // The liquidation row is not a month BEFORE the liquidation: counted, it would sit at or under 1.
    const breach = crash.rows.find((row) => row.postLiquidation)!;
    expect(breach.price / cbMetrics(breach.cbDebt, breach.cbCollateralBtc, breach.price, TRIGGER).liqPrice)
      .toBeLessThanOrEqual(1);
    expect(minCushionOf(crash.rows)).toBeGreaterThan(1);
  });

  it('⭐ W1 — ONE seizure-price rule: the cliff and the ranking both call cbSeizurePrice, and neither computes one', () => {
    const code = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // comments may NAME the formula
    for (const rel of ['src/components/Almanac/decisionChartView.ts', 'src/simulation/planSearch.ts']) {
      const src = code(rel);
      expect(src, rel).toMatch(/\bcbSeizurePrice\(/);
      expect(src, rel).not.toMatch(/\bCB_LLTV\b|\bcbMetrics\(|\.liqPrice\b/);
    }
  });

  it('the cliff rides into buildChartSeries as its own gapped series', () => {
    const r = run();
    const cliff = cliffPath(r.rows);
    const s = build({ cliff, months: 12 });
    expect(s.cliff).toHaveLength(13);
    s.cliff.forEach((p, m) => {
      expect(p.t).toBe(addMonths(START, m).getTime());
      expect(p.price).toBe(cliff[m]);
    });
  });
});

describe('⭐ chartDomain — an explicit, positive log-axis domain', () => {
  it('⭐ spans every plotted price, with room above and below', () => {
    const series = build();
    const all = [series.history, series.forward, series.floor, series.support, series.cliff]
      .flat().map((p) => p.price).filter((v): v is number => v !== null);
    const [lo, hi] = chartDomain(series)!;
    expect(lo).toBeCloseTo(Math.min(...all) * 0.8, 6);
    expect(hi).toBeCloseTo(Math.max(...all) * 1.25, 6);
    expect(lo).toBeGreaterThan(0);
  });

  it('⭐ a gap never drags the floor to zero — a log axis cannot take 0', () => {
    const series = build({ support: SUPPORT.slice(0, MONTHS + 1).map((v, m) => (m === 3 ? 0 : v)) });
    expect(chartDomain(series)![0]).toBeGreaterThan(0);
  });

  it('nothing to plot ⇒ null (the face shows its placeholder)', () => {
    expect(chartDomain({ history: [], forward: [], floor: [], support: [], cliff: [], seamT: 0 })).toBeNull();
    expect(chartDomain({
      history: [], forward: [], floor: [], support: [{ t: 0, price: null }], cliff: [{ t: 0, price: null }], seamT: 0,
    })).toBeNull();
  });
});

describe('⭐ the time axis — its extent, and ticks a person can read', () => {
  // ⚠ With per-series data and no chart-level data, recharts falls back to a tick per data point — hundreds of
  // overlapping labels. The face passes these explicitly.
  it('⭐ xExtent spans the first history point to the last forward month', () => {
    const series = build();
    const [lo, hi] = xExtent(series)!;
    expect(lo).toBe(series.history[0].t);
    expect(hi).toBe(series.forward[series.forward.length - 1].t);
  });
  it('no history ⇒ the extent starts at the seam; nothing at all ⇒ null', () => {
    const series = build({ hist: [] });
    expect(xExtent(series)![0]).toBe(series.seamT);
    expect(xExtent({ history: [], forward: [], floor: [], support: [], cliff: [], seamT: Number.NaN })).toBeNull();
  });

  const Y = (y: number) => Date.UTC(y, 0, 1);
  it('⭐ every 4 years across a history-plus-5-year span, on the year boundary', () => {
    expect(yearTicks(Date.UTC(2010, 6, 17), Date.UTC(2031, 8, 29))).toEqual([2012, 2016, 2020, 2024, 2028].map(Y));
  });
  it('every 8 years across a history-plus-20-year span, every 2 across a short one', () => {
    expect(yearTicks(Date.UTC(2010, 6, 17), Date.UTC(2046, 8, 29))).toEqual([2016, 2024, 2032, 2040].map(Y));
    expect(yearTicks(Date.UTC(2026, 8, 29), Date.UTC(2031, 8, 29))).toEqual([2028, 2030].map(Y));
  });
  it('ticks are unique, ascending and inside the span — and junk gives none', () => {
    const t = yearTicks(Date.UTC(2011, 0, 1), Date.UTC(2046, 0, 1));
    expect(new Set(t).size).toBe(t.length);
    t.forEach((v, i) => { if (i > 0) expect(v).toBeGreaterThan(t[i - 1]); });
    for (const v of t) { expect(v).toBeGreaterThanOrEqual(Date.UTC(2011, 0, 1)); expect(v).toBeLessThanOrEqual(Date.UTC(2046, 0, 1)); }
    expect(yearTicks(Number.NaN, Y(2030))).toEqual([]);
    expect(yearTicks(Y(2030), Y(2020))).toEqual([]);
  });
});
