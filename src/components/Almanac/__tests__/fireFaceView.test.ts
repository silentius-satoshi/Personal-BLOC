import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fireMonthYear, fireEngineOf, fireRunOf, fireInputsAt, yoursAt, spendWithBuffer, replayRunsOf, capacityOf, historyStateOf,
  fireTiles, replaysCard, breakEvenLine, firePositionLine, fireChartPoints, fireChartDomain, fireTooltipLines, inspectedLine,
  anchoredLine, stressLine, dollarsNote, fireScale, fireMilestoneMonths, fireMilestoneRows, firePathName, firePathHead,
  UNDERWATER_LINE, NONE, MS_VIEWS_FIRE, MS_COLS_FIRE, STOP_CARD, MODEL_RULES, MODEL_LIMITS, MODEL_CREDITS, FIRE_DISCLAIMER,
  FIRE_TITLE, FIRE_FRAMING, REPLAYS_TITLE, REPLAYS_INFO, CHART_TITLE, CHART_OWNED, CHART_NEEDED, CHART_EMPTY, CHART_GAP_NOTE,
  TILE_LABEL, spendHint, NOTHING_OWNED, LESS_THAN_A_MONTH, FIRE_LINES,
  type FireFacts, type FireRun, type HistoryState, type ReplayPathReading, type ReplayRun,
} from '../fireFaceView';
import { FIRE_INPUT_DEFAULTS, type FireFaceInputs } from '../../../lib/fireInputs';
import { fireTimeline, withdrawalCapacity } from '../../../simulation/fire';
import { CAPITAL_GAINS_TAX_RATE } from '../../../simulation/taxes';
import { netCoinsBtc } from '../../../simulation/goal';
import { monthYear } from '../futuresView';
import { fireReplayReadings, replayPathsAt } from '../fireReplays';
import type { FireBreakEven } from '../../../simulation/fireBreakEven';
import type { DatedPrice, Replay, ReplayReading } from '../../../simulation/cycleReplays';

/**
 * The FIRE face's words and figures (batch 1 build 4). Pure view tests on round, invented price paths built from + − × ÷
 * only — so every exact figure here holds on every runtime (`.claude/rules/general.md`); anything through a Math.pow
 * (the return factor) is checked to a tolerance. This repo is public: every figure is synthetic. Each assertion carries its
 * tag; each planted bug in build-4-mutations.json turns its own tag red.
 * The cut's tests (CUT — the follow-ups' F-1) run the replays' crossing on a synthetic month-end history. A replay's tail
 * is the trend, through Math.pow, so a figure it feeds is only ever compared with the engine's own figure on the same path,
 * in the same run — never stored (follow-ups-mutations.json's planted bugs turn their tags red).
 */

const START = '2026-10-01';
const flat = (p: number, n = 240): number[] => Array.from({ length: n }, () => p);
const ramp = (p0: number, step: number, n = 240): number[] => Array.from({ length: n }, (_, m) => p0 + step * m);
/** A crash: from p0 down to `low` over 12 months (its low first reached at month 12), flat there, then back up — a run-out
 *  driver. */
const crash = (p0: number, low: number, n = 240): number[] =>
  Array.from({ length: n }, (_, m) => (m < 12 ? p0 - ((p0 - low) * m) / 12 : m < 60 ? low : low + ((p0 - low) * (m - 60)) / 120));

const facts = (o: Partial<FireFacts> = {}): FireFacts => ({
  openingBtc: 2, coldBtc: 0.5, openingDebtUsd: 0, incomeUsd: 8000, expensesUsd: 4000, inflationPct: 0, ...o,
});
const inputs = (o: Partial<FireFaceInputs> = {}): FireFaceInputs => ({ ...FIRE_INPUT_DEFAULTS, ...o });
const runOn = (path: number[], f: Partial<FireFacts> = {}, i: Partial<FireFaceInputs> = {}): FireRun =>
  fireRunOf(fireEngineOf(facts(f), inputs(i)), path);

/** Replay runs from paths given — the stop the face resolved, held. */
const replaysFor = (run: FireRun, paths: ReplayPathReading[]): ReplayRun[] =>
  replayRunsOf(run.x, run.result.stopMonth ?? 0, paths);
/** A fixture's own low, months after the stop: its path's first lowest month from the stop on (`deriveReplays`' rule, ties
 *  to the earliest). Measured inside the path, so always inside the horizon — no fixture is cut (F-1). */
const lowAfter = (path: readonly number[], stop: number): number => {
  let low = stop;
  for (let m = stop + 1; m < path.length; m++) if (path[m] < path[low]) low = m;
  return low - stop;
};
/** Three replayed paths, each with its own low — its callers replay from month 0, or flat paths, whose low is anywhere. */
const three = (a: number[], b: number[], c: number[]): ReplayPathReading[] => [
  { id: '2013', path: a, reason: null, troughMonth: lowAfter(a, 0) },
  { id: '2017', path: b, reason: null, troughMonth: lowAfter(b, 0) },
  { id: '2021', path: c, reason: null, troughMonth: lowAfter(c, 0) },
];

describe('⭐ DATES — "Oct 2046" from one fixed month table, never ICU', () => {
  it('⭐ DATES — the face\'s month labels', () => {
    expect([0, 3, 239, 240].map((m) => fireMonthYear('2026-10-26', m)), 'DATES').toEqual(['Oct 2026', 'Jan 2027', 'Sep 2046', 'Oct 2046']);
  });
  it('⭐ DATES — the same arithmetic as futuresView\'s monthYear, over a sweep of starts and months', () => {
    for (const start of ['2026-01-31', '2026-10-26', '2027-12-01', '2028-02-29']) {
      for (let m = 0; m <= 600; m += 7) expect(fireMonthYear(start, m), `DATES ${start} +${m}`).toBe(monthYear(start, m));
    }
    const src = readFileSync(join(process.cwd(), 'src/components/Almanac/fireFaceView.ts'), 'utf8');
    expect(src, 'DATES no ICU').not.toMatch(/toLocale(Date|String|Time)/);
  });
});

