import { describe, it, expect } from 'vitest';
import { placementPlan, MOVE_THRESHOLD_BTC, type PlacementInput } from '../../../simulation/placement';
import type { CyclingRow } from '../../../simulation/cyclingSim';
import {
  moveCard, moveSections, coldAhead, rowActions, fmtBtc3, AHEAD_LABEL, monthsText,
  type ActionKind, type BreakerReading, type ColdAheadInput, type MoveCardContext, type ScheduleRow,
} from '../decisionView';
import { monthYear } from '../futuresView';
import { shownBtc } from '../supportPolicyView';

/**
 * R1b (BL54) — the Cold storage card always shows, 0 ₿ included, and, open, looks ahead on the path below: the next
 * move into cold (a small one marked as its schedule row marks it), the goal with one set, and the cold at the horizon. Its
 * figures are the displayed run's — the schedule's rows and the run's own — and nothing else. Read against fixed runs
 * and a seeded sweep of them; month 0 is 4 Nov 2026, so the months' names are pinned.
 */

/** The B′ board's own plan (R1's fixture): 2.5 ₿ on Strike for a $40,000 line, a $20,000 Coinbase loan on 2.2 ₿. */
const PLACE: PlacementInput = {
  creditLine: 40_000, strikeBalance: 0, strikeCollateralBtc: 2.5, cbDebt: 20_000, cbCollateralBtc: 2.2,
  coldBtc: 0.5, price: 122_650, support: 65_634, skStop: 0.50, cbStop: 0.45, cbDefenseLtv: 0.70,
  bufferUsd: 36_000, accumulateBelow: 2.0, payDownAbove: 3.0, inHold: false, broken: false,
};
const CLEAN: BreakerReading = { broken: false, monthsAtOrAbove: 0, monthsBelow: 0, lastMonthEndLabel: '30 Sep 2026' };
function ctxOf(input: PlacementInput, o: Partial<MoveCardContext> = {}): MoveCardContext {
  return {
    whatIf: false, policyApplied: true, policyEnabled: true, policyIgnoredReason: null,
    plan: placementPlan(input), holdThroughISO: '2026-12-01', holdDepositISO: '2026-10-02',
    breaker: CLEAN, rearmRule: 6,
    runLineUsd: input.creditLine, ownerLineUsd: input.creditLine, suggestedLineUsd: 20_000,
    expenses: 3_000, bearBufferMonths: 12, cbStop: input.cbStop, support: input.support, price: input.price,
    cbDebt: input.cbDebt, cbLtvTriggerPct: 75, cbLtvTargetPct: 65, hasCbLoan: input.cbDebt > 0, consoleRuns: input.cbDebt > 0,
    ...o,
  };
}
const sectionsOf = (input: PlacementInput, ahead: ColdAheadInput | null, o: Partial<MoveCardContext> = {}) => {
  const ctx = ctxOf(input, o);
  return moveSections(moveCard(ctx), ctx, input, ahead);
};

// ── a run, written by hand: its rows and its schedule ────────────────────────────────────────────────────────────
const START = '2026-11-04';
const H = 60;
type Row = ColdAheadInput['rows'][number];
type Into = Partial<Record<ActionKind, number>>;
interface Run { into?: Record<number, Into>; reach?: number; standDown?: number; net?: number; cold?: number; goal?: number | null }
function runOf(r: Run): ColdAheadInput {
  const rows: Row[] = [];
  const schedule: Pick<ScheduleRow, 'm' | 'actions'>[] = [];
  for (let m = 0; m <= H; m += 1) {
    rows.push({
      m, atGoal: r.goal === undefined || r.goal === null ? null : r.reach !== undefined && m >= r.reach,
      goalStandDown: r.standDown !== undefined && m >= r.standDown,
      coldBtc: m === H ? (r.cold ?? 4.62) : 1, netCoinsBtc: r.goal === undefined || r.goal === null ? null : (r.net ?? 4.2),
    });
    const into = r.into?.[m] ?? {};
    schedule.push({
      m,
      actions: (Object.entries(into) as [ActionKind, number][]).map(([kind, btc]) => ({ kind, usd: null, btc, text: '' })),
    });
  }
  return { schedule, rows, goalNetBtc: r.goal === undefined ? null : r.goal, startISO: START, pathLabel: 'Support', stressed: false };
}
/** The card's look ahead, as rows of [label, value, ...parts]. */
const lookOf = (a: ColdAheadInput) => coldAhead(a)!.facts.map((f) => [f.label, f.value, ...f.parts.map((p) => p.text)]);

