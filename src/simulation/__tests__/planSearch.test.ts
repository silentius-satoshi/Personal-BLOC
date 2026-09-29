import { describe, it, expect } from 'vitest';
import { evaluatePaths, worstCasePath } from '../planSearch';
import { runCyclingSim, type CyclingInputs } from '../cyclingSim';
import { deriveOwnership } from '../ownership';
import {
  SP_REPRO, SUPPORT, SP_START, policyFor, supportPathFor, pathP1, pathP2, pathP6, multiplePath,
} from './supportPolicyPaths';

/**
 * Path evaluation for the Decision face — which modelled future is WORST. Round synthetic figures only.
 *
 * ⚠ These runs are a SELECTOR, never a second truth: the face's lenses all read the one displayed run.
 */

const BASE: Omit<CyclingInputs, 'pricePath'> = { ...SP_REPRO, supportPolicy: policyFor(SUPPORT) };
const LABELS = ['a', 'b', 'c'];

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

describe('⭐ I11 — the ranking', () => {
  /** Three synthetic outcomes, built by choosing paths that liquidate at chosen depths. */
  const dip = (from: number, factor: number): number[] =>
    pathP1().map((p, m) => (m >= from ? p * factor : p));

  it('⭐ any liquidation is worse than none', () => {
    const safe = pathP1();
    const doomed = dip(6, 0.2);
    const { perPath, worstIndex } = evaluatePaths(BASE, [safe, doomed], ['safe', 'doomed']);
    expect(perPath[0].liqMonth).toBeNull();
    expect(perPath[1].liqMonth).not.toBeNull();
    expect(worstIndex).toBe(1);
  });

  it('⭐ an EARLIER liquidation is worse than a later one', () => {
    const early = dip(4, 0.15);
    const late = dip(30, 0.15);
    const { perPath, worstIndex } = evaluatePaths(BASE, [late, early], ['late', 'early']);
    expect(perPath[0].liqMonth).not.toBeNull();
    expect(perPath[1].liqMonth).not.toBeNull();
    expect(perPath[1].liqMonth!).toBeLessThan(perPath[0].liqMonth!);
    expect(worstIndex).toBe(1);
  });

  it('⭐ no liquidation either side ⇒ the least `yours` wins', () => {
    // ⚠ Which of these ends with less `yours` is NOT obvious — a high path spends its months in the pay-down zone
    // repaying debt rather than buying, while a path at support accumulates all the way. So the test pins the
    // RULE against the measured outcomes, not a guess about which fixture "should" win.
    const high = multiplePath([[0, 1.3], [72, 3.0]], SUPPORT);
    const flat = multiplePath([[0, 1.3], [72, 1.0]], SUPPORT);
    const { perPath, worstIndex } = evaluatePaths(BASE, [high, flat], ['high', 'flat']);
    expect(perPath.every((p) => p.liqMonth === null)).toBe(true);
    expect(perPath[0].yoursAtHorizon).not.toBeCloseTo(perPath[1].yoursAtHorizon, 6);
    const leaner = perPath[0].yoursAtHorizon < perPath[1].yoursAtHorizon ? 0 : 1;
    expect(worstIndex).toBe(leaner);
  });

  it('identical paths ⇒ the LOWEST index wins the tie', () => {
    const p = pathP1();
    expect(evaluatePaths(BASE, [p, p, p], LABELS).worstIndex).toBe(0);
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
    expect(evaluatePaths(BASE, [safe, longDoomed], ['safe', 'doomed']).worstIndex).toBe(0);
    // Non-vacuous: with a support path long enough for BOTH, the doomed run is ranked and wins.
    const wide = { ...BASE, supportPolicy: policyFor(supportPathFor(SP_START, longDoomed.length - 1)) };
    expect(runCyclingSim({ ...wide, pricePath: longDoomed }).policyApplied).toBe(true);
    expect(evaluatePaths(wide, [safe, longDoomed], ['safe', 'doomed']).worstIndex).toBe(1);
  });
});

describe('⭐ I10 / I12 — the outcomes, and the crown moving', () => {
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

  const dip = (from: number, factor: number): number[] =>
    pathP1().map((p, m) => (m >= from ? p * factor : p));
});