describe('⭐ the inputs the engine gets', () => {
  it('⭐ SAVINGS — a working month\'s savings are signed: a gap is drawn, never floored at 0', () => {
    expect(fireEngineOf(facts({ incomeUsd: 3000, expensesUsd: 4000 }), inputs()).base.savingsUsd, 'SAVINGS gap').toBe(-1000);
    expect(fireEngineOf(facts({ incomeUsd: 9000, expensesUsd: 4000 }), inputs()).base.savingsUsd, 'SAVINGS').toBe(5000);
  });
  it('⭐ BUFFER — the buffer folds into the spending the engine draws; the retirement spending follows the plan\'s expenses', () => {
    expect(spendWithBuffer(inputs({ bufferPct: 10 }), 4000), 'BUFFER 10%').toBeCloseTo(4400, 9);
    expect(spendWithBuffer(inputs(), 4000), 'BUFFER 0').toBe(4000);
    expect(spendWithBuffer(inputs({ spendUsd: 5000 }), 4000), 'BUFFER a typed spending').toBe(5000);
    expect(fireEngineOf(facts({ expensesUsd: 3500 }), inputs({ bufferPct: 20 })).base.spendUsd, 'BUFFER engine').toBeCloseTo(4200, 9);
  });
  it('⭐ RETURN — the other assets\' return follows inflation until typed (0% real); its monthly factor is (1 + r)^(1/12)', () => {
    expect(fireEngineOf(facts({ inflationPct: 0 }), inputs()).base.otherMonthlyFactor, 'RETURN 0%').toBe(1);
    expect(fireEngineOf(facts({ inflationPct: 3 }), inputs()).base.otherMonthlyFactor, 'RETURN follows inflation').toBeCloseTo(1.03 ** (1 / 12), 12);
    expect(fireEngineOf(facts({ inflationPct: 3 }), inputs({ otherReturnPct: 5 })).base.otherMonthlyFactor, 'RETURN typed').toBeCloseTo(1.05 ** (1 / 12), 12);
    expect(fireEngineOf(facts({ inflationPct: 3 }), inputs()).base.inflation, 'RETURN inflation ÷ 100').toBe(0.03);
  });
  it('⭐ TAX — Living\'s one rate by default; a typed rate ÷ 100', () => {
    expect(fireEngineOf(facts(), inputs()).base.taxRate, 'TAX default').toBe(CAPITAL_GAINS_TAX_RATE);
    expect(fireEngineOf(facts(), inputs({ taxPct: 20 })).base.taxRate, 'TAX typed').toBe(0.2);
    expect(fireEngineOf(facts(), inputs({ wBtcPct: 8, wOtherPct: 4 })).base, 'TAX the rates ÷ 100').toMatchObject({ wBtc: 0.08, wOther: 0.04 });
  });
  it('⭐ POSITION ≡ NET COINS — ₿ yours equals the goal tile\'s net coins, bit for bit, at the same price', () => {
    let seed = 7;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 2000; i++) {
      const a = rnd() * 3, b = rnd() * 2, c = rnd(), d = rnd() * 90_000, e = rnd() * 60_000, p = 1000 + rnd() * 200_000;
      // The face's sums, the parents' order: strike + CB + cold; Coinbase's debt + Strike's.
      const yours = yoursAt({ openingBtc: a + b + c, openingDebtUsd: e + d, coldBtc: c }, p);
      const net = netCoinsBtc({ strikeBtc: a, cbBtc: b, coldBtc: c, strikeBalanceUsd: d, cbDebtUsd: e, price: p });
      expect(yours, `POSITION ≡ NET COINS #${i}`).toBe(net);
    }
  });
  it('⭐ POSITION — netted at the displayed path\'s month 0', () => {
    const eng = fireEngineOf(facts({ openingBtc: 2, openingDebtUsd: 50_000 }), inputs());
    expect(fireInputsAt(eng, [100_000, 1]).btc, 'POSITION at path[0]').toBe(1.5);
    expect(fireInputsAt(eng, [50_000, 1]).btc, 'POSITION a stressed month 0 re-nets').toBe(1);
  });
});

