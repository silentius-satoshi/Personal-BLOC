import { describe, it, expect } from 'vitest';
import {
  runCyclingSim, allInEquity, baselineAllInEquity, neverDrawTie, beatsNeverDraw, NEVER_DRAW_TIE_USD,
  type CyclingInputs, type CyclingResult, type CyclingRow,
} from '../cyclingSim';
import { netCoinsBtc, atGoalOf } from '../goal';
import { allocatePayDown } from '../supportPolicy';
import { runFutures, futureOutcome } from '../monteCarlo';
import { shownUsd } from '../../components/Almanac/supportPolicyView';
import { DUST_USD } from '../../utils/format';
import {
  SP_REPRO, SP_START, supportPathFor, policyFor, V2_DEFAULTS, faceWorldGrid, reachGrid, a5Cases,
} from './supportPolicyPaths';

/**
 * BL14 — the plan's goal amount in the engine (Batch 1, build 2; spec pbloc-spec-batch-1-v1 §2.2). At or above the goal
 * (net coins, at the month's decision) a month borrows, buys and refinances nothing; spare income repays Strike, then
 * Coinbase; with both repaid the plan holds. Below it, the month acts on its zone. No goal: byte-identical (BL14's kill
 * criterion; the identity sweep against the build-1 engine is in the spec). ⚠ SYNTHETIC round figures — this repo is
 * public.
 *
 * ⚠ Every run here asserts `policyApplied` first: a price path whose length differs from the policy's support path
 * switches the policy OFF, and with it the goal — a test on such a run passes through the wrong branch.
 */

type Household = Omit<CyclingInputs, 'pricePath' | 'supportPolicy'>;

/** Two loans, a line, cold — a synthetic household whose accumulate months draw, buy and refinance (no restore). */
const TWO_LOANS: Household = {
  ...SP_REPRO, strikeCollateralBtc: 2, strikeBalance: 20_000, strikeCreditLine: 40_000,
  cbCollateralBtc: 2, cbDebt: 30_000, openingColdBtc: 0.5,
};
const NO_DEBT: Household = { ...TWO_LOANS, strikeBalance: 0, cbDebt: 0 };

const supportOf = (months: number): number[] => supportPathFor(SP_START, months);
/** The price as a multiple of support, flat or per month — always the policy's own length. */
const pathOf = (k: number | ((m: number) => number), months: number): number[] =>
  supportOf(months).map((s, m) => (typeof k === 'number' ? k : k(m)) * s);

function sim(b: Household, k: number | ((m: number) => number), goalNetBtc?: number | null, months = 12): CyclingResult {
  const r = runCyclingSim({
    ...b, supportPolicy: policyFor(supportOf(months), V2_DEFAULTS), pricePath: pathOf(k, months),
    ...(goalNetBtc === undefined ? {} : { goalNetBtc }),
  });
  expect(r.policyApplied, 'premise: the policy (and so the goal) is applied').toBe(true);
  return r;
}
const NEW = ['netCoinsBtc', 'atGoal', 'goalHeldUsd'] as const;
const bare = (r: CyclingRow): Record<string, unknown> => { const o: Record<string, unknown> = { ...r }; for (const k of NEW) delete o[k]; return o; };
const opening = (b: Household, k: number): number =>
  netCoinsBtc({
    strikeBtc: b.strikeCollateralBtc, cbBtc: b.cbCollateralBtc, coldBtc: b.openingColdBtc ?? 0,
    strikeBalanceUsd: b.strikeBalance, cbDebtUsd: b.cbDebt, price: k * supportOf(1)[0],
  }) as number;
const SPARE = SP_REPRO.income - SP_REPRO.expenses;

