import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fireLaneOn, fireLaneInputs, fireLaneFigures, fireLaneFutures, faceMonthOfLane,
  type FireLanePlan, type FireLaneJobSpec, type FireLaneRan,
} from '../fireLane';
import { futuresFor, type FireLaneFuturesJob } from '../futuresRun';
import { buildSupportPath, supportPolicyFor } from '../supportPolicyInputs';
import { PLAN_ENGINE_CONTEXT, engineInputsOf, placementInputOf, planPolicySettingsOf, seedsFromMove } from '../planRun';
import { fireTimeline, type FireInputs, type FireResult } from '../../../simulation/fire';
import { placementPlan } from '../../../simulation/placement';
import { deriveOwnership } from '../../../simulation/ownership';
import { sellToNet, CAPITAL_GAINS_TAX_RATE } from '../../../simulation/taxes';
import type { CyclingInputs, CyclingResult } from '../../../simulation/cyclingSim';
import { REARMABLE_BREAKER_START, type RearmableBreakerState } from '../../../simulation/supportPolicy';
import { priceFutures, FUTURES_SEED } from '../../../simulation/pricePaths';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';

/**
 * The FIRE face's borrow lane (BL42/BL55/BL57 — build 2): its composition of the plan's engine at the stop month, the
 * face's figures, and the futures. The paths ride the support path (price = k × support), so every zone is chosen by
 * construction; the support path goes through Math.pow, so no exact figure is stored — each assertion compares the lane
 * with the sell lane's own run, or with the engine's, on the same path, in the same run (`.claude/rules/general.md`).
 * Each assertion carries the tag its planted bug turns red.
 */
const START = '2026-11-01';
const MONTHS = 120;
const S = buildSupportPath(new Date(START), MONTHS);
/** The price at k × support, months 0 … MONTHS − 1 — k sets the zone (accumulate under 2, hold 2–3, pay down over 3). */
const along = (k: number): number[] => S.slice(0, MONTHS).map((s) => s * k);
/** k × support, but `low` × support for `len` months from `from` — a fall below support. */
const fall = (k: number, low: number, from: number, len: number): number[] =>
  S.slice(0, MONTHS).map((s, m) => s * (m >= from && m < from + len ? low : k));
