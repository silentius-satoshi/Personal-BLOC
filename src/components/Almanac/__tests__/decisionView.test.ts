import { describe, it, expect } from 'vitest';
import {
  ACTION_FIELDS, rowActions, todayActions, planSchedule, planOutcome, coinbaseLoanLine, scheduleToText,
  moveCard, MOVE_CARD_TITLE, PLAN_OF_RECORD_LINE, fmtBtc3,
  type ActionKind, type MoveCardContext, type BreakerReading,
} from '../decisionView';
import {
  placementPlan, MOVE_THRESHOLD_BTC,
  type PlacementInput, type PlacementPlan, type PlacementState,
} from '../../../simulation/placement';
import { runCyclingSim, allInEquity, type CyclingInputs, type CyclingResult } from '../../../simulation/cyclingSim';
import { cbMetrics } from '../../../simulation/cbMetrics';
import { ceilingLiquidationMultiple } from '../../../simulation/cbDefense';
import { CB_LLTV } from '../../../simulation/runCoinbaseLoan';
import { deriveOwnership } from '../../../simulation/ownership';
import { DISPLAY_DUST_BTC, shownBtc, shownUsd } from '../supportPolicyView';
import {
  SP_REPRO, SUPPORT, CASH_6_USD, policyFor, a5Cases, callRun, faceWorldGrid, reachGrid, syntheticGrid,
} from '../../../simulation/__tests__/supportPolicyPaths';

/**
 * The Decision face's schedule and THE MOVE's copy. Round synthetic figures only — this repo is public.
 *
 * 🔴 I31: every line THE MOVE shows comes from `moveCard`, so the face composes no copy and every sentence is
 * reachable from a test. 🔴 I14: no sentence anywhere prints "$0" or "0.000 ₿".
 */

const NO_ZERO = /\$0(?![\d,])/;
const NO_ZERO_BTC = /(^|[^\d])0\.000 ₿/;

// ── the placement fixtures the card is read against ──────────────────────────────────────────────────────────

const PLACE: PlacementInput = {
  creditLine: 40_000, strikeBalance: 0, strikeCollateralBtc: 2, cbDebt: 60_000, cbCollateralBtc: 2,
  coldBtc: 0.5, price: 100_000, support: 100_000, skStop: 0.50, cbStop: 0.60, cbDefenseLtv: 0.70,
  bufferUsd: 72_000, accumulateBelow: 1.5, payDownAbove: 2.0, inHold: false, broken: false,
};
const place = (o: Partial<PlacementInput> = {}) => placementPlan({ ...PLACE, ...o });

const BREAKERS: [string, BreakerReading | null][] = [
  ['clean', { broken: false, monthsAtOrAbove: 0, monthsBelow: 0, lastMonthEndLabel: '31 Aug 2026' }],
  ['one short', { broken: false, monthsAtOrAbove: 0, monthsBelow: 1, lastMonthEndLabel: '31 Aug 2026' }],
  ['broken', { broken: true, monthsAtOrAbove: 2, monthsBelow: 2, lastMonthEndLabel: '31 Aug 2026' }],
  ['no history', null],
];

const CTX: MoveCardContext = {
  policyApplied: true, policyEnabled: true, policyIgnoredReason: null,
  plan: place(), holdThroughISO: null, holdDepositISO: null,
  breaker: BREAKERS[0][1], rearmRule: 6,
  runLineUsd: 40_000, ownerLineUsd: 40_000, suggestedLineUsd: 20_000,
  expenses: 6_000, bearBufferMonths: 12, cbStop: 0.60, support: 100_000, price: 100_000,
  cbDebt: 60_000, cbLtvTriggerPct: 75, cbLtvTargetPct: 65, hasCbLoan: true, ltvTriggered: true,
};
const card = (o: Partial<MoveCardContext> = {}) => moveCard({ ...CTX, ...o });
const keyed = (o: Partial<MoveCardContext>, key: string) => card(o).lines.find((l) => l.key === key);

// ── I13 · completeness ───────────────────────────────────────────────────────────────────────────────────────

/** Every kind a ROW can produce, in the engine's month order. `strikeToCold` is today-only (the plan, not a row). */
const ENGINE_KINDS: ActionKind[] = [
  'draw', 'cashToBills', 'unpaid', 'repayStrike', 'repayCoinbase', 'buy', 'strikeToCoinbase', 'refinance',
  'coldToCoinbase', 'strikeReleaseToCoinbase', 'debtShift', 'coldToStrike', 'defenseShort', 'cashCure',
  'coldCure', 'strikeSale', 'coinbaseToCold', 'liquidation',
];