describe('⭐ GOAL OFF — no goal changes nothing (BL14\'s kill criterion)', () => {
  it('⭐ GOAL OFF — absent, null, junk, zero or negative: every row and result field as with no goal; the new fields neutral', () => {
    let compared = 0;
    for (const k of [0.95, 1.5, 2.5, 3.5]) for (const base of [TWO_LOANS, NO_DEBT]) {
      const none = sim(base, k);
      for (const g of [null, Number.NaN, 0, -2, Number.POSITIVE_INFINITY]) {
        const r = sim(base, k, g);
        expect(r.rows, `GOAL OFF k${k} ${String(g)}`).toEqual(none.rows);
        expect(r).toEqual(none);
        for (const row of r.rows) expect([row.netCoinsBtc, row.atGoal, row.goalHeldUsd]).toEqual([null, null, 0]);
        compared += 1;
      }
    }
    expect(compared).toBe(40);
  });

  it('⭐ GOAL OFF — policy-only and cycle-only: with no policy, or another strategy mode, a goal is ignored', () => {
    const price = pathOf(1.5, 12);
    const off = { ...TWO_LOANS, pricePath: price };
    expect(runCyclingSim({ ...off, goalNetBtc: 0.1 })).toEqual(runCyclingSim(off));
    const clear: CyclingInputs = { ...off, mode: 'clearBoth', supportPolicy: policyFor(supportOf(12), V2_DEFAULTS) };
    const clearRun = runCyclingSim(clear);
    // The policy is cycle-only, so another mode turns it off — and the goal with it (the engine's gate checks both).
    expect([clearRun.policyApplied, clearRun.policyIgnoredReason], 'premise: the mode switched the policy off')
      .toEqual([false, expect.stringMatching(/./)]);
    expect(runCyclingSim({ ...clear, goalNetBtc: 0.1 })).toEqual(clearRun);
  });

  it('⭐ GOAL BELOW — a goal the run never reaches: every pre-existing field as with no goal; net coins read, never acted on', () => {
    for (const k of [0.95, 1.5, 2.5, 3.5]) for (const base of [TWO_LOANS, NO_DEBT]) {
      const none = sim(base, k);
      const far = sim(base, k, 1_000);
      expect(far.rows.map(bare), `BELOW k${k}`).toEqual(none.rows.map(bare));
      // The run reports the goal it applied (v2 — the verdict's tie reads it); every other result field as with none.
      expect(far.goalNetBtc, 'BELOW the applied goal').toBe(1_000);
      expect({ ...far, rows: null, last: null, goalNetBtc: null }).toEqual({ ...none, rows: null, last: null });
      for (const row of far.rows) {
        expect(row.atGoal, 'BELOW never at it').toBe(false);
        expect(row.netCoinsBtc, 'BELOW the figure is read').not.toBeNull();
        expect(row.goalHeldUsd).toBe(0);
      }
    }
  });
});

