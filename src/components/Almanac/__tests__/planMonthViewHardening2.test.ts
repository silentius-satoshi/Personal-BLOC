import { describe, it, expect } from 'vitest';
import { planMonthRun, firstMonthUnderLimit, type PlanMonthFacts } from '../planRun';
import { planStatus, monthTrack } from '../planMonthView';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';
import type { CyclingResult } from '../../../simulation/cyclingSim';

/**
 * Hardening 2 — planMonthView.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * planMonthView.test.ts's household (OVER: Coinbase over its limit at support). SYNTHETIC round figures.
 */
const facts = (over: Partial<PlanMonthFacts> = {}): PlanMonthFacts => ({
  todayISO: '2026-10-12', price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
  income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
  strikeBalance: 20_000, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 50_000,
  strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
  goalNetBtc: null,
  ...over,
});

describe('Hardening 2 — planMonthView', () => {
  it('HS-15 · almanac.md § The plan of record (Run 2) — the catch-up moves cold when cold EXACTLY covers it', () => {
    const run = planMonthRun(facts());
    const sf = { monthsBackUnder: firstMonthUnderLimit(run.sim), cbStop: run.placementInput.cbStop, support0: run.supportPath[0] };
    const A = run.placement.cbOverCeilingUsd / (sf.cbStop * sf.support0);   // the ₿ that brings Coinbase within its limit
    expect(A > 0 && Number.isFinite(A), 'HS-15 premise: Coinbase is over its limit').toBe(true);
    const st = planStatus(run.sim, run.placement, 1, { ...sf, coldBtc: A });
    expect(st.fixes[0].startsWith('Move ₿'), `HS-15 cold covers it, to the last satoshi: "${st.fixes[0]}"`).toBe(true);
  });

  it('HS-16 · file-structure.md § planMonthView.ts (monthTrack) — a month whose bills go unpaid paints amber, never green, even within the limit', () => {
    const sim = {
      policyApplied: true,
      rows: [{ m: 1, postLiquidation: false, cbCeilingHeadroomUsd: 1_000, unfundedUsd: 100 }],
    } as unknown as CyclingResult;
    const track = monthTrack(sim, 1, 2);
    expect(track.startsWith('linear-gradient(90deg, var(--amber) 0.00% 50.00%'), `HS-16 the unpaid month: ${track}`).toBe(true);
  });
});
