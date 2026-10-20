import { describe, it, expect } from 'vitest';
import {
  planMonthRun, firstMonthUnderLimit, cbOverLimitAtMonthEnd, placementInputOf, engineInputsOf, planCbCollateralOf, planCbLoanBalanceOf,
  PLAN_ENGINE_CONTEXT, PLAN_RUN_MONTHS, type PlanMonthFacts,
} from '../planRun';
import { placementPlan } from '../../../simulation/placement';
import { runCyclingSim, type CyclingInputs } from '../../../simulation/cyclingSim';
import { buildSupportPath } from '../supportPolicyInputs';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';
import type { DayEvent } from '../../../simulation/types';

/**
 * The plan of record's ONE builder (spec pbloc-spec-plan-of-record-v1, Run 2 — §4.3, invariant 2). Every assertion
 * carries a tag from the spec's §13.3. ⚠ SYNTHETIC round figures — this repo is public; never a real position.
 */

const TODAY = '2026-10-12';
const facts = (over: Partial<PlanMonthFacts> = {}): PlanMonthFacts => ({
  todayISO: TODAY, price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
  income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
  strikeBalance: 20_000, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 50_000,
  strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
  goalNetBtc: null,
  ...over,
});

/** A grid of positions the app can produce: over the limit, inside it, no Coinbase loan, a fresh line, a deep one. */
const GRID: Partial<PlanMonthFacts>[] = [];
for (const price of [70_000, 100_000, 160_000, 250_000]) {
  for (const [cbDebt, cbCollateralBtc] of [[0, 0], [10_000, 0.5], [50_000, 1], [90_000, 2]] as const) {
    for (const [strikeBalance, strikeCollateralBtc] of [[0, 0], [10_000, 2], [20_000, 1]] as const) {
      for (const strikeMinFromIncome of [false, true]) {
        GRID.push({ price, cbDebt, cbCollateralBtc, strikeBalance, strikeCollateralBtc, strikeMinFromIncome });
      }
    }
  }
}

describe('⭐ ONE — invariant 2: THIS MONTH and the Decision card build THE MOVE from one object', () => {
  it('⭐ ONE — the run\'s placement input is placementInputOf over its own facts, priced at today\'s price and support', () => {
    for (const g of GRID) {
      const f = facts(g);
      const run = planMonthRun(f);
      expect(run.placementInput.price, 'ONE price').toBe(f.price);
      expect(run.placementInput.support, 'ONE support').toBe(buildSupportPath(new Date(TODAY), PLAN_RUN_MONTHS)[0]);
      expect(run.placementInput).toEqual(placementInputOf({
        runLine: f.creditLine, strikeBalance: f.strikeBalance, strikeCollateralBtc: f.strikeCollateralBtc,
        cbDebt: f.cbDebt, cbCollateralBtc: f.cbCollateralBtc, coldBtc: f.coldBtc, price: f.price,
        support: run.supportPath[0], policySettings: run.policySettings, expenses: f.expenses,
        inHold: f.hold.inHold, broken: false,
      }));
      expect(run.placement, 'ONE placement').toEqual(placementPlan(run.placementInput));
    }
  });

  it('⭐ MOVE — the Decision face\'s horizon never changes the move (S₀ is the same on 12 and 60 months)', () => {
    // The face runs 60 months by default; THIS MONTH 12 (D4). THE MOVE reads S₀ only — measured over the grid.
    let compared = 0;
    for (const g of GRID) {
      const f = facts(g);
      const run = planMonthRun(f);
      const faceSupport = buildSupportPath(new Date(TODAY), 60)[0];
      const face = placementPlan({ ...run.placementInput, support: faceSupport });
      expect(face, 'MOVE').toEqual(run.placement);
      compared += 1;
    }
    expect(compared).toBe(GRID.length);
    expect(GRID.length).toBe(96);
  });

  it('⭐ ONE — the run\'s engine inputs are engineInputsOf over its facts, spreading the plan\'s five constants', () => {
    const f = facts({ strikeMinFromIncome: true });
    const run = planMonthRun(f);
    for (const [k, v] of Object.entries(PLAN_ENGINE_CONTEXT)) {
      expect((run.engineInputs as Record<string, unknown>)[k], `ONE ${k}`).toBe(v);
    }
    expect(run.engineInputs.strikeMinFromIncome, 'MIN reaches the engine').toBe(true);
    expect(run.engineInputs.openingStrikeHoldMonths, 'ONE hold').toBe(run.holdMonths);
    expect(run.pricePath, 'D4 — flat at today\'s price').toEqual(Array(PLAN_RUN_MONTHS + 1).fill(f.price));
    expect(run.sim).toEqual(runCyclingSim({ ...run.engineInputs, pricePath: run.pricePath }));
    expect(engineInputsOf({
      startDate: run.startDate, seedFromMove: run.seedFromMove, placement: run.placement,
      strikeCollateralBtc: f.strikeCollateralBtc, strikeBalance: f.strikeBalance, runLine: f.creditLine,
      cbCollateralBtc: f.cbCollateralBtc, cbDebt: f.cbDebt, coldBtc: f.coldBtc, income: f.income, expenses: f.expenses,
      blocApr: f.blocApr, cbAprPct: f.cbAprPct, supportPolicy: run.supportPolicy, openingBreaker: undefined,
      holdMonths: run.holdMonths, strikeMinFromIncome: true, goalNetBtc: null,
    })).toEqual(run.engineInputs);
  });
});