const LP: FireLanePlan = {
  plan: { ...PLAN_POLICY_DEFAULTS }, creditLine: 40_000, blocApr: 13, cbAprPct: 6, strikeLiquidationLtvPct: 85, breakerToday: null,
};
const sellIn = (o: Partial<FireInputs> = {}): FireInputs => ({
  btc: 5, otherUsd: 0, savingsUsd: 0, spendUsd: 5_000, retirementIncomeUsd: 0, stopMonth: 0, inflation: 0.02, otherMonthlyFactor: 1,
  wBtc: 0.04, wOther: 0.04, taxRate: CAPITAL_GAINS_TAX_RATE, basisUsdPerBtc: null, ...o,
});
const laneOf = (x: FireInputs, path: number[], lp: FireLanePlan = LP): { r: FireResult; o: ReturnType<typeof fireLaneOn> } => {
  const r = fireTimeline(x, path);
  return { r, o: fireLaneOn(r, x, path, S, lp, START) };
};
const ranOf = (o: ReturnType<typeof fireLaneOn>, tag: string): FireLaneRan => {
  expect(o.ran, `${tag} premise: the lane ran`).toBe(true);
  return o as FireLaneRan;
};
const inputsOf = (r: FireResult, x: FireInputs, path: number[], lp: FireLanePlan = LP): CyclingInputs => {
  const li = fireLaneInputs(r, x, path, S, lp, START);
  if (typeof li === 'string') throw new Error(`no lane: ${li}`);
  return li.inputs;
};
/** The month's bill as the engine paid it — the line, the reserve, or unpaid (build 1's NEVER DROPPED reading). */
const billOf = (r: CyclingResult, m: number): number => r.rows[m].strikeDrawn + r.rows[m].cashToBillsUsd + r.rows[m].unfundedUsd;
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('⭐ the split — the same coins, the reserve, the plan', () => {
  it('⭐ SAME COINS — the lane opens with the sell lane\'s ₿ at the stop month\'s start, placed by THE MOVE, owing nothing', () => {
    let bought = 0;
    for (const stop of [0, 7, 12, 30]) {
      for (const savingsUsd of [0, 2_000]) {
        const x = sellIn({ stopMonth: stop, savingsUsd });
        const path = along(2.5);
        const { r, o } = laneOf(x, path);
        const ran = ranOf(o, 'SAME COINS');
        const li = inputsOf(r, x, path);
        const opening = li.strikeCollateralBtc + li.cbCollateralBtc + (li.openingColdBtc ?? 0);
        expect(opening, `SAME COINS placed, stop ${stop}`).toBeCloseTo(r.rows[stop].btc, 12);
        expect(ran.sim.rows[0].btcHeld, `SAME COINS held at the opening, stop ${stop}`).toBeCloseTo(r.rows[stop].btc, 12);
        expect([li.strikeBalance, li.cbDebt, ran.sim.rows[0].debt], `SAME COINS no debt, stop ${stop}`).toEqual([0, 0, 0]);
        if (r.rows[stop].btc > 5 + 1e-9) bought += 1;
      }
    }
    expect(bought, 'SAME COINS non-vacuous: working months bought coins').toBeGreaterThan(0);
    // Stop now: the coins net of today's loans, as the sell lane starts (F4) — the face hands the sell lane `yoursAt`.
    const net = deriveOwnership(5, 60_000, along(2.5)[0]).yoursBtc;
    const { r } = laneOf(sellIn({ btc: net }), along(2.5));
    expect(r.rows[0].btc, 'SAME COINS stop now: the coins net of today\'s loans').toBe(net);
  });

  it('⭐ RESERVE — the sell lane\'s other assets at the stop month, growing at the face\'s return; never the plan\'s months of bills', () => {
    const x = sellIn({ stopMonth: 12, otherUsd: 80_000, otherMonthlyFactor: 1.004, savingsUsd: 1_000 });
    const path = along(1.5);
    const r = fireTimeline(x, path);
    const li = inputsOf(r, x, path, { ...LP, plan: { ...PLAN_POLICY_DEFAULTS, cashReserveMonths: 6 } });
    expect(r.rows[12].otherUsd, 'RESERVE non-vacuous: the other assets grew while working').toBeGreaterThan(80_000);
    expect(li.supportPolicy?.openingCashUsd, 'RESERVE the sell lane\'s other assets').toBe(r.rows[12].otherUsd);
    expect(li.livingOnCredit, 'RESERVE its growth, the bill\'s inflation and calendar').toEqual(
      { spendingInflation: 0.02, reserveMonthlyFactor: 1.004, stepOffsetMonths: 11 });
  });

  it('⭐ THE PLAN — planRun\'s builders, the owner\'s plan and loan terms, no income, no goal, no hold', () => {
    const plan = { ...PLAN_POLICY_DEFAULTS, cbStopAtSupportPct: 40, bearBufferMonths: 6 };
    const lp: FireLanePlan = { ...LP, plan, creditLine: 25_000, blocApr: 11, cbAprPct: 7, strikeLiquidationLtvPct: 80 };
    const x = sellIn({ stopMonth: 13, savingsUsd: 500 });
    const path = along(1.5);
    const r = fireTimeline(x, path);
    const at = r.rows[13];
    const settings = planPolicySettingsOf(plan);
    const pricePath = [path[13], ...path.slice(13)];
    const supportPath = [S[13], ...S.slice(13, MONTHS)];
    const expenses = r.fundedUsd * at.inflationStep;   // 13 is no year's start: the stop month's step as it is
    const supportPolicy = { ...supportPolicyFor(settings, supportPath, expenses, 80, 'cycle')!, openingCashUsd: at.otherUsd };
    const placement = placementPlan(placementInputOf({
      runLine: 25_000, strikeBalance: 0, strikeCollateralBtc: at.btc, cbDebt: 0, cbCollateralBtc: 0, coldBtc: 0,
      price: pricePath[0], support: supportPath[0], policySettings: settings, expenses, inHold: false, broken: false, goalNetBtc: null,
    }));
    const seedFromMove = seedsFromMove(placement.seeded, { ...PLAN_ENGINE_CONTEXT, supportPolicy, pricePath, expenses });
    expect(seedFromMove, 'THE PLAN non-vacuous: THE MOVE seeds the run').toBe(true);
    const want: CyclingInputs = {
      ...engineInputsOf({
        startDate: new Date(Date.UTC(2026, 10 + 13, 1)), seedFromMove, placement, strikeCollateralBtc: at.btc, strikeBalance: 0,
        runLine: 25_000, cbCollateralBtc: 0, cbDebt: 0, coldBtc: 0, income: 0, expenses, blocApr: 11, cbAprPct: 7, supportPolicy,
        openingBreaker: undefined, holdMonths: 0, strikeMinFromIncome: false, goalNetBtc: null,
      }),
      pricePath,
      livingOnCredit: { spendingInflation: 0.02, reserveMonthlyFactor: 1, stepOffsetMonths: 0 },
    };
    expect(inputsOf(r, x, path, lp), 'THE PLAN').toEqual(want);
  });

  it('⭐ BREAKER — today\'s breaker opens the lane only when work stops now; it bites: no new borrowing while it holds', () => {
    const tripped: RearmableBreakerState = { ...REARMABLE_BREAKER_START, monthsBelow: 3, broken: true, brokenMonth: -1 };
    const lp = { ...LP, breakerToday: tripped };
    const path = along(2.5);
    const now = sellIn({ stopMonth: 0 });
    expect(inputsOf(fireTimeline(now, path), now, path, lp).openingBreaker, 'BREAKER stop now: today\'s').toEqual(tripped);
    const later = sellIn({ stopMonth: 12 });
    expect(inputsOf(fireTimeline(later, path), later, path, lp).openingBreaker, 'BREAKER a later stop: fresh').toBeUndefined();
    const held = ranOf(laneOf(now, path, lp).o, 'BREAKER');
    expect([held.endLaneMonth, held.endReason], 'BREAKER no reserve: the first bill goes unpaid').toEqual([1, 'unpaid']);
    expect(held.sim.rows[1].strikeDrawn, 'BREAKER nothing drawn').toBe(0);
    expect(ranOf(laneOf(now, path).o, 'BREAKER').endReason, 'BREAKER without it the same lane lasts').toBeNull();
  });
});

