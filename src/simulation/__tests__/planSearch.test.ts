import { describe, it, expect } from 'vitest';
import {
  evaluatePaths, worstCasePath, sameSeries, pickWorst, minCushionOf, CUSHION_EPS,
} from '../planSearch';
import { runCyclingSim, type CyclingInputs, type CyclingRow } from '../cyclingSim';
import { deriveOwnership } from '../ownership';
import { plConvergencePath, plBandAt, PL_ON_THE_LINE } from '../powerLaw';
import { cycleConvergencePath } from '../cyclePath';
import { CB_LLTV } from '../runCoinbaseLoan';
import { cbSeizurePrice } from '../cbMetrics';
import {
  SP_REPRO, SUPPORT, S0, SP_START, policyFor, supportPathFor, pathP1, pathP2, pathP6, multiplePath,
} from './supportPolicyPaths';

/**
 * Path evaluation for the Decision face — which modelled future is WORST. Round synthetic figures only.
 *
 * WORST = CLOSEST TO A FORCED SALE (spec v1.9, W1): (1) any liquidation beats none, and an earlier one beats a later
 * one; (2) the smallest cushion — price ÷ Coinbase's seizure price, the minimum over months 1 to the horizon before a
 * liquidation (month 0 is today, the same on every path — T1); (3) the least all-in equity; (4) the lowest index.
 * Each rule is pinned by a fixture where it ALONE decides.
 *
 * ⚠ These runs are a SELECTOR, never a second truth: the face's lenses all read the one displayed run.
 */

const BASE: Omit<CyclingInputs, 'pricePath'> = { ...SP_REPRO, supportPolicy: policyFor(SUPPORT) };
/** BASE with no Coinbase loan and no Coinbase collateral at the open. */
const NO_LOAN: Omit<CyclingInputs, 'pricePath'> = { ...BASE, cbDebt: 0, cbCollateralBtc: 0 };
const LABELS = ['a', 'b', 'c'];
/** The face's four path kinds, in its order. */
const KINDS = ['floor', 'fair', 'ceiling', 'fourYear'];

const utc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
/** The cushion when Coinbase's LTV sits exactly on `ltv`: price ÷ seizure price = CB_LLTV ÷ LTV. */
const cushionAt = (ltv: number): number => CB_LLTV / ltv;
/** A path that follows P1, then sits at `factor` of it from month `from` on. */
const dip = (from: number, factor: number): number[] =>
  pathP1().map((p, m) => (m >= from ? p * factor : p));
/** A ranking key for `pickWorst` — no liquidation unless given one. */
const key = (minCushion: number, allInEquity: number, liqMonth: number | null = null) =>
  ({ liqMonth, minCushion, allInEquity });

/**
 * The four modelled paths, built exactly as the Decision face builds them: the three bands through
 * `plConvergencePath`, the 4-yr cycle through `cycleConvergencePath` at phase shift 0.
 */
const pathsAt = (iso: string, months: number, conv: number, A = 80_000): number[][] => {
  const start = utc(iso);
  return [
    plConvergencePath(A, 'floor', start, months, conv),
    plConvergencePath(A, 'fair', start, months, conv),
    plConvergencePath(A, 'ceiling', start, months, conv),
    cycleConvergencePath(A, start, months, conv, 0),
  ];
};

describe('⭐ I9 — worstCasePath is the stitched floor', () => {
  it('⭐ is at or below every path in every month', () => {
    const paths = [pathP1(), pathP2(0), pathP6()];
    const floor = worstCasePath(paths);
    expect(floor).toHaveLength(paths[0].length);
    floor.forEach((v, m) => {
      for (const p of paths) expect(v, `m${m}`).toBeLessThanOrEqual(p[m]);
      expect(v).toBe(Math.min(...paths.map((p) => p[m])));
    });
  });

  it('one path IS its own floor', () => {
    const p = pathP1();
    expect(worstCasePath([p])).toEqual(p);
  });

  it('ragged or empty input ⇒ [] — a stitched floor over different horizons is not a path', () => {
    expect(worstCasePath([])).toEqual([]);
    expect(worstCasePath([[1, 2, 3], [1, 2]])).toEqual([]);
    expect(worstCasePath([[]])).toEqual([]);
  });
});

