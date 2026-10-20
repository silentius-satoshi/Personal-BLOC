import { describe, it, expect } from 'vitest';
import { runCyclingSim, allInEquity, baselineAllInEquity, type CyclingInputs, type CyclingMode } from '../cyclingSim';
import { planMonthRun, type PlanMonthFacts } from '../../components/Almanac/planRun';
import { PLAN_POLICY_DEFAULTS } from '../../lib/planPolicy';

/**
 * D-R2-7 — Strike's minimum, paid from income, at the engine's two sites the plan never reaches: the policy-off cycle
 * and the three other strategy modes (the faces pass the owner's setting to every run). Every assertion carries a tag
 * from the spec's §13.3. ⚠ SYNTHETIC round figures — this repo is public.
 */
const facts = (over: Partial<PlanMonthFacts> = {}): PlanMonthFacts => ({
  todayISO: '2026-10-12', price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
  income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
  strikeBalance: 20_000, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 50_000,
  strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
  goalNetBtc: null,
  ...over,
});

/** The plan's own inputs with the policy OFF and a strategy mode — the faces' other runs. */
function inputsOf(over: Partial<PlanMonthFacts>, mode: CyclingMode, fromIncome: boolean | undefined): CyclingInputs {
  const run = planMonthRun(facts(over));
  const { strikeMinFromIncome: _drop, ...rest } = run.engineInputs;
  return {
    ...rest, supportPolicy: undefined, mode, pricePath: run.pricePath,
    ...(fromIncome === undefined ? {} : { strikeMinFromIncome: fromIncome }),
  };
}

const CELLS: Partial<PlanMonthFacts>[] = [];
for (const price of [70_000, 100_000, 160_000]) {
  for (const [income, expenses] of [[6_000, 4_000], [4_200, 4_000], [3_000, 4_000]] as const) {
    for (const [strikeBalance, strikeCollateralBtc] of [[0, 0], [5_000, 2], [20_000, 1]] as const) {
      CELLS.push({ price, income, expenses, strikeBalance, strikeCollateralBtc });
    }
  }
}
const MODES: CyclingMode[] = ['cycle', 'hold', 'clearStrike', 'clearBoth'];

describe('⭐ MIN — the policy-off cycle and the other modes: income pays the minimum once', () => {
  it('⭐ INT — every mode: Σ strikeInterestUsd is the run\'s total; rolled in pays nothing and is byte-identical to absent', () => {
    for (const mode of MODES) {
      for (const c of CELLS) {
        for (const fromIncome of [false, true]) {
          const sim = runCyclingSim(inputsOf(c, mode, fromIncome));
          expect(sim.rows.reduce((a, r) => a + r.strikeInterestUsd, 0), `INT Σ ${mode}`).toBe(sim.totalStrikeInterest);
          for (const r of sim.rows) {
            expect(r.strikeMinPaidUsd, `INT paid ≤ charged ${mode}`).toBeLessThanOrEqual(r.strikeInterestUsd + 1e-9);
            if (!fromIncome) expect(r.strikeMinPaidUsd, `MIN roll pays nothing ${mode}`).toBe(0);
          }
        }
        expect(runCyclingSim(inputsOf(c, mode, false)), `MIN false ≡ absent ${mode}`).toEqual(runCyclingSim(inputsOf(c, mode, undefined)));
      }
    }
  });

  it('⭐ MIN — cycle (policy off) and hold: the buy and the minimum share what the bills left, exactly', () => {
    const paid: Record<string, number> = { cycle: 0, hold: 0 };
    for (const mode of ['cycle', 'hold'] as const) {
      for (const c of CELLS) {
        const inputs = inputsOf(c, mode, true);
        for (const r of runCyclingSim(inputs).rows) {
          if (r.m === 0 || r.postLiquidation) continue;
          // Drawing, the line pays the bill and only its unfunded part comes out of income; otherwise income pays it all.
          const left = r.strikeDrawn > 0 ? Math.max(0, inputs.income - r.strikeShortfall) : Math.max(0, inputs.income - inputs.expenses);
          expect(r.btcBoughtUsd + r.strikeMinPaidUsd, `MIN ${mode} m${r.m}`).toBeCloseTo(left, 6);
          if (r.strikeMinPaidUsd > 0) paid[mode] += 1;
        }
      }
    }
    expect([paid.cycle > 20, paid.hold > 20], 'MIN both modes pay minimums').toEqual([true, true]);
    // 'hold' never draws: it IS the never-draw world, so its verdict is nothing, in both minimum modes — the never-draw
    // baseline pays its own Strike interest by the run's rule. (Before, 12 of these 27 income-mode cells differed from
    // themselves: the baseline let Strike's interest compound and bought with the whole surplus. On these flat paths the
    // run came out ahead, by the interest on the interest; on a rising path it can come out behind.)
    let same = 0;
    for (const c of CELLS) {
      for (const fromIncome of [false, true]) {
        const sim = runCyclingSim(inputsOf(c, 'hold', fromIncome));
        expect(sim.baselineBtc, 'MIN baseline — hold IS never-draw (₿)').toBeCloseTo(sim.last.btcHeld, 9);
        expect(baselineAllInEquity(sim), 'MIN baseline — hold IS never-draw (equity)').toBeCloseTo(allInEquity(sim), 4);
        if (fromIncome && sim.rows.some((r) => r.strikeMinPaidUsd > 0)) same += 1;
      }
    }
    expect(same, 'MIN baseline — cells where income pays a minimum').toBe(12);
  });

  it('⭐ MIN — clearing Strike: paying the minimum from income IS part of clearing it — the month ends the same', () => {
    let paid = 0;
    for (const mode of ['clearStrike', 'clearBoth'] as const) {
      for (const c of CELLS) {
        const roll = runCyclingSim(inputsOf(c, mode, false)).rows;
        const inc = runCyclingSim(inputsOf(c, mode, true)).rows;
        for (let m = 1; m < roll.length; m++) {
          expect(inc[m].strikeBalance, `MIN ${mode} Strike m${m}`).toBeCloseTo(roll[m].strikeBalance, 6);
          expect(inc[m].cbDebt, `MIN ${mode} Coinbase m${m}`).toBeCloseTo(roll[m].cbDebt, 6);
          expect(inc[m].btcBoughtUsd, `MIN ${mode} buy m${m}`).toBeCloseTo(roll[m].btcBoughtUsd, 6);
          if (inc[m].strikeMinPaidUsd > 0) paid += 1;
        }
      }
    }
    expect(paid, 'MIN the clearing modes pay minimums').toBeGreaterThan(20);
  });
});
