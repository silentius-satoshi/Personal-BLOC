import { describe, it, expect, vi } from 'vitest';
import { buildSupportPath, supportPolicyFor } from '../supportPolicyInputs';
import {
  effectivePolicySettings, DEFAULT_SUPPORT_POLICY_SETTINGS, DEFAULT_BREAKER_REARM_MONTHS,
} from '../supportPolicyView';
import { runCyclingSim, effectiveStrikeCapPct, type CyclingMode } from '../../../simulation/cyclingSim';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';
// Tests may import beliefs; the no-belief-imports rule restricts the view MODULES, not their tests.
import { plBandAt, plConvergencePath, PL_ON_THE_LINE } from '../../../simulation/powerLaw';
import {
  SP_START, SP_MONTHS, SUPPORT, S0, SP_REPRO, policyFor, pathP1,
} from '../../../simulation/__tests__/supportPolicyPaths';

/**
 * Run 2a — the faces' one §2 crossing (supportPolicyInputs.ts). Round synthetic figures only — this repo is public.
 */

/** The effective settings a face with SP_REPRO's defense lines (CB 70, Strike cap 60) would build. */
const ctx = {
  cbLtvCapPct: SP_REPRO.cbLtvCapPct,
  strikeCapEffPct: effectiveStrikeCapPct(SP_REPRO.strikeLtvCapPct, STRIKE_MARGIN_CALL_LTV),
};
const defaults = effectivePolicySettings(DEFAULT_SUPPORT_POLICY_SETTINGS, ctx);

describe('buildSupportPath — the support line, built in ONE place', () => {
  it('has months + 1 entries, each exactly plBandAt(\'floor\', start, m)', () => {
    const path = buildSupportPath(SP_START, 24);
    expect(path).toHaveLength(25);
    path.forEach((s, m) => expect(s).toBe(plBandAt('floor', SP_START, m)));
  });

  it('⭐ is bit-equal to the on-the-line price path from month 1 — and IS Run 1\'s SUPPORT fixture', () => {
    const price = plConvergencePath(1.35 * S0, 'floor', SP_START, SP_MONTHS, PL_ON_THE_LINE);
    const support = buildSupportPath(SP_START, SP_MONTHS);
    expect(support).toHaveLength(price.length);
    for (let m = 1; m <= SP_MONTHS; m++) expect(support[m], `m${m}`).toBe(price[m]);
    expect(price[0]).toBe(1.35 * S0);           // month 0 is the live price, not the line
    expect(support).toEqual(SUPPORT);
  });

  it('floors the horizon, and a negative or non-finite one gives month 0 only', () => {
    expect(buildSupportPath(SP_START, 12.7)).toHaveLength(13);
    expect(buildSupportPath(SP_START, -3)).toEqual([plBandAt('floor', SP_START, 0)]);
    expect(buildSupportPath(SP_START, Number.NaN)).toHaveLength(1);
  });
});

describe('supportPolicyFor — the engine\'s policy input, as a face builds it', () => {
  it('undefined when the policy is off, and in every non-cycle mode (the engine then runs as today)', () => {
    expect(supportPolicyFor({ ...defaults, enabled: false }, SUPPORT, SP_REPRO.expenses, 85, 'cycle')).toBeUndefined();
    for (const mode of ['hold', 'clearStrike', 'clearBoth'] as CyclingMode[]) {
      expect(supportPolicyFor(defaults, SUPPORT, SP_REPRO.expenses, 85, mode), mode).toBeUndefined();
    }
    expect(supportPolicyFor(defaults, SUPPORT, SP_REPRO.expenses, 85, 'cycle')).toBeDefined();
  });

  it('opening cash = months of the face\'s bills; never negative or NaN', () => {
    const six = { ...defaults, cashReserveMonths: 6 };
    expect(supportPolicyFor(six, SUPPORT, 6_000, 85, 'cycle')!.openingCashUsd).toBe(36_000);
    expect(supportPolicyFor(six, SUPPORT, 4_500, 85, 'cycle')!.openingCashUsd).toBe(27_000);
    expect(supportPolicyFor(six, SUPPORT, -1, 85, 'cycle')!.openingCashUsd).toBe(0);
    expect(supportPolicyFor(six, SUPPORT, Number.NaN, 85, 'cycle')!.openingCashUsd).toBe(0);
  });

  it('the partial-liquidation LTV follows the store setting, with the published 85% as the fallback', () => {
    expect(supportPolicyFor(defaults, SUPPORT, 6_000, 85, 'cycle')!.strikePartialLiqLtv).toBeCloseTo(0.85, 12);
    expect(supportPolicyFor(defaults, SUPPORT, 6_000, 90, 'cycle')!.strikePartialLiqLtv).toBeCloseTo(0.90, 12);
    expect(supportPolicyFor(defaults, SUPPORT, 6_000, 0, 'cycle')!.strikePartialLiqLtv).toBe(0.85);
  });

  it('exactly the Run 1 keys plus the re-arm — nothing else, so no test-only input can reach the engine', () => {
    const p = supportPolicyFor(defaults, SUPPORT, 6_000, 85, 'cycle')!;
    expect(Object.keys(p).sort()).toEqual([
      'accumulateBelow', 'bearBufferMonths', 'breakerRearmMonths', 'cbStopAtSupportPct', 'openingCashUsd',
      'payDownAbove', 'strikeCureLtv', 'strikePartialLiqLtv', 'strikeRetrieveMaxLtv', 'strikeStopAtSupportPct',
      'supportPath',
    ]);
    expect(p.breakerRearmMonths).toBe(DEFAULT_BREAKER_REARM_MONTHS);
  });

  it('⭐ the re-arm key is ABSENT when the constant is undefined — a local override, never an edit of it', async () => {
    vi.resetModules();
    vi.doMock('../supportPolicyView', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../supportPolicyView')>()),
      DEFAULT_BREAKER_REARM_MONTHS: undefined,
    }));
    try {
      const latched = await import('../supportPolicyInputs');
      const p = latched.supportPolicyFor(defaults, SUPPORT, SP_REPRO.expenses, 85, 'cycle');
      expect(p).toBeDefined();
      expect(Object.keys(p!)).not.toContain('breakerRearmMonths');
      expect(p).toEqual(policyFor(SUPPORT));   // a latched run is exactly Run 1's object
    } finally {
      vi.doUnmock('../supportPolicyView');
      vi.resetModules();
    }
  });

  it('⭐ a face-shaped input: the engine applies it, and it IS Run 1\'s default policy plus the re-arm', () => {
    const supportPath = buildSupportPath(SP_START, SP_MONTHS);
    const policy = supportPolicyFor(defaults, supportPath, SP_REPRO.expenses, 85, 'cycle');
    expect(policy).toEqual({ ...policyFor(SUPPORT), breakerRearmMonths: DEFAULT_BREAKER_REARM_MONTHS });
    const r = runCyclingSim({ ...SP_REPRO, pricePath: pathP1(), supportPolicy: policy });
    expect(r.policyApplied).toBe(true);
    expect(r.policyIgnoredReason).toBeNull();
  });
});