describe('⭐ B1 — the first bill lined up with the sell lane\'s', () => {
  it('⭐ FIRST BILL — lane month k pays face month stop + k − 1\'s bill, month for month; the opening pays none', () => {
    let steps = 0;
    for (const inflation of [0, 0.02, 0.07]) {
      for (const stop of [0, 1, 11, 12, 13, 24, 35]) {
        const x = sellIn({ stopMonth: stop, inflation, retirementIncomeUsd: 1_000 });
        const path = along(2.5);
        const { r, o } = laneOf(x, path);
        const ran = ranOf(o, 'FIRST BILL');
        expect(billOf(ran.sim, 0), `FIRST BILL the opening, stop ${stop}`).toBe(0);
        for (let k = 1; k <= 40; k++) {
          const want = r.rows[faceMonthOfLane(stop, k)].withdrawalUsd;
          expect(billOf(ran.sim, k) / want, `FIRST BILL stop ${stop}, ${inflation}, lane month ${k}`).toBeCloseTo(1, 12);
          if (k > 1 && billOf(ran.sim, k) > billOf(ran.sim, k - 1) + 1e-6) steps += 1;
        }
        const li = inputsOf(r, x, path);
        expect(li.pricePath[0], `FIRST BILL the opening at the stop month's price, stop ${stop}`).toBe(path[stop]);
        expect(li.pricePath.slice(1), `FIRST BILL then the face's months, stop ${stop}`).toEqual(path.slice(stop));
        expect(li.supportPolicy?.supportPath, `FIRST BILL the support lined up, stop ${stop}`).toEqual([S[stop], ...S.slice(stop, MONTHS)]);
      }
    }
    expect(steps, 'FIRST BILL non-vacuous: the bill steps inside the window').toBeGreaterThan(20);
  });
});