describe('⭐ R1b — Cold storage, always, and ahead on the path below (BL54)', () => {
  it('⭐ ALWAYS — the card shows with nothing in cold and nothing arriving: "nothing yet", "—", no share', () => {
    const input = { ...PLACE, coldBtc: 0, price: 60_000 };
    const s = sectionsOf(input, null);
    expect(placementPlan(input).opening.coldBtc, 'ALWAYS premise — no cold after the move either').toBe(0);
    const cold = s.venues.find((v) => v.venue === 'cold');
    expect(cold, 'ALWAYS the card').toBeDefined();
    expect([cold!.held, cold!.rowName], 'ALWAYS its row').toEqual(['—', 'Cold storage, none']);
    expect(cold!.facts.map((f) => [f.label, f.value, f.parts.length]), 'ALWAYS no share of nothing').toEqual([['Now', 'nothing yet', 0]]);
    // With coins there, the share stays (R1's).
    const withCoins = sectionsOf({ ...PLACE, price: 60_000 }, null).venues.find((v) => v.venue === 'cold')!;
    expect(withCoins.facts[0].parts.map((p) => p.text), 'ALWAYS the share with coins').toEqual([expect.stringMatching(/ of all /)]);
  });

  it('⭐ AHEAD — on the cold card alone, under its label naming the path (", stressed" with a stress on); plain and unfolded', () => {
    const run = runOf({ into: { 3: { coinbaseToCold: 0.02 } }, goal: 5.5, reach: 33, standDown: 40 });
    const s = sectionsOf(PLACE, run);
    for (const v of s.venues) expect(v.ahead !== undefined, `AHEAD only on cold: ${v.venue}`).toBe(v.venue === 'cold');
    const ahead = s.venues.find((v) => v.venue === 'cold')!.ahead!;
    expect(ahead.label, 'AHEAD the label').toBe(`${AHEAD_LABEL}: Support`);
    expect(ahead.label).toBe('Ahead, on the path below: Support');
    expect(coldAhead({ ...run, pathLabel: 'Fair', stressed: true })!.label, 'AHEAD stressed').toBe('Ahead, on the path below: Fair, stressed');
    expect(ahead.facts.map((f) => f.key), 'AHEAD its order').toEqual(['coldNext', 'coldGoal', 'coldEnd']);
    for (const f of ahead.facts) expect([f.tone, f.folded], `AHEAD ${f.key} plain, folded away`).toEqual(['plain', false]);
    // Today's facts don't move with it: the same card without a look ahead, fact for fact.
    expect(s.venues.find((v) => v.venue === 'cold')!.facts, 'AHEAD today\'s facts untouched')
      .toEqual(sectionsOf(PLACE, null).venues.find((v) => v.venue === 'cold')!.facts);
    expect(sectionsOf(PLACE, null).venues.some((v) => v.ahead !== undefined), 'AHEAD none without a run').toBe(false);
  });

  it('⭐ NEXT — the first month after today that moves coins into cold, whatever their size; its sources, a small one marked as its row marks it; into cold only; none', () => {
    expect([monthYear(START, 1), monthYear(START, 3), monthYear(START, 33), monthYear(START, 60)], 'NEXT the months\' names')
      .toEqual(['Dec 2026', 'Feb 2027', 'Aug 2029', 'Nov 2031']);
    // Today's is THE MOVE's, never Next; the first month after it with a move into cold is, however small.
    const run = runOf({ into: { 0: { strikeToCold: 0.5 }, 2: { coinbaseToCold: 0.004 }, 3: { coinbaseToCold: 0.02 } } });
    expect(lookOf(run)[0], 'NEXT').toEqual(['Next', 'in 2 months', 'Jan 2027', '0.004 ₿ from Coinbase (small — can wait)']);
    expect(lookOf(runOf({ into: { 5: { strikeToCold: 0.3, coinbaseToCold: 0.1 } } }))[0], 'NEXT both sources')
      .toEqual(['Next', 'in 5 months', 'Apr 2027', '0.300 ₿ from Strike', '0.100 ₿ from Coinbase']);
    expect(lookOf(runOf({ into: { 1: { strikeToCold: 0.006, coinbaseToCold: MOVE_THRESHOLD_BTC } } }))[0], 'NEXT each marked')
      .toEqual(['Next', 'in 1 month', 'Dec 2026', '0.006 ₿ from Strike (small — can wait)', '0.010 ₿ from Coinbase']);
    expect(lookOf(runOf({ into: { 0: { coinbaseToCold: 1 } } }))[0], 'NEXT none').toEqual(['Next', 'none within 60 months']);
    // Coins leaving cold, or moving between Strike and Coinbase, are never a move into it.
    const out = runOf({
      into: { 1: { coldToCoinbase: 0.5, coldToStrike: 0.2, strikeToCoinbase: 0.3 }, 4: { coinbaseToCold: 0.01 } },
    });
    expect(lookOf(out)[0], 'NEXT into cold only').toEqual(['Next', 'in 4 months', 'Mar 2027', '0.010 ₿ from Coinbase']);
    // The mark is the row's own: the schedule's line for the same move says it, or doesn't, alike.
    for (const [kind, field] of [['coinbaseToCold', 'sweptToColdBtc'], ['strikeToCold', 'strikeToColdBtc']] as const) {
      for (const btc of [0.004, 0.0099, 0.01, 0.2]) {
        const row = rowActions({ m: 1, [field]: btc } as unknown as CyclingRow, null);
        expect(row.map((x) => x.kind), `NEXT the row's premise: ${kind}`).toEqual([kind]);
        const look = lookOf(runOf({ into: { 1: { [kind]: btc } } }))[0];
        expect([row[0].text.endsWith(' (small — can wait)'), look[3]?.endsWith(' (small — can wait)')], `NEXT the row's mark: ${kind} ${btc}`)
          .toEqual([btc < MOVE_THRESHOLD_BTC, btc < MOVE_THRESHOLD_BTC]);
      }
    }
  });

  it('⭐ GOAL — with a goal only: when net coins reach it, when every coin goes to cold; reached; not within the horizon', () => {
    expect(lookOf(runOf({})).map((f) => f[0]), 'GOAL none set').toEqual(['Next', 'By the end']);
    expect(lookOf(runOf({ goal: 5.5, reach: 33, standDown: 40 }))[1], 'GOAL').toEqual(
      ['Goal', 'in 33 months', 'Aug 2029 — net coins reach 5.500 ₿', 'every coin goes to cold storage from Mar 2030']);
    expect(lookOf(runOf({ goal: 5.5, reach: 1 }))[1], 'GOAL loans still open').toEqual(
      ['Goal', 'in 1 month', 'Dec 2026 — net coins reach 5.500 ₿']);
    expect(lookOf(runOf({ goal: 2, reach: 0, standDown: 0 }))[1], 'GOAL reached').toEqual(
      ['Goal', 'reached', 'net coins at your 2.000 ₿ goal', 'every coin goes to cold storage today']);
    expect(lookOf(runOf({ goal: 5.5, net: 4.2 }))[1], 'GOAL not within the horizon').toEqual(
      ['Goal', 'not within 60 months', 'net coins 4.200 ₿ of 5.500 ₿ by Nov 2031']);
    expect(lookOf(runOf({ goal: 2, net: -0.0001 }))[1], 'GOAL never "-0.000"').toEqual(
      ['Goal', 'not within 60 months', 'net coins 0.000 ₿ of 2.000 ₿ by Nov 2031']);
    const cold = coldAhead(runOf({ goal: 5.5, reach: 33, standDown: 40 }))!.facts.find((f) => f.key === 'coldGoal')!;
    expect(cold.parts.map((p) => p.venue), 'GOAL every coin to cold, in cold\'s colour').toEqual([null, 'cold']);
  });

  it('⭐ END — the cold at the horizon and its month; "nothing" for none', () => {
    expect(lookOf(runOf({ cold: 4.62 })).at(-1), 'END').toEqual(['By the end', '4.620 ₿', 'Nov 2031, in 60 months']);
    expect(lookOf(runOf({ cold: 0.0002 })).at(-1), 'END nothing').toEqual(['By the end', 'nothing', 'Nov 2031, in 60 months']);
    expect([monthsText(1), monthsText(7)]).toEqual(['1 month', '7 months']);
    expect(coldAhead({ ...runOf({}), rows: runOf({}).rows.slice(0, 1) }), 'END nothing ahead of month 0').toBeNull();
  });

  it('⭐ AHEAD FIGURES — a sweep of runs: Next and its parts are the reference rule\'s, and every figure is the run\'s own', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
    const FIG = /\d+(?:,\d{3})*(?:\.\d+)?(?: ₿)?/g;   // a figure — never a sentence's comma
    let nexts = 0, goals = 0, nones = 0, smalls = 0;
    for (let i = 0; i < 400; i += 1) {
      const into: Record<number, Into> = {};
      // Some runs move nothing into cold after today; a fifth of the others move only small amounts.
      const quiet = rnd() < 0.15, scale = rnd() < 0.2 ? 12 : 30, strikes = rnd() < 0.2 ? 0 : 0.03;
      for (let m = 0; m <= H; m += 1) {
        const cb = rnd() < 0.08 ? Math.max(1, Math.round(rnd() * scale)) / 1000 : 0;
        const sk = rnd() < strikes ? Math.max(1, Math.round(rnd() * 400)) / 1000 : 0;
        const moves: Into = {};
        if (cb > 0 && !(quiet && m > 0)) moves.coinbaseToCold = cb;
        if (sk > 0 && !(quiet && m > 0)) moves.strikeToCold = sk;
        // Coins out of cold and between the venues every fifth month — never a move into it.
        if (m % 5 === 2) Object.assign(moves, { coldToCoinbase: 0.25, strikeToCoinbase: 0.5 });
        if (Object.keys(moves).length > 0) into[m] = moves;
      }
      const goal = rnd() < 0.6 ? Math.round(rnd() * 8000) / 1000 + 0.5 : null;
      const reach = goal !== null && rnd() < 0.7 ? Math.floor(rnd() * (H + 1)) : undefined;
      const standDown = reach !== undefined && rnd() < 0.5 ? reach + Math.floor(rnd() * (H - reach + 1)) : undefined;
      const run = runOf({ into, goal, reach, standDown, net: (rnd() - 0.2) * 6, cold: rnd() * 5 });
      const look = coldAhead(run)!;
      // Next, by the reference rule: the first month ≥ 1 with a move into cold — Strike's or Coinbase's — of any size;
      // its parts, each move in the row's order, under THE MOVE's threshold marked as the row marks it.
      const intoOf = (r: Pick<ScheduleRow, 'actions'>) =>
        r.actions.filter((x) => x.kind === 'strikeToCold' || x.kind === 'coinbaseToCold');
      const ref = run.schedule.find((r) => r.m >= 1 && intoOf(r).length > 0);
      const next = look.facts.find((f) => f.key === 'coldNext')!;
      expect(next.value, `AHEAD FIGURES ${i}: Next`).toBe(ref === undefined ? 'none within 60 months' : `in ${monthsText(ref.m)}`);
      expect(next.parts.map((p) => p.text), `AHEAD FIGURES ${i}: Next's parts`).toEqual(ref === undefined ? [] : [
        monthYear(START, ref.m),
        ...intoOf(ref).map((x) => `${fmtBtc3(x.btc!)} ₿ from ${x.kind === 'strikeToCold' ? 'Strike' : 'Coinbase'}`
          + (x.btc! < MOVE_THRESHOLD_BTC ? ' (small — can wait)' : '')),
      ]);
      if (ref === undefined) nones += 1; else nexts += 1;
      if (ref !== undefined && intoOf(ref).some((x) => x.btc! < MOVE_THRESHOLD_BTC)) smalls += 1;
      if (goal !== null) goals += 1;
      // Every figure printed is one the run yields.
      const last = run.rows[H];
      const months = [H, ...(ref ? [ref.m] : []), ...(reach !== undefined ? [reach] : []), ...(standDown !== undefined ? [standDown] : [])];
      const allowed = new Set([
        ...months.flatMap((m) => [monthsText(m), monthYear(START, m)]),
        ...(ref ? intoOf(ref).map((x) => `${fmtBtc3(x.btc!)} ₿`) : []),
        ...(goal !== null ? [`${fmtBtc3(goal)} ₿`, `${fmtBtc3(last.netCoinsBtc!)} ₿`, '0.000 ₿'] : []),
        shownBtc(last.coldBtc) ? `${fmtBtc3(last.coldBtc)} ₿` : 'nothing',
      ].flatMap((t) => t.match(FIG) ?? []));
      for (const f of look.facts) for (const t of [f.value, ...f.parts.map((p) => p.text)]) {
        for (const g of t.match(FIG) ?? []) expect(allowed.has(g), `AHEAD FIGURES ${i}: "${g}" in "${t}"`).toBe(true);
      }
    }
    expect([nexts > 100, nones > 10, smalls > 20, goals > 150], 'AHEAD FIGURES premise — each kind reached')
      .toEqual([true, true, true, true]);
  });
});
