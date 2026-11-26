import { describe, it, expect } from 'vitest';
import { policyReading } from '../supportPolicyView';
import { planMonthRun, cbOverLimitAtMonthEnd, type PlanMonthFacts } from '../planRun';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';
import { DUST_USD } from '../../../utils/format';

/**
 * Hardening 2 — supportPolicyView.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * planMonthView.test.ts's household. SYNTHETIC round figures.
 */
const facts = (): PlanMonthFacts => ({
  todayISO: '2026-10-12', price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
  income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
  strikeBalance: 20_000, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 50_000,
  strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
  goalNetBtc: null,
});

describe('Hardening 2 — supportPolicyView', () => {
  it('HS-17 · the one "over" rule (planRun\'s cbOverLimitAtMonthEnd, headroom ≤ −DUST_USD) — at exactly 50¢ over, the policy card says over, as THIS MONTH does', () => {
    const run = planMonthRun(facts());
    const sim = { ...run.sim, rows: run.sim.rows.map((r) => (r.m === 1 ? { ...r, cbCeilingHeadroomUsd: -DUST_USD } : r)) };
    const row = sim.rows.find((r) => r.m === 1)!;
    expect(cbOverLimitAtMonthEnd(row), 'HS-17 premise: THIS MONTH calls the month over').toBe(true);
    expect(policyReading(sim, 1, 4_000).cb?.over, 'HS-17 the card agrees').toBe(true);
  });
});