describe('⭐ what the face reads — the engine\'s end, the line, the kept coins and the tax', () => {
  const lasts = (): { r: FireResult; x: FireInputs; path: number[]; ran: FireLaneRan } => {
    const x = sellIn();
    const path = along(2.5);
    const { r, o } = laneOf(x, path);
    return { r, x, path, ran: ranOf(o, 'LASTS') };
  };

  it('⭐ THE END — read from the engine\'s `livingOnCredit` and nothing else: lasts, unpaid, seized', () => {
    const cases: [string, FireInputs, number[], 'unpaid' | 'seized' | null][] = [
      ['lasts', sellIn(), along(2.5), null],
      ['unpaid below support', sellIn(), fall(1.2, 0.5, 24, 30), 'unpaid'],
      ['seized in a crash', sellIn(), fall(1.2, 0.35, 36, 12), 'seized'],
    ];
    for (const [name, x, path, reason] of cases) {
      const { r, o } = laneOf(x, path);
      const ran = ranOf(o, `THE END ${name}`);
      expect(ran.sim.livingOnCredit, `THE END ${name} the engine hosted it`).toBeDefined();
      expect([ran.endLaneMonth, ran.endReason], `THE END ${name}`).toEqual(
        [ran.sim.livingOnCredit!.endMonth, ran.sim.livingOnCredit!.endReason]);
      expect(ran.endReason, `THE END ${name} premise`).toBe(reason);
      const f = fireLaneFigures(ran, r, x, path);
      expect(f.endMonth, `THE END ${name} the face's month`).toBe(ran.endLaneMonth === null ? null : faceMonthOfLane(0, ran.endLaneMonth));
    }
    const src = strip(readFileSync(join(process.cwd(), 'src/components/Almanac/fireLane.ts'), 'utf8'));
    for (const never of ['firstUnfundedMonth', 'totalUnfundedUsd', 'CeilingHeadroom', 'liqMonth']) {
      expect(src, `THE END never ${never}`).not.toContain(never);
    }
    expect(src.split('runCyclingSim(').length - 1, 'THE END one engine run').toBe(1);
  });

  it('⭐ THE LINE STOPS — ₿ owned, borrowing, from the stop month to the lane\'s end: the engine\'s holdings and debt carried into each month, at its price', () => {
    for (const [name, x, path] of [
      ['lasts', sellIn({ stopMonth: 9 }), along(2.5)],
      ['ends', sellIn({ stopMonth: 9 }), fall(1.2, 0.5, 24, 30)],
    ] as const) {
      const r = fireTimeline(x, path);
      const ran = ranOf(fireLaneOn(r, x, path, S, LP, START), `THE LINE STOPS ${name}`);
      const f = fireLaneFigures(ran, r, x, path);
      // The line's last point from the ENGINE's end, mapped by B1 here (lane month k ↔ face month stop + k − 1), never from
      // the figures' own end month — so a wrong mapping in the module can't move the test's expectation with it.
      const last = ran.endLaneMonth === null ? MONTHS - 1 : 9 + ran.endLaneMonth - 1;
      expect(f.owned.length, `THE LINE STOPS ${name} a point a month`).toBe(MONTHS);
      f.owned.forEach((v, m) => {
        if (m < 9 || m > last) { expect(v, `THE LINE STOPS ${name} nothing at month ${m}`).toBeNull(); return; }
        const row = ran.sim.rows[m - 9];
        expect(v, `THE LINE STOPS ${name} month ${m}`).toBe(deriveOwnership(row.btcHeld, row.debt, path[m]).yoursBtc);
      });
      expect(f.endMonth, `THE LINE STOPS ${name} the end's month is the line's last`).toBe(ran.endLaneMonth === null ? null : last);
      expect(f.owned[last], `THE LINE STOPS ${name} drawn through its last month`).not.toBeNull();
      if (name === 'ends') expect(last, 'THE LINE STOPS premise: it ends inside the horizon').toBeLessThan(MONTHS - 1);
    }
  });

  it('⭐ KEPT AND TAX — at the last month (B3): ₿ yours against the sell lane\'s ₿, the debt, and the tax its repayment would owe', () => {
    const { r, x, path, ran } = lasts();
    const f = fireLaneFigures(ran, r, x, path);
    const m = MONTHS - 1;
    const row = ran.sim.rows[m];
    const sale = sellToNet(row.debt, path[m], path[0], CAPITAL_GAINS_TAX_RATE);
    expect(f.last, 'KEPT AND TAX').toEqual({
      m, yoursBtc: deriveOwnership(row.btcHeld, row.debt, path[m]).yoursBtc, sellBtc: r.rows[m].btc,
      debtUsd: row.debt, debtBtc: row.debt / path[m], repayTaxBtc: sale.taxUsd / path[m],
    });
    expect(f.last!.repayTaxBtc, 'KEPT AND TAX non-vacuous: a gain to tax').toBeGreaterThan(0.01);
    expect(f.last!.yoursBtc, 'KEPT AND TAX non-vacuous: borrowing keeps more on this path').toBeGreaterThan(f.last!.sellBtc!);
    expect(f.cold, 'KEPT AND TAX cold at the opening and at the last month').toEqual(
      { openBtc: ran.sim.rows[0].coldBtc, lastBtc: row.coldBtc });
    // Your own cost over the price: no gain, no tax.
    const own = { ...x, basisUsdPerBtc: path[m] * 2 };
    const ownRan = ranOf(fireLaneOn(fireTimeline(own, path), own, path, S, LP, START), 'KEPT AND TAX');
    expect(fireLaneFigures(ownRan, fireTimeline(own, path), own, path).last!.repayTaxBtc, 'KEPT AND TAX at your cost').toBe(0);
    // An ended lane has no last month to compare.
    const x2 = sellIn();
    const path2 = fall(1.2, 0.5, 24, 30);
    const r2 = fireTimeline(x2, path2);
    const f2 = fireLaneFigures(ranOf(fireLaneOn(r2, x2, path2, S, LP, START), 'KEPT AND TAX'), r2, x2, path2);
    expect([f2.last, f2.cold], 'KEPT AND TAX none when it ends').toEqual([null, null]);
  });

  it('⭐ IN THE BREAKER — an unpaid end while the breaker holds is said so; elsewhere it isn\'t', () => {
    const tripped: RearmableBreakerState = { ...REARMABLE_BREAKER_START, monthsBelow: 3, broken: true, brokenMonth: -1 };
    const x = sellIn();
    const path = along(2.5);
    const held = ranOf(laneOf(x, path, { ...LP, breakerToday: tripped }).o, 'IN THE BREAKER');
    expect(fireLaneFigures(held, fireTimeline(x, path), x, path).endInBreaker, 'IN THE BREAKER').toBe(true);
    const fallPath = fall(1.2, 0.5, 24, 30);
    const below = ranOf(laneOf(x, fallPath).o, 'IN THE BREAKER');
    expect(below.endReason, 'IN THE BREAKER premise: unpaid').toBe('unpaid');
    expect(fireLaneFigures(below, fireTimeline(x, fallPath), x, fallPath).endInBreaker, 'IN THE BREAKER not here').toBe(false);
  });
});

