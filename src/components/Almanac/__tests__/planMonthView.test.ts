import { describe, it, expect } from 'vitest';
import { planMonthRun, firstMonthUnderLimit, cbOverLimitAtMonthEnd, planBreakerCacheOf, type PlanMonthFacts } from '../planRun';
import {
  planMonthActions, planStatus, planAfter, monthTrack, planMonthSummary, planSwitchNote, planRowDot, planRowNoteColor,
  planRowAmountColor, planBreakerSource, planBreakerLine, loggedMonthRows, loggedMonthAfter, loggedMonthStatus,
  venueSegments, venuesOf, VENUE_COLOR, PLAN_ROW_LABELS, PLAN_CRASH_TITLE, fmtDayOrdinal, planMinimumOwed,
  planMinimumLine, planInterestRollsLine, planInterestRollsNote, planNdpLine, planLedgerParts, planLedgerTargets,
  planNextMonthLine, planSavingsLine, planPriceLine, planMeterAria, planSignoffLine, planSignoffSub, type PlanRow,
} from '../planMonthView';
import { planSchedule, todayActions, ACTION_FIELDS, type ActionKind } from '../decisionView';
import { cbSeizurePrice } from '../../../simulation/cbMetrics';
import { CB_LLTV } from '../../../simulation/runCoinbaseLoan';
import { PLAN_POLICY_DEFAULTS, PLAN_POLICY_RANGES } from '../../../lib/planPolicy';
import { fmtUSD, shownUsd as shownUsdOf } from '../../../utils/format';
import { fmtBelowPct, policyIgnoredNote } from '../supportPolicyView';
import type { CyclingRow } from '../../../simulation/cyclingSim';
import type { MonthlyLogEntry } from '../../../simulation/types';

/**
 * The plan of record's month, as words (Run 2 — §4.3, §4.5, D-R2-1…8). Every assertion carries a tag from the spec's
 * §13.3. ⚠ SYNTHETIC round figures — this repo is public; never a real position.
 */

const TODAY = '2026-10-12';
const facts = (over: Partial<PlanMonthFacts> = {}): PlanMonthFacts => ({
  todayISO: TODAY, price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
  income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
  strikeBalance: 20_000, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 50_000,
  strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
  ...over,
});
const OVER = facts();
const HEALTHY = facts({ creditLine: 20_000, strikeBalance: 10_000, strikeCollateralBtc: 2, cbDebt: 10_000, cbCollateralBtc: 0.5 });
const CRASHED = facts({ cbDebt: 80_000 });
/** The over household with a Strike liquidation LTV at its 70% call (the Safety dashboard allows 0–100): the engine
 *  refuses the policy ('strikeLadder'), so no limit at support is in force. */
const IGNORED = facts({ strikeLiquidationLtvPct: 70 });

/** Every household × price × minimum × income the sweeps read: the five prices straddle support (under it, inside the
 *  buy zone, the pay-down zone); the Coinbase legs run from none to past its liquidation line at the low prices; the
 *  incomes run from comfortable, to $100 over the bills (a buy too small for 3 dp), to short of them, with and without a
 *  cash reserve. Measured, the sweep reaches 13 of the 20 action kinds (ROWS, below). */
const SWEEP: PlanMonthFacts[] = [];
for (const [income, cashReserveMonths] of [[6_000, 0], [4_100, 0], [2_500, 0], [2_500, 3]] as const) {
  for (const price of [55_000, 70_000, 100_000, 160_000, 250_000]) {
    for (const [cbDebt, cbCollateralBtc] of [[0, 0], [10_000, 0.5], [50_000, 1], [80_000, 1], [90_000, 2]] as const) {
      for (const [strikeBalance, strikeCollateralBtc, creditLine] of [[0, 0, 10_000], [10_000, 2, 20_000], [20_000, 1, 40_000]] as const) {
        for (const strikeMinFromIncome of [false, true]) {
          SWEEP.push(facts({
            income, plan: { ...PLAN_POLICY_DEFAULTS, cashReserveMonths },
            price, cbDebt, cbCollateralBtc, strikeBalance, strikeCollateralBtc, creditLine, strikeMinFromIncome,
          }));
        }
      }
    }
  }
}
const RUNS = SWEEP.map((f) => ({ f, run: planMonthRun(f) }));

const BANNED = /\b(?:should|need to|needs to|safe|safely|safer)\b/i;
const NO_ZERO_USD = /(?<![\d.,])\$0(?![\d.,])/;
/** A zero either way round: "₿0.000" (THIS MONTH's own) and "0.000 ₿" (the Decision face's sentences, which "Why this
 *  plan?" prints). */
const NO_ZERO_BTC = /₿0\.0+(?![\d1-9])|(?<![\d.])0\.0+ ₿/;

function wordsOf(f: PlanMonthFacts, run: ReturnType<typeof planMonthRun>): string[] {
  const out: string[] = [];
  const statusFacts = {
    monthsBackUnder: firstMonthUnderLimit(run.sim), cbStop: run.placementInput.cbStop,
    support0: run.supportPath[0], coldBtc: f.coldBtc,
  };
  for (const r of run.sim.rows) {
    if (r.m === 0) continue;
    const st = planStatus(run.sim, run.placement, r.m, statusFacts);
    out.push(st.title, st.body ?? '', ...st.fixes);
    for (const row of planMonthActions(run.sim, run.placement, r.m)) out.push(row.label, row.note ?? '', row.amount);
    const after = planAfter(r, run.supportPath[r.m], run.placementInput.cbStop, run.sim.policyApplied);
    for (const a of after.rows) out.push(a.label, a.value);
    if (after.meter) out.push(planMeterAria(after.meter));
    out.push(planMonthSummary(run.sim, run.placement, r.m, run.supportPath[r.m]));
    out.push(planPriceLine(f.price, run.supportPath[r.m]));
  }
  out.push(planNextMonthLine(run.sim) ?? '', planSavingsLine(run.sim, 12) ?? '');
  out.push(planSignoffLine(1), planSignoffSub(null));
  out.push(planInterestRollsLine(run.sim.rows[1].strikeInterestUsd, 15) ?? '', planMinimumLine(run.sim.rows[1].strikeInterestUsd, 15) ?? '');
  return out.filter((t) => t !== '');
}

