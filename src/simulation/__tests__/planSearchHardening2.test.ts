import { describe, it, expect } from 'vitest';
import { evaluatePaths } from '../planSearch';
import { runCyclingSim } from '../cyclingSim';
import { SP_REPRO, policyFor } from './supportPolicyPaths';

/**
 * Hardening 2 — planSearch.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HE.json).
 * Round synthetic figures; the rule is docs/claude/file-structure.md § planSearch.ts (M4).
 */
describe('Hardening 2 — planSearch', () => {
  it('HE-33 · file-structure.md § planSearch.ts (M4) — when no path ran the policy as asked, every path is still ranked: the crash path is worst, by its cushion', () => {
    // A one-entry support path is ignored on both runs (the policy asked for, never applied), so neither path is
    // rankable by M4; they are one strategy, so all are ranked — never a crown at index 0 "decided by no rule".
    const inputs = { ...SP_REPRO, strikeAprPct: 0, cbAprPct: 0, supportPolicy: policyFor([50_000]) };
    const paths = [[60_000, 60_000, 60_000], [60_000, 20_000, 20_000]];
    expect(paths.map((pricePath) => runCyclingSim({ ...inputs, pricePath }).policyApplied), 'HE-33 premise: the policy applied on no path')
      .toEqual([false, false]);
    const r = evaluatePaths(inputs, paths, ['flat', 'crash']);
    expect([r.worstIndex, r.worstBy]).toEqual([1, 'cushion']);
  });
});