describe('⭐ I13 — every ACTION_FIELDS entry that fires appears in the schedule AND in the printout', () => {
  const runs: (() => CyclingResult)[] = [];
  const OWNER_FIXTURES: Partial<CyclingInputs>[] = [
    {}, { strikeCollateralBtc: 2 },
    { strikeCollateralBtc: 2, cbDebt: 0, cbCollateralBtc: 0 },
    { strikeCollateralBtc: 2, cbDebt: 50_000, cbCollateralBtc: 1 },
  ];
  for (const c of a5Cases()) for (const over of OWNER_FIXTURES) {
    runs.push(() => runCyclingSim({ ...c.on, ...over }), () => runCyclingSim({ ...c.off, ...over }));
  }
  for (const cell of [...faceWorldGrid(), ...reachGrid()]) {
    runs.push(() => runCyclingSim(cell.off),
      () => runCyclingSim({ ...cell.off, supportPolicy: policyFor(cell.support) }));
  }
  for (const cell of syntheticGrid()) {
    runs.push(() => runCyclingSim({ ...cell.off, supportPolicy: policyFor(cell.support) }));
  }
  // The margin-call fixtures — the ONLY source of a cash cure, a cold cure and a Strike sale.
  runs.push(() => callRun(), () => callRun({ openingCashUsd: CASH_6_USD }),
    () => callRun({}, { strikeLtvCapPct: 0, openingColdBtc: 0.1 }));

  it(`⭐ the sweep (${runs.length} runs) — no action is dropped, and every kind is reached`, () => {
    const reached = new Set<ActionKind>();
    const misses: string[] = [];
    let rowCount = 0;
    const plan = place();
    for (const run of runs) {
      const sim = run();
      const sched = planSchedule(sim, plan);
      // ⚠ Membership, not `toContain` per action: scanning the whole printout for every action is O(n²) over a
      // sweep this size (110s vs 3s). `scheduleToText` writes each action as "  - <text>".
      const printed = new Set(scheduleToText(sched, 'h', 'a', 'd')
        .split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4)));
      // The schedule already derived every row's actions — re-deriving them here doubles the sweep's cost.
      const byMonth = new Map(sched.map((r) => [r.m, r.actions]));
      for (const row of sim.rows) {
        if (row.m === 0) continue;
        rowCount += 1;
        const acts = byMonth.get(row.m) ?? [];
        const kinds = new Set(acts.map((a) => a.kind));
        for (const f of ACTION_FIELDS) {
          if (f.field === null) continue;
          const v = row[f.field];
          const fires = typeof v === 'number' && (f.unit === 'usd' ? shownUsd(v) : shownBtc(v));
          // ⚠ COLLECT, don't `expect`, in the innermost loop: 17 assertions × ~490k rows is 8M expect() calls
          // and ~110s of suite time. One assertion at the end says the same thing in 3s.
          if (kinds.has(f.kind) !== fires) misses.push(`m${row.m} ${f.kind}: fires=${fires}`);
        }
        for (const a of acts) {
          reached.add(a.kind);
          if (!printed.has(a.text)) misses.push(`printout dropped: ${a.text}`);
        }
      }
      if (sim.liqMonth !== null) reached.add('liquidation');
    }
    expect(misses.slice(0, 5), `${misses.length} mismatches`).toEqual([]);
    expect(rowCount).toBeGreaterThan(100_000);
    // ⚠ Against an EXPLICIT list, never against ACTION_FIELDS itself: deriving the expectation from the table
    // under test makes deleting an entry delete its own check — the sweep then passes while the printed schedule
    // silently drops that step. This list is the contract; the table must match it exactly, in the engine's order.
    expect(ACTION_FIELDS.map((f) => f.kind)).toEqual(ENGINE_KINDS);
    for (const k of ENGINE_KINDS) expect(reached.has(k), `never reached: ${k}`).toBe(true);
  }, 600_000);
});

// ── I14 · no sentence prints a zero ──────────────────────────────────────────────────────────────────────────