describe('⭐ WORDS — invariant 5 and the not-advice line: facts, never "should", never a zero', () => {
  it('⭐ WORDS — every sentence THIS MONTH and Daily print, over the sweep, every month of every run', () => {
    let n = 0;
    for (const { f, run } of RUNS) {
      for (const t of wordsOf(f, run)) {
        n += 1;
        expect(t, 'WORDS banned').not.toMatch(BANNED);
        if (t !== '—') {
          expect(t, 'WORDS no $0').not.toMatch(NO_ZERO_USD);
          expect(t, 'WORDS no ₿0').not.toMatch(NO_ZERO_BTC);
        }
      }
    }
    expect(n, 'WORDS not vacuous').toBeGreaterThan(40_000);
  }, 60_000);   // a sweep of all 600 runs: ~150,000 sentences, past vitest's 5 s default on Node 26 and on slower hosts
  it('⭐ WORDS — a buy too small for 3 dp: the face\'s sentence drops its "≈", THIS MONTH\'s amount says so (never a zero)', () => {
    const run = planMonthRun(OVER);
    const row: CyclingRow = { ...run.sim.rows[1], btcBoughtUsd: 3, price: 100_000 };
    const buy = ACTION_FIELDS.find((a) => a.kind === 'buy');
    expect(buy?.text(row), 'WORDS face buy, tiny').toBe('Buy $3 of bitcoin and pledge it to Coinbase.');
    expect(buy?.text({ ...row, btcBoughtUsd: 500 }), 'WORDS face buy').toBe('Buy $500 of bitcoin (≈ 0.005 ₿) and pledge it to Coinbase.');
    const refi = ACTION_FIELDS.find((a) => a.kind === 'refinance');
    expect(refi?.text({ ...row, refinancedUsd: 18, refinancedFeeUsd: 0.27 }), 'WORDS face refinance, fee under the floor')
      .toBe('Move $18 of Strike debt to Coinbase.');
    expect(refi?.text({ ...row, refinancedUsd: 14_000, refinancedFeeUsd: 280 }), 'WORDS face refinance')
      .toBe("Move $14,000 of Strike debt to Coinbase (Coinbase's fee: $280).");
    const sim = { ...run.sim, rows: run.sim.rows.map((r) => (r.m === 2 ? { ...r, btcBoughtUsd: 3, price: 100_000 } : r)) };
    const tiny = planMonthActions(sim, run.placement, 2).find((r) => r.kind === 'buy');
    expect([tiny?.note, tiny?.amount], 'WORDS THIS MONTH buy, tiny').toEqual(['$3', 'under ₿0.0001']);
  });
  it('⭐ WORDS — the one-time note, the crash title and the breaker lines', () => {
    for (const pct of [PLAN_POLICY_RANGES.cbStopAtSupportPct.min, 45, PLAN_POLICY_RANGES.cbStopAtSupportPct.max]) {
      expect(planSwitchNote(pct / 100), 'NOTE reads the plan\'s stop').toContain(`${pct}%`);
      expect(planSwitchNote(pct / 100), 'WORDS note').not.toMatch(BANNED);
    }
    expect(PLAN_CRASH_TITLE).not.toMatch(BANNED);
    const seed = { state: { broken: false, monthsBelow: 0, brokenMonth: null, monthsAtOrAbove: 0 }, lastMonthEndISO: '2026-09-30' };
    for (const b of [planBreakerSource(null, seed, false), planBreakerSource(null, null, true), planBreakerSource(null, null, false)]) {
      expect(planBreakerLine(b), 'WORDS breaker').not.toMatch(BANNED);
    }
    // The ignored policy's every word on both cards (the sweep never reaches it): its status, its months, its Why.
    const ig = planMonthRun(IGNORED);
    const igf = { monthsBackUnder: firstMonthUnderLimit(ig.sim), cbStop: ig.placementInput.cbStop, support0: ig.supportPath[0], coldBtc: IGNORED.coldBtc };
    for (const r of ig.sim.rows) {
      if (r.m === 0) continue;
      const st = planStatus(ig.sim, ig.placement, r.m, igf);
      const after = planAfter(r, ig.supportPath[r.m], ig.placementInput.cbStop, ig.sim.policyApplied);
      for (const t of [st.title, st.body ?? '', ...after.rows.map((a) => a.value), planMonthSummary(ig.sim, ig.placement, r.m, ig.supportPath[r.m])]) {
        expect(t, 'WORDS ignored').not.toMatch(BANNED);
        expect(t, 'WORDS ignored no $0').not.toMatch(NO_ZERO_USD);
      }
    }
  });
  it('⭐ NOTE — within the limit, a fall to support stays short of 86% at every stop the plan allows', () => {
    // The "Why this plan?" claim is a conditional fact: the plan's stop range sits wholly below Coinbase's seizure line.
    expect(PLAN_POLICY_RANGES.cbStopAtSupportPct.max / 100, 'NOTE the range').toBeLessThan(CB_LLTV);
    // …and it is made only while the engine applies the policy: refused, no limit at support is in force.
    const on = planMonthRun(OVER);
    const off = planMonthRun(IGNORED);
    expect([on.sim.policyApplied, off.sim.policyApplied], 'NOTE premise: applied, then refused').toEqual([true, false]);
    expect(planMonthSummary(on.sim, on.placement, 1, on.supportPath[1]), 'NOTE the Why, applied').toContain('The limit is measured at support');
    expect(planMonthSummary(off.sim, off.placement, 1, off.supportPath[1]), 'NOTE the Why, refused').not.toContain('measured at support');
  });
});