describe('⭐ GOAL STOP — at the goal the plan borrows, buys and refinances nothing', () => {
  it('⭐ GOAL STOP — in accumulate (1.5×): month 1 draws, buys and refinances without a goal; at the goal it repays instead', () => {
    const none = sim(TWO_LOANS, 1.5);
    const r = sim(TWO_LOANS, 1.5, opening(TWO_LOANS, 1.5) * 0.5);   // well under today's net coins
    const [n1, g1] = [none.rows[1], r.rows[1]];
    expect(n1.policyZone, 'STOP premise: an accumulate month').toBe('accumulate');
    expect([shownUsd(n1.strikeDrawn), shownUsd(n1.btcBoughtUsd), shownUsd(n1.refinancedUsd)], 'STOP premise: without a goal it acts')
      .toEqual([true, true, true]);
    expect(g1.atGoal, 'STOP at the goal').toBe(true);
    expect(g1.policyZone, 'STOP the zone is still the price\'s').toBe('accumulate');
    expect([g1.strikeDrawn, g1.btcBoughtUsd, g1.refinancedUsd], 'STOP nothing borrowed, bought or refinanced').toEqual([0, 0, 0]);
    expect(g1.restoreUsd, 'STOP premise: no restore').toBe(0);
    expect(g1.strikeRepaidUsd, 'STOP all the spare income repays Strike (13%) first').toBeCloseTo(SPARE, 9);
    expect(g1.cbRepaidUsd).toBe(0);
    expect(g1.goalHeldUsd).toBe(0);
  });

  it('⭐ GOAL STOP — in hold (2.6×): without a goal it buys and refinances; at the goal neither', () => {
    const none = sim(TWO_LOANS, 2.6);
    const r = sim(TWO_LOANS, 2.6, opening(TWO_LOANS, 2.6) * 0.5);
    expect(none.rows[1].policyZone, 'STOP premise: a hold month').toBe('hold');
    expect([shownUsd(none.rows[1].btcBoughtUsd), shownUsd(none.rows[1].refinancedUsd)], 'STOP premise').toEqual([true, true]);
    for (const row of r.rows.slice(1)) {
      expect(row.atGoal).toBe(true);
      expect([row.strikeDrawn, row.btcBoughtUsd, row.refinancedUsd], `STOP hold m${row.m}`).toEqual([0, 0, 0]);
    }
    expect(r.totalRefinancedUsd).toBe(0);
    expect(r.totalCbFees, 'STOP no refinance fee').toBe(0);
  });

  it('⭐ GOAL ORDER — at the goal, Strike first, then Coinbase, to zero — over every goal month of a sweep', () => {
    let goalMonths = 0, cbPaid = 0, cleared = 0;
    for (const k of [0.95, 1.5, 2.6, 3.5]) for (const f of [0.3, 0.6, 0.9]) {
      const r = sim(TWO_LOANS, k, opening(TWO_LOANS, k) * f, 36);
      for (const row of r.rows) {
        if (row.m === 0 || row.atGoal !== true) continue;
        goalMonths += 1;
        expect([row.strikeDrawn, row.btcBoughtUsd, row.refinancedUsd], `ORDER m${row.m} k${k}`).toEqual([0, 0, 0]);
        if (row.restoreUsd === 0 && shownUsd(row.cbRepaidUsd)) {
          cbPaid += 1;
          expect(row.strikeBalance, `ORDER Strike is repaid before Coinbase sees a dollar (m${row.m} k${k})`).toBe(0);
        }
        if (row.strikeBalance === 0 && row.cbDebt === 0) cleared += 1;
      }
    }
    expect(goalMonths, 'ORDER the sweep reaches goal months').toBeGreaterThan(300);
    expect(cbPaid, 'ORDER and Coinbase repayments among them').toBeGreaterThan(20);
    expect(cleared, 'ORDER and months with both loans repaid, to zero').toBeGreaterThan(20);
  });

  it('⭐ GOAL HOLD — nothing owed at the goal: the plan holds — spare income stays with the owner, no coin is bought', () => {
    const r = sim(NO_DEBT, 2.6, opening(NO_DEBT, 2.6) * 0.9);
    const none = sim(NO_DEBT, 2.6);
    for (const row of r.rows.slice(1)) {
      expect(row.atGoal, `HOLD m${row.m}`).toBe(true);
      expect(row.btcBoughtUsd, 'HOLD buys nothing').toBe(0);
      expect(row.goalHeldUsd, 'HOLD the spare income is kept').toBeCloseTo(SPARE, 9);
      expect(row.btcHeld, 'HOLD the coins stay as they were').toBeCloseTo(r.rows[0].btcHeld, 12);
    }
    expect(none.last.btcHeld, 'HOLD premise: without a goal it buys').toBeGreaterThan(r.last.btcHeld + 0.01);
  });

  it('⭐ GOAL NET — the month\'s figure: its coins less its debt, Coinbase\'s interest included, at its price', () => {
    const r = sim(TWO_LOANS, 2.6, 0.1);
    const price = pathOf(2.6, 12);
    const cmr = SP_REPRO.cbAprPct / 100 / 12;
    expect(r.rows[0].netCoinsBtc, 'NET month 0: the opening').toBeCloseTo(opening(TWO_LOANS, 2.6), 12);
    const want = 4.5 - (TWO_LOANS.strikeBalance + TWO_LOANS.cbDebt * (1 + cmr)) / price[1];
    expect(r.rows[1].netCoinsBtc, 'NET month 1: after a month of Coinbase interest, before Strike\'s').toBeCloseTo(want, 12);
  });
});

