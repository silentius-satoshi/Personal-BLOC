import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  strikeHoldFrom, playbookInputFromLive, fmtStepBtc, fmtStepUsd, fmtMultiplePair, waitingCard, playbookCard,
  STRIKE_HOLD_DAYS, SAT_BTC, type LivePlaybookFigures, type PlaybookCard,
} from '../crashPlaybookView';
import { crashPlaybook, type CrashPlaybookInput, type CrashPlaybookResult } from '../../../simulation/crashPlaybook';
import { effectivePolicyStops } from '../../../simulation/cyclingSim';
import { CB_LLTV } from '../../../simulation/runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';
import { DEFAULT_SUPPORT_POLICY_SETTINGS } from '../../Almanac/supportPolicyView';
import type { DayEvent } from '../../../simulation/types';

/**
 * The crash playbook, live (crash playbook Run 2) — the one front-end the Emergency Console runs and Run 3 imports.
 * Round synthetic figures only — this repo is public.
 *
 * LIVE = crashPlaybook.test's BASE as live figures: price $80k at support $100k (k = 0.8), Coinbase $60k on 1 ₿ (75%),
 * Strike $8k on 1 ₿ (10%), a $40k line, no cold, target 70, an empty dayLog, today 2026-10-15.
 */
const LIVE: LivePlaybookFigures = {
  price: 80_000, support: 100_000, cbDebt: 60_000, cbCollateralBtc: 1, strikeBalance: 8_000, strikeCollateralBtc: 1,
  creditLine: 40_000, coldBtc: 0, cbLtvTargetPct: 70, dayLog: [], todayISO: '2026-10-15',
};

/** A dated collateral move — `move('2026-09-01')` is a Strike deposit on that day. */
const move = (
  date: string, target: 'strike' | 'cb' | 'cold' = 'strike', kind: 'deposit' | 'withdraw' = 'deposit',
): DayEvent => ({ id: `${kind}-${target}-${date}`, date, ts: Date.parse(date) || 0, kind, amount: 0.1, target });

/** The console's composition: live figures → input, hold, result, card. */
function run(over: Partial<LivePlaybookFigures> = {}) {
  const live = { ...LIVE, ...over };
  const input = playbookInputFromLive(live);
  const hold = strikeHoldFrom(live.dayLog, live.todayISO);
  const result = crashPlaybook(input);
  return { input, hold, result, card: playbookCard(result, input, hold) };
}

const RULES_NOTE = 'Strike releases collateral only at or under 40% LTV, only down to under 50%, and only on a line '
  + 'more than 60 days old — the app assumes yours is.';
const PAST_86 = 'past its 86% liquidation line. Morpho liquidates instantly, so in a real crash you would have to act '
  + 'before the price fell this far.';
const DOOMED_DEPTH = "Price is 0.80× support — above the 0.70× liquidation depth, but the collateral you can move can't "
  + 'clear 86%, so shift debt first.';
const TOP_UP_DEPTH = 'Price is 0.80× support — above the 0.70× liquidation depth, so top up first.';
const DOOM = "Coinbase can't clear 86% even with every coin the rules allow — only the last resorts below remain.";
const HELD = { kind: 'held', text: 'Coinbase is back at your 70% target.' } as const;
const NO_EXTRAS = { pastLiquidation: null, steps: [], gap: null, strikeNote: null, after: null, outcome: null };

// ── the one live builder ─────────────────────────────────────────────────────────────────────────────────────────