describe('⭐ STATUS — §4.5 / D6: one line per month, the switch month\'s fact, time and catch-up', () => {
  const run = planMonthRun(OVER);
  const sf = { monthsBackUnder: firstMonthUnderLimit(run.sim), cbStop: run.placementInput.cbStop, support0: run.supportPath[0], coldBtc: OVER.coldBtc };

  it('⭐ STATUS — this month reads TODAY\'s over-the-limit fact (the move\'s, at S₀), with the time and the catch-up as facts', () => {
    const st = planStatus(run.sim, run.placement, 1, sf);
    const X = run.placement.cbOverCeilingUsd;
    expect(st.tone, 'STATUS amber, never red (D7)').toBe('warn');
    expect(st.title).toBe(`Coinbase is ${fmtUSD(X)} over your plan's limit`);
    expect(st.body).toBe("Spare income repays it before the plan borrows again — back within it in about 8 months at today's price.");
    const A = X / (sf.cbStop * sf.support0);
    expect(st.fixes[0], 'STATUS catch-up (cold short of A)').toBe(`Add ₿${A.toFixed(3)} of collateral to Coinbase, or repay ${fmtUSD(X)}.`);
    expect(st.fixes[1], 'STATUS the limit, with the support price per ₿').toBe(`Your limit: 45% of what Coinbase's collateral is worth at support (${fmtUSD(sf.support0)} per ₿ today).`);
    const rich = planStatus(run.sim, run.placement, 1, { ...sf, coldBtc: 5 });
    expect(rich.fixes[0], 'STATUS catch-up (cold covers A)').toBe(`Move ₿${A.toFixed(3)} from cold storage to Coinbase, or repay ${fmtUSD(X)}.`);
    const never = planStatus(run.sim, run.placement, 1, { ...sf, monthsBackUnder: null });
    expect(never.body).toContain('not back within it in the next 12 months');
    // No spare income: bills above income ($2,500 against $4,000), so nothing repays Coinbase — the card never says it does.
    const poor = planMonthRun(facts({ income: 2_500 }));
    const pf = { ...sf, monthsBackUnder: firstMonthUnderLimit(poor.sim), support0: poor.supportPath[0] };
    expect([cbOverLimitAtMonthEnd(poor.sim.rows[1]), shownUsdOf(poor.sim.rows[1].cbRepaidUsd)], 'STATUS premise: still over, nothing repaid')
      .toEqual([true, false]);
    expect(planStatus(poor.sim, poor.placement, 1, pf).body, 'STATUS no spare income')
      .toBe("No spare income repays it this month — not back within it in the next 12 months at today's price.");
    expect(planStatus(poor.sim, poor.placement, 2, pf).body, 'STATUS no spare income, a later month').toBe('No spare income repays it this month.');
    // Over today by less than the month's rise in support: back within at month-end with nothing repaid, and the spare
    // income buys — neither "spare income repays it" nor "no spare income" is true.
    const edge = planMonthRun(facts({ cbDebt: 29_500, strikeBalance: 0, strikeCollateralBtc: 0, creditLine: 10_000 }));
    const e1 = edge.sim.rows[1];
    expect([shownUsdOf(edge.placement.cbOverCeilingUsd), cbOverLimitAtMonthEnd(e1), shownUsdOf(e1.cbRepaidUsd), shownUsdOf(e1.btcBoughtUsd)],
      'STATUS premise: over today, within at month-end, nothing repaid, a buy').toEqual([true, false, false, true]);
    const ef = { ...sf, monthsBackUnder: firstMonthUnderLimit(edge.sim), support0: edge.supportPath[0] };
    expect(planStatus(edge.sim, edge.placement, 1, ef).body, 'STATUS back within at month-end').toBe("Back within your plan's limit this month.");
  });
  it('⭐ STATUS — a later month reads its own month-end: still over, then back within, then within', () => {
    const back = firstMonthUnderLimit(run.sim) ?? 0;
    expect(back, 'STATUS the run cures').toBeGreaterThan(2);
    const still = planStatus(run.sim, run.placement, 2, sf);
    expect(still.tone).toBe('warn');
    expect(still.title).toBe(`Still ${fmtUSD(-(run.sim.rows[2].cbCeilingHeadroomUsd ?? 0))} over your plan's limit at month-end`);
    expect(planStatus(run.sim, run.placement, back, sf).title, 'STATUS cure month').toBe("Back within your plan's limit this month");
    expect(planStatus(run.sim, run.placement, back + 1, sf).title).toBe("Within your plan's limits");
  });
  it('⭐ STATUS — N8: past the liquidation line today, then liquidated — never "before the plan borrows again"', () => {
    const c = planMonthRun(facts({ price: 55_000, cbDebt: 80_000 }));
    const cf = { ...sf, monthsBackUnder: firstMonthUnderLimit(c.sim), support0: c.supportPath[0] };
    expect(c.placement.state, 'STATUS premise: past 86% today').toBe('cbPastLiquidation');
    expect(c.sim.liqMonth, 'STATUS premise: the month-0 reading seizes').toBe(0);
    expect(planStatus(c.sim, c.placement, 1, cf)).toEqual({
      tone: 'bad', title: 'Coinbase is at or past its 86% liquidation line', body: 'The policy moves nothing today.', fixes: [],
    });
    const later = planStatus(c.sim, c.placement, 2, cf);
    expect(later.tone).toBe('bad');
    expect(later.title).toBe('Coinbase has been liquidated — borrowing has ended');
    expect(later.body).toBe(`${fmtUSD(c.sim.rows[2].cbDebt)} of Coinbase debt survives it.`);
  });
  it('⭐ STATUS — over the sweep: every month after a liquidation reads it, in red, and none promises a recovery', () => {
    let post = 0;
    for (const { f, run: r } of RUNS) {
      const fx = { monthsBackUnder: firstMonthUnderLimit(r.sim), cbStop: r.placementInput.cbStop, support0: r.supportPath[0], coldBtc: f.coldBtc };
      for (const row of r.sim.rows) {
        if (row.m === 0 || !row.postLiquidation) continue;
        const st = planStatus(r.sim, r.placement, row.m, fx);
        expect(st.tone, 'STATUS post-liquidation is red').toBe('bad');
        expect([st.title, st.body ?? ''].join(' '), 'STATUS N8').not.toMatch(/borrows again|Within your plan|Back within/);
        post += 1;
      }
    }
    expect(post, 'STATUS the sweep reaches post-liquidation months').toBeGreaterThan(500);
  });
  it('⭐ STATUS — invariant 4: while Coinbase is over its limit, the month borrows nothing new on Coinbase', () => {
    // Coinbase borrows when Strike's debt moves to it (the refinance). Over the sweep: never in a month that ends over
    // the limit, and never in month 1 when today's move leaves it over (the status's fact).
    let over = 0;
    for (const { run: r } of RUNS) {
      for (const row of r.sim.rows) {
        if (row.m === 0) continue;
        const startsOver = row.m === 1 && shownUsdOf(r.placement.cbOverCeilingUsd) && r.placement.state !== 'unavailable';
        if (!startsOver && !cbOverLimitAtMonthEnd(row)) continue;
        over += 1;
        expect(row.refinancedUsd, `STATUS invariant 4, month ${row.m}`).toBe(0);
        expect(planMonthActions(r.sim, r.placement, row.m).some((x) => x.kind === 'refinance'), 'STATUS no refinance row').toBe(false);
      }
    }
    expect(over, 'STATUS the sweep reaches months over the limit').toBeGreaterThan(1_000);
    // What spare income does about it, by the run's own figures: "repays it" only when the month repays Coinbase; "no
    // spare income" only when the bills, the cash reserve or the minimum left none — and then nothing buys or draws.
    let spare = 0, none = 0;
    for (const { f, run: r } of RUNS) {
      const fx = { monthsBackUnder: firstMonthUnderLimit(r.sim), cbStop: r.placementInput.cbStop, support0: r.supportPath[0], coldBtc: f.coldBtc };
      for (const row of r.sim.rows) {
        if (row.m === 0) continue;
        const body = planStatus(r.sim, r.placement, row.m, fx).body ?? '';
        if (body.startsWith('Spare income repays it')) {
          spare += 1;
          expect(shownUsdOf(row.cbRepaidUsd), 'STATUS "repays it" repays Coinbase').toBe(true);
        } else if (body.startsWith('No spare income')) {
          none += 1;
          const left = Math.max(0, f.income - f.expenses) - row.strikeMinPaidUsd;
          expect([shownUsdOf(left), shownUsdOf(row.cbRepaidUsd), shownUsdOf(row.btcBoughtUsd), shownUsdOf(row.strikeDrawn)],
            'STATUS "no spare income" had none').toEqual([false, false, false, false]);
        }
      }
    }
    expect([spare > 500, none > 1_000], 'STATUS the sweep reaches both').toEqual([true, true]);
  }, 60_000);   // a sweep of all 600 runs: room for Node 26 in a loaded full suite
  it('⭐ STATUS — inside the limits: one green line, no catch-up', () => {
    const h = planMonthRun(HEALTHY);
    const st = planStatus(h.sim, h.placement, 1, { ...sf, monthsBackUnder: 1, support0: h.supportPath[0] });
    expect(st).toEqual({ tone: 'good', title: "Within your plan's limits", body: null, fixes: [] });
    // The engine refused the policy: every month says so in the Decision card's own sentence — over the limit today or
    // not, no claim about a limit at support (none is in force).
    const ig = planMonthRun(IGNORED);
    expect([ig.sim.policyApplied, ig.sim.policyIgnoredReason, shownUsdOf(ig.placement.cbOverCeilingUsd)],
      'STATUS premise: refused, and over the policy\'s limit today').toEqual([false, 'strikeLadder', true]);
    const igf = { ...sf, monthsBackUnder: firstMonthUnderLimit(ig.sim), support0: ig.supportPath[0] };
    for (let m = 1; m <= 12; m++) {
      expect(planStatus(ig.sim, ig.placement, m, igf), `STATUS ignored, month ${m}`)
        .toEqual({ tone: 'warn', title: policyIgnoredNote('strikeLadder'), body: null, fixes: [] });
    }
  });
});