describe('⭐ GOAL REENTRY — below the goal again, the month acts on its zone (no latch, D14)', () => {
  it('⭐ GOAL REENTRY — a drop that takes net coins under the goal resumes drawing, buying and refinancing that month', () => {
    // Three months in hold at 2.6×, then a fall to 1.6× — accumulate. The goal sits between the two figures.
    const k = (m: number): number => (m <= 3 ? 2.6 : 1.6);
    const pre = sim(TWO_LOANS, k, 0.001);
    const [high, low] = [pre.rows[1].netCoinsBtc as number, pre.rows[4].netCoinsBtc as number];
    expect(high, 'REENTRY premise: the fall takes net coins down').toBeGreaterThan(low);
    const r = sim(TWO_LOANS, k, (high + low) / 2);
    expect(r.rows.slice(1, 4).every((x) => x.atGoal === true), 'REENTRY at the goal before the fall').toBe(true);
    expect(r.rows.slice(1, 4).every((x) => x.btcBoughtUsd === 0 && shownUsd(x.strikeRepaidUsd)), 'REENTRY repaying').toBe(true);
    const fall = r.rows[4];
    expect(fall.atGoal, 'REENTRY below it after').toBe(false);
    expect(fall.policyZone, 'REENTRY premise: an accumulate month').toBe('accumulate');
    expect([shownUsd(fall.strikeDrawn), shownUsd(fall.btcBoughtUsd), shownUsd(fall.refinancedUsd)], 'REENTRY it acts again')
      .toEqual([true, true, true]);
  });
});

describe('⭐ GOAL ZONE — the goal never moves the zone or the breaker', () => {
  it('⭐ GOAL ZONE — every month\'s zone is the price\'s, goal or not, over the face grids', () => {
    let rows = 0, goalRows = 0;
    for (const cell of [...faceWorldGrid(), ...reachGrid()]) {
      const inputs = { ...cell.off, supportPolicy: policyFor(cell.support) };
      const none = runCyclingSim(inputs);
      expect(none.policyApplied).toBe(true);
      const net0 = none.rows[0].btcHeld - none.rows[0].debt / none.rows[0].price;
      const r = runCyclingSim({ ...inputs, goalNetBtc: Math.max(0.01, net0 * 0.8) });
      expect(r.rows.map((x) => x.policyZone)).toEqual(none.rows.map((x) => x.policyZone));
      expect(r.modelBrokenMonth).toBe(none.modelBrokenMonth);
      rows += r.rows.length;
      goalRows += r.rows.filter((x) => x.m > 0 && x.atGoal === true).length;
    }
    expect(goalRows, 'ZONE the grid reaches goal months').toBeGreaterThan(100);
    expect(rows).toBeGreaterThan(goalRows);
  });
});