describe('⭐ I11 — the ranking: closest to a forced sale (W1)', () => {
  it('⭐ rule 1 — any liquidation is worse than none, even against a path that comes closer to seizure first', () => {
    const safe = pathP1();
    const doomed = dip(6, 0.2);
    const { perPath, worstIndex, worstBy } = evaluatePaths(BASE, [safe, doomed], ['safe', 'doomed']);
    expect(perPath[0].liqMonth).toBeNull();
    expect(perPath[1].liqMonth).not.toBeNull();
    // It alone decides: before its crash the doomed path never comes as close to seizure as the safe one does,
    // so without rule 1 the cushion would crown the safe path.
    expect(perPath[0].minCushion).toBeLessThan(perPath[1].minCushion);
    expect(worstIndex).toBe(1);
    expect(worstBy).toBe('liquidation');
  });

  it('⭐ rule 1 — an EARLIER liquidation is worse than a later one', () => {
    const early = dip(4, 0.15);
    const late = dip(30, 0.15);
    const { perPath, worstIndex, worstBy } = evaluatePaths(BASE, [late, early], ['late', 'early']);
    expect(perPath[0].liqMonth).not.toBeNull();
    expect(perPath[1].liqMonth).not.toBeNull();
    expect(perPath[1].liqMonth!).toBeLessThan(perPath[0].liqMonth!);
    // It alone decides: the LATER one comes closer to seizure first and ends poorer, so either later rule would
    // crown it.
    expect(perPath[0].minCushion).toBeLessThan(perPath[1].minCushion);
    expect(perPath[0].allInEquity).toBeLessThan(perPath[1].allInEquity);
    expect(worstIndex).toBe(1);
    expect(worstBy).toBe('liquidation');
  });

  it('⭐ rule 2 — neither liquidates ⇒ the smallest cushion is worst, however rich the path ends', () => {
    const { perPath, worstIndex, worstBy } = evaluatePaths(BASE, [pathP6(), pathP1()], ['P6', 'P1']);
    expect(perPath.every((p) => p.liqMonth === null)).toBe(true);
    expect(perPath[1].minCushion).toBeLessThan(perPath[0].minCushion);
    // It alone decides: the path it crowns ends RICHER (so rule 3 would crown the other) and holds more ₿ "yours"
    // (so v1.8's least-`yours` tiebreak did crown the other).
    expect(perPath[1].allInEquity).toBeGreaterThan(perPath[0].allInEquity);
    expect(perPath[1].yoursAtHorizon).toBeGreaterThan(perPath[0].yoursAtHorizon);
    expect(worstIndex).toBe(1);
    expect(worstBy).toBe('cushion');
  });

  it('⭐ the W1 regression — policy off, from 2028: the 4-yr cycle rides the 70% defense line and is crowned '
    + '(v1.8 crowned Resistance)', () => {
    // No support policy: the Strike line and the Coinbase loan run the face's constants — cadence 1, the 70% stop,
    // the 60% Strike cap, the 30% sweep and the automatic defense, all carried by SP_REPRO.
    const inputs = { ...SP_REPRO, startYear: 2028, strikeAprPct: 12, cbAprPct: 10, mode: 'cycle' as const };
    const anchor = 1.3 * plBandAt('floor', utc('2028-01-01'), 0);
    const { perPath, worstIndex, worstBy } = evaluatePaths(inputs, pathsAt('2028-01-01', 60, 48, anchor), KINDS);
    // Premises: nothing liquidates, and Resistance ends with the fewest ₿ "yours" — so v1.8 crowned it.
    expect(perPath.every((p) => p.liqMonth === null)).toBe(true);
    const yours = perPath.map((p) => p.yoursAtHorizon);
    expect(yours.indexOf(Math.min(...yours))).toBe(2);
    // The 4-yr cycle's fall into the 2030 trough holds Coinbase on the 70% defense line; no band comes near it.
    expect(perPath[3].minCushion).toBeCloseTo(cushionAt(0.7), 9);
    for (const i of [0, 1, 2]) expect(perPath[i].minCushion, KINDS[i]).toBeGreaterThan(perPath[3].minCushion + 0.1);
    expect(worstIndex).toBe(3);
    expect(worstBy).toBe('cushion');
  });

  it('⭐ a path with no Coinbase loan in any month has an INFINITE cushion — the farthest from a sale', () => {
    // From 2.2× support the policy never borrows (it opens in the pay-down zone and stays there); P1 borrows from
    // month 1. With no loan at the open, only P1 ever has a seizure price.
    const high = multiplePath([[0, 2.2], [72, 3.0]]);
    const { perPath, worstIndex, worstBy } = evaluatePaths(NO_LOAN, [high, pathP1()], ['high', 'P1']);
    expect(perPath.every((p) => p.liqMonth === null)).toBe(true);
    expect(perPath[0].minCushion).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(perPath[1].minCushion)).toBe(true);
    expect(worstIndex).toBe(1);
    expect(worstBy).toBe('cushion');
  });

  it('⭐ rule 3 — tied on liquidation and cushion ⇒ the least all-in equity is worst', () => {
    // Neither path ever borrows on Coinbase, so both cushions are ∞ — a tie — and the dollars decide.
    const higher = multiplePath([[0, 2.2], [72, 4.0]]);
    const high = multiplePath([[0, 2.2], [72, 3.0]]);
    const { perPath, worstIndex, worstBy } = evaluatePaths(NO_LOAN, [higher, high], ['higher', 'high']);
    expect(perPath.every((p) => p.liqMonth === null)).toBe(true);
    expect(perPath.every((p) => p.minCushion === Number.POSITIVE_INFINITY)).toBe(true);
    expect(perPath[1].allInEquity).toBeLessThan(perPath[0].allInEquity);
    expect(worstIndex).toBe(1);
    expect(worstBy).toBe('equity');
  });

  it('⭐ rule 4 — identical paths ⇒ the LOWEST index wins the tie', () => {
    const p = pathP1();
    const { worstIndex, worstBy } = evaluatePaths(BASE, [p, p, p], LABELS);
    expect(worstIndex).toBe(0);
    expect(worstBy).toBe('index');
  });

  it('⭐ M4 — a run whose policy did not apply as asked is NOT ranked', () => {
    // A MIXED call: the support path covers the short price path but not the long one, so the long run comes back
    // policy-ABSENT — a different strategy, which must not be crowned "worst" against a policy run.
    const safe = pathP1();
    const longDoomed = [...dip(4, 0.15), ...Array.from({ length: 12 }, () => 100)];
    expect(runCyclingSim({ ...BASE, pricePath: safe }).policyApplied).toBe(true);
    const ignored = runCyclingSim({ ...BASE, pricePath: longDoomed });
    expect(ignored.policyApplied).toBe(false);              // premise: it really is ignored
    expect(ignored.liqMonth).not.toBeNull();                // and it WOULD win the crown if it were ranked
    const lone = evaluatePaths(BASE, [safe, longDoomed], ['safe', 'doomed']);
    expect(lone.worstIndex).toBe(0);
    expect(lone.worstBy).toBe('index');                     // a lone ranked path: nothing in the field disagrees
    // Non-vacuous: with a support path as long as both price paths, BOTH are ranked and the doomed run wins, for
    // liquidating. ⚠ The policy applies only to a price path exactly as long as the support path, so the safe path
    // is P1 run out to the same horizon — the 73-month P1 would be ignored under `wide` and the doomed run would
    // win alone (the pre-W1 version of this test did exactly that).
    const wide = { ...BASE, supportPolicy: policyFor(supportPathFor(SP_START, longDoomed.length - 1)) };
    const safeLong = plConvergencePath(1.35 * S0, 'floor', SP_START, longDoomed.length - 1, PL_ON_THE_LINE);
    expect(runCyclingSim({ ...wide, pricePath: safeLong }).policyApplied).toBe(true);
    expect(runCyclingSim({ ...wide, pricePath: longDoomed }).policyApplied).toBe(true);
    const both = evaluatePaths(wide, [safeLong, longDoomed], ['safe', 'doomed']);
    expect(both.perPath[0].liqMonth).toBeNull();
    expect(both.worstIndex).toBe(1);
    expect(both.worstBy).toBe('liquidation');
  });
});