describe('⭐ I14 — no schedule line prints "$0" or "0.000 ₿"', () => {
  it('⭐ across a5Cases, both arms, and the owner fixtures', () => {
    const plan = place();
    for (const c of a5Cases()) {
      for (const inputs of [c.on, c.off]) {
        const sim = runCyclingSim(inputs);
        const sched = planSchedule(sim, plan);
        for (const row of sched) {
          for (const a of row.actions) {
            expect(a.text, `${c.name} ${row.label} ${a.kind}`).not.toMatch(NO_ZERO);
            expect(a.text, `${c.name} ${row.label} ${a.kind}`).not.toMatch(NO_ZERO_BTC);
          }
        }
        const text = scheduleToText(sched, 'header', 'answer', 'disclaimer');
        expect(text).not.toMatch(NO_ZERO);
        expect(text).not.toMatch(NO_ZERO_BTC);
      }
    }
  });

  it('an amount under its floor is left out entirely', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
    const row = { ...sim.rows[1], strikeDrawn: 0.4, sweptToColdBtc: 0.0004, refinancedUsd: 0.3 };
    const kinds = rowActions(row, null).map((a) => a.kind);
    expect(kinds).not.toContain('draw');
    expect(kinds).not.toContain('coinbaseToCold');
    expect(kinds).not.toContain('refinance');
  });
});

// ── today's row, the loan line, the printout ─────────────────────────────────────────────────────────────────

describe('today\'s row reads the PLAN, never a row', () => {
  it('a real move lists its legs', () => {
    const p = place({ strikeCollateralBtc: 10, cbDebt: 0, bufferUsd: 0 });
    const acts = todayActions(p);
    expect(acts.map((a) => a.kind)).toEqual(['strikeToCold', 'coinbaseToCold']);
    for (const a of acts) expect(a.text).not.toMatch(NO_ZERO_BTC);
  });

  it('nothing to move ⇒ no actions', () => {
    expect(todayActions(place({ strikeCollateralBtc: 0.01, cbDebt: 60_000 }))).toEqual([]);
  });

  it("⭐ N5 — today's row never marks a leg small, and has no actions unless the move is made", () => {
    const p = place({ strikeCollateralBtc: 10, cbDebt: 0, bufferUsd: 0 });
    expect(p.worthMoving).toBe(true);
    for (const a of todayActions(p)) expect(a.text, a.kind).not.toContain('small — can wait');
    // Relabelled inert: no actions at all, whatever the legs say.
    expect(todayActions({ ...p, state: 'broken' } as PlacementPlan)).toEqual([]);
    expect(todayActions({ ...p, worthMoving: false } as PlacementPlan)).toEqual([]);
  });

  it('a CRASH action is never marked small', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
    const row = { ...sim.rows[1], topUpFromColdBtc: 0.002 };
    const a = rowActions(row, null).find((x) => x.kind === 'coldToCoinbase')!;
    expect(a.text).not.toContain('can wait');
  });
});

describe('coinbaseLoanLine — the three shapes', () => {
  const sim = () => runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
  it('null once the owner HAS a loan', () => {
    expect(coinbaseLoanLine(sim(), place({ strikeCollateralBtc: 10 }), true)).toBeNull();
  });
  it('names when collateral moves and when the first borrow is', () => {
    const s = sim();
    const line = coinbaseLoanLine(s, place({ strikeCollateralBtc: 10 }), false);
    expect(line).toContain('You have no Coinbase loan yet.');
    expect(line).toMatch(/collateral moves to Coinbase today/);
  });
  it('says so when the path never borrows', () => {
    const s = sim();
    const noBorrow: CyclingResult = { ...s, rows: s.rows.map((r) => ({ ...r, refinancedUsd: 0 })) };
    expect(coinbaseLoanLine(noBorrow, place({ strikeCollateralBtc: 10 }), false))
      .toContain('this path never borrows on Coinbase');
  });
  it('null when nothing reaches Coinbase at all', () => {
    const s = sim();
    const nothing: CyclingResult = { ...s, rows: s.rows.map((r) => ({ ...r, strikeToCbBtc: 0 })) };
    expect(coinbaseLoanLine(nothing, place({ strikeCollateralBtc: 0.01 }), false)).toBeNull();
  });
});

