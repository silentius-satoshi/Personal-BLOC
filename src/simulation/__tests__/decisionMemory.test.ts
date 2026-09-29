import { describe, it, expect } from 'vitest';
import { runCyclingSim, type CyclingInputs } from '../cyclingSim';
import {
  nextRearmableBreakerState, REARMABLE_BREAKER_START, type RearmableBreakerState,
} from '../supportPolicy';
import {
  SP_REPRO, SUPPORT, policyFor, pathP2, pathP6, falseRecoveryPath, stressFrom12,
} from './supportPolicyPaths';

/**
 * I24 — MEMORY FROM PRICES (D14).
 *
 * The Decision face re-plans every month from the owner's REAL balances. Those balances carry every past
 * decision; the BREAKER is the one thing they do not carry. So the question this file answers is:
 *
 *   does a chain of fresh two-month runs, each started from the previous month's realized balances and seeded
 *   with the breaker folded over the realized month-ends, reproduce one continuous policy run?
 *
 * Seeded, yes — to 1e-9 ₿ on every crash path measured. UNSEEDED, a false recovery re-borrows, is liquidated,
 * and ends ~1 ₿ behind: the non-vacuity case below. That gap is the whole reason the engine takes an
 * `openingBreaker` at all.
 *
 * Round synthetic figures only — this repo is public.
 */

const REARM = 6;
const BASE: Omit<CyclingInputs, 'pricePath'> = { ...SP_REPRO, cycleMonths: 1 };

/** One continuous run of the whole path. */
const continuous = (pricePath: number[]) => runCyclingSim({
  ...BASE, pricePath, supportPolicy: policyFor(SUPPORT, { breakerRearmMonths: REARM }),
});

/**
 * The face's own loop: at each month, run TWO months from the realized balances — seeded (or not) with the
 * breaker folded over the month-ends seen so far — and carry the first month's result forward.
 */
function replan(pricePath: number[], months: number, seed: boolean) {
  let strikeCollateralBtc = BASE.strikeCollateralBtc;
  let cbCollateralBtc = BASE.cbCollateralBtc;
  let coldBtc = BASE.openingColdBtc ?? 0;
  let strikeBalance = BASE.strikeBalance;
  let cbDebt = BASE.cbDebt;
  let breaker: RearmableBreakerState = REARMABLE_BREAKER_START;
  let liquidated = false;

  for (let m = 0; m < months; m++) {
    const two = [pricePath[m], pricePath[m + 1]];
    // The support the run believes in, for these two months — the same line the continuous run reads.
    const support = [SUPPORT[m], SUPPORT[m + 1]];
    const r = runCyclingSim({
      ...BASE,
      pricePath: two,
      strikeCollateralBtc, cbCollateralBtc, openingColdBtc: coldBtc, strikeBalance, cbDebt,
      supportPolicy: policyFor(support, { breakerRearmMonths: REARM }),
      ...(seed ? { openingBreaker: breaker } : {}),
    });
    const row = r.rows[1];
    strikeCollateralBtc = row.strikeCollateralBtc;
    cbCollateralBtc = row.cbCollateralBtc;
    coldBtc = row.coldBtc;
    strikeBalance = row.strikeBalance;
    cbDebt = row.cbDebt;
    if (r.liqMonth !== null) liquidated = true;
    // The breaker the NEXT re-plan inherits — folded over the realized month-end, never over a decision log.
    breaker = nextRearmableBreakerState(breaker, pricePath[m + 1], SUPPORT[m + 1], m + 1, REARM);
  }
  return { strikeCollateralBtc, cbCollateralBtc, coldBtc, strikeBalance, cbDebt, liquidated };
}

const held = (o: { strikeCollateralBtc: number; cbCollateralBtc: number; coldBtc: number }) =>
  o.strikeCollateralBtc + o.cbCollateralBtc + o.coldBtc;