describe('⭐ W1b — worstBy is the rule on which the crown is the extreme of the WHOLE field', () => {
  it('⭐ A ties B for the closest to seizure and is poorer, but C is poorer still: A is crowned for its CUSHION', () => {
    // Naming the rule that split A from the runner-up (B) would say "ends poorest in dollars" — false: C ends
    // poorer. "Comes closest to Coinbase's seizure price" is true against every path.
    const keys = [key(1.2, 1_000_000), key(1.2, 2_000_000), key(1.5, 500_000)];
    expect(pickWorst(keys, [0, 1, 2])).toEqual({ worstIndex: 0, worstBy: 'cushion' });
  });

  it('a liquidating path is crowned for liquidating, whatever the others show', () => {
    const keys = [key(2, 3_000_000, 40), key(1.1, 100_000), key(1.3, 50_000, 12)];
    expect(pickWorst(keys, [0, 1, 2])).toEqual({ worstIndex: 2, worstBy: 'liquidation' });
  });

  it('ranks only the pool it is given; an empty pool falls back to index 0, decided by no rule', () => {
    const keys = [key(1.2, 1_000_000), key(1.2, 2_000_000), key(1.5, 500_000)];
    expect(pickWorst(keys, [1, 2])).toEqual({ worstIndex: 1, worstBy: 'cushion' });
    expect(pickWorst(keys, [2])).toEqual({ worstIndex: 2, worstBy: 'index' });
    expect(pickWorst([], [])).toEqual({ worstIndex: 0, worstBy: 'index' });
  });
});