describe('planOutcome and scheduleToText', () => {
  it('planOutcome reads the run, with deriveOwnership at THREE arguments', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
    const o = planOutcome(sim);
    expect(o.yours).toBe(deriveOwnership(sim.last.btcHeld, sim.last.debt, sim.last.price).yoursBtc);
    expect(o.cold).toBe(sim.last.coldBtc);
    expect(o.allIn).toBe(allInEquity(sim));
    expect(o.liqMonth).toBe(sim.liqMonth);
  });

  it('⭐ the printout carries the header, THE MOVE, every action and the disclaimer', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
    const sched = planSchedule(sim, place({ strikeCollateralBtc: 10 }));
    const text = scheduleToText(sched, 'HEADER', 'THE ANSWER LINE', 'DISCLAIMER');
    expect(text.startsWith('HEADER')).toBe(true);
    expect(text).toContain('THE ANSWER LINE');
    expect(text.endsWith('DISCLAIMER')).toBe(true);
    for (const r of sched) for (const a of r.actions) expect(text).toContain(a.text);
  });

  it('a crash row carries the Emergency Console note', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
    const crashed: CyclingResult = {
      ...sim, rows: sim.rows.map((r) => (r.m === 3 ? { ...r, topUpFromColdBtc: 0.5 } : r)),
    };
    const sched = planSchedule(crashed, place());
    expect(sched.find((r) => r.m === 3)!.crash).toBe(true);
    expect(scheduleToText(sched, 'h', 'a', 'd')).toContain('work from the Emergency Console');
  });
});

// ── I31 · one home for THE MOVE's copy ───────────────────────────────────────────────────────────────────────

