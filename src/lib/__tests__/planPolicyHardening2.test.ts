import { describe, it, expect } from 'vitest';
import { clampPlanPolicy, PLAN_POLICY_DEFAULTS, PLAN_POLICY_KEYS } from '../planPolicy';

/**
 * Hardening 2 — planPolicy.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HE.json).
 */
describe('Hardening 2 — planPolicy', () => {
  it('HE-04 · engine.md "The support policy\'s settings are the owner\'s SAVED plan" — a non-finite saved setting reads as its default, never the range\'s edge', () => {
    expect(PLAN_POLICY_KEYS.length, 'HE-04 premise: the six fields').toBe(6);
    for (const k of PLAN_POLICY_KEYS) {
      for (const v of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]) {
        expect(clampPlanPolicy(k, v), `HE-04 ${k} ← ${v}`).toBe(PLAN_POLICY_DEFAULTS[k]);
      }
    }
  });
});