describe('playbookInputFromLive — the one live builder', () => {
  it('⭐ passes the live figures through and sets the four lender constants', () => {
    expect(playbookInputFromLive(LIVE)).toEqual({
      price: 80_000, support: 100_000, cbDebt: 60_000, cbCollateralBtc: 1, strikeBalance: 8_000,
      strikeCollateralBtc: 1, strikeCreditLine: 40_000, coldBtc: 0, targetCbLtvPct: 70, cbStopAtSupport: 0.6,
      lltv: CB_LLTV, maxDrawLtv: STRIKE_MAX_DRAW_LTV, marginLtv: STRIKE_MARGIN_CALL_LTV,
      retrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV, strikeInHold: false,
    });
  });

  it('⭐ the stop at support goes through effectivePolicyStops on the policy defaults — never an inline copy', () => {
    expect(playbookInputFromLive({ ...LIVE, cbLtvTargetPct: 70 }).cbStopAtSupport).toBe(0.6);
    expect(playbookInputFromLive({ ...LIVE, cbLtvTargetPct: 55 }).cbStopAtSupport).toBe(0.55);
    const D = DEFAULT_SUPPORT_POLICY_SETTINGS;
    for (let t = 40; t <= 85; t++) {
      expect(playbookInputFromLive({ ...LIVE, cbLtvTargetPct: t }).cbStopAtSupport, `target ${t}`)
        .toBe(effectivePolicyStops(D.cbStopAtSupportPct, D.strikeStopAtSupportPct, t, 0).cbStop);
    }
    // The values above cannot tell the one clamp from a copy of it — the source can.
    const src = readFileSync(join(process.cwd(), 'src/components/Tools/crashPlaybookView.ts'), 'utf8');
    expect(src).toMatch(/effectivePolicyStops\(/);
    expect(src).not.toMatch(/Math\.min\(/);
  });

  it('⭐ cold under a satoshi (or junk) reads as none', () => {
    expect(playbookInputFromLive({ ...LIVE, coldBtc: 5.55e-17 }).coldBtc).toBe(0);   // netted cold moves' residue
    expect(playbookInputFromLive({ ...LIVE, coldBtc: NaN }).coldBtc).toBe(0);
    expect(playbookInputFromLive({ ...LIVE, coldBtc: -0.5 }).coldBtc).toBe(0);
    expect(playbookInputFromLive({ ...LIVE, coldBtc: 0.01 }).coldBtc).toBe(0.01);
    expect(playbookInputFromLive({ ...LIVE, coldBtc: SAT_BTC }).coldBtc).toBe(SAT_BTC);   // a whole satoshi is real
  });
});

// ── Strike's 60-day hold ─────────────────────────────────────────────────────────────────────────────────────────

describe("strikeHoldFrom — Strike's 60-day hold", () => {
  const FREE = { inHold: false, depositISO: null, throughISO: null };

  it('⭐ a Strike deposit 60 days back holds through the deposit + 60 days; 61 days back is free', () => {
    expect(STRIKE_HOLD_DAYS).toBe(60);
    expect(strikeHoldFrom([move('2026-08-16')], '2026-10-15'))
      .toEqual({ inHold: true, depositISO: '2026-08-16', throughISO: '2026-10-15' });
    expect(strikeHoldFrom([move('2026-08-15')], '2026-10-15')).toEqual(FREE);
  });

  it('the latest of two deposits sets the dates; a future-dated deposit counts', () => {
    expect(strikeHoldFrom([move('2026-09-01'), move('2026-09-20'), move('2026-08-30')], '2026-10-15'))
      .toEqual({ inHold: true, depositISO: '2026-09-20', throughISO: '2026-11-19' });
    expect(strikeHoldFrom([move('2026-11-01')], '2026-10-15'))
      .toEqual({ inHold: true, depositISO: '2026-11-01', throughISO: '2026-12-31' });
  });

  it("'cb' / 'cold' deposits, a Strike withdrawal and junk dates never hold", () => {
    expect(strikeHoldFrom(
      [move('2026-10-01', 'cb'), move('2026-10-01', 'cold'), move('2026-10-01', 'strike', 'withdraw')], '2026-10-15',
    )).toEqual(FREE);
    expect(strikeHoldFrom([move('junk'), move('2026-9-30'), move('')], '2026-10-15')).toEqual(FREE);
    expect(strikeHoldFrom([move('2026-10-01')], 'junk')).toEqual(FREE);
  });

  it("the builder's strikeInHold equals it", () => {
    const logs: DayEvent[][] = [
      [], [move('2026-08-16')], [move('2026-08-15')], [move('2026-10-01', 'cb')], [move('2026-11-01')],
    ];
    for (const dayLog of logs) {
      expect(playbookInputFromLive({ ...LIVE, dayLog }).strikeInHold)
        .toBe(strikeHoldFrom(dayLog, LIVE.todayISO).inHold);
    }
  });
});

// ── the step formatters ──────────────────────────────────────────────────────────────────────────────────────────

describe('the step formatters', () => {
  it('⭐ fmtStepBtc floors to its printed precision', () => {
    expect(fmtStepBtc(0.5999999996)).toBe('0.59999');   // rounded it prints 0.60000 — the 50% Strike refuses
    expect(fmtStepBtc(0.0714285714)).toBe('0.07142');
    expect(fmtStepBtc(0.1 + 0.2 - 0.25)).toBe('0.05000');
    expect(fmtStepBtc(0.00000999)).toBe('0.00000999');
    expect(fmtStepBtc(4e-9)).toBeNull();                // under a satoshi — not a step
    for (const junk of [NaN, 0, -1, Infinity]) expect(fmtStepBtc(junk), String(junk)).toBeNull();
  });

  it('⭐ fmtStepBtc: float noise never drops a digit (the floor guard)', () => {
    expect(0.3 - 0.25).toBeLessThan(0.05);              // premise: 0.04999999999999999
    expect(fmtStepBtc(0.3 - 0.25)).toBe('0.05000');
  });

  it('fmtStepUsd floors to whole dollars; under $1 is not a step', () => {
    expect(fmtStepUsd(3487.5)).toBe('$3,487');          // a line-capped shift never prints a draw over the line
    expect(fmtStepUsd(19_000)).toBe('$19,000');
    expect(fmtStepUsd(0.3)).toBeNull();
    expect(fmtStepUsd(0.9999)).toBeNull();
    expect(fmtStepUsd(NaN)).toBeNull();
  });

  it('⭐ fmtMultiplePair widens until the two differ', () => {
    expect(fmtMultiplePair(0.8, 0.6977)).toEqual({ k: '0.80', depth: '0.70', equal: false });
    expect(fmtMultiplePair(0.70, 0.6977)).toEqual({ k: '0.700', depth: '0.698', equal: false });
    expect(fmtMultiplePair(0.6975, 0.6977)).toEqual({ k: '0.6975', depth: '0.6977', equal: false });
    expect(fmtMultiplePair(0.5, 0.5)).toEqual({ k: '0.500000', depth: '0.500000', equal: true });
  });
});

// ── the waiting card ─────────────────────────────────────────────────────────────────────────────────────────────

describe('waitingCard — between the target and the trigger the plan waits', () => {
  // Target 65, trigger 75; Coinbase at the given LTV at $80k.
  const at = (cbLtv: number, over: Partial<LivePlaybookFigures> = {}): CrashPlaybookInput =>
    playbookInputFromLive({ ...LIVE, cbLtvTargetPct: 65, cbDebt: cbLtv * 80_000, ...over });

  it('68% — between the 65% target and the 75% trigger — waits', () => {
    expect(waitingCard(at(0.68), 75)).toEqual({
      badge: 'No action',
      depth: 'Coinbase is at 68.0% — between your 65% target and your 75% trigger, where your plan waits. At the '
        + 'trigger the playbook brings it back to 65%.',
      ...NO_EXTRAS,
    });
  });

  it('at the trigger, at or under the target, past 86%, and on junk → null (the playbook runs)', () => {
    expect(waitingCard(at(0.75), 75)).toBeNull();
    expect(waitingCard(at(0.65), 75)).toBeNull();
    expect(waitingCard(at(0.64), 75)).toBeNull();
    expect(waitingCard(at(0.87), 90)).toBeNull();   // a trigger above 86% never waits past the liquidation line
    expect(waitingCard(at(0.68, { price: NaN }), 75)).toBeNull();
    expect(waitingCard(at(0.68), NaN)).toBeNull();
  });
});

// ── the card, one fixture per shape ──────────────────────────────────────────────────────────────────────────────

describe('playbookCard — one fixture per shape', () => {
  it("'none' — at or under the target, nothing to do", () => {
    expect(run({ cbDebt: 50_000 }).card).toEqual({
      badge: 'No action', depth: 'Coinbase is at or under your 70% target — nothing to do.', ...NO_EXTRAS,
    });
  });

  it("junk — the playbook can't read the figures", () => {
    for (const over of [{ support: 0 }, { price: NaN }, { price: 0 }]) {
      const { result, card } = run(over);
      expect(result.order, JSON.stringify(over)).toBe('none');
      expect(card).toEqual({
        badge: 'Check figures', depth: "The playbook can't read these figures — check your loan details.", ...NO_EXTRAS,
      });
    }
  });

  it('⭐ top up first (LIVE) — a floored release, the rules note, the after line, held', () => {
    const { result, card } = run();
    expect(result.order).toBe('topUpFirst');
    expect(card).toEqual({
      badge: 'Top up first',
      depth: TOP_UP_DEPTH,
      pastLiquidation: null,
      steps: ['Release 0.07142 ₿ (~$5,714) of Strike collateral into Coinbase.'],
      gap: null,
      strikeNote: RULES_NOTE,
      after: 'After: Coinbase 70.0% LTV, liquidation at $65,116 · Strike 10.8% LTV, margin call at $12,308.',
      outcome: HELD,
    });
  });

  it('cold, then Strike collateral — two steps, in order', () => {
    const { card } = run({ coldBtc: 0.05 });
    expect(card.steps).toEqual([
      'Move 0.05000 ₿ (~$4,000) from cold storage into Coinbase.',
      'Release 0.02142 ₿ (~$1,714) of Strike collateral into Coinbase.',
    ]);
    expect(card.strikeNote).toBe(RULES_NOTE);
    expect(card.outcome).toEqual(HELD);
  });

  it('below the depth — shift first, already past 86% at this price, held', () => {
    const { result, card } = run({ price: 60_000 });
    expect(result.order).toBe('shiftFirst');
    expect(card).toEqual({
      badge: 'Shift first',
      depth: 'Price is 0.60× support — below the 0.70× liquidation depth, so shift debt first.',
      pastLiquidation: `At this price Coinbase is at 100.0% — ${PAST_86}`,
      steps: ['Draw $18,000 on Strike and pay Coinbase down with it.'],
      gap: null,
      strikeNote: null,
      after: 'After: Coinbase 70.0% LTV, liquidation at $48,837 · Strike 43.3% LTV, margin call at $37,143.',
      outcome: HELD,
    });
  });

  it('at or above support — shift first', () => {
    const { card } = run({ price: 110_000, cbDebt: 80_000 });
    expect(card.badge).toBe('Shift first');
    expect(card.depth).toBe('Price is 1.10× support — at or above support, so shift debt first.');
    expect(card.steps).toEqual(['Draw $3,000 on Strike and pay Coinbase down with it.']);
    expect(card.after).toBe(
      'After: Coinbase 70.0% LTV, liquidation at $89,535 · Strike 10.0% LTV, margin call at $15,714.');
    expect(card.outcome).toEqual(HELD);
  });

  it('⭐ doomed at the open, saved by the debt shift — held, never the doom warning', () => {
    const { result, card } = run({ cbDebt: 75_000, dayLog: [move('2026-09-01')] });   // a Strike deposit 44 days back
    expect(result.doomed).toBe(true);   // premise: at the open nothing can move (the hold, no cold)
    expect(card).toEqual({
      badge: 'Shift first',
      depth: DOOMED_DEPTH,
      pastLiquidation: `At this price Coinbase is at 93.8% — ${PAST_86}`,
      steps: ['Draw $19,000 on Strike and pay Coinbase down with it.'],
      gap: null,
      strikeNote: "Strike's collateral is on hold through 31 Oct 2026 — you logged a Strike deposit on 1 Sep 2026, "
        + 'and Strike releases nothing within 60 days of one.',
      after: 'After: Coinbase 70.0% LTV, liquidation at $65,116 · Strike 33.8% LTV, margin call at $38,571.',
      outcome: HELD,
    });
  });

  it('⭐ the doom warning — the after-state is at or over 86%, and the cold stays out', () => {
    const { result, card } = run({ cbDebt: 75_000, strikeBalance: 36_000, coldBtc: 0.02 });
    expect(result.after.cbLtv).toBeGreaterThanOrEqual(CB_LLTV);   // premise: the after-state is past the line
    expect(result.after.coldBtc).toBe(0.02);                      // the cold never went into a doomed Coinbase
    expect(card).toEqual({
      badge: 'Shift first',
      depth: DOOMED_DEPTH,
      pastLiquidation: `At this price Coinbase is at 93.8% — ${PAST_86}`,
      steps: ['Draw $4,000 on Strike and pay Coinbase down with it.'],
      gap: null,
      strikeNote: null,
      after: 'After: Coinbase 88.8% LTV, liquidation at $82,558 · Strike 50.0% LTV, margin call at $57,143.',
      outcome: { kind: 'doom', text: DOOM },
    });
  });

  it('⭐ short — a binding release floors to 0.59999, and the rest is named', () => {
    const { result, card } = run({ cbDebt: 204_000, cbCollateralBtc: 3, strikeBalance: 16_000 });
    expect(result.order).toBe('topUpFirst');
    expect(card).toEqual({
      badge: 'Top up first',
      depth: TOP_UP_DEPTH,
      pastLiquidation: null,
      steps: ['Release 0.59999 ₿ (~$47,999) of Strike collateral into Coinbase.'],
      gap: null,
      strikeNote: RULES_NOTE,
      after: 'After: Coinbase 70.8% LTV, liquidation at $65,891 · Strike 50.0% LTV, margin call at $57,143.',
      outcome: {
        kind: 'short',
        text: 'Still 0.04286 ₿ (~$3,429) short of your 70% target — Coinbase ends at 70.8%, under its 86% '
          + 'liquidation line.',
      },
    });
  });

  it('⭐ an exact tie at 86% — not doomed at the open, no step, and the card reads doom', () => {
    // Coinbase opens exactly on 86%: `possible < need` is 0 < 0, so not doomed, and the order is top-up-first — but
    // nothing can move (Strike at 50% releases nothing; its line is full; no cold), so the run ends AT 86%.
    const { result, card } = run({ cbDebt: 68_800, strikeBalance: 40_000 });
    expect(result.order).toBe('topUpFirst');
    expect(result.doomed).toBe(false);
    expect(result.steps).toEqual([]);
    expect(card).toEqual({
      badge: 'Top up first',
      depth: TOP_UP_DEPTH,
      pastLiquidation: `At this price Coinbase is at 86.0% — ${PAST_86}`,
      steps: [],
      gap: 'No step is available — the Strike line has no room.',
      strikeNote: null,
      after: null,
      outcome: { kind: 'doom', text: DOOM },
    });
  });

  it('gap: Strike over 40% releases nothing — the debt shifts instead', () => {
    const { result, card } = run({ strikeBalance: 36_000 });
    expect(result.order).toBe('topUpFirst');
    expect(card.steps).toEqual(['Draw $4,000 on Strike and pay Coinbase down with it.']);
    expect(card.gap).toBe(
      'Nothing can top up first — no cold, and no Strike collateral Strike will release now — so the debt shifts.');
    expect(card.strikeNote).toBe(RULES_NOTE);
    expect(card.outcome).toEqual(HELD);
  });

  it('gap: a $0.30 line — the shift floors to nothing, and collateral goes in instead', () => {
    const { result, card } = run({ price: 60_000, creditLine: 8_000.30, coldBtc: 0.5 });
    expect(result.steps.map((s) => s.kind)).toEqual(['shiftToStrike', 'coldToCoinbase']);   // premise: $0.30 shifted
    expect(card.steps).toEqual(['Move 0.42856 ₿ (~$25,714) from cold storage into Coinbase.']);
    expect(card.gap).toBe('The Strike line has no room to shift debt, so collateral goes in instead.');
    expect(card.strikeNote).toBeNull();
    expect(card.outcome).toEqual(HELD);
  });

  it('gap: nothing movable (Strike at 50%, in its hold, no cold) — no step, and short', () => {
    expect(run({ strikeBalance: 40_000, dayLog: [move('2026-10-05')] }).card).toEqual({
      badge: 'Top up first',
      depth: TOP_UP_DEPTH,
      pastLiquidation: null,
      steps: [],
      gap: 'No step is available — no cold, no Strike collateral Strike will release, and no room on the Strike line.',
      strikeNote: "Strike's collateral is on hold through 4 Dec 2026 — you logged a Strike deposit on 5 Oct 2026, "
        + 'and Strike releases nothing within 60 days of one.',
      after: null,
      outcome: {
        kind: 'short',
        text: 'Still 0.07143 ₿ (~$5,714) short of your 70% target — Coinbase ends at 75.0%, under its 86% '
          + 'liquidation line.',
      },
    });
  });

  it('gap: nothing movable and past 86% — the line has no room, doom', () => {
    const { result, card } = run({ strikeBalance: 40_000, dayLog: [move('2026-10-05')], cbDebt: 75_000 });
    expect(result.doomed).toBe(true);
    expect(card.steps).toEqual([]);
    expect(card.gap).toBe('No step is available — the Strike line has no room.');
    expect(card.outcome).toEqual({ kind: 'doom', text: DOOM });
  });

  it('the multiples widen inside the depth sentence (0.70× and 0.6975× support)', () => {
    expect(run({ price: 70_000 }).card.depth)
      .toBe('Price is 0.700× support — above the 0.698× liquidation depth, so top up first.');
    expect(run({ price: 69_750 }).card.depth)
      .toBe('Price is 0.6975× support — below the 0.6977× liquidation depth, so shift debt first.');
  });

  it('no Strike balance — the after line says so', () => {
    const { card } = run({ strikeBalance: 0, coldBtc: 0.1 });
    expect(card.steps).toEqual(['Move 0.07142 ₿ (~$5,714) from cold storage into Coinbase.']);
    expect(card.after).toBe('After: Coinbase 70.0% LTV, liquidation at $65,116 · no Strike balance.');
    expect(card.strikeNote).toBeNull();
  });
});

// ── the sweep ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ the sweep — the spec grid, every card clean', () => {
  const BAD = /NaN|Infinity|undefined|\$0(?![\d,])|(?<!\d)0\.0{5,8} ₿/;
  const texts = (c: PlaybookCard): string[] =>
    [c.depth, c.pastLiquidation, ...c.steps, c.gap, c.strikeNote, c.after, c.outcome?.text]
      .filter((x): x is string => typeof x === 'string');

  interface Case {
    live: LivePlaybookFigures;
    input: CrashPlaybookInput;
    result: CrashPlaybookResult;
    card: PlaybookCard;
    waiting: PlaybookCard | null;
  }
  const cases: Case[] = [];
  const ks = [...Array.from({ length: 19 }, (_, i) => 0.40 + i * 0.05), 0.6975, 0.70];
  for (const k of ks) for (const cbLtv of [0.66, 0.75, 0.90]) for (const cbColl of [1, 3])
    for (const skLtv of [0, 0.30, 0.45]) for (const skColl of [0, 1]) for (const cold of [0, 5.55e-17, 0.1])
      for (const line of [10_000, 200_000]) for (const inHold of [false, true]) {
        const price = k * 100_000;
        const strikeBalance = skLtv * skColl * price;
        if (strikeBalance > line) continue;   // not a live state
        const live: LivePlaybookFigures = {
          ...LIVE, price, cbDebt: cbLtv * cbColl * price, cbCollateralBtc: cbColl, strikeBalance,
          strikeCollateralBtc: skColl, creditLine: line, coldBtc: cold, dayLog: inHold ? [move('2026-10-05')] : [],
        };
        const input = playbookInputFromLive(live);
        const result = crashPlaybook(input);
        const card = playbookCard(result, input, strikeHoldFrom(live.dayLog, live.todayISO));
        cases.push({ live, input, result, card, waiting: waitingCard(input, 75) });
      }
  const at = (c: Case): string => JSON.stringify(c.live);

  it('covers every order and outcome, and the waiting card (non-vacuous)', () => {
    expect(new Set(cases.map((c) => c.result.order))).toEqual(new Set(['none', 'topUpFirst', 'shiftFirst']));
    expect(new Set(cases.map((c) => c.card.outcome?.kind))).toEqual(new Set([undefined, 'held', 'short', 'doom']));
    expect(cases.some((c) => c.waiting !== null)).toBe(true);
  });

  it('no card string prints NaN, Infinity, undefined, "$0" or "0.00000 ₿"', () => {
    for (const c of cases) {
      for (const s of [...texts(c.card), ...(c.waiting ? texts(c.waiting) : [])]) expect(s, at(c)).not.toMatch(BAD);
    }
  });

  it('topUpFirst never ends past 86% — a tie AT 86% is possible (the exact-86% ⭐)', () => {
    for (const c of cases) {
      if (c.result.order === 'topUpFirst') expect(c.result.after.cbLtv, at(c)).toBeLessThanOrEqual(c.input.lltv + 1e-12);
    }
  });

  it('a held outcome ends at or under the target', () => {
    for (const c of cases) {
      if (c.card.outcome?.kind === 'held') {
        expect(c.result.after.cbLtv, at(c)).toBeLessThanOrEqual(c.input.targetCbLtvPct / 100 + 1e-9);
      }
    }
  });

  it('⭐ residue cold never moves', () => {
    const residue = cases.filter((c) => c.live.coldBtc === 5.55e-17);
    expect(residue.some((c) => c.result.order !== 'none')).toBe(true);   // non-vacuous: the playbook acted on them
    for (const c of residue) expect(c.result.steps.some((s) => s.kind === 'coldToCoinbase'), at(c)).toBe(false);
  });
});

// ── layering ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ layering — the view module imports no belief, no store and no React', () => {
  it('crashPlaybookView imports nothing from powerLaw, cyclePath, cycleModel, the store or React', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Tools/crashPlaybookView.ts'), 'utf8');
    const imports = src.split('\n').filter((l) => /^import\b/.test(l) || /^\} from /.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const l of imports) expect(l).not.toMatch(/powerLaw|cyclePath|cycleModel|\/store\/|'react'/);
  });
});