describe('⭐ W1a — cushions within CUSHION_EPS tie, so float noise at a line never decides', () => {
  it('CUSHION_EPS is relative: a wider gap decides, a narrower one falls through to the dollars', () => {
    expect(CUSHION_EPS).toBe(1e-9);
    expect(pickWorst([key(1, 1_000_000), key(1 - 2e-9, 2_000_000)], [0, 1]))
      .toEqual({ worstIndex: 1, worstBy: 'cushion' });
    expect(pickWorst([key(1, 1_000_000), key(1 - 0.5e-9, 2_000_000)], [0, 1]))
      .toEqual({ worstIndex: 0, worstBy: 'equity' });
  });

  it('⭐ two cushions an ulp apart on the same line tie — the poorer path is crowned, for its dollars', () => {
    const keys = [key(1.2285714285714286, 1_000_000), key(1.2285714285714284, 2_000_000)];
    expect(pickWorst(keys, [0, 1])).toEqual({ worstIndex: 0, worstBy: 'equity' });
  });

  it('⭐ the engine holds Support and the 4-yr cycle on the 70% defense line; the dollars break the tie', () => {
    // Policy off, from 2026-09-29, on the line, 1.2× support, 1 ₿ on Coinbase with nothing owed at the open.
    // ⚠ Asserts only the TOLERANT outcome: the two cushions' last bits come from Math.pow, which differs across
    // Node versions, so an exact comparison could crown either path.
    const inputs = { ...SP_REPRO, startYear: 2026, strikeAprPct: 12, cbAprPct: 10, cbDebt: 0, mode: 'cycle' as const };
    const anchor = 1.2 * plBandAt('floor', utc('2026-09-29'), 0);
    const { perPath, worstIndex, worstBy } =
      evaluatePaths(inputs, pathsAt('2026-09-29', 60, PL_ON_THE_LINE, anchor), KINDS);
    expect(perPath.every((p) => p.liqMonth === null)).toBe(true);
    expect(perPath[0].minCushion).toBeCloseTo(cushionAt(0.7), 9);
    expect(Math.abs(perPath[3].minCushion / perPath[0].minCushion - 1)).toBeLessThan(CUSHION_EPS);
    expect(perPath[0].allInEquity).toBeLessThan(perPath[3].allInEquity - 100_000);
    expect(worstIndex).toBe(0);
    expect(worstBy).toBe('cushion');   // Fair and Resistance stay out on the sweep floor, farther from seizure
  });
});