describe('⭐ ROWS — D-R2-1: the month\'s to-do rows ARE the Decision face\'s schedule rows', () => {
  it('⭐ ROWS — kinds and amounts equal planSchedule\'s for every month; this month leads with Today\'s move', () => {
    let reached = 0;
    const kinds = new Set<ActionKind>();
    for (const { run } of RUNS) {
      const sched = planSchedule(run.sim, run.placement);
      for (const r of run.sim.rows) {
        if (r.m === 0) continue;
        const rows = planMonthActions(run.sim, run.placement, r.m).filter((x) => x.kind !== null);
        const want = [...(r.m === 1 ? sched.find((s) => s.m === 0)?.actions ?? [] : []), ...(sched.find((s) => s.m === r.m)?.actions ?? [])];
        expect(rows.map((x) => x.kind), 'ROWS kinds').toEqual(want.map((a) => a.kind));
        for (const x of rows) if (x.kind !== 'liquidation') expect(x.amount, 'ROWS every row has its amount').not.toBe('');
        reached += rows.length;
        for (const x of rows) if (x.kind !== null) kinds.add(x.kind);
      }
    }
    // Measured 2026-10-12: about 12,800 rows. The flat run at today's price never seizes on the way down, never calls Strike
    // and never sweeps Strike → cold — those kinds are the Decision face's (its own sweep reaches them).
    expect(reached, 'ROWS not vacuous').toBeGreaterThan(10_000);
    expect([...kinds].sort(), 'ROWS the sweep reaches these kinds').toEqual(expect.arrayContaining([
      'buy', 'cashToBills', 'coinbaseToCold', 'coldToCoinbase', 'debtShift', 'defenseShort', 'draw', 'payMinimum',
      'refinance', 'repayCoinbase', 'repayStrike', 'strikeToCoinbase', 'unpaid',
    ]));
  }, 60_000);   // a sweep of all 600 runs: past the 5 s default in a loaded full suite on Node 26
  it('⭐ ROWS — a month with no buy (or no draw) shows it muted, so a paused buy is visible', () => {
    const run = planMonthRun(OVER);
    const rows = planMonthActions(run.sim, run.placement, 1);
    expect(rows.map((r) => [r.label, r.amount, r.muted])).toEqual([
      ['Repay Coinbase', fmtUSD(run.sim.rows[1].cbRepaidUsd), false],
      ['Buy bitcoin', '—', true],
      ['Draw on Strike', '—', true],
    ]);
  });
  it('⭐ ROWS — bills nothing pays read as the Decision face says them: unpaid, never a guess at where from', () => {
    const run = planMonthRun(facts({ income: 2_500, price: 55_000 }));
    const r1 = run.sim.rows[1];
    expect(r1.unfundedUsd, 'ROWS premise: bills go unpaid').toBeGreaterThan(0.5);
    const row = planMonthActions(run.sim, run.placement, 1).find((r) => r.kind === 'unpaid');
    expect([row?.label, row?.note, row?.amount, row?.tone]).toEqual(['Bills go unpaid', null, fmtUSD(r1.unfundedUsd), 'warn']);
  });
  it('⭐ ROWS — today\'s legs say "today", never "can wait" (N5)', () => {
    const run = planMonthRun(HEALTHY);
    expect(todayActions(run.placement).length, 'ROWS the healthy move is made').toBeGreaterThan(0);
    const first = planMonthActions(run.sim, run.placement, 1)[0];
    expect([first.label, first.note]).toEqual(['Strike → Coinbase', 'today']);
  });
});

