import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planMonthRun, firstMonthUnderLimit, type PlanMonthFacts, type PlanMonthRun } from '../planRun';
import { PLAN_POLICY_DEFAULTS } from '../../../lib/planPolicy';
import {
  planGoalLine, planMonthSummary, goalPair, netBtcText, planStatus, GOAL_UNPAID_BODY, planMonthActions,
} from '../planMonthView';
import { buildSupportPath } from '../supportPolicyInputs';
import {
  planSchedule, scheduleToText, GOAL_MARK_TEXT, goalMarkLabel, moveCard, atGoalThisMonthOf, netCoinsThisMonthOf, outcomeTiles,
  coinbaseLoanLine, type MoveCardContext,
} from '../decisionView';
import {
  policyPauseReason, policyReading, policyHeadline, neverDrawsNote, drawPauseClause, policyStopSentence, goalStopWords,
  goalHeadlineTail, effectivePolicySettings, DEFAULT_SUPPORT_POLICY_SETTINGS, ZONE_LABEL, GOAL_BUY_ZONE_LABEL,
  GOAL_STAND_DOWN_WORDS, policyColdNote, policyColdGoalNote,
} from '../supportPolicyView';
import { coldCardView } from '../coldCardView';
import {
  noBillsNote, playbookNote, verdictVsNeverDraw, verdictBasisClause, neverDrawTieHead, KEPT_BASIS_CLAUSE,
  GOAL_REFINANCE_CLAUSE,
} from '../cyclingFaceView';
import { policyUnpaidNote, GOAL_UNPAID_CAUSE } from '../supportPolicyView';
import { strikeLimitTail } from '../ownershipFaceView';
import { strikeAvailableCredit } from '../../../simulation/strikeCredit';
import { futuresReadout } from '../futuresView';
import type { FuturesSummary } from '../../../simulation/monteCarlo';
import { PLAN_CLAMP } from '../planClamp';
import { fmtUSD, shownUsd } from '../../../utils/format';
import {
  runCyclingSim, allInEquity, baselineAllInEquity, type CyclingInputs, type CyclingResult, type CyclingRow,
} from '../../../simulation/cyclingSim';
import { netCoinsBtc } from '../../../simulation/goal';
import { SP_REPRO, SP_START, supportPathFor, policyFor, V2_DEFAULTS, a5Cases } from '../../../simulation/__tests__/supportPolicyPaths';

/**
 * BL14 — the goal's words (Batch 1, build 2; spec pbloc-spec-batch-1-v1 §2.2). Every face that runs the plan runs it with
 * the goal, so every sentence that says why a month did not borrow or buy must name the goal when the goal was why — and
 * with no goal set, every one of them is byte-identical. ⚠ SYNTHETIC round figures — this repo is public.
 */

// ── THIS MONTH — the plan of record's own run ────────────────────────────────────────────────────────────────────

const TODAY = '2026-10-12';
const facts = (over: Partial<PlanMonthFacts> = {}): PlanMonthFacts => ({
  todayISO: TODAY, price: 100_000, plan: { ...PLAN_POLICY_DEFAULTS },
  income: 6_000, expenses: 4_000, blocApr: 13, cbAprPct: 6.27, creditLine: 40_000,
  strikeBalance: 20_000, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, cbDebt: 50_000,
  strikeLiquidationLtvPct: 85, hold: { inHold: false, throughISO: null }, breakerSeed: null, strikeMinFromIncome: false,
  goalNetBtc: null,
  ...over,
});
const SUP = buildSupportPath(new Date(TODAY), 12);
const month = (f: PlanMonthFacts, m = 1): { row: CyclingRow; sum: string } => {
  const run = planMonthRun(f);
  const row = run.sim.rows.find((r) => r.m === m) as CyclingRow;
  return { row, sum: planMonthSummary(run.sim, run.placement, m, SUP[m], f.goalNetBtc) };
};

describe('⭐ GOAL LINE — THIS MONTH\'s and Daily\'s goal line', () => {
  it('⭐ GOAL LINE — no goal: no line, and the summary is byte-identical to one built without a goal', () => {
    for (const over of [{}, { cbDebt: 0, strikeBalance: 0 }, { income: 3_000 }, { price: 250_000 }]) {
      const run = planMonthRun(facts(over));
      for (const row of run.sim.rows) {
        expect(planGoalLine(row, null), 'GOAL LINE none').toBeNull();
        expect(planMonthSummary(run.sim, run.placement, row.m, SUP[row.m] ?? 0, null), 'GOAL LINE summary')
          .toBe(planMonthSummary(run.sim, run.placement, row.m, SUP[row.m] ?? 0));
      }
    }
  });

  it('⭐ GOAL LINE — under the goal: the month\'s figure, after a month of Coinbase interest, at today\'s price', () => {
    const { row, sum } = month(facts({ goalNetBtc: 2 }));
    // 2.5 ₿ held; $20,000 + $50,000 × (1 + 6.27%/12) owed, at $100,000.
    expect(row.netCoinsBtc).toBeCloseTo(2.5 - (20_000 + 50_000 * (1 + 0.0627 / 12)) / 100_000, 12);
    expect(planGoalLine(row, 2)).toBe('Net coins this month: ₿1.797 of your ₿2.000 goal, at today\'s price.');
    expect(sum).toContain('Net coins this month, at today\'s price once this month\'s Coinbase interest is added, are ₿1.797 — under your ₿2.000 goal. ');
  });

  it('⭐ GOAL LINE — at the goal: the legs the month actually repaid (no order word: the restore can reorder them)', () => {
    // Coinbase is over its limit at support, so the restore takes the spare income first — the month repays Coinbase.
    const over = month(facts({ goalNetBtc: 1.5 }));
    expect(over.row.restoreUsd, 'premise: a restore month').toBeGreaterThan(0);
    expect(planGoalLine(over.row, 1.5))
      .toBe('At your goal (net coins this month: ₿1.797 of ₿1.500): the plan borrows and buys nothing — spare income repays Coinbase.');
    expect(over.sum).toContain('are ₿1.797 — at or above your ₿1.500 goal, so the plan borrows and buys nothing. ');
    // Coinbase inside its limit: the goal's own order — Strike first.
    const inside = month(facts({ goalNetBtc: 1.5, cbDebt: 10_000 }));
    expect(planGoalLine(inside.row, 1.5))
      .toBe('At your goal (net coins this month: ₿2.199 of ₿1.500): the plan borrows and buys nothing — spare income repays Strike.');
    // Nothing owed: the plan holds, and the spare income stays.
    const free = month(facts({ goalNetBtc: 1.5, cbDebt: 0, strikeBalance: 0 }));
    expect(planGoalLine(free.row, 1.5))
      .toBe('At your goal (net coins this month: ₿2.500 of ₿1.500): the plan holds — it borrows and buys nothing, and $2,000.00 of spare income stays with you.');
    expect(free.sum, 'no Coinbase interest to name').toContain('Net coins this month, at today\'s price, are ₿2.500');
    // Bills over income: no spare income at all — said, never "spare income repays".
    const short = month(facts({ goalNetBtc: 1.5, income: 3_000 }));
    expect(short.row.unfundedUsd, 'premise: bills go unpaid at the goal (the plan borrows nothing)').toBeGreaterThan(0);
    expect(planGoalLine(short.row, 1.5))
      .toBe('At your goal (net coins this month: ₿1.797 of ₿1.500): the plan borrows and buys nothing — no spare income is left this month to repay a loan.');
  });

  it('⭐ GOAL LINE — both legs repaid, and spare income kept once both are repaid (synthetic rows)', () => {
    const base = month(facts({ goalNetBtc: 1.5 })).row;
    const both = { ...base, strikeRepaidUsd: 900, cbRepaidUsd: 1_100 };
    expect(planGoalLine(both, 1.5)).toBe('At your goal (net coins this month: ₿1.797 of ₿1.500): the plan borrows and buys nothing — spare income repays Strike and Coinbase.');
    const last = { ...base, strikeRepaidUsd: 0, cbRepaidUsd: 500, strikeBalance: 0, cbDebt: 0, goalHeldUsd: 1_500 };
    expect(planGoalLine(last, 1.5)).toBe('At your goal (net coins this month: ₿1.797 of ₿1.500): the plan borrows and buys nothing — spare income repays Coinbase, and $1,500.00 of spare income stays with you.');
    const dust = { ...base, strikeRepaidUsd: 0.2, cbRepaidUsd: 0.3, strikeBalance: 0, cbDebt: 0, goalHeldUsd: 0.4 };
    expect(planGoalLine(dust, 1.5), 'dust is never named').toBe('At your goal (net coins this month: ₿1.797 of ₿1.500): the plan holds — it borrows and buys nothing.');
  });

  it('⭐ GOAL PAIR — under the goal never prints as the goal; at it (the engine\'s verdict) three places; a negative sign before ₿', () => {
    expect(goalPair(1.9996, 2)).toEqual({ net: '1.9996', goal: '2.0000' });
    expect(goalPair(1.99999999, 2)).toEqual({ net: '1.99999999', goal: '2.00000000' });
    expect(goalPair(2 - 1e-13, 2, true), 'at by the engine\'s dust rule').toEqual({ net: '2.000', goal: '2.000' });
    expect(goalPair(2.5, 2)).toEqual({ net: '2.500', goal: '2.000' });
    expect(netBtcText('-0.200')).toBe('−₿0.200');
    expect(netBtcText('1.797')).toBe('₿1.797');
    const under = { ...month(facts({ goalNetBtc: 2 })).row, netCoinsBtc: -0.2 };
    expect(planGoalLine(under, 2)).toBe('Net coins this month: −₿0.200 of your ₿2.000 goal, at today\'s price.');
  });
});