describe('⭐ T1 — the cushion counts months 1 to the horizon: month 0 is today, the same on every path', () => {
  it('⭐ a position tightest TODAY: from month 1, Support comes closest to seizure — counting today tied every path, '
    + 'and the dollars crowned the 4-yr cycle', () => {
    // Policy on, from 2026-09-29, horizon 240, a 48-month window, 1.2× support. 1 ₿ on Strike (a $30,000 line,
    // nothing drawn) and 0.8 ₿ on Coinbase owing $45,000; $8,000 / $6,000; APRs 12% / 10%; the face's constants
    // (cadence 1, the 70% stop, the 60% Strike cap, the 30% sweep, the automatic defense — all carried by SP_REPRO).
    const start = utc('2026-09-29');
    const inputs = {
      ...SP_REPRO, startYear: 2026, strikeAprPct: 12, cbAprPct: 10, cbCollateralBtc: 0.8, cbDebt: 45_000,
      mode: 'cycle' as const, supportPolicy: policyFor(supportPathFor(start, 240)),
    };
    const paths = pathsAt('2026-09-29', 240, 48, 1.2 * plBandAt('floor', start, 0));
    const runs = paths.map((pricePath) => runCyclingSim({ ...inputs, pricePath }));
    /** A month's cushion against the one seizure-price rule; null where there is no seizure price. */
    const cushion = (row: CyclingRow): number | null => {
      const seizure = cbSeizurePrice(row);
      return seizure === null ? null : row.price / seizure;
    };
    // Premises: the policy applies and nothing liquidates. Today is the same row on every path, so the same cushion —
    // and it is every path's tightest month, by a wide margin.
    expect(runs.every((r) => r.policyApplied && r.liqMonth === null)).toBe(true);
    const today = cushion(runs[0].rows[0])!;
    runs.forEach((r, i) => {
      expect(cushion(r.rows[0]), KINDS[i]).toBe(today);
      const later = r.rows.filter((row) => row.m >= 1).map(cushion).filter((c): c is number => c !== null);
      expect(Math.min(...later), KINDS[i]).toBeGreaterThan(today + 0.1);
    });
    const { perPath, worstIndex, worstBy } = evaluatePaths(inputs, paths, KINDS);
    expect(worstIndex).toBe(0);
    expect(worstBy).toBe('cushion');
    // It alone decides: the 4-yr cycle ends poorer than Support, so the dollars would crown it — which is what
    // counting today did, since every path then tied at today's cushion.
    expect(perPath[3].allInEquity).toBeLessThan(perPath[0].allInEquity);
    expect(pickWorst(perPath.map((p) => ({ ...p, minCushion: today })), [0, 1, 2, 3]))
      .toEqual({ worstIndex: 3, worstBy: 'equity' });
  });
});