describe('⭐ VENUE — the owner\'s venue colours: Strike white, Coinbase blue, cold storage orange', () => {
  // The contract, written out — never derived from the table under test.
  const EXPECTED: Record<ActionKind, string[]> = {
    draw: ['strike'], cashToBills: [], unpaid: [], payMinimum: ['strike'], repayStrike: ['strike'], repayCoinbase: ['coinbase'],
    buy: [], strikeToCoinbase: ['strike', 'coinbase'], strikeToCold: ['strike', 'cold'], refinance: ['strike', 'coinbase'],
    coldToCoinbase: ['cold', 'coinbase'], strikeReleaseToCoinbase: ['strike', 'coinbase'], debtShift: ['coinbase', 'strike'],
    coldToStrike: ['cold', 'strike'], defenseShort: ['coinbase'], cashCure: ['strike'], coldCure: ['cold', 'strike'],
    strikeSale: ['strike'], coinbaseToCold: ['coinbase', 'cold'], liquidation: ['coinbase'],
  };
  it('⭐ VENUE — the palette, written out: Strike white, Coinbase blue, cold storage orange (the faces\' own tokens)', () => {
    expect(VENUE_COLOR).toEqual({ strike: 'var(--text-primary)', coinbase: 'var(--coinbase)', cold: 'var(--btc)' });
  });
  it('⭐ VENUE — every action kind\'s label names exactly its venues, in order', () => {
    for (const f of ACTION_FIELDS) expect(venuesOf(PLAN_ROW_LABELS[f.kind]), `VENUE ${f.kind}`).toEqual(EXPECTED[f.kind]);
    expect(venuesOf(PLAN_ROW_LABELS.strikeToCold)).toEqual(EXPECTED.strikeToCold);
  });
  it('⭐ VENUE — one venue fills the dot; two split it in the label\'s order; none keeps the tone; a "—" is a ring', () => {
    const row = (label: string, over: Partial<PlanRow> = {}): PlanRow => ({
      key: 'k', kind: null, tone: 'plain', venues: venuesOf(label), label, note: null, amount: '$1', muted: false, ...over,
    });
    expect(planRowDot(row('Repay Coinbase')).background).toBe(VENUE_COLOR.coinbase);
    expect(planRowDot(row('Draw on Strike')).background).toBe(VENUE_COLOR.strike);
    expect(planRowDot(row('Strike → Coinbase')).background)
      .toBe(`linear-gradient(90deg, ${VENUE_COLOR.strike} 0 50%, ${VENUE_COLOR.coinbase} 50% 100%)`);
    expect(planRowDot(row('Buy bitcoin', { tone: 'good' })).background).toBe('var(--green)');
    expect(planRowDot(row('Buy bitcoin', { muted: true }))).toEqual({ background: 'transparent', ring: 'var(--text-muted)' });
    const seg = venueSegments('Cold storage → Coinbase');
    expect(seg).toEqual([{ text: 'Cold storage', venue: 'cold' }, { text: ' → ', venue: null }, { text: 'Coinbase', venue: 'coinbase' }]);
  });
  it('⭐ VENUE — a warning shows in the note and the amount, so a venue dot never hides it; today in the accent', () => {
    const warn: PlanRow = { key: 'k', kind: 'debtShift', tone: 'warn', venues: ['coinbase', 'strike'], label: 'x', note: 'defends it', amount: '$1', muted: false };
    expect(planRowNoteColor(warn)).toBe('var(--amber)');
    expect(planRowAmountColor(warn)).toBe('var(--amber)');
    expect(planRowNoteColor({ ...warn, tone: 'plain', note: 'today' })).toBe('var(--orange)');
    expect(planRowAmountColor({ ...warn, tone: 'plain' })).toBeUndefined();
  });
});