describe('⭐ I24 — seeding the breaker reproduces the continuous run', () => {
  const MONTHS = 40;
  const PATHS: [string, number[]][] = [
    ['P6', pathP6()],
    ['false recovery 0.6', falseRecoveryPath(0.6)],
    ['false recovery 0.35 with $50k on Coinbase', falseRecoveryPath(0.35)],
    ['P2 × 0.35 from month 12', stressFrom12(pathP2(0), 0.35)],
  ];

  it.each(PATHS)('⭐ %s — seeded re-planning matches the continuous run to 1e-9 ₿', (_name, path) => {
    const one = continuous(path);
    expect(one.policyApplied).toBe(true);
    const chain = replan(path, MONTHS, true);
    const row = one.rows[MONTHS];
    expect(chain.strikeCollateralBtc).toBeCloseTo(row.strikeCollateralBtc, 9);
    expect(chain.cbCollateralBtc).toBeCloseTo(row.cbCollateralBtc, 9);
    expect(chain.coldBtc).toBeCloseTo(row.coldBtc, 9);
    expect(chain.strikeBalance).toBeCloseTo(row.strikeBalance, 6);
    expect(chain.cbDebt).toBeCloseTo(row.cbDebt, 6);
  });

  it('⭐ NON-VACUITY — unseeded, the $50k false recovery re-borrows, is liquidated, and ends behind', () => {
    // The shape the breaker exists for: a first leg that trips it, a recovery that tempts a re-borrow, and a
    // second leg that liquidates whatever re-borrowed.
    const path = falseRecoveryPath(0.35);
    const inputs = { ...BASE, cbDebt: 50_000, cbCollateralBtc: 1 };
    const seededChain = replanWith(inputs, path, MONTHS, true);
    const blindChain = replanWith(inputs, path, MONTHS, false);
    expect(blindChain.liquidated).toBe(true);
    expect(seededChain.liquidated).toBe(false);
    expect(held(blindChain)).toBeLessThan(held(seededChain));
  });

  it('a seeded chain on a calm path is identical to a blind one — the breaker only matters once it trips', () => {
    const calm = SUPPORT.map((s) => s * 1.3);
    const a = replan(calm, 24, true);
    const b = replan(calm, 24, false);
    expect(held(a)).toBeCloseTo(held(b), 9);
  });
});

/** `replan` with the opening position overridden — the non-vacuity fixture needs its own Coinbase loan. */
function replanWith(inputs: Omit<CyclingInputs, 'pricePath'>, pricePath: number[], months: number, seed: boolean) {
  let strikeCollateralBtc = inputs.strikeCollateralBtc;
  let cbCollateralBtc = inputs.cbCollateralBtc;
  let coldBtc = inputs.openingColdBtc ?? 0;
  let strikeBalance = inputs.strikeBalance;
  let cbDebt = inputs.cbDebt;
  let breaker: RearmableBreakerState = REARMABLE_BREAKER_START;
  let liquidated = false;
  for (let m = 0; m < months; m++) {
    const r = runCyclingSim({
      ...inputs,
      pricePath: [pricePath[m], pricePath[m + 1]],
      strikeCollateralBtc, cbCollateralBtc, openingColdBtc: coldBtc, strikeBalance, cbDebt,
      supportPolicy: policyFor([SUPPORT[m], SUPPORT[m + 1]], { breakerRearmMonths: REARM }),
      ...(seed ? { openingBreaker: breaker } : {}),
    });
    const row = r.rows[1];
    strikeCollateralBtc = row.strikeCollateralBtc;
    cbCollateralBtc = row.cbCollateralBtc;
    coldBtc = row.coldBtc;
    strikeBalance = row.strikeBalance;
    cbDebt = row.cbDebt;
    if (r.liqMonth !== null) liquidated = true;
    breaker = nextRearmableBreakerState(breaker, pricePath[m + 1], SUPPORT[m + 1], m + 1, REARM);
  }
  return { strikeCollateralBtc, cbCollateralBtc, coldBtc, strikeBalance, cbDebt, liquidated };
}