describe('minCushionOf — the minimum, over months 1 to the horizon before a liquidation, of price ÷ Coinbase\'s '
  + 'seizure price', () => {
  /** A row in month `m`. $43,000 owed on 1 ₿ puts Coinbase's seizure price at $50,000 (43,000 ÷ 0.86). */
  const row = (m: number, price: number, cbDebt = 43_000, cbCollateralBtc = 1, postLiquidation = false) =>
    ({ m, price, cbDebt, cbCollateralBtc, postLiquidation });

  it('is the smallest price ÷ seizure price over the months', () => {
    expect(minCushionOf([row(1, 100_000)])).toBeCloseTo(2, 12);
    expect(minCushionOf([row(1, 100_000), row(2, 75_000), row(3, 90_000)])).toBeCloseTo(1.5, 12);
  });

  it('⭐ T1 — skips month 0: today is the same row on every path, so it can never tell two futures apart', () => {
    expect(minCushionOf([row(0, 60_000), row(1, 100_000), row(2, 90_000)])).toBeCloseTo(1.8, 12);
    // Still ∞ when no month from 1 on has a seizure price.
    expect(minCushionOf([row(0, 60_000)])).toBe(Number.POSITIVE_INFINITY);
  });

  it('⭐ T1 — reads the row\'s own month, never its array position', () => {
    expect(minCushionOf([row(1, 100_000), row(0, 60_000)])).toBeCloseTo(2, 12);
  });

  it('⭐ skips the liquidation row and every row after it — the breach row sits at or under 1', () => {
    expect(minCushionOf([row(1, 100_000), row(2, 40_000, 43_000, 1, true), row(3, 30_000, 43_000, 1, true)]))
      .toBeCloseTo(2, 12);
  });

  it('⭐ is ∞ with no Coinbase loan in any month — no seizure price, nothing to come close to', () => {
    expect(minCushionOf([])).toBe(Number.POSITIVE_INFINITY);
    expect(minCushionOf([row(1, 100_000, 0), row(2, 100_000, 0.49), row(3, 100_000, 43_000, 0)]))
      .toBe(Number.POSITIVE_INFINITY);
  });
});

// ⚠ This block used to be labelled "I10 / I12" but never tested I10's dated degeneracy — that lives below (Run B, G2).
describe('⭐ I12 — the outcomes (three-argument ownership), and the crown moving', () => {
  it('⭐ yoursAtHorizon is deriveOwnership with THREE arguments (a row\'s btcHeld already holds cold)', () => {
    const { perPath } = evaluatePaths(BASE, [pathP1()], ['a']);
    const r = runCyclingSim({ ...BASE, pricePath: pathP1() });
    expect(perPath[0].yoursAtHorizon)
      .toBe(deriveOwnership(r.last.btcHeld, r.last.debt, r.last.price).yoursBtc);
    // Passing cold a second time would double-count the pool.
    expect(perPath[0].yoursAtHorizon)
      .not.toBe(deriveOwnership(r.last.btcHeld, r.last.debt, r.last.price, r.last.coldBtc).yoursBtc);
    expect(perPath[0].coldAtHorizon).toBe(r.last.coldBtc);
    expect(perPath[0].liqMonth).toBe(r.liqMonth);
  });

  it('⭐ minCushion is minCushionOf over the run\'s own rows', () => {
    const { perPath } = evaluatePaths(BASE, [pathP1()], ['a']);
    const r = runCyclingSim({ ...BASE, pricePath: pathP1() });
    expect(perPath[0].minCushion).toBe(minCushionOf(r.rows));
    expect(Number.isFinite(perPath[0].minCushion)).toBe(true);   // non-vacuous: P1 borrows on Coinbase
  });

  it('labels ride along, and a missing label degrades gracefully', () => {
    const { perPath } = evaluatePaths(BASE, [pathP1(), pathP2(0)], ['first']);
    expect(perPath[0].label).toBe('first');
    expect(perPath[1].label).toBe('path 1');
  });

  it('⭐ I12 — the crown recomputes when the inputs change', () => {
    const safe = pathP1();
    const dipped = dip(20, 0.3);
    const lean = { ...BASE, cbDebt: 0, cbCollateralBtc: 0.2, strikeBalance: 0 };
    const heavy = { ...BASE, cbDebt: 120_000 };
    const a = evaluatePaths(lean, [safe, dipped], ['safe', 'dipped']);
    const b = evaluatePaths(heavy, [safe, dipped], ['safe', 'dipped']);
    // The same two futures, two different positions — the outcomes are not the same run.
    expect(a.perPath[1].yoursAtHorizon).not.toBeCloseTo(b.perPath[1].yoursAtHorizon, 6);
  });
});