describe('⭐ AFTER — box 3: both loans at month-end, Coinbase at the month\'s own support', () => {
  it('⭐ AFTER — the at-support figure reads the row\'s support; the tone is the engine\'s own verdict; the cliff is cbMetrics\'', () => {
    let metered = 0, unmetered = 0, cliffs = 0;
    for (const { run } of RUNS) {
      for (const r of run.sim.rows) {
        if (r.m === 0) continue;
        const a = planAfter(r, run.supportPath[r.m], run.placementInput.cbStop, run.sim.policyApplied);
        const cb = a.rows.find((x) => x.key === 'cb');
        if (!cb) continue;
        const over = r.cbCeilingHeadroomUsd !== null && -r.cbCeilingHeadroomUsd >= 0.5;   // over by a shown dollar
        expect(cb.tone === 'warn', 'AFTER tone = the engine\'s headroom').toBe(over);
        if (r.cbCollateralBtc > 0) {
          expect(a.meter?.over, 'AFTER meter = the engine\'s headroom').toBe(over);
          expect(a.meter?.atSupport, 'AFTER meter at the row\'s support').toBeCloseTo(r.cbDebt / (r.cbCollateralBtc * run.supportPath[r.m]), 12);
          if (a.meter) {
            expect(planMeterAria(a.meter), 'AFTER the meter read aloud').toBe(`Coinbase is at ${Math.round(a.meter.atSupport * 100)}% of its `
              + `collateral's value at support; your limit is ${Math.round(a.meter.limit * 100)}%, and it seizes at ${Math.round(CB_LLTV * 100)}%.`);
          }
          metered += 1;
        } else {
          // A liquidation at the opening leaves debt and no collateral: nothing to meter, and the words say so.
          expect(a.meter, 'AFTER no collateral, no meter').toBeNull();
          expect(cb.value, 'AFTER no collateral').toBe(`${fmtUSD(r.cbDebt)} · no collateral`);
          unmetered += 1;
        }
        const seize = a.rows.find((x) => x.key === 'seize');
        const liq = cbSeizurePrice(r);
        expect(seize !== undefined, 'AFTER the cliff is the face\'s one rule').toBe(liq !== null && liq < r.price);
        if (seize && liq !== null) {
          expect(seize.value, 'AFTER cliff').toBe(`${fmtUSD(liq)} · ${fmtBelowPct(1 - liq / r.price)} below today`);
          cliffs += 1;
        }
      }
    }
    expect([metered > 1_000, unmetered > 100, cliffs > 1_000], 'AFTER the sweep reaches all three').toEqual([true, true, true]);
  }, 60_000);   // a sweep of all 600 runs: room for Node 26 in a loaded full suite
  it('⭐ AFTER — a leg with nothing owed shows its coins, or just "nothing owed" — never "₿0.000 held"', () => {
    const run = planMonthRun(OVER);
    const base = run.sim.rows[1];
    const of = (over: Partial<CyclingRow>) => planAfter({ ...base, ...over }, run.supportPath[1], run.placementInput.cbStop, true).rows;
    expect(of({ strikeBalance: 0, strikeCollateralBtc: 0 }).find((x) => x.key === 'strike')?.value).toBe('nothing owed');
    expect(of({ strikeBalance: 0, strikeCollateralBtc: 0.25 }).find((x) => x.key === 'strike')?.value).toBe('nothing owed · ₿0.250 held');
    expect(of({ cbDebt: 0, cbCollateralBtc: 0.1 }).find((x) => x.key === 'cb')?.value).toBe('nothing owed · ₿0.100 held');
    expect(of({ cbDebt: 0, cbCollateralBtc: 0 }).find((x) => x.key === 'cb'), 'AFTER no Coinbase leg, no row').toBeUndefined();
    // THE one per-row seizure rule: the liquidation month's row still holds its coins, and has no cliff (cbSeizurePrice).
    expect(of({}).find((x) => x.key === 'seize'), 'AFTER premise: a cliff on the live row').toBeDefined();
    expect(of({ postLiquidation: true }).find((x) => x.key === 'seize'), 'AFTER no cliff once liquidated').toBeUndefined();
    // F11's words at the edge: a cliff a fraction of a percent under the price is "less than 1%", never "0%".
    const edge = of({ cbDebt: 0.86 * 0.996 * base.price * base.cbCollateralBtc }).find((x) => x.key === 'seize');
    expect(edge?.value, 'AFTER less than 1%').toMatch(/· less than 1% below today$/);
    // The engine refused the policy: no limit at support is in force — no meter, no over-the-limit tone; the figures stay.
    const ig = planMonthRun(IGNORED);
    const on = planAfter(ig.sim.rows[1], ig.supportPath[1], ig.placementInput.cbStop, true);
    const off = planAfter(ig.sim.rows[1], ig.supportPath[1], ig.placementInput.cbStop, ig.sim.policyApplied);
    expect([on.meter !== null, on.rows.find((x) => x.key === 'cb')?.tone], 'AFTER premise: the policy\'s limit would meter it amber')
      .toEqual([true, 'warn']);
    expect([off.meter, off.rows.find((x) => x.key === 'cb')?.tone], 'AFTER ignored: no meter, no amber').toEqual([null, 'plain']);
    expect(off.rows.find((x) => x.key === 'cb')?.value, 'AFTER ignored: the figures stay').toBe(on.rows.find((x) => x.key === 'cb')?.value);
  });
});

describe('⭐ TRACK — the scrubber\'s track is the year: amber over the limit, green within', () => {
  it('⭐ TRACK — past months faint; the over household amber until its cure month, then green', () => {
    const run = planMonthRun(OVER);
    const back = firstMonthUnderLimit(run.sim) ?? 0;
    const g = monthTrack(run.sim, 4);
    const stops = g.slice('linear-gradient(90deg, '.length, -1).split(/, (?=var)/);
    expect(stops.length, 'TRACK twelve bands').toBe(12);
    for (let k = 1; k <= 12; k++) {
      const colour = stops[k - 1].split(' ')[0];
      const want = k < 4 ? 'var(--text-faint)' : (k - 4 + 1) < back ? 'var(--amber)' : 'var(--green)';
      expect(colour, `TRACK month ${k}`).toBe(want);
    }
  });
  it('⭐ TRACK — a liquidation is red from its month on, never green', () => {
    const c = planMonthRun(facts({ price: 55_000, cbDebt: 80_000 }));
    const stops = monthTrack(c.sim, 1).slice('linear-gradient(90deg, '.length, -1).split(/, (?=var)/);
    expect(stops.map((x) => x.split(' ')[0]), 'TRACK red').toEqual(Array(12).fill('var(--red)'));
    // The engine refused the policy: no limit at support is in force, so no month is "within" it — never green.
    const ig = planMonthRun(IGNORED);
    expect(ig.sim.policyApplied, 'TRACK premise: refused').toBe(false);
    const istops = monthTrack(ig.sim, 1).slice('linear-gradient(90deg, '.length, -1).split(/, (?=var)/);
    expect(istops.map((x) => x.split(' ')[0]), 'TRACK ignored').toEqual(Array(12).fill('var(--text-faint)'));
  });
});