describe('⭐ GATE — D-R2-4: the Coinbase leg is the owner\'s only with the loan switched on', () => {
  const reading: DayEvent = { id: 'r1', date: '2026-10-01', ts: Date.UTC(2026, 9, 1), kind: 'cbCollateralReading', cbCollateral: 2 } as DayEvent;
  it('⭐ GATE — switched off, the seed\'s $60,000 on 1.48 ₿ never reaches a plan', () => {
    const off = { hasCbLoan: false, dayLog: [reading], cbCollateralBtc: 1.48, cbLoanBalance: 60_000 };
    expect(planCbCollateralOf(off), 'GATE collateral off').toBe(0);
    expect(planCbLoanBalanceOf(off), 'GATE balance off').toBe(0);
  });
  it('⭐ GATE — switched on, the derived collateral and the stored balance', () => {
    const on = { hasCbLoan: true, dayLog: [reading], cbCollateralBtc: 1.48, cbLoanBalance: 60_000 };
    expect(planCbCollateralOf(on), 'GATE collateral on (the journal\'s reading)').toBe(2);
    expect(planCbLoanBalanceOf(on), 'GATE balance on').toBe(60_000);
  });
});

describe('⭐ SWITCH — §4.5: the month the run is back within Coinbase\'s limit', () => {
  it('⭐ SWITCH — the over household is back in month 8 at today\'s price; a household inside it from month 1', () => {
    expect(firstMonthUnderLimit(planMonthRun(facts()).sim), 'SWITCH over').toBe(8);
    expect(firstMonthUnderLimit(planMonthRun(facts({ cbDebt: 10_000, cbCollateralBtc: 0.5 })).sim), 'SWITCH inside').toBe(1);
  });
  it('⭐ SWITCH — never month 0, and null when no month of the run is back within', () => {
    const sim = planMonthRun(facts()).sim;
    const doctored = { ...sim, rows: sim.rows.map((r) => ({ ...r, cbCeilingHeadroomUsd: r.m === 0 ? 1_000 : -1 })) };
    expect(firstMonthUnderLimit(doctored), 'SWITCH month 0 never counts').toBeNull();
    const noPolicy = { ...sim, rows: sim.rows.map((r) => ({ ...r, cbCeilingHeadroomUsd: null })) };
    expect(firstMonthUnderLimit(noPolicy), 'SWITCH no reading').toBeNull();
  });
  it('⭐ SWITCH — one rule with the status: a restore that lands ~1e-10 over the limit is back within it, never a month later', () => {
    const sim = planMonthRun(facts()).sim;
    const at = (h: number) => ({ ...sim, rows: sim.rows.map((r) => ({ ...r, cbCeilingHeadroomUsd: r.m === 3 ? h : r.m < 3 ? -5_000 : 100 })) });
    expect(firstMonthUnderLimit(at(-1e-10)), 'SWITCH dust is within').toBe(3);
    expect(cbOverLimitAtMonthEnd({ cbCeilingHeadroomUsd: -1e-10 }), 'SWITCH dust is not over').toBe(false);
    expect(firstMonthUnderLimit(at(-0.5)), 'SWITCH a shown dollar over is over').toBe(4);
    expect(cbOverLimitAtMonthEnd({ cbCeilingHeadroomUsd: -0.5 })).toBe(true);
  });
});