describe('⭐ GOAL BASELINE — the never-draw world keeps the same goal, so a run that never acts still IS it', () => {
  it('⭐ GOAL BASELINE — nothing owed, in hold: the run and the baseline stop buying at the same month, coin for coin', () => {
    const none = sim(NO_DEBT, 2.6, undefined, 36);
    expect(none.last.btcHeld, 'BASELINE premise: the run IS the never-draw world').toBeCloseTo(none.baselineBtc, 9);
    const r = sim(NO_DEBT, 2.6, opening(NO_DEBT, 2.6) + 0.05, 36);   // reached within the run
    const first = r.rows.find((x) => x.m > 0 && x.atGoal === true);
    expect(first, 'BASELINE the goal is reached').toBeDefined();
    expect((first as CyclingRow).m, 'BASELINE … not at once').toBeGreaterThan(1);
    expect(r.last.btcHeld, 'BASELINE the run stopped buying').toBeLessThan(none.last.btcHeld - 0.01);
    expect(r.last.btcHeld, 'BASELINE coin for coin').toBeCloseTo(r.baselineBtc, 9);
    expect(r.last.equity, 'BASELINE equity for equity').toBeCloseTo(r.baselineEquity, 4);
  });

  it('⭐ GOAL BASELINE — the read point: under support the run never acts, so a goal crossed mid-run keeps it the never-draw world', () => {
    // Just under support (0.95×, paused — never broken) a run with Strike debt and no Coinbase loan only buys with its spare
    // income, as the never-draw world does. The goal sits between a month's figure before Strike's interest and after it:
    // read where the run reads it (after Coinbase's interest, BEFORE Strike's), both reach it that month.
    const base: Household = { ...TWO_LOANS, cbDebt: 0 };
    const none = sim(base, 0.95, undefined, 36);
    expect(none.last.btcHeld, 'BASELINE premise: the run IS the never-draw world').toBeCloseTo(none.baselineBtc, 9);
    const reads = sim(base, 0.95, 1e9, 36);   // never reached: the figures, read and never acted on
    const m = 12;
    const before = reads.rows[m].netCoinsBtc as number;
    const strikeInterestBtc = reads.rows[m - 1].strikeBalance * (SP_REPRO.strikeAprPct / 100 / 12) / reads.rows[m].price;
    const goal = before - strikeInterestBtc / 2;
    expect((reads.rows[m - 1].netCoinsBtc as number) < goal, 'BASELINE premise: first reached at month 12').toBe(true);
    const r = sim(base, 0.95, goal, 36);
    expect(r.rows.find((x) => x.m > 0 && x.atGoal === true)?.m, 'BASELINE the run reaches it at month 12').toBe(m);
    expect(r.last.btcHeld, 'BASELINE coin for coin').toBeCloseTo(r.baselineBtc, 9);
    expect(r.last.equity, 'BASELINE equity for equity').toBeCloseTo(r.baselineEquity, 4);
  });

  it('⭐ GOAL BASELINE — two loans, at the goal from month 1: the run only repays, so it IS the never-draw world, debt for debt', () => {
    let checked = 0;
    for (const k of [1.5, 2.6, 3.5]) {
      const none = sim(TWO_LOANS, k, undefined, 36);
      expect(Math.abs(none.last.equity - none.baselineEquity), `BASELINE premise k${k}: without a goal the run acts`).toBeGreaterThan(1);
      const r = sim(TWO_LOANS, k, opening(TWO_LOANS, k) * 0.5, 36);
      expect(r.rows.slice(1).every((x) => x.atGoal === true), `BASELINE k${k} always at it`).toBe(true);
      expect(r.last.btcHeld, `BASELINE k${k} coin for coin`).toBeCloseTo(r.baselineBtc, 9);
      expect(r.last.equity, `BASELINE k${k} equity for equity`).toBeCloseTo(r.baselineEquity, 4);
      checked += 1;
    }
    expect(checked).toBe(3);
  });
});

// ── v2 (the build 2 plan review, spec v0.6): the kept spare income and the tie ───────────────────────────────────────

/** The never-draw world, replayed from its rule (a test oracle): Coinbase's interest, the goal read there, Strike's
 *  interest, then — at the goal — the surplus repays Strike, then Coinbase, and what is left is KEPT; else it buys. */
function replayBaseline(b: Household, prices: number[], goal: number): { kept: number; btc: number } {
  const cmr = b.cbAprPct / 100 / 12, smr = b.strikeAprPct / 100 / 12;
  let cb = b.cbDebt, sk = b.strikeBalance, kept = 0;
  let btc = b.strikeCollateralBtc + b.cbCollateralBtc + (b.openingColdBtc ?? 0);
  const surplus = Math.max(0, b.income - b.expenses);
  for (let m = 1; m < prices.length; m++) {
    cb *= 1 + cmr;
    const at = atGoalOf(netCoinsBtc({ strikeBtc: btc, cbBtc: 0, coldBtc: 0, strikeBalanceUsd: sk, cbDebtUsd: cb, price: prices[m] }), goal);
    sk *= 1 + smr;
    let buy = surplus;
    if (at) {
      const a = allocatePayDown(buy, sk, cb);
      sk -= a.toStrikeUsd; cb -= a.toCbUsd;
      if (sk < 0.005) sk = 0;
      if (cb < 0.005) cb = 0;
      kept += a.leftUsd;
      buy = 0;
    }
    btc += buy / prices[m];
  }
  return { kept, btc };
}
const rawAllIn = (r: CyclingResult): number => r.last.equity - (r.totalUnfundedUsd + r.totalCashToBillsUsd + r.totalCashToCureUsd);