// ── the faces — the engine's own rows ────────────────────────────────────────────────────────────────────────────

type Household = Omit<CyclingInputs, 'pricePath' | 'supportPolicy'>;
const TWO_LOANS: Household = {
  ...SP_REPRO, strikeCollateralBtc: 2, strikeBalance: 20_000, strikeCreditLine: 40_000,
  cbCollateralBtc: 2, cbDebt: 30_000, openingColdBtc: 0.5,
};
const S = effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS }, PLAN_CLAMP);
const sim = (b: Household, k: number | ((m: number) => number), goalNetBtc: number | null = null, months = 12): CyclingResult => {
  const support = supportPathFor(SP_START, months);
  const r = runCyclingSim({
    ...b, supportPolicy: policyFor(support, V2_DEFAULTS),
    pricePath: support.map((s, m) => (typeof k === 'number' ? k : k(m)) * s), goalNetBtc,
  });
  expect(r.policyApplied, 'premise: the policy (and so the goal) is applied').toBe(true);
  return r;
};
const opening = (b: Household, k: number): number => netCoinsBtc({
  strikeBtc: b.strikeCollateralBtc, cbBtc: b.cbCollateralBtc, coldBtc: b.openingColdBtc ?? 0,
  strikeBalanceUsd: b.strikeBalance, cbDebtUsd: b.cbDebt, price: k * supportPathFor(SP_START, 1)[0],
}) as number;