describe('⭐ no lane — why', () => {
  it('⭐ NONE — each reason, and nothing run', () => {
    const path = along(2.5);
    const why = (x: FireInputs, p: number[] = path, lp: FireLanePlan = LP): string => {
      const o = laneOf(x, p, lp).o;
      return o.ran ? 'ran' : o.why;
    };
    expect(why(sellIn({ stopMonth: 'atFi', spendUsd: 90_000 })), 'NONE no FI on this path').toBe('noStop');
    expect(why(sellIn({ stopMonth: 200 })), 'NONE the stop after the horizon').toBe('noStop');
    expect(why(sellIn({ spendUsd: 0 })), 'NONE no spending').toBe('noSpending');
    expect(why(sellIn({ retirementIncomeUsd: 5_000 })), 'NONE income covers it').toBe('covered');
    expect(why(sellIn({ btc: 0 })), 'NONE nothing owned').toBe('nothingOwned');
    expect(why(sellIn({ btc: 1, savingsUsd: -20_000, stopMonth: 60 })), 'NONE the working gap ran it out').toBe('nothingOwned');
    expect(why(sellIn(), path, { ...LP, creditLine: 0 }), 'NONE no Strike line').toBe('noLine');
    expect(why(sellIn(), [...path.slice(0, 5), 0, ...path.slice(6)]), 'NONE a junk path').toBe('invalid');
    expect(why(sellIn()), 'NONE non-vacuous: the same household runs').toBe('ran');
  });
});