describe('⭐ GOAL KEPT — the spare income kept at the goal counts in all-in equity, on BOTH sides (δ-L8)', () => {
  it('⭐ GOAL KEPT — the totals: the run\'s is Σ goalHeldUsd; the never-draw world\'s, its leftover after its pay-down', () => {
    let runKept = 0, baseKept = 0, cases = 0;
    for (const b of [TWO_LOANS, NO_DEBT]) for (const k of [1.2, 1.5, 2.6]) for (const f of [0.5, 1.02, 1.05, 1.1]) {
      const goal = opening(b, k) * f;
      const r = sim(b, k, goal, 60);
      expect(r.totalGoalHeldUsd, `KEPT run k${k} f${f}`).toBeCloseTo(r.rows.reduce((a, x) => a + x.goalHeldUsd, 0), 6);
      const rep = replayBaseline(b, pathOf(k, 60), goal);
      expect(rep.btc, `KEPT the replay IS the engine's baseline k${k} f${f}`).toBeCloseTo(r.baselineBtc, 9);
      expect(r.baselineGoalHeldUsd, `KEPT baseline k${k} f${f}`).toBeCloseTo(rep.kept, 6);
      if (shownUsd(r.totalGoalHeldUsd)) runKept += 1;
      if (shownUsd(r.baselineGoalHeldUsd)) baseKept += 1;
      cases += 1;
    }
    expect(cases).toBe(24);
    expect([runKept, baseKept], 'KEPT non-vacuous on both sides').toEqual([expect.any(Number), expect.any(Number)]);
    expect(Math.min(runKept, baseKept), 'KEPT both sides keep spare income somewhere in the sweep').toBeGreaterThan(5);
  });

  it('⭐ GOAL KEPT — all-in equity adds each side\'s own; with no goal both totals are 0 and all-in equity is bit-identical', () => {
    const r = sim(TWO_LOANS, 2.6, opening(TWO_LOANS, 2.6) * 1.02, 60);
    expect(allInEquity(r)).toBe(rawAllIn(r) + r.totalGoalHeldUsd);
    expect(baselineAllInEquity(r)).toBe(r.baselineEquity - r.baselineUnfundedUsd + r.baselineGoalHeldUsd);
    for (const k of [0.95, 1.5, 2.6, 3.5]) for (const b of [TWO_LOANS, NO_DEBT]) for (const g of [undefined, null, Number.NaN]) {
      const none = sim(b, k, g, 36);
      expect([none.totalGoalHeldUsd, none.baselineGoalHeldUsd, none.goalNetBtc], `KEPT none k${k}`).toEqual([0, 0, null]);
      expect(Object.is(allInEquity(none), rawAllIn(none)), 'KEPT none: bit for bit').toBe(true);
      expect(Object.is(baselineAllInEquity(none), none.baselineEquity - none.baselineUnfundedUsd)).toBe(true);
    }
  });

  it('⭐ GOAL KEPT — a run that clears its loans for less keeps more: counted, the verdict is the interest it saved, not a tie', () => {
    // Hold at 2.6×: month 1 moves Strike's $20,000 to Coinbase (6.27% against 13%, a 2% fee); at the goal from month 7 both
    // worlds repay and stop buying — they end coin for coin, equity for equity, and the run has kept $1,058 more.
    const r = sim(TWO_LOANS, 2.6, opening(TWO_LOANS, 2.6) * 1.02, 60);
    expect(r.rows.find((x) => x.m > 0 && x.atGoal === true)?.m, 'KEPT premise: reached at month 7').toBe(7);
    expect(r.totalRefinancedUsd, 'KEPT premise: the run moved Strike debt to cheaper Coinbase debt').toBeGreaterThan(20_000);
    expect(r.last.btcHeld, 'KEPT premise: coin for coin').toBeCloseTo(r.baselineBtc, 9);
    expect(Math.abs(rawAllIn(r) - (r.baselineEquity - r.baselineUnfundedUsd)), 'KEPT premise: uncounted, a tie').toBeLessThan(DUST_USD);
    const gap = r.totalGoalHeldUsd - r.baselineGoalHeldUsd;
    expect(gap, 'KEPT the interest it saved').toBeGreaterThan(1_000);
    expect(allInEquity(r) - baselineAllInEquity(r)).toBeCloseTo(gap, 6);
    expect([neverDrawTie(r), beatsNeverDraw(r)], 'KEPT a real win').toEqual([false, true]);
  });
});