describe('⭐ I31 — moveCard, every line true of its inputs', () => {
  it('the title and the plan-of-record line are always present', () => {
    for (const o of [{}, { policyApplied: false }, { policyApplied: false, policyEnabled: false }]) {
      const c = card(o);
      expect(c.title).toBe(MOVE_CARD_TITLE);
      expect(c.lines[0].text).toBe(PLAN_OF_RECORD_LINE);
    }
  });

  it('policy off, and policy ignored, each get their own state line', () => {
    expect(keyed({ policyApplied: false, policyEnabled: false }, 'state')!.text)
      .toBe('This card needs the support policy — turn it on in the card below.');
    expect(keyed({ policyApplied: false, policyIgnoredReason: 'strikeLadder' }, 'state')!.text)
      .toContain('Strike');
  });

  it('⭐ paused and past-liquidation each say so, and say it ALONE', () => {
    const paused = card({ plan: place({ support: 200_000 }) });
    expect(keyed({ plan: place({ support: 200_000 }) }, 'state')!.text)
      .toBe('Price is below support — the policy moves nothing off Strike or Coinbase today.');
    // "It is the only line": no moves line, and none of the other state-group lines either.
    for (const k of ['moves', 'batch', 'aligned']) {
      expect(paused.lines.find((l) => l.key === k), k).toBeUndefined();
    }

    const past = keyed({ plan: place({ cbDebt: CB_LLTV * 2 * 100_000 }) }, 'state')!;
    expect(past.text).toContain('86% liquidation line');
    expect(past.text).toContain('Emergency Console');
  });

  it('the console pointer names the gate when the strategy is not LTV-triggered', () => {
    const p = place({ cbDebt: CB_LLTV * 2 * 100_000 });
    expect(keyed({ plan: p, ltvTriggered: false }, 'state')!.text)
      .toContain('it runs when your Coinbase strategy is LTV-triggered');
  });

  it('⭐ the Strike leg: moves / hold / ltv — each with its own reason', () => {
    expect(keyed({ plan: place({ strikeCollateralBtc: 10 }) }, 'state')!.text).toBe('Strike releases this today.');
    expect(keyed({
      plan: place({ strikeCollateralBtc: 10, inHold: true }),
      holdThroughISO: '2026-11-20', holdDepositISO: '2026-09-21',
    }, 'state')!.text).toBe("Strike's 60-day hold runs through 2026-11-20 (you logged a Strike deposit on 2026-09-21) — move then.");
    expect(keyed({ plan: place({ strikeCollateralBtc: 10, strikeBalance: 0.45 * 10 * 100_000 }) }, 'state')!.text)
      .toBe('Strike releases nothing while its LTV is above 40% — pay it down first.');
    expect(keyed({
      plan: place({ strikeCollateralBtc: 10, strikeBalance: 0.40 * 10 * 100_000, creditLine: 0 }),
    }, 'state')!.text).toBe('Releasing all of it would leave Strike at 50% LTV or more — pay it down first.');
  });

  it('⭐ the batch line and the aligned line are mutually exclusive', () => {
    const keep = place({ creditLine: 40_000, cbDebt: 0, bufferUsd: 0, cbCollateralBtc: 0 }).strikeKeepBtc!;
    const small = card({ plan: place({ strikeCollateralBtc: keep + 0.005, cbDebt: 0, bufferUsd: 0, cbCollateralBtc: 0 }) });
    expect(small.lines.find((l) => l.key === 'batch')!.text)
      .toContain('under the 0.01 ₿ threshold');
    expect(small.lines.find((l) => l.key === 'aligned')).toBeUndefined();

    const aligned = card({ plan: place({ strikeCollateralBtc: keep, cbDebt: 0, bufferUsd: 0, cbCollateralBtc: 0 }) });
    expect(aligned.lines.find((l) => l.key === 'aligned')!.text)
      .toBe('Nothing to move — Strike and Coinbase hold no more than they need at support.');
    expect(aligned.lines.find((l) => l.key === 'batch')).toBeUndefined();
  });

  it('⭐ the breaker, all four readings', () => {
    expect(keyed({ breaker: BREAKERS[0][1] }, 'breaker')!.text)
      .toBe("Month-ends through 31 Aug 2026: the model isn't treated as broken.");
    expect(keyed({ breaker: BREAKERS[1][1] }, 'breaker')!.text)
      .toContain('one more like it and the model is treated as broken');
    expect(keyed({ breaker: BREAKERS[2][1] }, 'breaker')!.text)
      .toBe('Month-ends through 31 Aug 2026: the model is treated as broken — no new debt until 6 months back on the line (2 so far).');
    expect(keyed({ breaker: null }, 'breaker')!.text)
      .toBe("Price history didn't load, so this run assumes the model isn't treated as broken.");
    expect(keyed({ breaker: BREAKERS[2][1], rearmRule: null }, 'breaker')!.text)
      .toContain('no new debt for the rest of this run');
  });

  it('⭐ S3 — the over-the-limit line REPLACES the aligned line', () => {
    // ⚠ F1 — the fixture must be over at `opening`, not just at today's collateral. $140,000 on 2 ₿ at $100,000
    // is 70% LTV (so 'ready', not past liquidation) and Strike holds 0.01 ₿, so NOTHING moves and `opening` is
    // today's position: $20,000 over. A fixture whose Strike releases into Coinbase would not be over at all.
    const over = place({ strikeCollateralBtc: 0.01, cbDebt: 140_000, cbCollateralBtc: 2 });
    expect(over.state).toBe('ready');                                        // premise
    expect(over.strikeToCbBtc + over.strikeToColdBtc + over.cbToColdBtc).toBe(0);
    expect(over.cbOverCeilingUsd).toBeCloseTo(140_000 - 2 * 100_000 * 0.6, 9);
    const c = card({ plan: over, cbDebt: 140_000 });
    expect(c.lines.find((l) => l.key === 'overLimit')!.text)
      .toContain('over its limit at support — the policy repays that from spare income before it borrows again');
    expect(c.lines.find((l) => l.key === 'aligned')).toBeUndefined();
  });

  it('⭐ I29 — the cliff is cbMetrics().liqPrice, and there is no line without a loan', () => {
    const p = place();
    const m = cbMetrics(CTX.cbDebt, p.after.cbCollateralBtc, CTX.price, CTX.cbLtvTriggerPct);
    expect(m.liqPrice).toBeLessThan(CTX.price);                       // premise
    const cliff = keyed({ plan: p }, 'cliff')!;
    expect(cliff.text).toContain(`Coinbase seizes this loan at $${Math.round(m.liqPrice).toLocaleString()}`);
    expect(cliff.text).toContain(`${Math.round(Math.abs(m.pctToLiq) * 100)}% below today`);
    // The limit-depth line reads the shared leaf, never a literal.
    const depth = ceilingLiquidationMultiple(CTX.cbStop, CB_LLTV);
    expect(keyed({ plan: p }, 'cliffDepth')!.text).toContain(`${depth.toFixed(2)}× support`);
    // No loan ⇒ no cliff line at all.
    expect(keyed({ hasCbLoan: false, cbDebt: 0, plan: place({ cbDebt: 0, cbCollateralBtc: 0 }) }, 'cliff'))
      .toBeUndefined();
  });

  it('a seizure price at or above today is left to the state line', () => {
    const p = place({ cbDebt: CB_LLTV * 2 * 100_000 });
    expect(keyed({ plan: p, cbDebt: CB_LLTV * 2 * 100_000 }, 'cliff')).toBeUndefined();
  });

  it('⭐ the line: covered, not covered, and the what-if', () => {
    expect(keyed({ ownerLineUsd: 40_000, runLineUsd: 40_000, suggestedLineUsd: 20_000 }, 'line')!.text)
      .toBe('Your $40,000 line already covers two months of bills and one Coinbase paydown (75% → 65%).');
    expect(keyed({ ownerLineUsd: 10_000, runLineUsd: 10_000, suggestedLineUsd: 20_000 }, 'line')!.text)
      .toBe('A $20,000 line would cover two months of bills and one Coinbase paydown (75% → 65%), with 25% spare.');
    expect(keyed({ hasCbLoan: false, ownerLineUsd: 10_000, runLineUsd: 10_000 }, 'line')!.text)
      .toBe('A $20,000 line would cover two months of bills, with 25% spare.');
    expect(keyed({ runLineUsd: 80_000 }, 'line')!.text).toBe('Modeling a $80,000 line.');
    expect(keyed({ runLineUsd: 80_000 }, 'lineHold')!.text)
      .toBe("Raising your line restarts Strike's 60-day hold — move the coins first.");
    expect(keyed({ runLineUsd: 10_000 }, 'lineHold')).toBeUndefined();
  });

  it('⭐ the "why" line, all four shapes', () => {
    expect(keyed({}, 'why')!.text)
      .toBe('Strike keeps what your $40,000 line needs at support ($100,000); Coinbase keeps what its $60,000 debt '
        + 'plus 12 months of bills need at support.');
    expect(keyed({ bearBufferMonths: 0 }, 'why')!.text)
      .toContain('Coinbase keeps what its $60,000 debt needs at support.');
    expect(keyed({ hasCbLoan: false }, 'why')!.text)
      .toContain('Coinbase keeps 12 months of bills of room at support.');
    expect(keyed({ hasCbLoan: false, expenses: 0 }, 'why')!.text)
      .toContain('Coinbase needs to keep nothing.');
  });

  it('⭐ the SWEEP — every state × breaker × loan shape × junk price/support: no $0, ₿0.000, NaN or Infinity', () => {
    const PLANS: [string, PlacementPlan][] = [
      ['ready', place({ strikeCollateralBtc: 10 })],
      ['aligned', place({ strikeCollateralBtc: 0.01 })],
      ['small', place({ strikeCollateralBtc: (place().strikeKeepBtc ?? 0) + 0.005 })],
      ['hold', place({ strikeCollateralBtc: 10, inHold: true })],
      ['ltv', place({ strikeCollateralBtc: 10, strikeBalance: 0.45 * 10 * 100_000 })],
      ['paused', place({ support: 200_000 })],
      ['broken', place({ broken: true, strikeCollateralBtc: 10 })],
      ['pastLiq', place({ cbDebt: CB_LLTV * 2 * 100_000 })],
      ['over the limit', place({ strikeCollateralBtc: 0.01, cbDebt: 140_000 })],
      // N3 — a price or support that never loaded. I31 never reached these before, which is how the why line's
      // "at support ($0)" / "($NaN)" and the aligned line survived.
      ['price 0', place({ price: 0 })],
      ['price NaN', place({ price: Number.NaN })],
      ['support 0', place({ support: 0 })],
      ['support NaN', place({ support: Number.NaN })],
    ];
    // N4 / F3 — a loan SETTING with nothing owed, and one owed less than a dollar.
    const LOANS: [string, boolean, number][] = [
      ['loan $60k', true, 60_000], ['loan $0', true, 0], ['loan $0.40', true, 0.4], ['no loan', false, 0],
    ];
    const JUNKY = /NaN|Infinity|undefined/;
    const seen = new Set<PlacementState>();
    let lines = 0;
    for (const [pname, plan] of PLANS) {
      seen.add(plan.state);
      for (const [bname, breaker] of BREAKERS) {
        for (const [lname, hasCbLoan, cbDebt] of LOANS) {
          for (const expenses of [0, 6_000]) {
            const c = card({ plan, breaker, hasCbLoan, cbDebt, expenses });
            for (const l of c.lines) {
              const where = `${pname}/${bname}/${lname}/bills:${expenses}/${l.key}`;
              expect(l.text, where).not.toMatch(NO_ZERO);
              expect(l.text, where).not.toMatch(NO_ZERO_BTC);
              expect(l.text, where).not.toMatch(JUNKY);
              expect(l.text.trim(), where).not.toBe('');
              lines += 1;
            }
          }
        }
      }
    }
    expect(lines).toBeGreaterThan(600);
    // NON-VACUITY: the sweep reached every state, so none of the above is untested.
    const ALL: PlacementState[] = ['ready', 'paused', 'broken', 'cbPastLiquidation', 'unavailable'];
    for (const st of ALL) expect(seen.has(st), `never reached: ${st}`).toBe(true);
  });

  it('every ₿ part of the moves line passes the display floor', () => {
    const p = place({ strikeCollateralBtc: 10 });
    const moves = keyed({ plan: p }, 'moves')!.text;
    for (const [, num] of [...moves.matchAll(/([\d.]+) ₿/g)]) {
      expect(Number(num)).toBeGreaterThanOrEqual(DISPLAY_DUST_BTC);
    }
    expect(fmtBtc3(MOVE_THRESHOLD_BTC)).toBe('0.010');
  });
});