describe('⭐ the futures — the lane from the held stop month on each simulated path', () => {
  const spec: FireLaneJobSpec = {
    sell: { ...sellIn({ btc: 0, otherUsd: 30_000 }), stopMonth: 6 }, facts: { openingBtc: 3, openingDebtUsd: 20_000 },
    lane: LP, startISO: START, months: 60,
  };
  const paths = priceFutures({ anchorPrice: 100_000, startDate: new Date(`${START}T00:00:00Z`), months: 60, count: 80, seed: FUTURES_SEED })
    .map((f) => f.prices);

  it('⭐ FUTURES — each path\'s lane, tallied; the stop month held; the paths read to the face\'s horizon', () => {
    const support = buildSupportPath(new Date(START), 60);
    let lasts = 0, unpaid = 0, seized = 0, ran = 0;
    for (const full of paths) {
      const path = full.slice(0, 60);
      const x: FireInputs = { ...spec.sell, btc: deriveOwnership(3, 20_000, path[0]).yoursBtc };
      const o = fireLaneOn(fireTimeline(x, path), x, path, support, LP, START);
      if (!o.ran) continue;
      expect(o.stop, 'FUTURES the stop month held').toBe(6);
      ran += 1;
      if (o.endReason === 'seized') seized += 1; else if (o.endReason === 'unpaid') unpaid += 1; else lasts += 1;
    }
    const f = fireLaneFutures(spec, paths);
    expect(f, 'FUTURES').toEqual({ count: 80, lasts, unpaid, seized, ran, startISO: START, months: 60, stop: 6 });
    expect(lasts > 0 && unpaid > 0, 'FUTURES non-vacuous: some last, some run out').toBe(true);
    expect(paths[0].length, 'FUTURES premise: the drawn paths run a month past the horizon').toBe(61);
  });

  it('⭐ ONE CROSSING — futuresRun runs the lane\'s job on the drawn futures, and nothing else', () => {
    const job: FireLaneFuturesJob = { kind: 'fireLane', ...spec, anchorPrice: 100_000, count: 80 };
    expect(futuresFor(job), 'ONE CROSSING').toEqual(fireLaneFutures(spec, paths));
  });
});
