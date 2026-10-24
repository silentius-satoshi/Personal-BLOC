import { describe, it, expect } from 'vitest';
import { runCyclingSim, type CyclingInputs, type CyclingResult } from '../cyclingSim';
import { placementPlan, type PlacementInput } from '../placement';
import { goalOf, goalStandsDown, atGoalOf } from '../goal';
import { strikeKeepCollateralBtc, cbKeepCollateralBtc } from '../supportPolicy';
import { SP_REPRO, SP_START, supportPathFor, policyFor, V2_DEFAULTS } from './supportPolicyPaths';

/**
 * BL32 (G3-B) — THE STAND-DOWN (Batch 1, build 2b; spec pbloc-spec-batch-1-v1 §2.2b). At the goal with both loans repaid
 * the plan keeps nothing on Strike or Coinbase: both keeps are zero, in any zone — paused, broken or past a seizure — and
 * every coin goes to cold, Strike's straight there. THE MOVE and the engine read ONE rule (`goalStandsDown`) through the
 * SAME two keep functions. Strike's 60-day hold and its release rules still stand. No goal, or a loan still open: nothing
 * moves (the identity sweep against the build-2 engine, 3569b8d, is in the spec). ⚠ SYNTHETIC round figures — this repo
 * is public.
 *
 * ⚠ Every engine run here asserts `policyApplied` first: off, the goal is off too, and a test passes through the wrong
 * branch.
 */

type Household = Omit<CyclingInputs, 'pricePath' | 'supportPolicy'>;
/** Nothing owed: a line, two venues and cold — the household that stands down at its goal. */
const DEBT_FREE: Household = {
  ...SP_REPRO, strikeCollateralBtc: 2, strikeBalance: 0, strikeCreditLine: 40_000,
  cbCollateralBtc: 1.5, cbDebt: 0, openingColdBtc: 0.5,
};
const COINS = 4;   // 2 + 1.5 + 0.5
const supportOf = (months: number): number[] => supportPathFor(SP_START, months);
const pathOf = (k: number | ((m: number) => number), months: number): number[] =>
  supportOf(months).map((s, m) => (typeof k === 'number' ? k : k(m)) * s);

function sim(b: Household, k: number | ((m: number) => number), extra: Partial<CyclingInputs> = {}, months = 12): CyclingResult {
  const r = runCyclingSim({ ...b, supportPolicy: policyFor(supportOf(months), V2_DEFAULTS), pricePath: pathOf(k, months), ...extra });
  expect(r.policyApplied, 'premise: the policy (and so the goal) is applied').toBe(true);
  return r;
}
const BROKEN = { broken: true, monthsBelow: 0, monthsAtOrAbove: 2, brokenMonth: null } as const;

// ── the rule ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ STAND RULE — at the goal with both loans repaid, exactly', () => {
  it('⭐ STAND RULE — goalStandsDown: at the goal and both balances exactly zero; any other balance is a loan still open', () => {
    expect(goalStandsDown(true, 0, 0)).toBe(true);
    expect(goalStandsDown(false, 0, 0), 'RULE below the goal').toBe(false);
    for (const owed of [0.004, 1e-9, 0.5, 20_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(goalStandsDown(true, owed, 0), `RULE Strike owes ${owed}`).toBe(false);
      expect(goalStandsDown(true, 0, owed), `RULE Coinbase owes ${owed}`).toBe(false);
    }
  });

  it('⭐ STAND RULE — goalOf: a finite number above zero is a goal; anything else is none (the engine\'s and THE MOVE\'s one read)', () => {
    expect([goalOf(1), goalOf(0.25), goalOf(1e-8)]).toEqual([1, 0.25, 1e-8]);
    for (const junk of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1', {}]) {
      expect(goalOf(junk), `RULE ${String(junk)}`).toBeNull();
    }
  });

  it('⭐ STAND KEEPS — told to stand down, both keeps are zero; junk still keeps everything; absent, the keep as before', () => {
    expect(strikeKeepCollateralBtc(40_000, 0, 0.5, 60_000, true)).toBe(0);
    expect(cbKeepCollateralBtc(0, 72_000, 60_000, 0.45, 0.7, 90_000, true)).toBe(0);
    expect(strikeKeepCollateralBtc(40_000, 0, 0.5, 60_000)).toBeCloseTo(40_000 / (0.5 * 60_000), 12);
    expect(strikeKeepCollateralBtc(40_000, 0, 0.5, 60_000, false)).toBe(strikeKeepCollateralBtc(40_000, 0, 0.5, 60_000));
    expect(cbKeepCollateralBtc(0, 72_000, 60_000, 0.45, 0.7, 90_000)).toBeCloseTo(72_000 / (60_000 * 0.45), 12);
    for (const support of [0, -1, Number.NaN]) {
      expect(strikeKeepCollateralBtc(40_000, 0, 0.5, support, true), `KEEPS junk support ${support}`).toBe(Number.POSITIVE_INFINITY);
      expect(cbKeepCollateralBtc(0, 72_000, support, 0.45, 0.7, 90_000, true), `KEEPS junk support ${support}`)
        .toBe(Number.POSITIVE_INFINITY);
    }
    expect(cbKeepCollateralBtc(0, 72_000, 60_000, 0.45, 0.7, 0, true), 'KEEPS junk price').toBe(Number.POSITIVE_INFINITY);
  });
});