describe('⭐ GOAL WHY — the faces\' month sentence and verdict name the goal when the goal was why', () => {
  it('⭐ GOAL WHY — the pause reason: the goal, whatever the zone, then what spare income repaid or kept', () => {
    let checked = 0;
    for (const k of [1.5, 2.6, 3.5]) {
      const r = sim(TWO_LOANS, k, opening(TWO_LOANS, k) * 0.5);
      const row = r.rows[1];
      expect(row.atGoal, `WHY k${k} premise`).toBe(true);
      const why = policyPauseReason(row, S, SP_REPRO.expenses) as string;
      expect(why.startsWith(`${goalStopWords(false)} Your paycheck pays the bills.`), `WHY k${k}: ${why}`).toBe(true);
      expect(why, `WHY k${k} the repayment`).toContain('Spare income repaid $2,000 of Strike debt.');
      expect(why, `WHY k${k} no zone reason`).not.toMatch(/no room to borrow|buy zone|pays debt down \(/);
      checked += 1;
    }
    expect(checked).toBe(3);
    // Nothing owed: the kept spare income.
    const free = sim({ ...TWO_LOANS, strikeBalance: 0, cbDebt: 0 }, 1.5, 0.5);
    expect(policyPauseReason(free.rows[1], S, SP_REPRO.expenses))
      .toBe(`${goalStopWords(false)} Your paycheck pays the bills. $2,000 of spare income stays with you.`);
    // Without the goal, the same month draws — so it has no pause reason at all (the identity the faces rely on).
    expect(policyPauseReason(sim(TWO_LOANS, 1.5).rows[1], S, SP_REPRO.expenses), 'WHY no goal: a drawing month').toBeNull();
  });

  it('⭐ GOAL WHY — the policy card\'s headline keeps the zone and adds the goal; below the goal it is unchanged', () => {
    const at = sim(TWO_LOANS, 1.5, opening(TWO_LOANS, 1.5) * 0.5);
    const head = policyHeadline(policyReading(at, 1, SP_REPRO.expenses), S);
    // δ-L4 — never "Buy with the line" when the plan borrows and buys nothing: the buy zone reads as a zone.
    expect(head.text).toBe(`${GOAL_BUY_ZONE_LABEL} · 1.50× support${goalHeadlineTail(false)}`);
    expect(head.text, 'GOAL HEAD no imperative').not.toContain(ZONE_LABEL.accumulate);
    expect(head.tone, 'GOAL HEAD the zone\'s tone').toBe('good');
    const none = sim(TWO_LOANS, 1.5);
    const far = sim(TWO_LOANS, 1.5, 1_000);
    expect(policyHeadline(policyReading(far, 1, SP_REPRO.expenses), S), 'below: byte-identical')
      .toEqual(policyHeadline(policyReading(none, 1, SP_REPRO.expenses), S));
    expect(policyReading(far, 1, SP_REPRO.expenses).atGoal).toBe(false);
  });

  it('⭐ GOAL WHY — the verdict\'s stop clause and sentence: "at your goal"; a run held at it never borrows, and says so', () => {
    const at = sim(TWO_LOANS, 1.5, opening(TWO_LOANS, 1.5) * 0.5);
    expect([at.stopMonth, at.drawingResumedMonth, at.firstDrawMonth], 'premise').toEqual([1, null, null]);
    expect(drawPauseClause(at, S)).toBe(' · borrowing stopped at month 1 (at your goal)');
    expect(policyStopSentence(at, S)).toBe("Borrowing stops in month 1 (at your goal) and doesn't resume on this path.");
    const rd = policyReading(at, 1, SP_REPRO.expenses);
    expect(rd.neverDraws).toBe('goal');
    expect(neverDrawsNote(rd, S)).toBe('Net coins are at your goal in every buy-zone month on this path, so the plan never borrows.');
  });

  it('⭐ GOAL WHY — never borrowing, partly at the goal: the mixed reason, true of every buy-zone month', () => {
    const full: Household = { ...TWO_LOANS, strikeBalance: 40_000, cycleMonths: 999 };   // the line full, no refinance to free it
    const none = sim(full, 1.5);
    expect(policyReading(none, 1, SP_REPRO.expenses).neverDraws, 'premise: the line never has room').toBe('line');
    const r = sim(full, 1.5, opening(full, 1.5) + 0.05);
    expect(r.firstDrawMonth, 'premise: it never draws').toBeNull();
    expect(r.rows.find((x) => x.m > 0 && x.atGoal === true)?.m, 'premise: the goal is reached midway').toBe(3);
    const rd = policyReading(r, 1, SP_REPRO.expenses);
    expect(rd.neverDraws).toBe('goalMixed');
    expect(neverDrawsNote(rd, S)).toBe("The buy zone comes, but in each of its months either the limits at support (or Strike's own line) leave no room to borrow, or net coins are at your goal — so the plan never borrows.");
  });

  it('⭐ GOAL WHY — a run that reaches the goal later, or never, keeps the zone\'s words', () => {
    // Re-entry: three hold months at the goal, then a fall to the buy zone below it — the run draws, so no never-draws reason.
    const k = (m: number): number => (m <= 3 ? 2.6 : 1.6);
    const pre = sim(TWO_LOANS, k, 0.001);
    const goal = ((pre.rows[1].netCoinsBtc as number) + (pre.rows[4].netCoinsBtc as number)) / 2;
    const re = sim(TWO_LOANS, k, goal);
    expect(re.firstDrawMonth, 'premise: it draws after the fall').toBe(4);
    expect(policyReading(re, 4, SP_REPRO.expenses).neverDraws).toBeNull();
    // Never at the goal: every sentence as with no goal.
    for (const kk of [0.95, 1.5, 2.6, 3.5]) {
      const none = sim(TWO_LOANS, kk);
      const far = sim(TWO_LOANS, kk, 1_000);
      expect(drawPauseClause(far, S), `far k${kk}`).toBe(drawPauseClause(none, S));
      expect(policyStopSentence(far, S), `far k${kk}`).toBe(policyStopSentence(none, S));
      for (let m = 0; m < far.rows.length; m++) {
        expect(policyPauseReason(far.rows[m], S, SP_REPRO.expenses), `far k${kk} m${m}`)
          .toBe(policyPauseReason(none.rows[m], S, SP_REPRO.expenses));
        expect(neverDrawsNote(policyReading(far, m, SP_REPRO.expenses), S))
          .toBe(neverDrawsNote(policyReading(none, m, SP_REPRO.expenses), S));
      }
    }
  });

  it('⭐ GOAL WHY — no bills: a fourth shape at the goal; without one, the three shapes byte-identical', () => {
    const row = { btcBoughtUsd: 0, payDownUsd: 2_000, restoreUsd: 0, atGoal: true, goalHeldUsd: 0 };
    expect(noBillsNote(row)).toBe(`No bills to fund. ${goalStopWords(false)} $2,000 of spare income paid debt down.`);
    expect(noBillsNote({ ...row, payDownUsd: 0, goalHeldUsd: 8_000 }))
      .toBe(`No bills to fund. ${goalStopWords(false)} $8,000 of spare income stays with you.`);
    for (const atGoal of [false, null, undefined]) {
      expect(noBillsNote({ ...row, atGoal } as never)).toBe('No bills to fund. $2,000 of spare income paid debt down, so no bitcoin bought this month.');
      expect(noBillsNote({ btcBoughtUsd: 8_000, payDownUsd: 0, restoreUsd: 0, atGoal } as never)).toBe('No bills to fund, so $8,000/mo buys bitcoin.');
    }
  });
});

describe('⭐ GOAL MARK — the Decision face\'s schedule marks a goal month, on screen and in the printout', () => {
  it('⭐ GOAL MARK — every engine month at the goal is marked; Today never is; the printout names it', () => {
    const run = planMonthRun(facts({ goalNetBtc: 1.5 }));
    const rows = planSchedule(run.sim, run.placement);
    expect(rows[0].atGoal, 'Today is THE MOVE\'s').toBe(false);
    for (const r of rows.slice(1)) expect(r.atGoal, `MARK m${r.m}`).toBe(run.sim.rows[r.m].atGoal === true);
    expect(rows.filter((r) => r.atGoal).length, 'MARK non-vacuous').toBe(12);
    const text = scheduleToText(rows, 'H', 'M', 'D', false);
    expect(text).toContain(`(accumulate · ${GOAL_MARK_TEXT})`);
    const none = planMonthRun(facts());
    const plain = scheduleToText(planSchedule(none.sim, none.placement), 'H', 'M', 'D', false);
    expect(plain, 'no goal: no mark').not.toContain(GOAL_MARK_TEXT);
  });
});

// ── v2 (the build 2 plan review, spec v0.6) — the sentences a goal month made false, and the verdict ────────────────

const statusOf = (f: PlanMonthFacts, m: number) => {
  const run = planMonthRun(f);
  return planStatus(run.sim, run.placement, m, {
    monthsBackUnder: firstMonthUnderLimit(run.sim), cbStop: run.placementInput.cbStop,
    support0: run.supportPath[0], coldBtc: f.coldBtc,
  });
};

describe('⭐ GOAL WORDS — THIS MONTH\'s status and the faces\' unpaid line at a goal month (δ1–δ3)', () => {
  it('⭐ GOAL WORDS — δ1: the first unpaid month at the goal names the goal; with no goal the same household draws', () => {
    const f = facts({ goalNetBtc: 1.5, income: 3_000, cbDebt: 10_000, strikeBalance: 0 });
    const run = planMonthRun(f);
    expect([run.sim.rows[1].atGoal, run.sim.rows[1].policyZone], 'δ1 premise: a buy-zone goal month').toEqual([true, 'accumulate']);
    expect(shownUsd(run.sim.rows[1].unfundedUsd), 'δ1 premise: bills go unpaid').toBe(true);
    const note = policyUnpaidNote(policyReading(run.sim, 1, f.expenses)) as string;
    expect(note).toBe(`From month 1, ${fmtUSD(run.sim.totalUnfundedUsd)} of bills went unpaid — ${GOAL_UNPAID_CAUSE}. Set a cash reserve to cover them.`);
    expect(note, 'δ1 never the line\'s cause').not.toContain("couldn't cover them");
    const none = planMonthRun({ ...f, goalNetBtc: null });
    expect(shownUsd(none.sim.rows[1].strikeDrawn), 'δ1 premise: without the goal the line pays the bills').toBe(true);
    expect(policyUnpaidNote(policyReading(none.sim, 1, f.expenses)), 'δ1 no goal: nothing unpaid').toBeNull();
  });

  it('⭐ GOAL WORDS — δ2: THIS MONTH\'s unpaid body says the goal skipped the draw; with no goal HEAD\'s body', () => {
    const st = statusOf(facts({ goalNetBtc: 1.5, income: 3_000, cbDebt: 10_000, strikeBalance: 0 }), 1);
    expect(st.title).toBe('Bills $1,000.00 short this month');
    expect(st.body).toBe(GOAL_UNPAID_BODY);
    // No goal, under support (paused): the line isn't used, and HEAD's body stands.
    const paused = facts({ income: 3_000, cbDebt: 10_000, price: 50_000 });
    const pr = planMonthRun(paused).sim.rows[1];
    expect([pr.policyZone, pr.atGoal, shownUsd(pr.unfundedUsd)], 'δ2 premise').toEqual(['paused', null, true]);
    expect(statusOf(paused, 1).body).toBe("Income, the line and the cash reserve fall short at today's price.");
  });

  it('⭐ GOAL WORDS — δ3: no goal month\'s status promises that the plan borrows again (the N8 rule\'s goal twin)', () => {
    let over = 0;
    for (const f of [facts({ goalNetBtc: 1.5 }), facts({ goalNetBtc: 1.7 }), facts({ goalNetBtc: 1.5, coldBtc: 0 })]) {
      const run = planMonthRun(f);
      for (const r of run.sim.rows) {
        if (r.m === 0 || r.atGoal !== true) continue;
        const st = statusOf(f, r.m);
        expect([st.title, st.body ?? ''].join(' '), `δ3 m${r.m}`).not.toMatch(/borrows again/);
        if ((st.body ?? '').startsWith('Spare income repays it')) over += 1;
      }
    }
    expect(over, 'δ3 non-vacuous: goal months over the limit, repaying').toBeGreaterThan(3);
    expect(statusOf(facts({ goalNetBtc: 1.5 }), 1).body).toMatch(/^Spare income repays it — back within it in about \d+ months at today's price\.$/);
  });
});

const moveCtx = (run: PlanMonthRun, atGoalThisMonth?: boolean): MoveCardContext => ({
  whatIf: false, policyApplied: true, policyEnabled: true, policyIgnoredReason: null,
  plan: run.placement, holdThroughISO: null, holdDepositISO: null,
  breaker: { broken: false, monthsAtOrAbove: 0, monthsBelow: 0, lastMonthEndLabel: '30 Sep 2026' }, rearmRule: 6,
  runLineUsd: 40_000, ownerLineUsd: 40_000, suggestedLineUsd: 40_000, expenses: 4_000, bearBufferMonths: 12,
  cbStop: run.placementInput.cbStop, support: run.placementInput.support, price: run.placementInput.price,
  cbDebt: run.placementInput.cbDebt, cbLtvTriggerPct: 75, cbLtvTargetPct: 65, hasCbLoan: true, consoleRuns: true,
  ...(atGoalThisMonth === undefined ? {} : { atGoalThisMonth }),
});

describe('⭐ GOAL MOVE — THE MOVE\'s over-limit line at the goal (δ4)', () => {
  it('⭐ GOAL MOVE — this month at the goal: "repays that from spare income", never "before it borrows again"', () => {
    const run = planMonthRun(facts({ goalNetBtc: 1.5 }));
    expect(shownUsd(run.placement.cbOverCeilingUsd), 'δ4 premise: over its limit today').toBe(true);
    // THIS MONTH's own figure: 2.5 ₿ less $20,000 and $50,000 plus a month of Coinbase's 6.27%, at $100,000 = ₿1.7974 —
    // the run's month 1 on its flat path, read from THE MOVE's facts alone (so the card is the same on every path).
    const net = netCoinsThisMonthOf(run.placementInput, 6.27) as number;
    expect(net).toBeCloseTo(run.sim.rows[1].netCoinsBtc as number, 12);
    expect(net).toBeCloseTo(2.5 - (20_000 + 50_000 * (1 + 0.0627 / 12)) / 100_000, 12);
    expect([atGoalThisMonthOf(run.placementInput, 6.27, 1.5), atGoalThisMonthOf(run.placementInput, 6.27, 1.797),
      atGoalThisMonthOf(run.placementInput, 6.27, 1.8), atGoalThisMonthOf(run.placementInput, 6.27, null)])
      .toEqual([true, true, false, false]);
    expect(atGoalThisMonthOf(run.placementInput, 0, 1.8), 'δ4 the month\'s Coinbase interest counts').toBe(true);
    const at = moveCard(moveCtx(run, true)).lines.find((l) => l.key === 'overLimit')!.text;   // the face passes atGoalThisMonthOf
    expect(at).toBe(`Coinbase is ${fmtUSD(run.placement.cbOverCeilingUsd)} over its limit at support — the policy repays that from spare income.`);
    const below = moveCard(moveCtx(run, false)).lines.find((l) => l.key === 'overLimit')!.text;
    expect(below).toBe(`Coinbase is ${fmtUSD(run.placement.cbOverCeilingUsd)} over its limit at support — the policy repays that from spare income before it borrows again.`);
    expect(moveCard(moveCtx(run)), 'δ4 absent ⇒ as before').toEqual(moveCard(moveCtx(run, false)));
  });
});

/** δ-L2's household: Coinbase $72,000 on 1 ₿ at $100,000, Strike owes nothing, a low goal — month 1's restore leaves
 *  Coinbase over its 70% defense line, so the playbook shifts debt to Strike in a goal month. */
const DEFENSE = (): PlanMonthFacts => facts({ strikeBalance: 0, strikeCollateralBtc: 1, cbCollateralBtc: 1, cbDebt: 72_000, coldBtc: 0, goalNetBtc: 0.2 });

describe('⭐ GOAL DEFENSE — a goal month whose crash defense draws on Strike says so (δ-L2)', () => {
  it('⭐ GOAL DEFENSE — the goal line, "Why this plan?", the schedule\'s mark and the pause reason: it borrows only for the defense', () => {
    const f = DEFENSE();
    const run = planMonthRun(f);
    const row = run.sim.rows[1];
    expect([row.atGoal, shownUsd(row.defenseDrawnUsd), row.strikeDrawn], 'DEFENSE premise').toEqual([true, true, 0]);
    const sched = planSchedule(run.sim, run.placement).find((r) => r.m === 1)!;
    expect(sched.actions.some((a) => a.kind === 'debtShift'), 'DEFENSE premise: the schedule lists the shift').toBe(true);
    const say = 'buys nothing and borrows only for a crash defense';
    expect(planGoalLine(row, 0.2)).toContain(`: the plan ${say} — spare income repays Coinbase.`);
    expect(planMonthSummary(run.sim, run.placement, 1, SUP[1], 0.2)).toContain(`goal, so the plan ${say}. `);
    expect(goalMarkLabel(sched)).toBe(`At your goal — the plan ${say}`);
    expect(policyPauseReason(row, S, f.expenses)!.startsWith(goalStopWords(true))).toBe(true);
    expect(goalStopWords(true)).toBe(`Net coins are at your goal, so the plan ${say}.`);
    for (const t of [planGoalLine(row, 0.2), planMonthSummary(run.sim, run.placement, 1, SUP[1], 0.2), goalMarkLabel(sched),
      policyPauseReason(row, S, f.expenses)]) expect(t, 'DEFENSE never "borrows and buys nothing"').not.toContain('borrows and buys nothing');
    // The headline's tail and the no-bills shape take the same words.
    const rd = { ...policyReading(sim(TWO_LOANS, 1.5, opening(TWO_LOANS, 1.5) * 0.5), 1, SP_REPRO.expenses), goalDefense: true };
    expect(policyHeadline(rd, S).text).toBe(`${GOAL_BUY_ZONE_LABEL} · 1.50× support${goalHeadlineTail(true)}`);
    expect(noBillsNote({ btcBoughtUsd: 0, payDownUsd: 0, restoreUsd: 0, atGoal: true, goalHeldUsd: 0, defenseDrawnUsd: 500 }))
      .toBe(`No bills to fund. ${goalStopWords(true)}`);
    // A goal month without a shift (or a shift under the floor) keeps "borrows and buys nothing".
    const plain = planMonthRun(facts({ goalNetBtc: 1.5 })).sim.rows[1];
    expect(plain.defenseDrawnUsd, 'DEFENSE premise: no shift').toBe(0);
    expect(planGoalLine({ ...plain, defenseDrawnUsd: 0.4 }, 1.5)).toContain('the plan borrows and buys nothing');
  });

  it('⭐ GOAL DEFENSE — the crash playbook note: at the goal the refinance waits — spare income repays the shifted debt (δ-L7)', () => {
    const base = {
      policyApplied: true, totalTopUpBtc: 0, totalTopUpFromColdBtc: 0, totalTopUpFromStrikeBtc: 0,
      totalDefenseDrawnUsd: 1_876, defenseCount: 1, firstTopUpMonth: null, firstDefenseMonth: 3, firstUnheldMonth: null,
      liqMonth: null, seizedOnTheWayDown: false,
    };
    const rows = (atGoal: (m: number) => boolean | null) => Array.from({ length: 13 }, (_, m) => ({ m, atGoal: atGoal(m) }));
    const head = 'Crash playbook: $1,876 of Coinbase debt shifted to Strike across 1 month, starting month 3. The 70% defense line held';
    expect(playbookNote({ ...base, rows: rows((m) => m >= 3) }, 70)).toBe(`${head}${GOAL_REFINANCE_CLAUSE}`);
    expect(playbookNote({ ...base, rows: rows((m) => m === 12) }, 70), 'a goal month after the shift').toBe(`${head}${GOAL_REFINANCE_CLAUSE}`);
    const HEAD_CLAUSE = '; the refinance shifts the debt back to Coinbase as the price recovers.';
    expect(playbookNote({ ...base, rows: rows((m) => m <= 3) }, 70), 'at the goal only up to the shift').toBe(`${head}${HEAD_CLAUSE}`);
    expect(playbookNote({ ...base, rows: rows(() => null) }, 70), 'no goal').toBe(`${head}${HEAD_CLAUSE}`);
    expect(playbookNote(base, 70), 'no rows').toBe(`${head}${HEAD_CLAUSE}`);
    // The engine reaches it: δ-L2's household on the faces' run.
    const run = planMonthRun(DEFENSE());
    expect(playbookNote(run.sim, 70)).toContain(GOAL_REFINANCE_CLAUSE);
    expect(playbookNote(planMonthRun({ ...DEFENSE(), goalNetBtc: null }).sim, 70)).not.toContain('your goal');
  });
});

describe('⭐ GOAL VERDICT — the never-draw verdict at the goal: a tie is a tie; kept income counts (δ-L6, δ-L8)', () => {
  it('⭐ GOAL VERDICT — at the goal from month 1: "ties", no signed figure, a plain tile; the head words', () => {
    const r = sim(TWO_LOANS, 2.6, opening(TWO_LOANS, 2.6) * 0.5, 36);
    const v = verdictVsNeverDraw(r, 'cycle');
    expect([v.kind, v.wins]).toEqual(['even', false]);
    expect(Math.abs(v.equityDelta)).toBeLessThan(0.5);
    // Residue of either sign is a tie, never a win — and only with a goal (the engine's residue here happens to be ≤ 0).
    const synth = (d: number, goalNetBtc: number | null) => ({
      liqMonth: null, last: { equity: 100_000 + d, btcHeld: 2 } as CyclingRow, baselineEquity: 100_000, baselineBtc: 2,
      totalUnfundedUsd: 0, totalCashToBillsUsd: 0, totalCashToCureUsd: 0, baselineUnfundedUsd: 0, goalNetBtc,
    });
    expect([0.3, -0.3, 0.6, -0.6].map((d) => { const x = verdictVsNeverDraw(synth(d, 1), 'cycle'); return [x.kind, x.wins]; }))
      .toEqual([['even', false], ['even', false], ['wins', true], ['loses', false]]);
    expect([0.3, -0.3].map((d) => { const x = verdictVsNeverDraw(synth(d, null), 'cycle'); return [x.kind, x.wins]; }), 'no goal: as before')
      .toEqual([['wins', true], ['loses', false]]);
    expect(neverDrawTieHead('Cycling')).toBe('Cycling ties — the same equity as paying bills from income');
    const tiles = outcomeTiles({ cold: 0, yours: 1, allIn: 0, liqMonth: null }, v, verdictBasisClause(r), 36);
    expect([tiles[2].value, tiles[2].tone], 'VERDICT the Decision tile').toEqual(['even', 'plain']);
    expect(verdictVsNeverDraw(r, 'hold').kind, 'hold is still the baseline').toBe('baseline');
  });

  it('⭐ GOAL VERDICT — never "even" without a goal: every kind as the bare comparison gives it, ties included', () => {
    let runs = 0, ties = 0;
    const check = (r: CyclingResult): void => {
      const v = verdictVsNeverDraw(r, 'cycle');
      const d = allInEquity(r) - baselineAllInEquity(r);
      expect(v.kind).toBe(r.liqMonth !== null ? 'liquidated' : d > 0 ? 'wins' : 'loses');
      expect(v.wins).toBe(d > 0);
      if (Math.abs(d) < 0.5) ties += 1;
      runs += 1;
    };
    for (const c of a5Cases()) { check(runCyclingSim(c.on)); check(runCyclingSim(c.off)); }
    // Under support with no Coinbase loan the run IS the never-draw world: HEAD's own tie, decided as before.
    for (const h of [{ cbDebt: 0, cbCollateralBtc: 0 }, { cbDebt: 0, cbCollateralBtc: 0, strikeCollateralBtc: 2 }]) {
      for (const months of [12, 60]) for (const k of [0.5, 0.7, 0.9]) {
        const sup = supportPathFor(SP_START, months);
        check(runCyclingSim({ ...SP_REPRO, ...h, supportPolicy: policyFor(sup), pricePath: sup.map((x) => k * x) }));
      }
    }
    expect(runs).toBeGreaterThan(20);
    expect(ties, 'VERDICT premise: HEAD\'s own ties are in the sweep').toBeGreaterThan(10);
  });

  it('⭐ GOAL VERDICT — the kept spare income: counted, named in the basis clause, and the tile says "all-in"', () => {
    const r = sim(TWO_LOANS, 2.6, opening(TWO_LOANS, 2.6) * 1.02, 60);
    expect([shownUsd(r.totalGoalHeldUsd), shownUsd(r.baselineGoalHeldUsd)], 'KEPT premise').toEqual([true, true]);
    const v = verdictVsNeverDraw(r, 'cycle');
    expect([v.kind, v.allIn]).toEqual(['wins', true]);
    expect(v.equityDelta).toBeCloseTo(r.totalGoalHeldUsd - r.baselineGoalHeldUsd, 4);
    expect(verdictBasisClause(r)).toBe(KEPT_BASIS_CLAUSE);
    expect(verdictBasisClause({ ...r, totalUnfundedUsd: 10 })).toBe(`, after unpaid bills${KEPT_BASIS_CLAUSE}`);
    const none = sim(TWO_LOANS, 2.6, null, 60);
    expect(verdictBasisClause(none), 'no goal: no kept clause').not.toContain('kept');
  });

  it('⭐ GOAL VERDICT — the faces render the tie: the head, a neutral box, a plain tile, "even" for the all-in figure', () => {
    const src = (f: string) => readFileSync(join(process.cwd(), 'src/components/Almanac', f), 'utf8');
    const cy = src('CyclingFace.tsx');
    expect(cy).toMatch(/\{verdict\.kind === 'even' \? \(\s*<>\{neverDrawTieHead\('Cycling'\)\}\{verdictBasisClause\(sim\)\}<\/>/);
    expect(cy).toContain(": verdict.kind === 'even' ? '' : wins ? styles.verdictGood : styles.verdictWarn");
    expect(cy).toContain("atEnd ? (verdict.kind === 'even' ? 'var(--text-primary)' : wins ? 'var(--green)' : 'var(--amber)')");
    expect(cy).toContain("`all-in vs never-draw: ${verdict.kind === 'even' ? 'even' : fmtSignedK(verdict.equityDelta)}`");
    // A tie's coin gap rounds to 0.0000 ₿ and its sign is residue: the sub-line names the two figures only.
    expect(cy).toMatch(/\{fmtBtc\(last\.btcHeld\)\} vs \{fmtBtc\(sim\.baselineBtc\)\}\{verdict\.kind === 'even' \? ''\s*: ` \(\$\{verdict\.btcDelta >= 0 \? '\+' : '−'\}\$\{Math\.abs\(verdict\.btcDelta\)\.toFixed\(4\)\} ₿\)`\}/);
    const un = src('UnifiedFace.tsx');
    expect(un).toMatch(/\{verdict\.kind === 'even' \? \(\s*<>\{neverDrawTieHead\(modeLabel\)\}\{verdictBasisClause\(sim\)\}<\/>/);
    expect(un).toContain(": verdict.kind === 'even' ? '' : verdict.kind === 'wins' ? styles.verdictGood : styles.verdictWarn");
    expect(un).toContain("(verdict.kind === 'even' ? 'var(--text-primary)' : verdict.wins ? 'var(--green)' : 'var(--amber)')");
    expect(un).toContain("`all-in vs never-draw: ${verdict.kind === 'even' ? 'even' : fmtSignedK(verdict.equityDelta)}`");
    expect(un).toMatch(/\{fmtBtc\(last\.btcHeld\)\} vs \{fmtBtc\(sim\.baselineBtc\)\}\{verdict\.kind === 'even' \? ''\s*: ` \(\$\{verdict\.btcDelta >= 0 \? '\+' : '−'\}\$\{Math\.abs\(verdict\.btcDelta\)\.toFixed\(4\)\} ₿\)`\}/);
  });

  it('⭐ GOAL VERDICT — the futures readout says how many tie; with none, its words as before', () => {
    const s: FuturesSummary = {
      count: 1_000, months: 60, yoursBtc: { p10: 1, p50: 2, p90: 3 }, coldBtc: { p10: 0, p50: 1, p90: 2 },
      beatsNeverDraw: 150, tiesNeverDraw: 800, seized: 0, seizedWithinYear: 0, seizedHalfByMonth: null,
      startISO: '2026-10-20', countsSeizures: true,
    };
    const beats = (x: FuturesSummary) => futuresReadout(x).rows.find((r) => r.label === 'Beats never borrowing')!;
    expect([beats(s).value, beats(s).sub]).toEqual(['15%', 'of the simulations, all-in · 80% tie']);
    expect(beats({ ...s, tiesNeverDraw: 0 }).sub).toBe('of the simulations, all-in');
  });
});

// ── BL32 (G3-B, build 2b) — the stand-down's words ───────────────────────────────────────────────────────────────

/** Debt-free with coins on both venues, at a goal under its ₿2.5: today stands down. */
const STAND = (over: Partial<PlanMonthFacts> = {}): PlanMonthFacts =>
  facts({ strikeBalance: 0, cbDebt: 0, strikeCollateralBtc: 1, cbCollateralBtc: 1, coldBtc: 0.5, goalNetBtc: 2, ...over });
const STAND_WHY = `At your goal with both loans repaid, ${GOAL_STAND_DOWN_WORDS}.`;

describe('⭐ STAND WORDS — THE MOVE\'s card at the stand-down (BL32)', () => {
  it('⭐ STAND WORDS — the one phrase', () => {
    expect(GOAL_STAND_DOWN_WORDS).toBe('the plan keeps nothing on Strike or Coinbase: every coin goes to cold storage');
  });

  it('⭐ STAND WORDS — the why line says the plan keeps nothing; the moves go to cold; never the keeps\' sentence', () => {
    const run = planMonthRun(STAND());
    expect([run.placement.standDown, run.placement.after.strikeCollateralBtc, run.placement.after.cbCollateralBtc],
      'STAND premise: today stands down').toEqual([true, 0, 0]);
    const card = moveCard(moveCtx(run));
    const text = (key: string) => card.lines.find((l) => l.key === key)?.text;
    expect(text('why')).toBe(STAND_WHY);
    expect(text('moves')).toBe('Today: move 1.000 ₿ to cold · move 1.000 ₿ from Coinbase to cold');
    expect(text('state')).toBe('Strike releases this today.');
    for (const l of card.lines) expect(l.text, `STAND ${l.key}`).not.toMatch(/keeps what your|months of bills of room|needs at support/);
    expect(card.lines.some((l) => l.key === 'short'), 'STAND nothing is short of a line it keeps nothing for').toBe(false);
    // δ1 — nothing backs the line once the plan keeps nothing on Strike, so no "covers two months of bills" and no "Try $X"
    // (a bigger line changes nothing: both keeps are zero at any line). The what-if's way back stays.
    expect(card.lines.some((l) => l.key === 'line'), 'STAND no line words at the stand-down').toBe(false);
    const whatIf = moveCard({ ...moveCtx(run), runLineUsd: 30_000 }).lines.find((l) => l.key === 'line')!;
    expect([whatIf.text, whatIf.action?.kind]).toEqual(['Modeling a $30,000 line.', 'backToLine']);
    // Without the goal, the same owner's card keeps the line's coins on Strike and the buffer on Coinbase.
    const none = planMonthRun(STAND({ goalNetBtc: null }));
    const noneCard = moveCard(moveCtx(none));
    expect(noneCard.lines.find((l) => l.key === 'why')!.text).toMatch(/^Strike keeps what your \$40,000 line needs at support/);
    expect(noneCard.lines.find((l) => l.key === 'line')!.text).toBe('Your $40,000 line already covers two months of bills.');
  });

  it('⭐ STAND WORDS — inside Strike\'s hold: Coinbase\'s coins go today, the hold line says when Strike\'s can', () => {
    const run = planMonthRun(STAND({ hold: { inHold: true, throughISO: '2026-11-30' } }));
    const card = moveCard({ ...moveCtx(run), holdThroughISO: '2026-11-30', holdDepositISO: '2026-10-01' });
    const text = (key: string) => card.lines.find((l) => l.key === key)?.text;
    expect(text('why')).toBe(STAND_WHY);
    // δ2 — the plan keeps nothing on Strike: its coins wait out the hold, and the hold line says when they go. Never
    // "keep 1.000 ₿ on Strike" beside "keeps nothing on Strike".
    expect(text('moves')).toBe('Today: move 1.000 ₿ from Coinbase to cold');
    expect(text('state')).toMatch(/^Strike's 60-day hold runs through 2026-11-30 \(you logged a Strike deposit on 2026-10-01\) — move then\.$/);
    expect(card.lines.some((l) => l.key === 'line'), 'STAND no line words inside the hold either').toBe(false);
    // A dollar still owed on Strike: no stand-down, and the card keeps the line's coins on Strike in so many words.
    const owing = planMonthRun(STAND({ strikeCollateralBtc: 3, strikeBalance: 1 }));
    expect(owing.placement.standDown).toBe(false);
    expect(moveCard(moveCtx(owing)).lines.find((l) => l.key === 'moves')!.text).toMatch(/^Today: keep 1\.236 ₿ on Strike · /);
  });

  it('⭐ STAND WORDS — already all in cold: "every coin is already in cold storage"; a loan open keeps the old words', () => {
    const cold = planMonthRun(STAND({ strikeCollateralBtc: 0, cbCollateralBtc: 0, coldBtc: 2.5 }));
    const card = moveCard(moveCtx(cold));
    expect(card.lines.find((l) => l.key === 'aligned')!.text).toBe('Nothing to move — every coin is already in cold storage.');
    expect(card.lines.find((l) => l.key === 'why')!.text).toBe(STAND_WHY);
    // A dollar still owed on Strike: no stand-down — the card is word for word the no-goal card.
    const open = planMonthRun(STAND({ strikeBalance: 1 }));
    expect(open.placement.standDown).toBe(false);
    expect(moveCard(moveCtx(open))).toEqual(moveCard(moveCtx(planMonthRun(STAND({ strikeBalance: 1, goalNetBtc: null })))));
  });
});

describe('⭐ STAND ROWS — a stand-down month in the schedule, on THIS MONTH and in "Why this plan?" (BL32)', () => {
  /** Strike owes $1,000 today; month 1's spare income repays it, so month 1 stands down after its pay-down. */
  const LATE = (): PlanMonthFacts => STAND({ strikeBalance: 1_000 });

  it('⭐ STAND ROWS — Today stands down: its Strike → cold row is "today"; months after move nothing', () => {
    const run = planMonthRun(STAND());
    const rows = planMonthActions(run.sim, run.placement, 1);
    const sk = rows.find((r) => r.kind === 'strikeToCold')!;
    expect([sk.label, sk.note, sk.amount]).toEqual(['Strike → cold storage', 'today', '₿1.000']);
    expect(run.sim.rows.slice(1).every((r) => r.goalStandDown && r.strikeToColdBtc === 0 && r.sweptToColdBtc === 0)).toBe(true);
  });

  it('⭐ STAND ROWS — the month that repays the last loan stands down: its own Strike → cold, named in the schedule and on THIS MONTH', () => {
    const run = planMonthRun(LATE());
    expect(run.placement.standDown, 'ROWS premise: today a loan is open').toBe(false);
    const m1 = run.sim.rows[1];
    expect([m1.atGoal, m1.goalStandDown, m1.strikeBalance, m1.cbDebt], 'ROWS premise: month 1 repays and stands down')
      .toEqual([true, true, 0, 0]);
    expect(m1.strikeToColdBtc, 'ROWS premise: Strike still held coins').toBeGreaterThan(0.01);
    const sched = planSchedule(run.sim, run.placement).find((r) => r.m === 1)!;
    const kinds = sched.actions.map((a) => a.kind);
    expect(kinds).toContain('repayStrike');
    expect(kinds, 'ROWS straight to cold, never through Coinbase').not.toContain('strikeToCoinbase');
    expect(sched.actions.find((a) => a.kind === 'strikeToCold')!.text)
      .toBe(`Release ${m1.strikeToColdBtc.toFixed(3)} ₿ of Strike collateral to cold storage.`);
    const row = planMonthActions(run.sim, run.placement, 1).find((r) => r.kind === 'strikeToCold' && r.note !== 'today')!;
    expect([row.label, row.note]).toEqual(['Strike → cold storage', 'month-end']);
  });

  it('⭐ STAND ROWS — a stand-down month\'s Strike → cold under 0.01 ₿ is marked as able to wait, in both places', () => {
    // ₿0.004 on Strike, debt-free at the goal: too little to move today, so month 1 releases it.
    const run = planMonthRun(STAND({ strikeCollateralBtc: 0.004, cbCollateralBtc: 0, coldBtc: 2.5 }));
    expect([run.placement.standDown, run.placement.worthMoving], 'ROWS premise: nothing worth moving today').toEqual([true, false]);
    expect(run.sim.rows[1].strikeToColdBtc).toBeCloseTo(0.004, 12);
    const act = planSchedule(run.sim, run.placement).find((r) => r.m === 1)!.actions.find((a) => a.kind === 'strikeToCold')!;
    expect(act.text).toBe('Release 0.004 ₿ of Strike collateral to cold storage. (small — can wait)');
    const row = planMonthActions(run.sim, run.placement, 1).find((r) => r.kind === 'strikeToCold')!;
    expect(row.note).toBe('small, can wait');
  });

  it('⭐ STAND ROWS — "Why this plan?" says why every coin goes to cold, from the engine\'s own flag; never without it', () => {
    const late = planMonthRun(LATE());
    const sum = planMonthSummary(late.sim, late.placement, 1, SUP[1], 2);
    expect(sum).toContain(`at or above your ₿2.000 goal, so the plan borrows and buys nothing. With both loans repaid, ${GOAL_STAND_DOWN_WORDS}. `);
    // A month still owing (a goal it is at, a loan open): no such sentence.
    const owing = planMonthRun(STAND({ strikeBalance: 30_000 }));
    expect(owing.sim.rows[1].goalStandDown, 'premise: still owing').toBe(false);
    expect(planMonthSummary(owing.sim, owing.placement, 1, SUP[1], 2)).not.toContain(GOAL_STAND_DOWN_WORDS);
    const none = planMonthRun(STAND({ goalNetBtc: null }));
    expect(planMonthSummary(none.sim, none.placement, 1, SUP[1], null)).not.toContain(GOAL_STAND_DOWN_WORDS);
    // 30¢ still owed on Strike with nothing spare to repay it: under the dust floor, so every figure reads $0 — but it is a
    // loan, the engine keeps the line's coins, and the words never say otherwise (they read the engine's flag).
    const dust = planMonthRun(STAND({ strikeBalance: 0.3, income: 4_000 }));
    const d1 = dust.sim.rows[1];
    expect([d1.atGoal, d1.goalStandDown, shownUsd(d1.strikeBalance), d1.strikeBalance > 0], 'premise: a dust loan').toEqual([true, false, false, true]);
    expect(planMonthSummary(dust.sim, dust.placement, 1, SUP[1], 2)).not.toContain(GOAL_STAND_DOWN_WORDS);
    expect(dust.placement.standDown, 'and THE MOVE keeps the line\'s coins too').toBe(false);
  });

  it('⭐ STAND ROWS — no Coinbase loan: the stand-down never says the plan opens one (its coins never pass through Coinbase)', () => {
    const noCb = (goalNetBtc: number | null) => planMonthRun(STAND({ cbCollateralBtc: 0, strikeCollateralBtc: 2, goalNetBtc }));
    const none = noCb(null);
    expect(coinbaseLoanLine(none.sim, none.placement, false), 'premise: without the goal the plan opens a Coinbase loan')
      .toMatch(/^You have no Coinbase loan yet\. This plan opens one/);
    const stood = noCb(2);
    expect(stood.placement.standDown).toBe(true);
    expect(coinbaseLoanLine(stood.sim, stood.placement, false)).toBeNull();
    expect(stood.sim.rows.every((r) => r.strikeToCbBtc === 0)).toBe(true);
    // Inside Strike's hold today, so its coins move in a later MONTH of the run — straight to cold there too.
    const held = planMonthRun(STAND({ cbCollateralBtc: 0, strikeCollateralBtc: 2, hold: { inHold: true, throughISO: '2026-11-30' } }));
    expect([held.placement.standDown, held.placement.strikeLeg, held.placement.worthMoving], 'premise: held, nothing moves today')
      .toEqual([true, 'hold', false]);
    const later = held.sim.rows.find((r) => r.strikeToColdBtc > 0);
    expect(later?.m, 'premise: a later month releases Strike\'s coins').toBeGreaterThan(0);
    expect(coinbaseLoanLine(held.sim, held.placement, false)).toBeNull();
    expect(held.sim.rows.every((r) => r.strikeToCbBtc === 0)).toBe(true);
  });
});

describe('⭐ STAND LIMIT — the Ownership face\'s limit line at a stand-down month (BL32, δ3)', () => {
  it('⭐ STAND LIMIT — nothing pledged to Strike: never "backed again above $0"; every other month the words as before', () => {
    const r = runCyclingSim({
      ...SP_REPRO, strikeCollateralBtc: 2, strikeBalance: 0, strikeCreditLine: 40_000, cbCollateralBtc: 1.5, cbDebt: 0,
      openingColdBtc: 0.5, supportPolicy: policyFor(supportPathFor(SP_START, 12), V2_DEFAULTS),
      pricePath: supportPathFor(SP_START, 12).map((x) => 1.4 * x), goalNetBtc: 3,
    });
    const m1 = r.rows[1];
    expect([r.policyApplied, m1.goalStandDown, m1.strikeCollateralBtc], 'LIMIT premise: month 1 stands down, Strike emptied')
      .toEqual([true, true, 0]);
    const cap = strikeAvailableCredit(40_000, m1.strikeCollateralBtc, m1.price, m1.strikeBalance);
    expect([cap.binding, cap.fullyBackedPrice], 'LIMIT premise: bound by collateral it no longer has').toEqual(['collateral', 0]);
    expect(strikeLimitTail(cap, m1, fmtUSD))
      .toBe('Limit is bound by collateral — at your goal with both loans repaid, nothing is pledged to Strike.');
    // Every other month, the face's words: coins on Strike (a stand-down inside Strike's hold included), the line binding,
    // and an empty Strike that did not stand down (a fresh install — the zero-state pass's, in the backlog).
    const old = 'Limit is bound by collateral — the full line is backed again above $80,000.';
    expect(strikeLimitTail({ binding: 'collateral', fullyBackedPrice: 80_000 }, { goalStandDown: false, strikeCollateralBtc: 1 }, fmtUSD)).toBe(old);
    expect(strikeLimitTail({ binding: 'collateral', fullyBackedPrice: 80_000 }, { goalStandDown: true, strikeCollateralBtc: 1 }, fmtUSD)).toBe(old);
    expect(strikeLimitTail({ binding: 'line', fullyBackedPrice: 50_000 }, { goalStandDown: true, strikeCollateralBtc: 0 }, fmtUSD))
      .toBe('Limit is bound by the credit line.');
    expect(strikeLimitTail({ binding: 'collateral', fullyBackedPrice: 0 }, { goalStandDown: false, strikeCollateralBtc: 0 }, fmtUSD))
      .toBe('Limit is bound by collateral — the full line is backed again above $0.');
    // The face renders the helper, never its own copy of the words.
    const face = readFileSync(join(process.cwd(), 'src/components/Almanac/OwnershipFace.tsx'), 'utf8');
    expect(face).toContain("{' '}{strikeLimitTail(cap, selRow, fmtK)}");
    expect(face).not.toContain('the full line is backed again above');
  });
});

describe('⭐ STAND COLD — the cold-storage card names the stand-down with a goal (BL32)', () => {
  const S = effectivePolicySettings({ ...DEFAULT_SUPPORT_POLICY_SETTINGS }, { cbLtvCapPct: 70, strikeCapEffPct: 60 });
  it('⭐ STAND COLD — one more line with the goal the run applied; without one, the rules as before', () => {
    expect(policyColdGoalNote(2)).toBe(`At your goal with both loans repaid, ${GOAL_STAND_DOWN_WORDS}, at any price.`);
    expect(policyColdGoalNote(null)).toBeNull();
    // BL33 — the card's rules, one fact a line, from the run's OWN goal (`sim.goalNetBtc`): the policy's rule, then the
    // stand-down's — never one without the goal.
    const run = (goal: number | null) => planMonthRun(facts({ goalNetBtc: goal })).sim;
    const labels = { end: 'month 12', firstCold: null };
    const withGoal = coldCardView(run(2), S, 30, labels);
    const without = coldCardView(run(null), S, 30, labels);
    expect(withGoal?.rules[0], 'STAND COLD the rule first').toBe(policyColdNote(S));
    expect(withGoal?.rules[1], 'STAND COLD the stand-down second').toBe(policyColdGoalNote(2));
    expect(without?.rules[0]).toBe(policyColdNote(S));
    expect(without?.rules.join(' '), 'STAND COLD none without a goal').not.toContain(GOAL_STAND_DOWN_WORDS);
    // The four faces build the card from their run (the goal rides inside `sim`), through the one view.
    const src = (f: string) => readFileSync(join(process.cwd(), 'src/components/Almanac', f), 'utf8');
    for (const f of ['CyclingFace.tsx', 'UnifiedFace.tsx', 'OwnershipFace.tsx', 'DecisionFace.tsx']) {
      expect(src(f), f).toMatch(/const coldView = coldCardView\(sim, policySettings, /);
    }
  });
});