describe('⭐ FOOT — the minimum, the Ledger and the year, as words (never "$0", never "the 1th")', () => {
  it('⭐ FOOT — the due day\'s ordinal', () => {
    const want: Record<number, string> = {
      1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 14: '14th',
      21: '21st', 22: '22nd', 23: '23rd', 24: '24th', 28: '28th', 31: '31st',
    };
    for (const [n, w] of Object.entries(want)) expect(fmtDayOrdinal(Number(n)), `FOOT ${n}`).toBe(w);
  });
  it('⭐ FOOT — the minimum: the statement\'s figure, else the month\'s interest; nothing owed, no line (never a "MISSED")', () => {
    expect(planMinimumOwed(250, 216.67), 'FOOT the statement wins').toBe(250);
    expect(planMinimumOwed(null, 216.67), 'FOOT else the interest Strike bills').toBe(216.67);
    expect(planMinimumLine(216.67, 1)).toBe("Strike's minimum is due the 1st");
    expect(planMinimumLine(0.3, 15), 'FOOT nothing owed').toBeNull();
    expect(planInterestRollsLine(216.67, 22)).toBe("Strike's interest, $217, rolls into the line on the 22nd.");
    expect(planInterestRollsLine(0.3, 15), 'FOOT nothing to roll').toBeNull();
    expect(planInterestRollsNote(3)).toBe('rolls in the 3rd');
  });
  it('⭐ FOOT — the yearly payment, one day or many', () => {
    expect(planNdpLine({ status: 'never', daysRemaining: null })).toBe("Strike's yearly payment (NDP) isn't recorded yet.");
    expect(planNdpLine({ status: 'overdue', daysRemaining: -3 })).toBe("Strike's yearly payment (NDP) is overdue.");
    expect(planNdpLine({ status: 'soon', daysRemaining: 1 })).toBe("Strike's yearly payment (NDP) is due in 1 day.");
    expect(planNdpLine({ status: 'soon', daysRemaining: 0 })).toBe("Strike's yearly payment (NDP) is due today.");
    expect(planNdpLine({ status: 'upcoming', daysRemaining: 45 })).toBe("Strike's yearly payment (NDP) is due in 45 days.");
  });
  it('⭐ FOOT — the Ledger so far names only what was logged', () => {
    expect(planLedgerParts({ draw: 0, buyBtc: 0, paydown: 0, cbPaydown: 0 }), 'FOOT nothing logged').toBeNull();
    expect(planLedgerParts({ draw: 4_000, buyBtc: 0.0002, paydown: 0, cbPaydown: 0 })).toBe('$4,000 drawn');
    expect(planLedgerParts({ draw: 4_000, buyBtc: 0.02, paydown: 500, cbPaydown: 0 })).toBe('$4,000 drawn · ₿0.020 bought · $500 paid');
    expect(planLedgerParts({ draw: 0, buyBtc: 0, paydown: 200, cbPaydown: 300 }), 'FOOT paid on both loans').toBe('$500 paid');
    expect(planLedgerParts({ draw: 0, buyBtc: 0, paydown: 0, cbPaydown: 300 }), 'FOOT a Coinbase paydown alone').toBe('$300 paid');
    // Daily's bars: the plan's month 1 in the Ledger's own streams. Written out per to-do kind — what the owner logs as a
    // Strike draw (the bills', a defense's) and as a paydown on either loan (spare income's, a refinance's payment to
    // Strike, a defense's to Coinbase, the reserve's margin cure).
    const DRAWN: ActionKind[] = ['draw', 'debtShift'];
    const PAID: ActionKind[] = ['repayStrike', 'repayCoinbase', 'refinance', 'debtShift', 'cashCure'];
    const reached = new Set<ActionKind>();
    for (const { run } of RUNS) {
      const acts = planSchedule(run.sim, run.placement).find((s) => s.m === 1)?.actions ?? [];
      const sum = (kinds: ActionKind[]) => acts.filter((a) => kinds.includes(a.kind)).reduce((s, a) => s + (a.usd ?? 0), 0);
      const t = planLedgerTargets(run.sim.rows[1]);
      // A schedule row under the dust floor is not shown, so the two may differ by less than a shown dollar per kind.
      expect(Math.abs(t.draw - sum(DRAWN)), 'FOOT Daily drawn = the draw rows').toBeLessThan(1);
      expect(Math.abs(t.paid - sum(PAID)), 'FOOT Daily paid = the paydown rows').toBeLessThan(2.5);
      expect(t.buyBtc, 'FOOT Daily bought').toBeCloseTo(run.sim.rows[1].btcBoughtUsd / run.sim.rows[1].price, 12);
      for (const a of acts) if (PAID.includes(a.kind) || DRAWN.includes(a.kind)) reached.add(a.kind);
    }
    expect([...reached].sort(), 'FOOT the sweep reaches every kind but the margin cure')
      .toEqual(['debtShift', 'draw', 'refinance', 'repayCoinbase', 'repayStrike']);
    // The sign-off pointer's words: the month, and the Ledger so far or nothing yet (I31 — never composed in the card).
    expect(planSignoffLine(3), 'FOOT the sign-off pointer').toBe('Month 3 awaits sign-off in the Ledger');
    expect(planSignoffSub(null), 'FOOT nothing logged yet').toBe('Nothing logged yet this month');
    expect(planSignoffSub('$4,000 drawn'), 'FOOT so far').toBe('So far: $4,000 drawn');
  });
  it('⭐ FOOT — next month and the savings need are the run\'s own rows', () => {
    const run = planMonthRun(HEALTHY);
    // The rule, written out: the run's month 2 — draw, buy, repay Coinbase, repay Strike — each only above the floor.
    const nextOf = (r: CyclingRow): string | null => {
      const parts = [
        r.strikeDrawn >= 0.5 ? `draw ${fmtUSD(r.strikeDrawn)}` : null,
        r.btcBoughtUsd >= 0.5 ? `buy ₿${(r.btcBoughtUsd / r.price).toFixed(4)}` : null,
        r.cbRepaidUsd >= 0.5 ? `repay Coinbase ${fmtUSD(r.cbRepaidUsd)}` : null,
        r.strikeRepaidUsd >= 0.5 ? `repay Strike ${fmtUSD(r.strikeRepaidUsd)}` : null,
      ].filter((p) => p !== null);
      return parts.length > 0 ? `Next month: ${parts.join(' · ')}` : null;
    };
    let differ = 0;
    for (const { run: r } of RUNS) {
      const want = nextOf(r.sim.rows[2]);
      expect(planNextMonthLine(r.sim), 'FOOT next month').toBe(want);
      if (want !== nextOf(r.sim.rows[1])) differ += 1;
    }
    expect(differ, 'FOOT the sweep tells month 2 from month 1').toBeGreaterThan(50);
    expect(planSavingsLine(run.sim, 12), 'FOOT healthy: bills all paid').toBeNull();
    // N counts the months with a gap, within the months left — not the months left.
    const gaps = { ...run.sim, rows: run.sim.rows.map((r) => ({ ...r, unfundedUsd: r.m === 2 ? 100 : r.m === 5 ? 50 : 0 })) };
    expect(planSavingsLine(gaps, 12), 'FOOT two gaps').toBe('Needs ~$150 from savings over the next 2 months');
    expect(planSavingsLine(gaps, 4), 'FOOT one gap left').toBe('Needs ~$100 from savings over the next 1 month');
    const short = planMonthRun(facts({ income: 2_500, price: 55_000 }));
    const unpaid = short.sim.rows.filter((r) => r.m >= 1 && r.m <= 12 && r.unfundedUsd >= 0.5);
    expect(unpaid.length, 'FOOT premise: bills go unpaid').toBeGreaterThan(0);
    expect(planSavingsLine(short.sim, 12)).toBe(`Needs ~${fmtUSD(unpaid.reduce((a, r) => a + r.unfundedUsd, 0))} from savings `
      + `over the next ${unpaid.length} month${unpaid.length === 1 ? '' : 's'}`);
    expect(planPriceLine(100_000, 66_519)).toBe('BTC $100,000 · 1.50× support');
    expect(planPriceLine(100_000, 0)).toBe('BTC $100,000');
  });
});