// ── THE MOVE ──────────────────────────────────────────────────────────────────────────────────────────────────────

const PLACE: PlacementInput = {
  creditLine: 40_000, strikeBalance: 0, strikeCollateralBtc: 2, cbDebt: 0, cbCollateralBtc: 1.5, coldBtc: 0.5,
  price: 100_000, support: 100_000 / 1.4, skStop: 0.5, cbStop: 0.45, cbDefenseLtv: 0.7, bufferUsd: 72_000,
  accumulateBelow: 2, payDownAbove: 3, inHold: false, broken: false,
};
const plan = (o: Partial<PlacementInput> = {}) => placementPlan({ ...PLACE, ...o });

describe('⭐ STAND MOVE — THE MOVE at the stand-down: every coin to cold, in any zone', () => {
  it('⭐ STAND MOVE — debt-free at the goal: both keeps zero, Strike straight to cold, Coinbase emptied, the coins conserved', () => {
    const none = plan();
    expect([none.standDown, none.after.strikeCollateralBtc > 0, none.after.cbCollateralBtc > 0], 'MOVE premise: no goal keeps both')
      .toEqual([false, true, true]);
    const p = plan({ goalNetBtc: COINS });   // exactly at it
    expect([p.state, p.standDown, p.strikeKeepBtc, p.cbKeepBtc, p.strikeLeg]).toEqual(['ready', true, 0, 0, 'moves']);
    expect([p.strikeToCbBtc, p.strikeToColdBtc, p.cbToColdBtc]).toEqual([0, 2, 1.5]);
    expect(p.after).toEqual({ strikeCollateralBtc: 0, cbCollateralBtc: 0, coldBtc: COINS });
    expect([p.worthMoving, p.seeded, p.opening]).toEqual([true, true, p.after]);
    expect([p.strikeShortBtc, p.cbOverCeilingUsd], 'MOVE nothing short, nothing over').toEqual([0, 0]);
  });

  it('⭐ STAND MOVE — the pause and the breaker hold nothing back at the stand-down; without it they do', () => {
    for (const [name, o] of [['paused', { support: 100_000 / 0.8 }], ['broken', { broken: true }],
      ['broken and paused', { broken: true, support: 100_000 / 0.8 }]] as const) {
      const without = plan(o);
      expect(without.state, `MOVE premise: ${name} without a goal`).toBe(name === 'paused' ? 'paused' : 'broken');
      expect(without.after, `MOVE premise: ${name} moves nothing`).toEqual({ strikeCollateralBtc: 2, cbCollateralBtc: 1.5, coldBtc: 0.5 });
      const p = plan({ ...o, goalNetBtc: 3 });
      expect([p.state, p.standDown], `MOVE ${name}`).toEqual(['ready', true]);
      expect(p.after, `MOVE ${name}`).toEqual({ strikeCollateralBtc: 0, cbCollateralBtc: 0, coldBtc: COINS });
    }
  });

  it('⭐ STAND HOLD — inside Strike\'s 60-day hold its coins stay; Coinbase\'s still go', () => {
    const p = plan({ goalNetBtc: 3, inHold: true });
    expect([p.standDown, p.strikeLeg, p.strikeToColdBtc, p.cbToColdBtc]).toEqual([true, 'hold', 0, 1.5]);
    expect(p.after).toEqual({ strikeCollateralBtc: 2, cbCollateralBtc: 0, coldBtc: 2 });
  });

  it('⭐ STAND OPEN — a loan still open, a goal above the coins, or no goal: THE MOVE is exactly as without a goal', () => {
    const cases: Partial<PlacementInput>[] = [
      { strikeBalance: 0.01 }, { cbDebt: 0.01 }, { strikeBalance: 5_000 }, { cbDebt: 30_000 },
      { strikeBalance: 5_000, cbDebt: 30_000 }, { support: 100_000 / 0.8, cbDebt: 30_000 }, { broken: true, strikeBalance: 1 },
    ];
    let compared = 0;
    for (const o of cases) {
      const none = plan(o);
      for (const goalNetBtc of [null, Number.NaN, 0, -1, 0.5, 3, COINS - 0.01, 1e9]) {
        const p = plan({ ...o, goalNetBtc });
        expect(p, `OPEN ${JSON.stringify(o)} goal ${goalNetBtc}`).toEqual(none);
        expect(p.standDown).toBe(false);
        compared += 1;
      }
    }
    // Debt-free, but the goal is above the coins, or no goal at all (junk reads as none — the engine's own `goalOf`).
    for (const goalNetBtc of [COINS * 1.01, null, Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(plan({ goalNetBtc }), `OPEN debt-free, goal ${goalNetBtc}`).toEqual(plan());
    }
    expect(compared).toBe(56);
  });

  it('⭐ STAND MOVE — already all in cold: nothing to move, and nothing worth moving when only dust is left', () => {
    const cold = plan({ strikeCollateralBtc: 0, cbCollateralBtc: 0, coldBtc: COINS, goalNetBtc: 3 });
    expect([cold.standDown, cold.strikeLeg, cold.worthMoving, cold.after.coldBtc]).toEqual([true, 'nothing', false, COINS]);
    const dust = plan({ strikeCollateralBtc: 0, cbCollateralBtc: 0.004, coldBtc: 3.996, goalNetBtc: 3 });
    expect([dust.standDown, dust.cbToColdBtc, dust.worthMoving, dust.seeded]).toEqual([true, 0.004, false, false]);
    expect(dust.opening, 'MOVE under the threshold the coins stay until next month').toEqual(
      { strikeCollateralBtc: 0, cbCollateralBtc: 0.004, coldBtc: 3.996 });
  });
});

// ── the engine ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ STAND ENGINE — the engine stands down where THE MOVE does', () => {
  it('⭐ STAND ENGINE — debt-free at the goal: month 1 releases Strike straight to cold and sweeps Coinbase; then nothing moves', () => {
    const none = sim(DEBT_FREE, 1.4);
    expect([none.rows[1].goalStandDown, none.rows[1].cbCollateralBtc > 1, none.rows[1].strikeCollateralBtc > 0],
      'ENGINE premise: without a goal both venues keep coins').toEqual([false, true, true]);
    const r = sim(DEBT_FREE, 1.4, { goalNetBtc: 3 });
    const m1 = r.rows[1];
    expect([m1.policyZone, m1.atGoal, m1.goalStandDown]).toEqual(['accumulate', true, true]);
    expect([m1.strikeToCbBtc, m1.strikeToColdBtc, m1.sweptToColdBtc, m1.strikeKeepBtc]).toEqual([0, 2, 1.5, 0]);
    expect([m1.strikeCollateralBtc, m1.cbCollateralBtc]).toEqual([0, 0]);
    expect(m1.coldBtc).toBeCloseTo(COINS, 12);
    expect(r.rows[0].goalStandDown, 'ENGINE month 0 is the opening: it places nothing').toBe(false);
    for (const row of r.rows.slice(2)) {
      expect(row.goalStandDown, `ENGINE absorbing m${row.m}`).toBe(true);
      expect([row.strikeToColdBtc, row.sweptToColdBtc, row.strikeToCbBtc], `ENGINE nothing left to move m${row.m}`).toEqual([0, 0, 0]);
    }
    expect(r.firstColdMonth).toBe(1);
    expect([r.last.coldFromStrike, r.last.coldFromCb]).toEqual([2, 1.5]);
    // Nothing on Coinbase: Strike's coins are the first to reach cold, and the month says so.
    const sk = sim({ ...DEBT_FREE, cbCollateralBtc: 0, openingColdBtc: 0 }, 1.4, { goalNetBtc: 1 });
    expect([sk.firstColdMonth, sk.rows[1].strikeToColdBtc, sk.rows[1].sweptToColdBtc, sk.last.coldFromStrike]).toEqual([1, 2, 0, 2]);
  });

  it('⭐ STAND ENGINE — below support and broken alike: the stand-down moves the coins the pause and the breaker would hold', () => {
    for (const [name, k, extra] of [
      ['paused', 0.9, {}], ['broken', 1.4, { openingBreaker: BROKEN }], ['broken, paused', 0.9, { openingBreaker: BROKEN }],
    ] as const) {
      const none = sim(DEBT_FREE, k, extra);
      const n1 = none.rows[1];
      expect(n1.policyZone, `ENGINE premise ${name}`).toBe(name === 'paused' ? 'paused' : 'broken');
      expect([n1.strikeCollateralBtc, n1.strikeToCbBtc, n1.sweptToColdBtc, n1.cbCollateralBtc >= 1.5],
        `ENGINE premise: ${name} moves nothing off either venue`).toEqual([2, 0, 0, true]);
      const r = sim(DEBT_FREE, k, { ...extra, goalNetBtc: 3 });
      expect([r.rows[1].goalStandDown, r.rows[1].strikeCollateralBtc, r.rows[1].cbCollateralBtc], `ENGINE ${name}`)
        .toEqual([true, 0, 0]);
    }
  });

  it('⭐ STAND HOLD — Strike\'s hold binds: Coinbase\'s coins go in month 1, Strike\'s only when the hold ends, straight to cold', () => {
    const r = sim(DEBT_FREE, 1.4, { goalNetBtc: 3, openingStrikeHoldMonths: 2 });
    expect([r.rows[1].goalStandDown, r.rows[1].strikeToColdBtc, r.rows[1].sweptToColdBtc, r.rows[1].strikeCollateralBtc])
      .toEqual([true, 0, 1.5, 2]);
    expect([r.rows[2].strikeToColdBtc, r.rows[2].strikeCollateralBtc, r.rows[2].strikeToCbBtc]).toEqual([2, 0, 0]);
  });

  it('⭐ STAND CADENCE — off a monthly cadence (the faces\' what-if): Coinbase\'s coins go at once, Strike\'s on its cadence month', () => {
    // The plan's own screens run monthly (PLAN_CYCLE_MONTHS); the Cycling, Ownership and Strategy faces can model every
    // three months. Step 9 runs every month and step 5 on the cadence — the stand-down changes neither.
    const r = sim(DEBT_FREE, 1.4, { goalNetBtc: 3, cycleMonths: 3 });
    expect([r.rows[1].goalStandDown, r.rows[1].sweptToColdBtc, r.rows[1].strikeToColdBtc, r.rows[1].strikeCollateralBtc],
      'CADENCE month 1 stands down: Coinbase is swept, Strike waits').toEqual([true, 1.5, 0, 2]);
    expect([r.rows[2].strikeToColdBtc, r.rows[2].strikeCollateralBtc], 'CADENCE month 2 is off the cadence').toEqual([0, 2]);
    expect([r.rows[3].strikeToColdBtc, r.rows[3].strikeCollateralBtc, r.rows[3].strikeToCbBtc], 'CADENCE month 3: straight to cold')
      .toEqual([2, 0, 0]);
    expect(r.rows.slice(4).every((x) => x.goalStandDown && x.strikeToColdBtc === 0 && x.sweptToColdBtc === 0)).toBe(true);
    expect(sim(DEBT_FREE, 1.4, { goalNetBtc: 3 }).rows[1].strikeToColdBtc, 'CADENCE monthly: Strike\'s go in month 1').toBe(2);
  });

  it('⭐ STAND SEIZED — after Coinbase seizes, a survivor at the goal with Strike repaid stands down; it placed nothing before', () => {
    const b: Household = { ...DEBT_FREE, strikeCollateralBtc: 1, cbCollateralBtc: 1, cbDebt: 60_000, openingColdBtc: 0.2, strikeCreditLine: 30_000 };
    const crash = (m: number): number => (m < 2 ? 1.6 : 0.45);
    const none = sim(b, crash);
    expect([none.liqMonth, none.seizedOnTheWayDown], 'SEIZED premise: Coinbase seized on the way down in month 2').toEqual([2, true]);
    expect(none.rows[2].strikeCollateralBtc, 'SEIZED premise: without a goal the survivor keeps Strike\'s coins').toBeGreaterThan(0.5);
    const r = sim(b, crash, { goalNetBtc: 1 });
    expect([r.liqMonth, r.rows[1].goalStandDown], 'SEIZED month 1: a loan open, no stand-down').toEqual([2, false]);
    const m2 = r.rows[2];
    expect([m2.policyZone, m2.postLiquidation, m2.cbDebt, m2.strikeBalance, m2.goalStandDown]).toEqual(['paused', true, 0, 0, true]);
    expect([m2.strikeCollateralBtc, m2.cbCollateralBtc]).toEqual([0, 0]);
    expect(m2.coldBtc, 'SEIZED every survivor coin is in cold').toBeCloseTo(m2.btcHeld, 12);
  });

  it('⭐ STAND SEIZED — at the opening: month 0\'s seizure leaves a debt; the goal\'s pay-down repays it, then the survivor stands down', () => {
    // Coinbase opens past 86% (₿0.5 against $54,000): seized after month 0's row, short of the debt, so a deficiency
    // survives (unsecured, at Coinbase's rate). At the goal the spare income repays it; until it is zero nothing moves.
    const b: Household = { ...DEBT_FREE, strikeCollateralBtc: 2, cbCollateralBtc: 0.5, cbDebt: 54_000, openingColdBtc: 1 };
    const none = sim(b, 1.4);
    expect([none.liqMonth, none.seizedOnTheWayDown, none.rows[1].cbDebt > 1_000],
      'SEIZED premise: the opening is seized at month-end and a deficiency survives').toEqual([0, false, true]);
    expect(none.rows.every((x) => x.strikeCollateralBtc === 2), 'SEIZED premise: without a goal Strike\'s coins never move').toBe(true);
    const r = sim(b, 1.4, { goalNetBtc: 2 });
    const first = r.rows.findIndex((x) => x.goalStandDown);
    expect([r.liqMonth, first], 'SEIZED the survivor stands down once the deficiency is repaid').toEqual([0, 4]);
    for (const x of r.rows.slice(1, first)) {
      expect([x.atGoal, x.cbDebt > 0, x.strikeToColdBtc, x.strikeToCbBtc, x.sweptToColdBtc, x.strikeCollateralBtc],
        `SEIZED m${x.m}: at the goal, still owing — nothing moves`).toEqual([true, true, 0, 0, 0, 2]);
    }
    const f = r.rows[first];
    expect([f.cbDebt, f.strikeBalance, f.strikeToColdBtc, f.strikeCollateralBtc, f.cbCollateralBtc]).toEqual([0, 0, 2, 0, 0]);
    expect(f.coldBtc, 'SEIZED every survivor coin is in cold').toBeCloseTo(f.btcHeld, 12);
  });

  it('⭐ STAND OPEN — a month that does not stand down moves no coin straight to cold and keeps as before', () => {
    // Two loans at the goal: the pay-down repays them over the months; until both are zero, nothing new happens.
    const b: Household = { ...DEBT_FREE, strikeBalance: 12_000, cbDebt: 20_000 };
    let open = 0, stood = 0, pendingAtStand = 0;
    for (const k of [0.9, 1.4, 2.6, 3.5]) for (const goal of [0.5, 2, 3]) {
      const r = sim(b, k, { goalNetBtc: goal }, 36);
      const first = r.rows.findIndex((x) => x.goalStandDown);
      // The cold ledger foots through the stand-down, coins still pending from Strike's two-hop migrations included (the
      // sweep attributes them FIFO): cold from Strike is never more than ever left Strike, and once Coinbase is emptied at
      // the stand-down it is all of it.
      const flows = r.rows.reduce((t, x) => t + x.sweptToColdBtc + x.strikeToColdBtc, 0);
      const leftStrike = r.rows.reduce((t, x) => t + x.strikeToColdBtc + x.strikeToCbBtc, 0);
      expect(flows, `OPEN ledger k${k} g${goal}`).toBeCloseTo(r.last.coldFromCb + r.last.coldFromStrike, 9);
      expect(r.openingColdBtc + r.last.coldFromCb + r.last.coldFromStrike - r.last.coldRetrievedBtc).toBeCloseTo(r.last.coldBtc, 9);
      expect(r.last.coldFromStrike, `OPEN cold from Strike ≤ what left Strike k${k} g${goal}`).toBeLessThanOrEqual(leftStrike + 1e-9);
      if (first > 0) {
        expect(r.last.coldFromStrike, `OPEN stood down: every coin that left Strike is cold from Strike k${k} g${goal}`)
          .toBeCloseTo(leftStrike, 9);
        const pending = r.rows.slice(0, first).reduce((t, x) => t + x.strikeToCbBtc, 0) - r.rows[first - 1].coldFromStrike;
        if (pending > 0.01) pendingAtStand += 1;
      }
      for (const row of r.rows) {
        if (row.goalStandDown) { stood += 1; continue; }
        open += 1;
        expect(row.strikeToColdBtc, `OPEN m${row.m}`).toBe(0);
        if (row.strikeKeepBtc !== null) {
          expect(row.strikeKeepBtc, `OPEN keep m${row.m}`).toBeGreaterThan(0);
        }
      }
      if (first > 0) {
        // The first stand-down month is the first whose pay-down left both loans at zero, at the goal.
        const f = r.rows[first];
        expect([f.atGoal, f.strikeBalance, f.cbDebt], `OPEN the first stand-down k${k} g${goal}`).toEqual([true, 0, 0]);
        expect(r.rows[first - 1].strikeBalance + r.rows[first - 1].cbDebt, 'OPEN the month before still owed').toBeGreaterThan(0);
      }
    }
    expect([open > 100, stood > 100], 'OPEN the sweep reaches both').toEqual([true, true]);
    expect(pendingAtStand, 'OPEN a stand-down meets coins still pending from Strike').toBeGreaterThan(0);
  });

  it('⭐ STAND MONEY — the stand-down moves coins between venues only: the coins, equity and net coins as if they had stayed', () => {
    for (const k of [0.9, 1.4, 2.6]) {
      const r = sim(DEBT_FREE, k, { goalNetBtc: 3 }, 24);
      for (const row of r.rows) {
        expect(row.btcHeld, `MONEY coins m${row.m}`).toBeCloseTo(COINS, 12);
        expect(row.equity, `MONEY equity m${row.m}`).toBeCloseTo(COINS * row.price, 6);
        if (row.m > 0) expect(row.netCoinsBtc, `MONEY net coins m${row.m}`).toBeCloseTo(COINS, 12);
      }
    }
  });

  it('⭐ STAND LEDGER — the cold ledger foots with the new flow: Σ (Coinbase → cold + Strike → cold) is the cold from both venues', () => {
    let reached = 0;
    for (const [k, extra] of [[1.4, {}], [0.9, {}], [1.4, { openingStrikeHoldMonths: 2 }]] as const) {
      const r = sim(DEBT_FREE, k, { goalNetBtc: 3, ...extra });
      const flows = r.rows.reduce((s, x) => s + x.sweptToColdBtc + x.strikeToColdBtc, 0);
      expect(flows).toBeCloseTo(r.last.coldFromCb + r.last.coldFromStrike, 12);
      expect(r.openingColdBtc + r.last.coldFromCb + r.last.coldFromStrike - r.last.coldRetrievedBtc).toBeCloseTo(r.last.coldBtc, 12);
      if (r.rows.some((x) => x.strikeToColdBtc > 0)) reached += 1;
    }
    expect(reached).toBe(3);
  });
});

