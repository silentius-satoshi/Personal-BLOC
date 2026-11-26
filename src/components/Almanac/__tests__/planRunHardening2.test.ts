import { describe, it, expect } from 'vitest';
import { planMonthRun, type PlanMonthFacts } from '../planRun';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';
import { REARMABLE_BREAKER_START } from '../../../simulation/supportPolicy';

/**
 * Hardening 2 — planRun.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * planMonthView.test.ts's household. SYNTHETIC round figures.
 */
const facts = (over: Partial<PlanMonthFacts> = {}): PlanMonthFacts => ({
  todayISO: '2026-10-12', price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
  income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
  strikeBalance: 20_000, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 50_000,
  strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
  goalNetBtc: null,
  ...over,
});

describe('Hardening 2 — planRun', () => {
  it('HS-31 · engine.md "A run shown as THIS MONTH\'S MOVE carries the policy\'s memory" — a broken breaker seed breaks THE MOVE\'s placement input too (one seed, run and card)', () => {
    const run = planMonthRun(facts({
      breakerSeed: { state: { ...REARMABLE_BREAKER_START, broken: true, brokenMonth: 1 }, lastMonthEndISO: '2026-09-30' },
    }));
    expect([run.placementInput.broken, run.placement.state], 'HS-31 no move the broken run won\'t make').toEqual([true, 'broken']);
  });
});