// ── I10 · the dated degeneracy ───────────────────────────────────────────────────────────────────────────────

/**
 * WHY I10 IS A DATED TEST. Every path converges multiplicatively — `path_m = dest_m × (A / dest_0)^w` — so the
 * 4-yr path sits at `r_m / r_0^w` × Support, where `r` is the cycle's destination over Support. The anchor `A`
 * cancels: whether the stitched floor departs from Support depends on the START DATE and the window, never on
 * the price. From 2026-09-29 the cycle is six days from its modelled trough (`r_0` ≈ 1), so it never dips under
 * Support; from 2028-01-01 it starts deep in a rise (`r_0` ≈ 1.5) and dips under Support into the 2030 trough.
 */
describe('⭐ I10 — the stitched floor IS Support on today\'s dates, and not on every date', () => {
  /** The first month the stitched floor is not Support's own value, bit for bit; null if never. */
  const firstDeparture = (paths: number[][]): number | null => {
    const floor = worstCasePath(paths);
    for (let m = 0; m < floor.length; m++) if (!Object.is(floor[m], paths[0][m])) return m;
    return null;
  };

  it.each([[48], [120], [PL_ON_THE_LINE]])(
    '⭐ 2026-09-29, window %i, horizon 60: identical to Support, bit for bit', (conv) => {
      const paths = pathsAt('2026-09-29', 60, conv);
      const floor = worstCasePath(paths);
      expect(floor).toHaveLength(61);
      expect(firstDeparture(paths)).toBeNull();
      expect(sameSeries(floor, paths[0])).toBe(true);
    });

  it('⭐ 2028-01-01, window 48, horizon 60: the 4-yr path dips under Support — first at month 31', () => {
    const paths = pathsAt('2028-01-01', 60, 48);
    const floor = worstCasePath(paths);
    expect(firstDeparture(paths)).toBe(31);
    // It is the 4-yr cycle that is lowest there, strictly under Support.
    expect(floor[31]).toBe(paths[3][31]);
    expect(floor[31]).toBeLessThan(paths[0][31]);
    expect(sameSeries(floor, paths[0])).toBe(false);
  });

  it('⭐ 2028-01-01, on the line, horizon 240: identical again', () => {
    const paths = pathsAt('2028-01-01', 240, PL_ON_THE_LINE);
    expect(worstCasePath(paths)).toHaveLength(241);
    expect(firstDeparture(paths)).toBeNull();
    expect(sameSeries(worstCasePath(paths), paths[0])).toBe(true);
  });

  it.each([[30_000], [250_000]])('the departure does not depend on the anchor (A = %i)', (A) => {
    expect(firstDeparture(pathsAt('2026-09-29', 60, 48, A))).toBeNull();
    expect(firstDeparture(pathsAt('2028-01-01', 60, 48, A))).toBe(31);
    expect(firstDeparture(pathsAt('2028-01-01', 240, PL_ON_THE_LINE, A))).toBeNull();
  });
});

describe('sameSeries — bit for bit, or not at all', () => {
  it('equal length and every month Object.is-equal', () => {
    expect(sameSeries([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameSeries([], [])).toBe(true);
  });
  it('a different length, or one month off by an ulp, is NOT the same series', () => {
    expect(sameSeries([1, 2, 3], [1, 2])).toBe(false);
    expect(sameSeries([1, 2, 3], [1, 2, 3 + 3 * Number.EPSILON])).toBe(false);
  });
});