// ── ONE rule: THE MOVE's after IS the engine's month 1 at the stand-down ─────────────────────────────────────────────

describe('⭐ STAND I3 — at the stand-down, month 1 ≡ THE MOVE\'s after, in every state, held or not, any income', () => {
  const rng = (seed: number) => () => { seed = (seed * 1_664_525 + 1_013_904_223) >>> 0; return seed / 4_294_967_296; };
  it('⭐ STAND I3 — 3,000 random debt-free positions at the goal', () => {
    const rand = rng(20_261_020);
    const P = 100_000;
    const states = new Set<string>();
    let held = 0, both = 0;
    for (let i = 0; i < 3_000; i++) {
      const k = [0.7, 0.95, 1, 1.4, 1.75, 2.5][i % 6];
      const broken = rand() < 0.25;
      const inHold = rand() < 0.2;
      const S = P / k;
      const strikeCollateralBtc = rand() < 0.1 ? 0 : rand() * 4;
      const cbCollateralBtc = rand() < 0.1 ? 0 : rand() * 4;
      const coldBtc = rand() * 2;
      const goal = (strikeCollateralBtc + cbCollateralBtc + coldBtc) * (0.2 + rand() * 0.8);
      const income = Math.round(rand() * 9_000);
      const expenses = Math.round(rand() * 6_000);
      const creditLine = 3_500 + Math.round(rand() * 150_000);
      const r = runCyclingSim({
        ...SP_REPRO, income, expenses, strikeBalance: 0, strikeCollateralBtc, cbDebt: 0, cbCollateralBtc,
        openingColdBtc: coldBtc, strikeCreditLine: creditLine, pricePath: [P, P],
        supportPolicy: policyFor([S, S], { openingCashUsd: 0 }), goalNetBtc: goal,
        ...(broken ? { openingBreaker: BROKEN } : {}), ...(inHold ? { openingStrikeHoldMonths: 2 } : {}),
      });
      expect(r.policyApplied).toBe(true);
      const p = placementPlan({
        creditLine, strikeBalance: 0, strikeCollateralBtc, cbDebt: 0, cbCollateralBtc, coldBtc, price: P, support: S,
        skStop: 0.5, cbStop: 0.6, cbDefenseLtv: 0.7, bufferUsd: 12 * expenses, accumulateBelow: 1.5, payDownAbove: 2,
        inHold, broken, goalNetBtc: goal,
      });
      const row = r.rows[1];
      expect([p.standDown, row.goalStandDown], `I3 premise i${i}`).toEqual([true, true]);
      expect(row.strikeCollateralBtc, `I3 i${i} strike`).toBeCloseTo(p.after.strikeCollateralBtc, 12);
      expect(row.cbCollateralBtc, `I3 i${i} cb`).toBeCloseTo(p.after.cbCollateralBtc, 12);
      expect(row.coldBtc, `I3 i${i} cold`).toBeCloseTo(p.after.coldBtc, 12);
      expect([row.strikeToCbBtc, p.strikeToCbBtc], `I3 i${i} no two-hop`).toEqual([0, 0]);
      states.add(row.policyZone ?? 'none');
      if (inHold && strikeCollateralBtc > 0) held += 1;
      if (p.strikeToColdBtc > 0 && p.cbToColdBtc > 0) both += 1;
    }
    expect([...states].sort(), 'I3 every state').toEqual(['accumulate', 'broken', 'hold', 'paused', 'payDown']);
    expect([held > 100, both > 1_000], 'I3 held, and both legs moving').toEqual([true, true]);
  });

  it('the at-goal reading THE MOVE uses is the engine\'s: with nothing owed net coins are the coins (atGoalOf, GOAL_EPS)', () => {
    // Coins whose float sum lands an ulp UNDER the goal they make: at it, by the engine's own rule.
    const s = 0.7 + 0.1;
    const p = plan({ strikeCollateralBtc: 0.7, cbCollateralBtc: 0.1, coldBtc: 0, goalNetBtc: 0.8 });
    expect([s < 0.8, atGoalOf(s, 0.8), p.standDown]).toEqual([true, true, true]);
  });
});