// ── the v1.4 / v1.5 card fixes ───────────────────────────────────────────────────────────────────────────────

/** Strike at its keep + 0.004 ₿ and Coinbase at its keep − 0.002 ₿: 0.004 ₿ in all, under the threshold. */
const trickle = () => {
  const keepS = place().strikeKeepBtc!;
  const probe = place({ strikeCollateralBtc: keepS + 0.004 });
  return place({ strikeCollateralBtc: keepS + 0.004, cbCollateralBtc: probe.cbKeepBtc! - 0.002 });
};

describe('⭐ N1 / F4 — a broken model moves nothing, and says so alone', () => {
  it('⭐ the broken state line, and NOTHING else from the state group', () => {
    const c = card({ plan: place({ broken: true, strikeCollateralBtc: 10 }) });
    const states = c.lines.filter((l) => l.key === 'state');
    expect(states).toHaveLength(1);
    expect(states[0].text)
      .toBe('The model is treated as broken — the policy moves nothing off Strike or Coinbase today.');
    for (const k of ['moves', 'aligned', 'batch']) {
      expect(c.lines.find((l) => l.key === k), k).toBeUndefined();
    }
  });

  it('the breaker line still says until when', () => {
    const c = card({ plan: place({ broken: true }), breaker: BREAKERS[2][1] });
    expect(c.lines.find((l) => l.key === 'breaker')!.text).toContain('no new debt until 6 months back on the line');
  });
});