describe('⭐ INT and MIN — the engine\'s Strike interest and the minimum\'s source (D-R2-7)', () => {
  const inputsOf = (g: Partial<PlanMonthFacts>, fromIncome: boolean): CyclingInputs => {
    const run = planMonthRun(facts({ ...g, strikeMinFromIncome: fromIncome }));
    return { ...run.engineInputs, pricePath: run.pricePath };
  };

  it('⭐ INT — every month\'s strikeInterestUsd adds up to the run\'s total, exactly, in both modes', () => {
    for (const g of GRID) {
      const sim = planMonthRun(facts(g)).sim;
      expect(sim.rows.reduce((a, r) => a + r.strikeInterestUsd, 0), 'INT Σ').toBe(sim.totalStrikeInterest);
      for (const r of sim.rows) expect(r.strikeMinPaidUsd, 'INT paid ≤ charged').toBeLessThanOrEqual(r.strikeInterestUsd + 1e-9);
    }
  });

  it('⭐ MIN — rolled in (absent or false): byte-identical, and nothing is paid from income', () => {
    for (const g of GRID.filter((x) => !x.strikeMinFromIncome)) {
      const inputs = inputsOf(g, false);
      const { strikeMinFromIncome: _absent, ...withoutFlag } = inputs;
      expect(runCyclingSim(inputs), 'MIN false ≡ absent').toEqual(runCyclingSim(withoutFlag));
      for (const r of runCyclingSim(inputs).rows) expect(r.strikeMinPaidUsd, 'MIN roll pays nothing').toBe(0);
    }
  });

  it('⭐ MIN — from income: month 1 pays the minimum before the buy, and only an unpaid part capitalises', () => {
    // Compared where month 1 moves no Strike debt any other way in either mode (no refinance, repayment or defense), so
    // the minimum is the ONLY difference — measured, the cells are counted below.
    let paidMonths = 0;
    let compared = 0;
    for (const g of GRID.filter((x) => x.strikeMinFromIncome)) {
      const roll = runCyclingSim(inputsOf(g, false)).rows[1];
      const inc = runCyclingSim(inputsOf(g, true)).rows[1];
      expect(inc.strikeInterestUsd, 'MIN same interest charged').toBeCloseTo(roll.strikeInterestUsd, 9);
      if (inc.strikeMinPaidUsd > 0) paidMonths += 1;
      const quiet = (r: typeof roll) => r.refinancedUsd === 0 && r.strikeRepaidUsd === 0 && r.defenseDrawnUsd === 0;
      if (!quiet(roll) || !quiet(inc)) continue;
      compared += 1;
      expect(inc.strikeBalance, 'MIN capitalises only the unpaid part').toBeCloseTo(roll.strikeBalance - inc.strikeMinPaidUsd, 6);
      const spent = (r: typeof roll) => r.btcBoughtUsd + r.cbRepaidUsd;
      expect(spent(inc) + inc.strikeMinPaidUsd, 'MIN income pays it, nothing else').toBeCloseTo(spent(roll), 6);
    }
    expect(paidMonths, 'MIN the sweep reaches a paid minimum').toBeGreaterThan(20);
    expect(compared, 'MIN the comparison is not vacuous').toBeGreaterThan(10);
  });

  it('⭐ MIN — a drawing month: the buy and the minimum share what the bills left, exactly — income pays it once', () => {
    // The flywheel's identity (the line pays the bill, so income buys): buy + minimum = income − the bill the line
    // could not fund. Every month that draws, both modes — the quiet-cell comparison above never reaches a draw.
    let reached = 0;
    for (const g of GRID) {
      for (const fromIncome of [false, true]) {
        const run = planMonthRun(facts({ ...g, strikeMinFromIncome: fromIncome }));
        for (const r of run.sim.rows) {
          if (r.m === 0 || !(r.strikeDrawn > 0)) continue;
          expect(r.btcBoughtUsd + r.strikeMinPaidUsd, 'MIN drawing month')
            .toBeCloseTo(Math.max(0, run.engineInputs.income - r.strikeShortfall), 6);
          if (fromIncome && r.strikeMinPaidUsd > 0) reached += 1;
        }
      }
    }
    expect(reached, 'MIN drawing months that pay a minimum').toBeGreaterThan(20);
  });
});