describe('⭐ GOAL TIE — with a goal, a gap under the dust floor is a tie, never a win by rounding (δ-L6)', () => {
  it('⭐ GOAL TIE — at the goal from month 1 the run IS the never-draw world: a tie, never a beat', () => {
    let ties = 0, residue = 0;
    for (const b of [TWO_LOANS, NO_DEBT, { ...TWO_LOANS, cbDebt: 0 }, { ...TWO_LOANS, strikeBalance: 0 }]) {
      for (const k of [1.5, 2.6, 3.5]) {
        const r = sim(b, k, opening(b, k) * 0.5, 36);
        expect(r.rows.slice(1).every((x) => x.atGoal === true), `TIE premise k${k}: always at the goal`).toBe(true);
        const d = allInEquity(r) - baselineAllInEquity(r);
        expect(Math.abs(d), `TIE k${k}`).toBeLessThan(DUST_USD);
        if (d !== 0) residue += 1;
        expect([neverDrawTie(r), beatsNeverDraw(r)], `TIE k${k}`).toEqual([true, false]);
        ties += 1;
      }
    }
    expect(ties).toBe(12);
    expect(residue, 'TIE premise: float residue on some — the bare comparison would call them').toBeGreaterThan(0);
  });

  it('⭐ GOAL TIE — the minimum paid from income: at the goal still the never-draw world, still a tie (the missed path)', () => {
    let paid = 0;
    for (const k of [1.5, 2.6, 3.5]) {
      const b: Household = { ...TWO_LOANS, strikeMinFromIncome: true };
      const r = sim(b, k, opening(b, k) * 0.5, 36);
      paid += r.rows.filter((x) => shownUsd(x.strikeMinPaidUsd)).length;
      expect(r.last.btcHeld, `MIN k${k} coin for coin`).toBeCloseTo(r.baselineBtc, 9);
      expect(r.last.equity, `MIN k${k} equity for equity`).toBeCloseTo(r.baselineEquity, 4);
      expect(neverDrawTie(r), `MIN k${k}`).toBe(true);
    }
    expect(paid, 'MIN premise: income pays the minimum').toBeGreaterThan(0);
  });

  it('⭐ GOAL TIE — never without a goal: a run that never acts keeps the bare comparison (BL14\'s kill criterion)', () => {
    let runs = 0, headTies = 0;
    const check = (r: CyclingResult): void => {
      expect(neverDrawTie(r)).toBe(false);
      expect(beatsNeverDraw(r)).toBe(allInEquity(r) > baselineAllInEquity(r));
      if (Math.abs(allInEquity(r) - baselineAllInEquity(r)) < DUST_USD) headTies += 1;
      runs += 1;
    };
    for (const c of a5Cases()) { check(runCyclingSim(c.on)); check(runCyclingSim(c.off)); }
    // Under support with no Coinbase loan, the policy never borrows, so the run IS the never-draw world — HEAD's own tie,
    // its sign float residue (both signs occur).
    let pos = 0, neg = 0;
    for (const h of [{ cbDebt: 0, cbCollateralBtc: 0 }, { cbDebt: 0, cbCollateralBtc: 0, strikeCollateralBtc: 2 }]) {
      for (const months of [12, 60]) for (const k of [0.5, 0.7, 0.9]) {
        const sup = supportPathFor(SP_START, months);
        const r = runCyclingSim({ ...SP_REPRO, ...h, supportPolicy: policyFor(sup), pricePath: sup.map((x) => k * x) });
        check(r);
        const d = allInEquity(r) - baselineAllInEquity(r);
        if (d > 0) pos += 1;
        if (d < 0) neg += 1;
      }
    }
    expect(runs).toBeGreaterThan(20);
    expect(headTies, 'TIE premise: the sweep reaches the no-goal tie').toBeGreaterThan(10);
    expect(Math.min(pos, neg), 'TIE premise: residue of both signs').toBeGreaterThan(0);
  });

  it('⭐ GOAL TIE — the floor is the faces\' dust floor; a gap at it is real; only a goal makes a tie', () => {
    expect(NEVER_DRAW_TIE_USD).toBe(DUST_USD);
    const at = (d: number, goalNetBtc: number | null) => ({
      last: { equity: 100_000 + d } as CyclingRow, totalUnfundedUsd: 0, totalCashToBillsUsd: 0, totalCashToCureUsd: 0,
      baselineEquity: 100_000, baselineUnfundedUsd: 0, goalNetBtc,
    });
    expect([0.49, -0.49, 0, 1e-9].map((d) => neverDrawTie(at(d, 1)))).toEqual([true, true, true, true]);
    expect([0.5, -0.5, 3].map((d) => neverDrawTie(at(d, 1)))).toEqual([false, false, false]);
    expect([0.49, 1e-9].map((d) => neverDrawTie(at(d, null)))).toEqual([false, false]);
    expect([beatsNeverDraw(at(0.49, 1)), beatsNeverDraw(at(0.5, 1)), beatsNeverDraw(at(1e-9, null))]).toEqual([false, true, true]);
  });

  it('⭐ GOAL TIE — the futures count ties apart, never as beats; with no goal there are none', () => {
    const months = 36;
    const sup = supportPathFor(SP_START, months);
    const paths = [1.5, 2.6, 3.5].flatMap((k) => [sup.map((x) => k * x), sup.map((x, m) => k * x * (1 + 0.1 * Math.sin(m / 3)))]);
    const goal = opening(TWO_LOANS, 1.5) * 0.3;
    const inputs = { ...TWO_LOANS, supportPolicy: policyFor(sup, V2_DEFAULTS), goalNetBtc: goal };
    const s = runFutures(inputs, paths, '2026-10-20');
    for (const p of paths) {
      const o = futureOutcome(inputs, p);
      expect([o.tiesNeverDraw, o.beatsNeverDraw], 'FUTURES at the goal from month 1').toEqual([true, false]);
    }
    expect([s.tiesNeverDraw, s.beatsNeverDraw]).toEqual([paths.length, 0]);
    const s0 = runFutures({ ...inputs, goalNetBtc: null }, paths, '2026-10-20');
    expect(s0.tiesNeverDraw, 'FUTURES no goal: no ties').toBe(0);
    expect(s0.beatsNeverDraw, 'FUTURES premise: without the goal they act, and beat').toBeGreaterThan(0);
  });
});