describe('⭐ N8 — a seizure is named, and is never repaid from income', () => {
  const SEIZED = place({ support: 100_000 / 0.8, cbDebt: 54_000, cbCollateralBtc: 0.5 });

  it('⭐ below support and past 86%: the card names the line and the console', () => {
    const c = card({ plan: SEIZED, cbDebt: 54_000 });
    const state = c.lines.find((l) => l.key === 'state')!;
    expect(state.text).toContain('86% liquidation line');
    expect(state.text).toContain('Emergency Console');
  });

  it('⭐ also with a broken model — the seizure still wins', () => {
    const both = place({ support: 100_000 / 0.8, cbDebt: 54_000, cbCollateralBtc: 0.5, broken: true });
    expect(both.state).toBe('cbPastLiquidation');
    expect(card({ plan: both, cbDebt: 54_000 }).lines.find((l) => l.key === 'state')!.text)
      .toContain('86% liquidation line');
  });

  it('⭐ no over-the-limit line in cbPastLiquidation — a seized loan is not repaid from income', () => {
    // 1.2× support on 0.4 ₿ with $36,000 owed: 90% LTV, and over its limit at support.
    const p = place({ support: 100_000 / 1.2, cbDebt: 36_000, cbCollateralBtc: 0.4 });
    expect(p.state).toBe('cbPastLiquidation');
    expect(p.cbOverCeilingUsd).toBeGreaterThan(0);                 // the FIELD is reported
    const c = card({ plan: p, cbDebt: 36_000 });
    expect(c.lines.find((l) => l.key === 'overLimit')).toBeUndefined();
    expect(c.lines.map((l) => l.text).join(' ')).not.toContain('repays that from spare income');
  });
});