describe('⭐ GOAL — BL14: THIS MONTH and the Decision card run ONE goal', () => {
  const GOALS = [null, 0.5, 1.6, 2, 1_000] as const;
  it('⭐ GOAL — the run hands the engine its facts\' goal, and is engineInputsOf over them: over the grid × five goals', () => {
    let atGoal = 0, below = 0, cells = 0;
    for (const g of GRID) for (const goalNetBtc of GOALS) {
      const f = facts({ ...g, goalNetBtc });
      const run = planMonthRun(f);
      expect(run.engineInputs.goalNetBtc, 'GOAL reaches the engine').toBe(goalNetBtc);
      expect(run.sim, 'GOAL one run').toEqual(runCyclingSim({ ...run.engineInputs, pricePath: run.pricePath }));
      expect(engineInputsOf({
        startDate: run.startDate, seedFromMove: run.seedFromMove, placement: run.placement,
        strikeCollateralBtc: f.strikeCollateralBtc, strikeBalance: f.strikeBalance, runLine: f.creditLine,
        cbCollateralBtc: f.cbCollateralBtc, cbDebt: f.cbDebt, coldBtc: f.coldBtc, income: f.income, expenses: f.expenses,
        blocApr: f.blocApr, cbAprPct: f.cbAprPct, supportPolicy: run.supportPolicy, openingBreaker: undefined,
        holdMonths: run.holdMonths, strikeMinFromIncome: f.strikeMinFromIncome, goalNetBtc,
      }), 'GOAL engineInputsOf').toEqual(run.engineInputs);
      const r1 = run.sim.rows[1];
      if (goalNetBtc === null) expect(r1.atGoal, 'GOAL none').toBeNull();
      else if (run.sim.policyApplied) (r1.atGoal ? atGoal++ : below++);
      cells += 1;
    }
    expect(cells).toBe(GRID.length * GOALS.length);
    expect([atGoal > 50, below > 50], 'GOAL the grid reaches both sides of the goal').toEqual([true, true]);
  });

  it('⭐ GOAL — no goal: every cell\'s run is byte-identical to the run with the field absent (BL14\'s kill criterion)', () => {
    for (const g of GRID) {
      const run = planMonthRun(facts({ ...g, goalNetBtc: null }));
      const { goalNetBtc: _g, ...absent } = run.engineInputs;
      expect(run.sim, 'GOAL absent').toEqual(runCyclingSim({ ...absent, pricePath: run.pricePath }));
    }
  });

  it('⭐ GOAL — THE MOVE never reads the goal: the placement is the same with any goal (option A)', () => {
    for (const g of GRID) {
      const base = planMonthRun(facts(g));
      for (const goalNetBtc of GOALS) {
        const run = planMonthRun(facts({ ...g, goalNetBtc }));
        expect(run.placementInput, 'GOAL placement input').toEqual(base.placementInput);
        expect(run.placement, 'GOAL placement').toEqual(base.placement);
      }
    }
  });
});