describe('⭐ GOAL DEFENSE — the crash defense still runs at the goal (the missed path; δ-L2)', () => {
  it('⭐ GOAL DEFENSE — a goal month over Coinbase\'s defense line shifts debt to Strike, buys nothing, draws nothing for bills', () => {
    // Coinbase $72,000 on 1 ₿ at $100,000; Strike owes nothing; a low goal — at it from month 1.
    const sup = supportPathFor(SP_START, 12);
    const b: Household = { ...SP_REPRO, strikeCollateralBtc: 1, strikeBalance: 0, strikeCreditLine: 40_000, cbCollateralBtc: 1, cbDebt: 72_000 };
    const pricePath = sup.map(() => 100_000);
    const r = runCyclingSim({ ...b, supportPolicy: policyFor(sup, V2_DEFAULTS), pricePath, goalNetBtc: 0.2 });
    const none = runCyclingSim({ ...b, supportPolicy: policyFor(sup, V2_DEFAULTS), pricePath });
    expect(r.policyApplied).toBe(true);
    const m1 = r.rows[1];
    expect(m1.atGoal, 'DEFENSE at the goal').toBe(true);
    expect(shownUsd(m1.defenseDrawnUsd), 'DEFENSE the shift still runs').toBe(true);
    expect(m1.defenseDrawnUsd, 'DEFENSE the same shift as without a goal').toBeCloseTo(none.rows[1].defenseDrawnUsd, 6);
    expect([m1.strikeDrawn, m1.btcBoughtUsd, m1.refinancedUsd], 'DEFENSE nothing else borrowed or bought').toEqual([0, 0, 0]);
  });
});