describe('⭐ N3 — an unavailable card says so, and nothing else', () => {
  const BAD: [string, number, number][] = [
    ['price 0', 0, 100_000], ['price NaN', Number.NaN, 100_000],
    ['support 0', 100_000, 0], ['support NaN', 100_000, Number.NaN],
  ];
  it.each(BAD)(
    '⭐ %s ⇒ the plan-of-record line plus one sentence', (_n, price, support) => {
      const c = card({ plan: place({ price, support }), price, support });
      expect(c.lines).toHaveLength(2);
      expect(c.lines[0].text).toBe(PLAN_OF_RECORD_LINE);
      expect(c.lines[1].text).toBe("The move can't be worked out right now — today's price, the support line or "
        + "a balance isn't available.");
      expect(c.lines.map((l) => l.text).join(' ')).not.toMatch(/Nothing to move|at support \(/);
    },
  );
});

describe('⭐ N4 / F3 — a loan with no balance is no loan', () => {
  it('⭐ $0 owed: the why line takes the no-loan wording and the paydown clause drops', () => {
    const c = card({ hasCbLoan: true, cbDebt: 0, plan: place({ cbDebt: 0 }) });
    expect(c.lines.find((l) => l.key === 'why')!.text).toContain('Coinbase keeps 12 months of bills of room');
    expect(c.lines.find((l) => l.key === 'why')!.text).not.toContain('$0 debt');
    expect(c.lines.find((l) => l.key === 'line')!.text).not.toContain('Coinbase paydown');
  });

  it('⭐ F3 — $0.40 owed: no cliff line, and no "$0" anywhere', () => {
    const c = card({ hasCbLoan: true, cbDebt: 0.4, plan: place({ cbDebt: 0.4 }) });
    expect(c.lines.find((l) => l.key === 'cliff')).toBeUndefined();
    expect(c.lines.find((l) => l.key === 'cliffDepth')).toBeUndefined();
    const text = c.lines.map((l) => l.text).join(' ');
    expect(text).not.toMatch(NO_ZERO);
    expect(text).not.toContain('Coinbase paydown');
  });

  it('a real balance still draws the cliff', () => {
    expect(card({ hasCbLoan: true, cbDebt: 60_000 }).lines.find((l) => l.key === 'cliff')).toBeDefined();
  });
});

describe('⭐ N5 — a move under the threshold is not a move', () => {
  it('⭐ no moves line, no Today actions, and the batch line instead', () => {
    const p = trickle();
    expect(p.state).toBe('ready');
    expect(p.worthMoving).toBe(false);                             // premise
    const c = card({ plan: p });
    expect(c.lines.find((l) => l.key === 'moves')).toBeUndefined();
    expect(c.lines.find((l) => l.key === 'batch')!.text).toContain('under the 0.01 ₿ threshold');
    expect(todayActions(p)).toEqual([]);
  });

  it('⭐ the cliff reads TODAY\'s collateral, not a position that won\'t exist', () => {
    const p = trickle();
    expect(p.opening.cbCollateralBtc).not.toBeCloseTo(p.after.cbCollateralBtc, 6);   // premise
    const m = cbMetrics(CTX.cbDebt, p.opening.cbCollateralBtc, CTX.price, CTX.cbLtvTriggerPct);
    expect(card({ plan: p }).lines.find((l) => l.key === 'cliff')!.text)
      .toContain(`$${Math.round(m.liqPrice).toLocaleString()}`);
  });

  it('⭐ a worth-moving plan with a sub-0.01 leg marks NO leg small', () => {
    // Strike releases plenty, but its Coinbase leg is a sliver: the total is worth moving, so every leg moves.
    const keepS = place().strikeKeepBtc!;
    const probe = place({ strikeCollateralBtc: keepS + 0.5 });
    const p = place({ strikeCollateralBtc: keepS + 0.5, cbCollateralBtc: probe.cbKeepBtc! - 0.002 });
    expect(p.worthMoving).toBe(true);
    const acts = todayActions(p);
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts) expect(a.text, a.kind).not.toContain('small — can wait');
  });

  it('a FUTURE row keeps its marker — those moves are the engine\'s', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
    const row = { ...sim.rows[1], sweptToColdBtc: 0.004 };
    expect(rowActions(row, null).find((a) => a.kind === 'coinbaseToCold')!.text)
      .toContain('(small — can wait)');
  });

  it('⭐ F2 — coinbaseLoanLine never says "today" when nothing moves today', () => {
    const sim = runCyclingSim({ ...SP_REPRO, pricePath: SUPPORT, supportPolicy: policyFor(SUPPORT) });
    const line = coinbaseLoanLine(sim, trickle(), false);
    expect(line).not.toBeNull();
    expect(line).not.toContain('today');
    expect(line).toMatch(/collateral moves to Coinbase in month \d+/);
    // Non-vacuous: a real move DOES say today.
    expect(coinbaseLoanLine(sim, place({ strikeCollateralBtc: 10 }), false)).toContain('today');
  });
});