describe('⭐ the tiles and the edges', () => {
  it('⭐ WORDS — six tiles in their order, each with a label, a value and a sub-line', () => {
    const run = runOn(ramp(100_000, 1000), { openingBtc: 2, incomeUsd: 8000, expensesUsd: 4000 }, { otherUsd: 200_000 });
    const t = fireTiles({ run, fi: inputs({ otherUsd: 200_000 }), startISO: START, capacity: { kind: 'none', why: 'loading' } });
    expect(t.map((x) => x.key), 'WORDS order').toEqual(['years', 'need', 'fi', 'lasts', 'capacity', 'breakEven']);
    expect(t.map((x) => x.label), 'WORDS labels').toEqual(Object.values(TILE_LABEL));
    expect(t[0].value, 'WORDS years').toMatch(/^\d+\.\d years$/);
    expect(t[1].value, 'WORDS need').toBe('$1,200,000');   // $4,000 × 12 × 25, at 4% / 4%
    expect(t[1].sub, 'WORDS need sub').toMatch(/^25 years of funded spending at 4%/);
    expect(t[2].value, 'WORDS FI').toMatch(/^[A-Z][a-z]{2} \d{4}$|^Now$/);
    for (const x of t) expect(x.sub.length, `WORDS ${x.key} sub`).toBeGreaterThan(0);
    expect(firePathName({ label: 'Support', onTheLine: true, revertMonths: 48 }), 'WORDS path').toBe('Support, on the line');
    expect(firePathName({ label: 'Fair', onTheLine: false, revertMonths: 48 }), 'WORDS path reverting').toBe('Fair, reverting over 4 yr');
    expect(firePathHead('Support, on the line', '2026-10-26', 240), 'WORDS every figure names its path').toBe('On Support, on the line · Oct 2026 – Sep 2046');
    expect(REPLAYS_INFO, 'WORDS the ⓘ — (b′): milder OR harsher, and the run-out month moves').toMatch(
      /a replay can read a little milder or a little harsher than on daily prices, and the month it runs out can move by several months\.$/);
  });

  it('⭐ LASTS THROUGH — the horizon\'s last month, never "all 20 years"', () => {
    const run = runOn(flat(100_000), { openingBtc: 10, incomeUsd: 4000, expensesUsd: 4000 }, { stopChoice: 'now' });
    const t = fireTiles({ run, fi: inputs({ stopChoice: 'now' }), startISO: START, capacity: { kind: 'none', why: 'loading' } });
    expect(t[3].value, 'LASTS THROUGH').toBe('Lasts through Sep 2046');
    expect(t[3].sub, 'LASTS THROUGH the stop').toBe('You stop: Oct 2026 (now).');
    const short = runOn(flat(100_000, 30), { openingBtc: 10, incomeUsd: 4000, expensesUsd: 4000 }, { stopChoice: 'now' });
    expect(fireTiles({ run: short, fi: inputs({ stopChoice: 'now' }), startISO: START, capacity: { kind: 'none', why: 'loading' } })[3].value, 'LASTS THROUGH 30 months').toBe('Lasts through Mar 2029');
  });

  it('⭐ EDGES — each state the engine returns has its words', () => {
    const tiles = (run: FireRun, i: Partial<FireFaceInputs> = {}) => fireTiles({ run, fi: inputs(i), startISO: START, capacity: { kind: 'none', why: 'noStop' } });
    // FI beyond the horizon, with "At FI": no stop month — nothing for what lasts, the replays, the capacity, the break-even.
    const never = runOn(flat(10_000), { openingBtc: 0.1, incomeUsd: 4100, expensesUsd: 4000 });
    expect(never.result.stopMonth, 'EDGES premise: no stop month').toBeNull();
    expect(tiles(never)[3].sub, 'EDGES no stop').toBe('No stop month: FI doesn\'t come by Sep 2046.');
    expect(replaysCard({ run: never, runs: [], history: 'ready', capacity: { kind: 'none', why: 'noStop' }, startISO: START, bufferPct: 0 }).state,
      'EDGES no stop: the replays').toMatch(/^At FI: on this path FI doesn't come by Sep 2046, so there's no stop month — .*To see them, choose Now or In years/);
    // Underwater: the loans outweigh the coins.
    expect(firePositionLine(facts({ openingBtc: 1, openingDebtUsd: 150_000 }), 100_000, 0), 'EDGES underwater').toEqual([UNDERWATER_LINE]);
    expect(firePositionLine(facts({ openingBtc: 1, openingDebtUsd: 150_000 }), 100_000, 30_000), 'EDGES uncovered')
      .toEqual([UNDERWATER_LINE, '$30,000 of it is more than they cover — left out of every figure here.']);
    expect(UNDERWATER_LINE, 'EDGES the go\'s words').toBe('Your loans are more than your bitcoin is worth at this price: this starts you with no bitcoin of your own, the excess repaid from your other assets.');
    // ₿ owned 0 today.
    expect(firePositionLine(facts({ openingBtc: 0, coldBtc: 0 }), 100_000, 0)[0], 'EDGES no coins').toMatch(/^Today you hold no bitcoin/);
    // ₿ needed at or below 0: the other assets alone cover the need.
    const covered = runOn(flat(100_000), { openingBtc: 1 }, { otherUsd: 5_000_000 });
    expect(tiles(covered, { otherUsd: 5_000_000 })[1].sub, 'EDGES other assets cover the need').toMatch(/your other assets cover it — no bitcoin needed\.$/);
    // Retirement income covers the spending — no scale figure.
    const income = runOn(flat(100_000), {}, { retirementIncomeUsd: 5000 });
    expect([tiles(income, { retirementIncomeUsd: 5000 })[0].value, tiles(income, { retirementIncomeUsd: 5000 })[0].sub], 'EDGES covered')
      .toEqual([NONE, 'Retirement income covers your spending — nothing to fund.']);
    expect(fireScale(income), 'EDGES covered: no scale').toBeNull();
    // Spending 0.
    const none = runOn(flat(100_000), { expensesUsd: 0 });
    expect([tiles(none)[0].value, tiles(none)[0].sub], 'EDGES no spending').toEqual([NONE, 'No spending to fund.']);
    // Years funded with nothing owned (the go's change 2).
    const empty = runOn(flat(100_000), { openingBtc: 0, coldBtc: 0, incomeUsd: 4000, expensesUsd: 4000 });
    expect([tiles(empty)[0].value, tiles(empty)[0].sub], 'EDGES nothing owned').toEqual([NONE, 'No bitcoin of your own and no other assets to fund it.']);
    // A working gap that runs out before the stop.
    const gap = runOn(flat(100_000), { openingBtc: 0.1, incomeUsd: 2000, expensesUsd: 4000 }, { stopChoice: 'years', stopYears: 10 });
    expect(gap.result.runsOutWhileWorking, 'EDGES premise: runs out while working').toBe(true);
    expect(tiles(gap, { stopChoice: 'years', stopYears: 10 })[3], 'EDGES runs out while working').toMatchObject({ value: expect.stringMatching(/^Runs out [A-Z][a-z]{2} \d{4}$/), sub: 'Before you stop — your savings gap draws it down.' });
    expect(replaysCard({ run: gap, runs: [], history: 'ready', capacity: { kind: 'none', why: 'whileWorking' }, startISO: START, bufferPct: 0 }).state,
      'EDGES runs out while working: the replays').toMatch(/before you stop working — so there's nothing for the replays to test\.$/);
    // A stop at or past the horizon.
    const late = runOn(flat(100_000, 120), {}, { stopChoice: 'years', stopYears: 15 });
    expect(tiles(late, { stopChoice: 'years', stopYears: 15 })[3].sub, 'EDGES stop past the horizon').toBe('You\'d stop in Oct 2041, after this horizon ends.');
    // An invalid input: a price the engine can't use.
    const bad = runOn([100_000, 0, 100_000]);
    expect(tiles(bad).map((x) => [x.value, x.sub]), 'EDGES invalid').toEqual(Array(6).fill([NONE, 'No bitcoin price to use yet.']));
  });

  it('⭐ TINY — a little owned is never "nothing owned": under the years floor the tile and the scale say less than a month', () => {
    const little = runOn(flat(100_000), { openingBtc: 0.02, coldBtc: 0, incomeUsd: 6000, expensesUsd: 5000 });   // $2,000 ÷ $60,000 a year ≈ 12 days
    expect((little.result.rows[0].yearsFunded as number) > 0 && (little.result.rows[0].yearsFunded as number) < 0.05, 'TINY premise: owned, under the floor').toBe(true);
    const t = fireTiles({ run: little, fi: inputs(), startISO: START, capacity: { kind: 'none', why: 'loading' } })[0];
    expect([t.value, t.sub], 'TINY the tile').toEqual([NONE, LESS_THAN_A_MONTH]);
    expect(fireScale(little)?.caption, 'TINY the scale').toMatch(/^You: less than a month · /);
    const empty = runOn(flat(100_000), { openingBtc: 0, coldBtc: 0, incomeUsd: 6000, expensesUsd: 5000 });
    expect(fireTiles({ run: empty, fi: inputs(), startISO: START, capacity: { kind: 'none', why: 'loading' } })[0].sub, 'TINY nothing owned').toBe(NOTHING_OWNED);
    expect(fireScale(empty)?.caption, 'TINY the scale, nothing owned').toMatch(/^You: nothing funded yet · /);
  });
});

describe('⭐ the replays and the capacity', () => {
  const household = { openingBtc: 2, coldBtc: 0, incomeUsd: 4000, expensesUsd: 4000 };

  it('⭐ STOP HELD — under "At FI" the replays run from the face\'s own stop, passed as that number', () => {
    const f = { openingBtc: 1, coldBtc: 0, incomeUsd: 10_000, expensesUsd: 2000 };
    const run = runOn(flat(100_000, 120), f);
    const stop = run.result.stopMonth as number;
    expect(stop, 'STOP HELD premise: FI on the face\'s path').toBe(63);
    const crafted = flat(20_000, 120);   // a path whose months before the stop would move a re-resolved FI
    expect(fireTimeline(run.x, crafted).stopMonth, 'STOP HELD premise: re-resolved, the stop would move').not.toBe(stop);
    const [r] = replayRunsOf(run.x, stop, [{ id: '2013', path: crafted, reason: null, troughMonth: lowAfter(crafted, stop) }]);
    expect(r.capacity?.stopMonth, 'STOP HELD the capacity').toBe(stop);
    const held = fireTimeline({ ...run.x, stopMonth: stop }, crafted);
    expect([r.lasts, r.runOutMonth], 'STOP HELD the line').toEqual([held.lasts, held.runOutMonth]);
  });

  it('⭐ LOWEST — the capacity is the lowest replay\'s; the harshest is named', () => {
    const run = runOn(flat(100_000), household, { stopChoice: 'now' });
    const paths = three(flat(100_000), crash(100_000, 30_000), crash(100_000, 50_000));
    const runs = replaysFor(run, paths);
    const engine = paths.map((p) => withdrawalCapacity({ ...run.x, stopMonth: 0 }, p.path as number[]).capacityUsd as number);
    const c = capacityOf(run.result, runs, 'ready', 0);
    expect(c, 'LOWEST').toEqual({ kind: 'shown', usd: Math.min(...engine), atLeast: false, harshest: '2017' });
    expect(engine[1] < engine[2] && engine[2] < engine[0], 'LOWEST premise: three different capacities').toBe(true);
  });

  it('⭐ ALL THREE — no capacity unless all three replayed; the missing cycle is named', () => {
    const run = runOn(flat(100_000), household, { stopChoice: 'now' });
    const p13 = flat(100_000), p21 = crash(100_000, 50_000);
    const paths: ReplayPathReading[] = [
      { id: '2013', path: p13, reason: null, troughMonth: lowAfter(p13, 0) }, { id: '2017', path: null, reason: 'gap', troughMonth: null },
      { id: '2021', path: p21, reason: null, troughMonth: lowAfter(p21, 0) },
    ];
    const runs = replaysFor(run, paths);
    const c = capacityOf(run.result, runs, 'ready', 0);
    expect(c, 'ALL THREE').toEqual({ kind: 'none', why: 'missing', missing: '2017' });
    const card = replaysCard({ run, runs, history: 'ready', capacity: c, startISO: START, bufferPct: 0 });
    expect(card.lines[1], 'ALL THREE the gap named').toBe('2017: a gap in the price history after its top — not replayed.');
    expect(card.capacity, 'ALL THREE no figure').toBe('No capacity: the 2017 bear couldn\'t be replayed, and it might be the harshest.');
    const tile = fireTiles({ run, fi: inputs({ stopChoice: 'now' }), startISO: START, capacity: c })[4];
    expect([tile.value, tile.sub], 'ALL THREE the tile').toEqual([NONE, 'The 2017 bear couldn\'t be replayed from this history.']);
    const noPeak = replaysCard({ run, runs: replaysFor(run, [{ id: '2013', path: null, reason: 'noPeak', troughMonth: null }]), history: 'ready', capacity: c, startISO: START, bufferPct: 0 });
    expect(noPeak.lines, 'ALL THREE a missing top').toEqual(['2013: no top in this price history — not replayed.']);
  });

  it('⭐ CAPACITY STATES — the stop first, as the card reads it: no stop month, a stop past the horizon, a working gap — never "couldn\'t be replayed"', () => {
    // Built as the face builds it: no stop month inside the horizon → no replayed paths → an EMPTY runs list.
    const cases: [string, FireRun, string, string][] = [
      ['noStop', runOn(flat(10_000), { openingBtc: 0.1, incomeUsd: 4100, expensesUsd: 4000 }), 'No stop month to replay from.', 'no stop month'],
      ['stopBeyond', runOn(flat(100_000, 120), {}, { stopChoice: 'years', stopYears: 15 }), 'You stop after this horizon ends.', 'past the horizon'],
      ['whileWorking', runOn(flat(100_000), { openingBtc: 0.1, incomeUsd: 2000, expensesUsd: 4000 }, { stopChoice: 'years', stopYears: 10 }), 'It runs out before you stop working.', 'a working gap'],
    ];
    for (const [why, run, words, name] of cases) {
      const stop = run.result.stopMonth;
      const inside = stop !== null && run.result.stopInHorizon;
      const runs = inside ? replaysFor(run, three(flat(100_000), flat(100_000), flat(100_000))) : [];
      expect(inside, `CAPACITY STATES premise: ${name}`).toBe(why === 'whileWorking');
      for (const h of ['ready', 'loading', 'failed', 'offline'] as const) {
        const c = capacityOf(run.result, runs, h, 0);
        expect(c, `CAPACITY STATES ${name}, history ${h}`).toEqual({ kind: 'none', why });
        const fi = why === 'stopBeyond' ? inputs({ stopChoice: 'years', stopYears: 15 }) : why === 'whileWorking' ? inputs({ stopChoice: 'years', stopYears: 10 }) : inputs();
        const tile = fireTiles({ run, fi, startISO: START, capacity: c })[4];
        expect([tile.value, tile.sub], `CAPACITY STATES ${name}, history ${h}: the tile`).toEqual([NONE, words]);
        expect(tile.sub, `CAPACITY STATES ${name}: never a missing cycle`).not.toMatch(/couldn't be replayed/);
      }
    }
  });

  it('⭐ HI BINDS — the search\'s top binding says "at least", and with a buffer the words stay exact', () => {
    const rich = { openingBtc: 50, coldBtc: 0, incomeUsd: 4000, expensesUsd: 4000 };
    for (const bufferPct of [0, 10]) {
      const run = runOn(flat(100_000), rich, { stopChoice: 'now', bufferPct });
      const c = capacityOf(run.result, replaysFor(run, three(flat(100_000), flat(100_000), flat(100_000))), 'ready', bufferPct);
      expect(c.kind === 'shown' && c.atLeast, `HI BINDS ${bufferPct}%`).toBe(true);
      expect(c.kind === 'shown' ? c.usd : 0, `HI BINDS twice the spending ${bufferPct}%`).toBeCloseTo(8000, 6);
      const tile = fireTiles({ run, fi: inputs({ stopChoice: 'now', bufferPct }), startISO: START, capacity: c })[4];
      expect(tile.value, `HI BINDS the tile ${bufferPct}%`).toBe('At least $8,000 a month');
      const card = replaysCard({ run, runs: replaysFor(run, three(flat(100_000), flat(100_000), flat(100_000))), history: 'ready', capacity: c, startISO: START, bufferPct });
      expect(card.capacity, `HI BINDS the line ${bufferPct}%`).toMatch(/^Spending that lasts all three: at least \$8,000 a month \(today's dollars\) — twice your spending still lasts\./);
    }
  });

  it('⭐ BUFFER — the capacity reads in the owner\'s own spending: × (1 + b) is the engine\'s to the cent; the buffer is said', () => {
    const paths = three(flat(100_000), crash(100_000, 30_000), crash(100_000, 50_000));
    const at = (bufferPct: number) => {
      const run = runOn(flat(100_000), household, { stopChoice: 'now', bufferPct });
      const engine = Math.min(...paths.map((p) => withdrawalCapacity({ ...run.x, stopMonth: 0 }, p.path as number[]).capacityUsd as number));
      return { run, c: capacityOf(run.result, replaysFor(run, paths), 'ready', bufferPct), engine };
    };
    const z = at(0);
    expect(z.c.kind === 'shown' ? z.c.usd : -1, 'BUFFER at 0 the two are equal').toBe(z.engine);
    const b = at(10);
    expect(b.c.kind === 'shown' ? b.c.usd * 1.1 : -1, 'BUFFER × 1.1 is the engine\'s').toBeCloseTo(b.engine, 2);
    const tile = fireTiles({ run: b.run, fi: inputs({ stopChoice: 'now', bufferPct: 10 }), startISO: START, capacity: b.c })[4];
    expect(tile.sub, 'BUFFER said').toMatch(/ Your 10% buffer is kept on top\.$/);
    const zt = fireTiles({ run: z.run, fi: inputs({ stopChoice: 'now' }), startISO: START, capacity: z.c })[4];
    expect(zt.sub, 'BUFFER none said at 0').not.toMatch(/buffer/);
  });

  it('⭐ HISTORY — loading, failed or offline: no replays and no capacity, said in words; never read as lasting', () => {
    expect(historyStateOf({ loading: true, error: null, online: true }), 'HISTORY loading').toBe('loading');
    expect(historyStateOf({ loading: false, error: 'Blockchain.com 500', online: true }), 'HISTORY failed').toBe('failed');
    expect(historyStateOf({ loading: false, error: 'Failed to fetch', online: false }), 'HISTORY offline').toBe('offline');
    expect(historyStateOf({ loading: false, error: null, online: true }), 'HISTORY ready').toBe('ready');
    const run = runOn(flat(100_000), household, { stopChoice: 'now' });
    const runs = replaysFor(run, three(flat(100_000), flat(100_000), flat(100_000)));
    const words: Record<Exclude<HistoryState, 'ready'>, string> = {
      loading: 'Loading the price history — the replays and the capacity need it.',
      failed: 'The price history didn\'t load, so there are no replays and no capacity this visit.',
      offline: 'Offline — the replays need the price history, which isn\'t kept on this device.',
    };
    for (const h of ['loading', 'failed', 'offline'] as const) {
      const c = capacityOf(run.result, runs, h, 0);
      expect(c, `HISTORY ${h}: no capacity`).toEqual({ kind: 'none', why: h });
      const card = replaysCard({ run, runs, history: h, capacity: c, startISO: START, bufferPct: 0 });
      expect([card.state, card.lines, card.capacity], `HISTORY ${h}: the card`).toEqual([words[h], [], null]);
      expect(fireTiles({ run, fi: inputs({ stopChoice: 'now' }), startISO: START, capacity: c })[4].value, `HISTORY ${h}: the tile`).toBe(NONE);
    }
  });

  it('⭐ BREAK-EVEN — the yardstick in words: a rate, at the floor, none in the bracket', () => {
    const be = (o: Partial<FireBreakEven>): FireBreakEven => ({ yearlyGrowth: null, atFloor: false, bracket: [-0.5, 1], stopMonth: 0, reason: null, ...o });
    expect(breakEvenLine(be({ yearlyGrowth: 0.073 }), 'Sep 2046'), 'BREAK-EVEN').toBe('It lasts through Sep 2046 as long as bitcoin grows at least 7.3% a year, steadily.');
    expect(breakEvenLine(be({ yearlyGrowth: -0.00267 }), 'Sep 2046'), 'BREAK-EVEN below 0 prints as it is').toBe('It lasts through Sep 2046 as long as bitcoin grows at least −0.3% a year, steadily.');
    expect(breakEvenLine(be({ yearlyGrowth: -0.5, atFloor: true }), 'Sep 2046'), 'BREAK-EVEN floor').toBe('It lasts through Sep 2046 even if bitcoin falls 50% a year, steadily — the lowest growth the search tries.');
    expect(breakEvenLine(be({ reason: 'nothingLasts' }), 'Sep 2046'), 'BREAK-EVEN none').toBe('Even 100.0% a year, steadily, doesn\'t last through Sep 2046.');
    expect(breakEvenLine(be({ reason: 'noStopMonth', stopMonth: null }), 'Sep 2046'), 'BREAK-EVEN no stop').toBeNull();
    const run = runOn(flat(100_000), household, { stopChoice: 'now' });
    const tile = (o: Partial<FireBreakEven>) => fireTiles({ run: { ...run, breakEven: be(o) }, fi: inputs({ stopChoice: 'now' }), startISO: START, capacity: { kind: 'none', why: 'loading' } })[5];
    expect(tile({ yearlyGrowth: 0.073 }).value, 'BREAK-EVEN tile').toBe('7.3% a year');
    expect(tile({ yearlyGrowth: -0.5, atFloor: true }).value, 'BREAK-EVEN tile floor').toBe('−50.0% or lower');
    expect(tile({ reason: 'nothingLasts' }).value, 'BREAK-EVEN tile none').toBe('None up to 100.0%');
  });
});

// ── the cut (the follow-ups' F-1): a replay the horizon ends before its low ─────────────────────────────────────────

/** Three invented tops on real dates, one in each cycle's window. */
const TOPS: readonly [string, number][] = [['2013-12-04', 1000], ['2017-12-15', 20_000], ['2021-11-10', 60_000]];
/**
 * A month-end history, 2012–2025: a close on each month's last day, each era flat under its cycle's invented top; the top
 * on its own day; then down a twentieth of the top a month to the low, `lows[i]` month-ends after the top, and back up the
 * same steps to the top. Round prices — and the leaf's `troughMonth` is exactly `lows[i]`.
 */
function monthEnds(lows: readonly [number, number, number]): DatedPrice[] {
  const lastDay = (y: number, m: number): number => Date.UTC(y, m + 1, 1) - 86_400_000;
  const closes = new Map<number, number>();
  for (let y = 2012; y <= 2025; y++) {
    for (let m = 0; m < 12; m++) {
      const t = lastDay(y, m);
      closes.set(t, t < Date.UTC(2017, 0, 1) ? 300 : t < Date.UTC(2021, 0, 1) ? 5000 : 15_000);
    }
  }
  const tops = TOPS.map(([iso, top], i): DatedPrice => {
    const d = new Date(`${iso}T00:00:00Z`), step = top / 20, low = lows[i];
    for (let k = 1; k <= 2 * low + 1; k++) {
      closes.set(lastDay(d.getUTCFullYear(), d.getUTCMonth() + k - 1), top - step * (k <= low ? k : 2 * low - k));
    }
    return { timestamp: d.getTime(), price: top };
  });
  return [...tops, ...[...closes].map(([timestamp, price]) => ({ timestamp, price }))];
}
const TODAY = new Date('2026-10-12T00:00:00Z');
const START_DATE = new Date(`${START}T00:00:00Z`);
const BASE = ramp(100_000, 500);   // 240 months: the horizon's last is month 239, Sep 2046
const MID = { openingBtc: 1, coldBtc: 0, incomeUsd: 5000, expensesUsd: 5000 };
const THIN = { openingBtc: 0.3, coldBtc: 0, incomeUsd: 5000, expensesUsd: 5000 };
const CUT_TILE = 'The horizon ends before a bear reaches its low.';
const CUT_CARD = 'No capacity: the horizon ends before a bear reaches its low.';
const CUT_LINE = ' — the horizon ends before its low';
/** The leaf's own lows — every premise reads these, never the run's `cut`. */
const lowsOf = (readings: readonly ReplayReading[]): number[] => readings.map((r) => (r.replay as Replay).troughMonth);
/** The face's pipeline at a held stop: the crossing, the runs, the face's own result there, the capacity and the card. */
function atStop(readings: readonly ReplayReading[], stop: number, run: FireRun) {
  const paths = replayPathsAt(BASE, START_DATE, stop, readings);
  const runs = replayRunsOf(run.x, stop, paths);
  const held: FireRun = { ...run, result: fireTimeline({ ...run.x, stopMonth: stop }, BASE) };
  const capacity = capacityOf(held.result, runs, 'ready', 0);
  return { paths, runs, capacity, card: replaysCard({ run: held, runs, history: 'ready', capacity, startISO: START, bufferPct: 0 }) };
}

describe('⭐ the cut — a replay the horizon ends before its low (the follow-ups\' F-1)', () => {
  it('⭐ CUT — stop 228 (In years: 19): no capacity, the cut reason in the tile and the card; each cut bear\'s line says so, one that runs out keeps its own', () => {
    const readings = fireReplayReadings(monthEnds([10, 14, 12]), TODAY);
    expect(lowsOf(readings), 'CUT premise: the lows, 10, 14 and 12 month-ends after each top').toEqual([10, 14, 12]);
    const run = runOn(BASE, MID, { stopChoice: 'years', stopYears: 19 });
    expect(run.result.stopMonth, 'CUT premise: In years 19 is month 228').toBe(228);
    expect(lowsOf(readings).map((l) => 228 + l > 239), 'CUT premise: the 2017 and 2021 lows fall past Sep 2046').toEqual([false, true, true]);
    const runs = replayRunsOf(run.x, 228, replayPathsAt(BASE, START_DATE, 228, readings));
    expect(runs.map((r) => r.lasts), 'CUT premise: all three last').toEqual([true, true, true]);
    const c = capacityOf(run.result, runs, 'ready', 0);
    expect(c, 'CUT no capacity: the cut reason').toEqual({ kind: 'none', why: 'cut' });
    const tile = fireTiles({ run, fi: inputs({ stopChoice: 'years', stopYears: 19 }), startISO: START, capacity: c })[4];
    expect([tile.value, tile.sub], 'CUT the tile').toEqual([NONE, CUT_TILE]);
    const card = replaysCard({ run, runs, history: 'ready', capacity: c, startISO: START, bufferPct: 0 });
    expect(card.capacity, 'CUT the card').toBe(CUT_CARD);
    expect(card.lines, 'CUT each cut bear says so; the 2013 line as today').toEqual([
      '2013 bear: lasts through Sep 2046.',
      '2017 bear: lasts through Sep 2046 — the horizon ends before its low.',
      '2021 bear: lasts through Sep 2046 — the horizon ends before its low.',
    ]);
    // One that runs out keeps its line: a thin position, the same stop.
    const thin = atStop(readings, 228, runOn(BASE, THIN));
    expect([thin.runs[1].lasts, thin.runs[1].runOutMonth !== null], 'CUT premise: the cut 2017 bear runs out').toEqual([false, true]);
    expect(thin.card.lines[1], 'CUT a cut bear that runs out keeps its line')
      .toBe(`2017 bear: runs out in ${fireMonthYear(START, thin.runs[1].runOutMonth as number)}.`);
    // A replayed path whose low isn't known is never vouched for.
    expect(replayRunsOf(run.x, 0, [{ id: '2013', path: BASE, reason: null, troughMonth: null }])[0].cut, 'CUT a low not known reads as cut').toBe(true);
  });

  it('⭐ CUT EDGE — a low at the horizon\'s last month: shown, as today; one month later: withheld — the capacity and the line alike', () => {
    const readings = fireReplayReadings(monthEnds([10, 14, 12]), TODAY);
    expect(lowsOf(readings), 'CUT EDGE premise: the lows').toEqual([10, 14, 12]);
    const mid = runOn(BASE, MID);
    // The capacity's edge: the 2017 low, 14 months on — month 239 from a stop at 225, month 240 from 226.
    const edge = atStop(readings, 225, mid);
    const engine = edge.paths.map((p) => withdrawalCapacity({ ...mid.x, stopMonth: 225 }, p.path as number[]));
    const usd = engine.map((k) => k.capacityUsd as number);
    const low = usd.indexOf(Math.min(...usd));
    expect(edge.capacity, 'CUT EDGE 225 + 14 = 239: shown, the lowest replay\'s, as today')
      .toEqual({ kind: 'shown', usd: usd[low], atLeast: engine[low].hiBinds, harshest: edge.paths[low].id });
    expect(atStop(readings, 226, mid).capacity, 'CUT EDGE 226 + 14 = 240: withheld').toEqual({ kind: 'none', why: 'cut' });
    // The line's edge: the 2013 low, 10 months on — month 239 from a stop at 229, month 240 from 230.
    expect(atStop(readings, 229, mid).card.lines[0], 'CUT EDGE 229 + 10 = 239: the line as today').toBe('2013 bear: lasts through Sep 2046.');
    expect(atStop(readings, 230, mid).card.lines[0], 'CUT EDGE 230 + 10 = 240: the line says so')
      .toBe('2013 bear: lasts through Sep 2046 — the horizon ends before its low.');
  });

  it('⭐ CUT ONE — only the 2021 bear cut, not the first: withheld', () => {
    const readings = fireReplayReadings(monthEnds([10, 10, 14]), TODAY);
    expect(lowsOf(readings).map((l) => 226 + l > 239), 'CUT ONE premise: only the 2021 low falls past Sep 2046').toEqual([false, false, true]);
    const at = atStop(readings, 226, runOn(BASE, MID));
    expect(at.capacity, 'CUT ONE').toEqual({ kind: 'none', why: 'cut' });
    expect(at.card.lines, 'CUT ONE the lines').toEqual([
      '2013 bear: lasts through Sep 2046.', '2017 bear: lasts through Sep 2046.', '2021 bear: lasts through Sep 2046 — the horizon ends before its low.',
    ]);
  });

  it('⭐ CUT ORDER — a missing cycle and a cut one: the missing cycle\'s reason', () => {
    const late = monthEnds([10, 14, 12]).filter((p) => p.timestamp >= Date.UTC(2016, 0, 1));   // the 2013 top is gone
    const readings = fireReplayReadings(late, TODAY);
    expect(readings.map((r) => [r.id, r.reason]), 'CUT ORDER premise: 2013 not replayed').toEqual([['2013', 'noPeak'], ['2017', null], ['2021', null]]);
    expect(readings.slice(1).map((r) => 228 + (r.replay as Replay).troughMonth > 239), 'CUT ORDER premise: the 2017 and 2021 lows past Sep 2046').toEqual([true, true]);
    const at = atStop(readings, 228, runOn(BASE, MID));
    expect(at.capacity, 'CUT ORDER the missing cycle first').toEqual({ kind: 'none', why: 'missing', missing: '2013' });
    expect(at.card.capacity, 'CUT ORDER the card').toBe('No capacity: the 2013 bear couldn\'t be replayed, and it might be the harshest.');
  });

  it('⭐ CUT SWEEP — every stop 0–239: withheld exactly when a low falls past the horizon, shown as today otherwise; both sides reached', () => {
    const readings = fireReplayReadings(monthEnds([10, 14, 12]), TODAY);
    const lows = lowsOf(readings);
    expect(lows, 'CUT SWEEP premise: the lows').toEqual([10, 14, 12]);
    const mid = runOn(BASE, MID);
    const sides = { shown: 0, withheld: 0 };
    for (let stop = 0; stop < 240; stop++) {
      const at = atStop(readings, stop, mid);
      const cut = lows.map((l) => stop + l > 239);
      if (cut.some(Boolean)) {
        sides.withheld += 1;
        expect(at.capacity, `CUT SWEEP ${stop}: withheld`).toEqual({ kind: 'none', why: 'cut' });
      } else {
        sides.shown += 1;
        // As today: the lowest of the engine's three capacities on the same paths, in this run (ties to the first).
        const engine = at.paths.map((p) => withdrawalCapacity({ ...mid.x, stopMonth: stop }, p.path as number[]));
        const usd = engine.map((k) => k.capacityUsd as number);
        const low = usd.indexOf(Math.min(...usd));
        expect(at.capacity, `CUT SWEEP ${stop}: shown, as today`)
          .toEqual({ kind: 'shown', usd: usd[low], atLeast: engine[low].hiBinds, harshest: at.paths[low].id });
      }
      expect(at.card.lines, `CUT SWEEP ${stop}: the lines`).toEqual(at.runs.map((r, i) => (r.lasts || r.runOutMonth === null
        ? `${r.id} bear: lasts through Sep 2046${cut[i] ? CUT_LINE : ''}.`
        : `${r.id} bear: runs out in ${fireMonthYear(START, r.runOutMonth)}.`)));
    }
    expect(sides, 'CUT SWEEP both sides reached').toEqual({ shown: 226, withheld: 14 });
  });
});

describe('⭐ the chart, the scale and the Milestones', () => {
  it('⭐ GAPS — a point with no bitcoin to draw is a gap, never 0; nothing to draw → no domain', () => {
    const none = runOn(flat(100_000), { openingBtc: 0, coldBtc: 0, incomeUsd: 4000, expensesUsd: 4000 }, { otherUsd: 9_000_000 });
    const pts = fireChartPoints(none.result, START);
    expect(pts.every((p) => p.owned === null && p.needed === null), 'GAPS none owned, none needed').toBe(true);
    expect(fireChartDomain(pts), 'GAPS nothing to draw').toBeNull();
    expect(CHART_EMPTY, 'GAPS the words').toBe('Nothing to draw on this path.');
    const some = runOn(crash(100_000, 30_000), { openingBtc: 1, coldBtc: 0, incomeUsd: 4000, expensesUsd: 4000 }, { stopChoice: 'now' });
    const sp = fireChartPoints(some.result, START);
    expect(sp.some((p) => p.owned === null), 'GAPS premise: it runs out').toBe(true);
    for (const p of sp) expect(p.owned !== 0 && p.needed !== 0, `GAPS month ${p.m}`).toBe(true);
    const d = fireChartDomain(sp) as [number, number];
    expect(d[0] > 0 && d[1] > d[0], 'GAPS a positive domain').toBe(true);
    expect(fireTooltipLines(sp[sp.length - 1]).map((l) => l.value).slice(0, 2), 'GAPS the tooltip').toEqual([NONE, expect.stringMatching(/^₿\d/)]);
  });

  it('⭐ HOVER BOX — the two ₿ rows are the chart\'s lines, with their colour and dash; the dollar rows are no line (BL41)', () => {
    expect(FIRE_LINES.owned, 'HOVER BOX ₿ owned: solid --btc').toStrictEqual({ name: CHART_OWNED, color: 'var(--btc)', dash: undefined });
    expect(FIRE_LINES.needed, 'HOVER BOX ₿ needed: dashed --text-secondary').toStrictEqual({ name: CHART_NEEDED, color: 'var(--text-secondary)', dash: '5 4' });
    const run = runOn(crash(100_000, 30_000), { openingBtc: 1, coldBtc: 0, incomeUsd: 4000, expensesUsd: 4000 }, { stopChoice: 'now' });
    const pts = fireChartPoints(run.result, START);
    const gap = pts.find((p) => p.owned === null);
    expect(gap, 'HOVER BOX premise: a gap month').toBeDefined();
    for (const p of [pts[0], gap!]) {
      const rows = fireTooltipLines(p);
      expect(rows.map((r) => r.name), `HOVER BOX the rows, month ${p.m}`).toEqual([CHART_OWNED, CHART_NEEDED, 'Portfolio, today\'s dollars', 'Price, today\'s dollars']);
      expect(rows[0].line, `HOVER BOX ₿ owned is its line, month ${p.m}`).toBe(FIRE_LINES.owned);
      expect(rows[1].line, `HOVER BOX ₿ needed is its line, month ${p.m}`).toBe(FIRE_LINES.needed);
      expect(rows.slice(2).map((r) => r.line), `HOVER BOX the dollar rows are no line, month ${p.m}`).toEqual([null, null]);
    }
    expect(fireTooltipLines(gap!)[0].value, 'HOVER BOX a gap row keeps its line, its value "—"').toBe(NONE);
  });

  it('⭐ TODAY\'S DOLLARS — every dollar shown is nominal ÷ the row\'s inflation step', () => {
    const run = runOn(flat(103_000), { inflationPct: 3, openingBtc: 2, incomeUsd: 8000, expensesUsd: 4000 });
    const rows = fireMilestoneRows(run.result, START);
    const at = (m: number) => rows.find((r) => r.month === m)?.cells.find((c) => c.label === 'Price')?.value;
    expect(at(12), 'TODAY\'S DOLLARS year 1').toBe('$100,000');
    expect(at(24), 'TODAY\'S DOLLARS year 2').toBe('$97,087');
    const pts = fireChartPoints(run.result, START);
    expect([pts[0].price, pts[12].price], 'TODAY\'S DOLLARS the tooltip').toEqual(['$103,000', '$100,000']);
    expect(dollarsNote(3), 'TODAY\'S DOLLARS said once').toBe('Dollars here are today\'s: each month\'s figure ÷ inflation since today (3% a year, stepped yearly).');
  });

  it('⭐ SCALE — years of funded spending: one mark at equal rates, two once a bitcoin rate is typed; no names', () => {
    const one = fireScale(runOn(flat(100_000)));
    expect(one?.marks, 'SCALE one mark').toEqual([{ at: 25, label: 'The need: 25 years at 4%' }]);
    const two = fireScale(runOn(flat(100_000), {}, { wBtcPct: 8 }));
    expect(two?.marks.length, 'SCALE two marks').toBe(2);
    expect(two?.marks[1], 'SCALE the traditional mark').toEqual({ at: 25, label: 'At 4% for all: 25 years' });
    expect(two?.caption, 'SCALE no level names').not.toMatch(/FIRE|Barista|Lean|Coast|Chubby|Fat|level/i);
  });

  it('⭐ MILESTONES — a row a year strictly inside the horizon, its last month, and the flagged months', () => {
    for (const n of [240, 120, 30]) {
      const run = runOn(flat(100_000, n), { openingBtc: 1, coldBtc: 0, incomeUsd: 10_000, expensesUsd: 2000 });
      const months = fireMilestoneMonths(run.result);
      expect(Math.max(...months), `MILESTONES ${n}: never past the last row`).toBe(n - 1);
      expect(months.filter((m) => m % 12 === 0 && m > 0), `MILESTONES ${n}: the years`).toEqual(Array.from({ length: Math.ceil(n / 12) - 1 }, (_, k) => 12 * (k + 1)));
      const rows = fireMilestoneRows(run.result, START);
      expect(rows.every((r) => r.cells.length === 6), `MILESTONES ${n}: six cells a row`).toBe(true);
    }
    const run = runOn(flat(100_000, 120), { openingBtc: 1, coldBtc: 0, incomeUsd: 10_000, expensesUsd: 2000 });
    const fi = fireMilestoneRows(run.result, START).find((r) => r.month === 63);
    expect(fi && { flags: fi.flags, turn: fi.turn }, 'MILESTONES the FI and stop month, flagged and dated').toEqual({ flags: [{ text: 'stop' }, { text: 'FI' }], turn: 'Jan 2032' });
  });

  it('⭐ MILESTONES — the switch table\'s views partition the table\'s columns, in its order', () => {
    expect(MS_VIEWS_FIRE.flatMap((v) => v.cols).sort(), 'MILESTONES partition').toEqual([...MS_COLS_FIRE].sort());
  });
});

describe('⭐ the model card', () => {
  it('⭐ LIMITS — what it leaves out says your savings and retirement income rise with inflation (the follow-ups\' F-3)', () => {
    expect(MODEL_LIMITS, 'LIMITS the incomes rise with inflation').toContain(
      'Your savings while you work, and your retirement income, rise with inflation as your spending does; a pension without cost-of-living raises would cover less each year.');
  });
});

// ── the words sweep: every sentence and every Milestones cell, over states that reach the zeros ──────────────────

const BANNED: [string, RegExp][] = [
  ['safe', /safe/i], ['you can retire', /you can retire/i], ['guaranteed', /guarantee/i], ['should', /should/i],
  ['need to', /\bneed to\b/i], ['$0', /\$0(?![\d.,])/], ['$0.00', /\$0\.00(?!\d)/], ['₿0', /₿0(?![\d.])/],
  ['₿0.000', /₿0\.000(?!\d)/], ['0.0 years', /(?<![\d.])0\.0 years/], ['NaN', /NaN/], ['Infinity', /Infinity/],
  ['undefined', /undefined/], ['all N years', /all \d+ years/i],
];

describe('⭐ BANNED — no sentence or cell says what the face never says, or prints a zero', () => {
  it('⭐ BANNED — the sweep, over households that reach every zero', () => {
    const texts: string[] = [
      FIRE_TITLE, FIRE_FRAMING, REPLAYS_TITLE, REPLAYS_INFO, CHART_TITLE, CHART_OWNED, CHART_NEEDED, CHART_EMPTY, CHART_GAP_NOTE,
      UNDERWATER_LINE, ...Object.values(STOP_CARD).flatMap((v) => (typeof v === 'string' ? [v] : v.map((c) => c.label))),
      ...MODEL_RULES, ...MODEL_LIMITS, ...MODEL_CREDITS.map((c) => c.text), FIRE_DISCLAIMER.lead, FIRE_DISCLAIMER.body,
      spendHint(0, false), spendHint(4000, false), spendHint(4000, true), dollarsNote(0), dollarsNote(2.5),
      anchoredLine(100_000, 101_000, 0.01, true) ?? '', stressLine(0.7, 12, START) ?? '', stressLine(1.3, 0, START) ?? '',
    ];
    const zeroCols = new Map<string, number>();
    const cells: string[] = [];
    const households: Partial<FireFacts>[] = [
      { openingBtc: 2, coldBtc: 0.5 }, { openingBtc: 0, coldBtc: 0 }, { openingBtc: 1, coldBtc: 0, openingDebtUsd: 150_000 },
      { openingBtc: 0.1, coldBtc: 0, incomeUsd: 2000 }, { openingBtc: 0.0001, coldBtc: 0, incomeUsd: 4000 }, { expensesUsd: 0 },
    ];
    const choices: Partial<FireFaceInputs>[] = [
      {}, { otherUsd: 0, stopChoice: 'now' }, { otherUsd: 200_000, stopChoice: 'now' }, { stopChoice: 'years', stopYears: 20 },
      { bufferPct: 10, wBtcPct: 8 }, { retirementIncomeUsd: 9000 }, { otherUsd: 9_000_000 },
    ];
    const paths = [flat(100_000), crash(100_000, 20_000), ramp(100_000, 2000), flat(100_000, 30), [100_000, 0]];
    const histories: HistoryState[] = ['ready', 'loading', 'failed', 'offline'];
    for (const f of households) {
      for (const i of choices) {
        for (const path of paths) {
          for (const infl of [0, 3]) {
            const run = runOn(path, { ...f, inflationPct: infl }, i);
            const stop = run.result.stopMonth;
            const p13 = crash(100_000, 20_000, path.length);
            const readings: ReplayPathReading[] = stop === null || stop >= path.length ? [] : [
              { id: '2013', path: p13, reason: null, troughMonth: lowAfter(p13, stop) },
              { id: '2017', path: path.length > 2 ? flat(100_000, path.length) : null, reason: path.length > 2 ? null : 'gap', troughMonth: path.length > 2 ? 0 : null },
              { id: '2021', path: null, reason: 'noPeak', troughMonth: null },
            ];
            const runs = run.result.valid && stop !== null ? replayRunsOf(run.x, stop, readings) : [];
            for (const h of histories) {
              const c = capacityOf(run.result, runs, h, i.bufferPct ?? 0);
              const fi = inputs(i);
              for (const t of fireTiles({ run, fi, startISO: START, capacity: c })) texts.push(t.label, t.value, t.sub);
              const card = replaysCard({ run, runs, history: h, capacity: c, startISO: START, bufferPct: fi.bufferPct });
              texts.push(card.state ?? '', ...card.lines, card.capacity ?? '', card.breakEven ?? '');
            }
            // F-1 — the cut state, where it shows (a ready history): all three replayed, the 2013 bear still falling at the
            // horizon's end, its low past it.
            const cutReadings: ReplayPathReading[] = stop === null || stop >= path.length ? [] : [
              { id: '2013', path: ramp(100_000, -300, path.length), reason: null, troughMonth: path.length },
              { id: '2017', path: flat(100_000, path.length), reason: null, troughMonth: 0 },
              { id: '2021', path: flat(100_000, path.length), reason: null, troughMonth: 0 },
            ];
            const cutRuns = run.result.valid && stop !== null ? replayRunsOf(run.x, stop, cutReadings) : [];
            const cutCap = capacityOf(run.result, cutRuns, 'ready', i.bufferPct ?? 0);
            const cutTile = fireTiles({ run, fi: inputs(i), startISO: START, capacity: cutCap })[4];
            const cutCard = replaysCard({ run, runs: cutRuns, history: 'ready', capacity: cutCap, startISO: START, bufferPct: inputs(i).bufferPct });
            texts.push(cutTile.value, cutTile.sub, ...cutCard.lines, cutCard.capacity ?? '');
            texts.push(...firePositionLine(facts({ ...f, inflationPct: infl }), path[0], run.result.uncoveredDebtUsd));
            const scale = fireScale(run);
            if (scale) texts.push(scale.caption, scale.ariaLabel, ...scale.marks.map((m) => m.label), scale.you?.label ?? '');
            for (let m = 0; m < run.result.rows.length; m += 7) texts.push(inspectedLine(run.result, m, START) ?? '');
            for (const p of fireChartPoints(run.result, START)) texts.push(...fireTooltipLines(p).map((l) => `${l.name} ${l.value}`));
            for (const r of fireMilestoneRows(run.result, START)) {
              texts.push(r.year, r.turn ?? '', ...r.flags.map((x) => x.text));
              for (const cell of r.cells) {
                cells.push(cell.value);
                if (cell.value === NONE) zeroCols.set(cell.label, (zeroCols.get(cell.label) ?? 0) + 1);
                if (cell.label === 'Years funded') expect(cell.value, 'BANNED a years cell').not.toBe('0.0');
              }
            }
          }
        }
      }
    }
    for (const [name, re] of BANNED) {
      const hit = [...texts, ...cells].find((t) => re.test(t));
      expect(hit, `BANNED "${name}"`).toBeUndefined();
    }
    // Non-vacuous: the sweep reached a zero in each of the columns that hold one.
    for (const col of ['Other assets', '₿ owned', 'Portfolio', 'Years funded']) {
      expect(zeroCols.get(col) ?? 0, `BANNED reaches a zero in ${col}`).toBeGreaterThan(0);
    }
    expect(texts.length, 'BANNED non-vacuous').toBeGreaterThan(10_000);
    // F-1 — the sweep reaches the cut state: its words are among the texts it checked.
    for (const w of [CUT_TILE, CUT_CARD, `${CUT_LINE}.`]) expect(texts.some((t) => t.includes(w)), `BANNED reaches the cut state: "${w}"`).toBe(true);
  }, 60_000);
});