describe('⭐ BREAKER — invariant 10: offline, the cache and its date; with neither, it says so', () => {
  const seed = (iso: string) => ({ state: { broken: false, monthsBelow: 0, brokenMonth: null, monthsAtOrAbove: 0 }, lastMonthEndISO: iso });
  it('⭐ BREAKER — today\'s fold wins; the cache stands in; nothing → loading or none, never silent', () => {
    expect(planBreakerSource(seed('2026-09-30'), seed('2026-08-31'), false)).toEqual({ kind: 'fresh', seed: seed('2026-09-30') });
    expect(planBreakerSource(null, seed('2026-08-31'), true)).toEqual({ kind: 'cached', seed: seed('2026-08-31'), settled: false });
    expect(planBreakerSource(null, seed('2026-08-31'), false)).toEqual({ kind: 'cached', seed: seed('2026-08-31'), settled: true });
    expect(planBreakerSource(null, null, true)).toEqual({ kind: 'loading' });
    expect(planBreakerSource(null, null, false)).toEqual({ kind: 'none' });
    expect(planBreakerLine({ kind: 'fresh', seed: seed('2026-09-30') }), 'BREAKER fresh says nothing').toBeNull();
    expect(planBreakerLine({ kind: 'cached', seed: seed('2026-09-30'), settled: true })).toBe(
      "Price history hasn't loaded — the breaker as of 30 Sep 2026, this device's last reading.");
    // The history is fetched on every visit: while it loads, the cache runs the month without a line (a line that showed
    // for the fetch and vanished would jump the card on every open); it speaks once the fetch has failed.
    expect(planBreakerLine(planBreakerSource(null, seed('2026-09-30'), true)), 'BREAKER cached while loading: no line').toBeNull();
    expect(planBreakerLine(planBreakerSource(null, seed('2026-09-30'), false)), 'BREAKER cached once it failed').toMatch(/^Price history hasn't loaded/);
    expect(planBreakerLine({ kind: 'loading' })).toMatch(/assumes the model isn't treated as broken/);
    expect(planBreakerLine({ kind: 'none' })).toMatch(/didn't load — this month assumes the model isn't treated as broken/);
    // The cache is read through the engine's own rule: a damaged one is none, a sound one is the stored object itself.
    const ok = seed('2026-09-30');
    expect(planBreakerCacheOf(ok), 'BREAKER a sound cache is the stored object itself').toBe(ok);
    expect(planBreakerCacheOf(null), 'BREAKER none').toBeNull();
    expect(planBreakerCacheOf({}), 'BREAKER malformed cache: {}').toBeNull();
    expect(planBreakerCacheOf({ ...ok, state: { ...ok.state, broken: 'yes' } }), 'BREAKER malformed cache: broken not a boolean').toBeNull();
    expect(planBreakerCacheOf({ ...ok, state: { ...ok.state, monthsBelow: -1 } }), 'BREAKER malformed cache: a negative count').toBeNull();
    expect(planBreakerCacheOf({ state: ok.state }), 'BREAKER malformed cache: no date').toBeNull();
    expect(planBreakerCacheOf({ ...ok, lastMonthEndISO: '' }), 'BREAKER malformed cache: not a date').toBeNull();
    // A damaged cache never reaches the run: the month runs as with no cache at all.
    expect(planMonthRun(facts({ breakerSeed: planBreakerCacheOf({}) })).sim, 'BREAKER the run without it').toEqual(planMonthRun(facts()).sim);
  });
});

describe('⭐ LOGGED — a past month shows what the Ledger recorded', () => {
  const entry = (over: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry => ({
    month: 2, date: '2026-08-01', btcBought: 0.05, income: 5_000, paydown: 0, strikeBal: 12_000, strikeLtv: 0.12,
    loggedAt: 1, expensesActual: 4_000, ...over,
  });
  it('⭐ LOGGED — past-tense rows, no zero, and the month-end the Ledger kept', () => {
    expect(loggedMonthRows(entry()).map((r) => [r.label, r.amount])).toEqual([['Drew on Strike', '$4,000'], ['Bought bitcoin', '₿0.0500']]);
    expect(loggedMonthRows(entry({ expensesActual: 0, btcBought: 0 }))).toEqual([]);
    expect(loggedMonthAfter(entry({ cbBal: 30_000, cbLtv: 0.3 })).map((r) => r.value)).toEqual(['$12,000 · 12.0% LTV', '$30,000 · 30.0% LTV']);
  });
  it('⭐ LOGGED — logged, awaiting sign-off, or nothing logged', () => {
    expect(loggedMonthStatus(entry(), 2).title).toBe('Month 2 is logged');
    expect(loggedMonthStatus(entry({ confirmed: false }), 2).title).toBe('Month 2 awaits sign-off in the Ledger');
    expect(loggedMonthStatus(undefined, 2)).toEqual({ tone: 'plain', title: 'Nothing logged for month 2', body: null, fixes: [] });
  });
});

describe('⭐ CRASH — D13: on a crash day the plan\'s month is the monthly model\'s estimate', () => {
  it('⭐ CRASH — the crash household\'s month 1 carries a defense row, in amber, naming Coinbase', () => {
    const run = planMonthRun(CRASHED);
    const rows = planMonthActions(run.sim, run.placement, 1);
    const defense = rows.find((r) => r.kind === 'debtShift' || r.kind === 'coldToCoinbase' || r.kind === 'strikeReleaseToCoinbase');
    expect(defense, 'CRASH a defense row').toBeDefined();
    expect(defense?.venues, 'CRASH it names Coinbase').toContain('coinbase');
    expect(defense?.tone).toBe('warn');
  });
});
