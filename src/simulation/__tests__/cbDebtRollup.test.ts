import { describe, it, expect } from 'vitest';
import { rollupMonth, flowVenue, unreconciledCbFlows, deriveReadingAnchors, type ReadingAnchorState } from '../logUtils';
import type { DayEvent } from '../types';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const START = '2026-01-01';   // strategy month 1 = January 2026

type Flow = Extract<DayEvent, { kind: 'draw' | 'paydown' }>;
const flow = (id: string, kind: 'draw' | 'paydown', amount: number, date: string, ts: number, extra: Partial<Flow> = {}): Flow =>
  ({ id, date, ts, kind, amount, ...extra });
const reading = (id: string, date: string, ts: number, cbBal?: number): DayEvent =>
  ({ id, date, ts, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.1, ...(cbBal !== undefined ? { cbBal } : {}) } });

describe('flowVenue — a MISSING target is Strike (the entire migration story)', () => {
  it('absent and explicit "strike" read as strike; "cb" reads as cb', () => {
    expect(flowVenue(flow('a', 'draw', 1, '2026-01-10', 1))).toBe('strike');
    expect(flowVenue(flow('b', 'draw', 1, '2026-01-10', 1, { target: 'strike' }))).toBe('strike');
    expect(flowVenue(flow('c', 'paydown', 1, '2026-01-10', 1, { target: 'cb' }))).toBe('cb');
  });

  it('⭐ a legacy target-less draw and paydown still roll into the month — flip the default to "cb" and this goes red', () => {
    // Every draw/paydown already stored predates the field. A non-Strike default would empty expensesActual across
    // all 12 months, and reconcileMonthBuckets would delete the emptied daily-owned entries.
    const { entry } = rollupMonth([flow('a', 'draw', 1000, '2026-01-10', 10), flow('b', 'paydown', 300, '2026-01-11', 11)], 1, START);
    expect(entry.expensesActual).toBe(1000);
    expect(entry.paydown).toBe(300);
  });

  it('Strike is unaffected: target absent and target "strike" roll up identically', () => {
    const absent   = rollupMonth([flow('a', 'draw', 1000, '2026-01-10', 10)], 1, START);
    const explicit = rollupMonth([flow('a', 'draw', 1000, '2026-01-10', 10, { target: 'strike' })], 1, START);
    expect(explicit).toEqual(absent);
  });
});

describe('rollupMonth — the Coinbase skip (THE corruption guard)', () => {
  it('⭐ a mixed month keeps a Coinbase borrow out of expensesActual and a Coinbase paydown out of paydown', () => {
    // rerollMonth and reconcileMonthBuckets hand rollupMonth the FULL dayLog — isMonthlyMeaningful cannot filter here.
    // CB events FIRST (array order and ts): the ordering that made the leak non-obvious.
    const log = [
      flow('c1', 'draw',    5000, '2026-01-03', 3, { target: 'cb', fee: 100 }),
      flow('c2', 'paydown', 2000, '2026-01-04', 4, { target: 'cb' }),
      flow('s1', 'draw',    1000, '2026-01-10', 10),
    ];
    const { entry } = rollupMonth(log, 1, START);
    expect(entry.expensesActual).toBe(1000);
    expect('paydown' in entry).toBe(false);
  });

  it('⭐ a month holding only a Coinbase flow rolls up to nothing — no carry-forward, no provisional', () => {
    const prior = { strikeBal: 4000, strikeLtv: 0.1 };
    const { entry } = rollupMonth([flow('c1', 'draw', 5000, '2026-01-03', 3, { target: 'cb', fee: 100 })], 1, START, prior);
    expect(entry).toEqual({});
  });
});

describe('unreconciledCbFlows — the first signal that a reading\'s Coinbase balance is stale', () => {
  it('(a) no Coinbase flows → no signal, even over an old reading (interest-only staleness is NOT detected)', () => {
    const u = unreconciledCbFlows([reading('r', '2026-01-05', 5, 60000), flow('s', 'draw', 1000, '2026-01-10', 10)]);
    expect(u.events).toEqual([]);
    expect(u.suggestedCbBal).toBe(60000);
  });

  it('(b) a borrow after the latest CB-bearing reading is reported, with a suggested balance incl. its fee', () => {
    const u = unreconciledCbFlows([reading('r', '2026-01-05', 5, 60000), flow('c', 'draw', 10000, '2026-01-10', 10, { target: 'cb', fee: 200 })]);
    expect(u.events.map((e) => e.id)).toEqual(['c']);
    expect(u).toMatchObject({ drawn: 10000, fees: 200, paid: 0, anchorCbBal: 60000, suggestedCbBal: 70200 });
  });

  it('a paydown after the anchor is subtracted', () => {
    const u = unreconciledCbFlows([reading('r', '2026-01-05', 5, 60000), flow('c', 'paydown', 5000, '2026-01-10', 10, { target: 'cb' })]);
    expect(u).toMatchObject({ paid: 5000, suggestedCbBal: 55000 });
  });

  it('⭐ (c) a borrow DATED BEFORE the reading is not reported, however late its ts (date-primary ordering)', () => {
    // A backfilled borrow is already inside the reading's stated balance. A ts-primary rule would count it.
    const u = unreconciledCbFlows([reading('r', '2026-01-05', 5, 60000), flow('c', 'draw', 10000, '2026-01-03', 99, { target: 'cb' })]);
    expect(u.events).toEqual([]);
  });

  it('(d) same date: a later ts is reported; an equal ts is not', () => {
    expect(unreconciledCbFlows([reading('r', '2026-01-05', 5, 60000), flow('c', 'draw', 1, '2026-01-05', 6, { target: 'cb' })]).events).toHaveLength(1);
    expect(unreconciledCbFlows([reading('r', '2026-01-05', 5, 60000), flow('c', 'draw', 1, '2026-01-05', 5, { target: 'cb' })]).events).toHaveLength(0);
  });

  it('⭐ (e) a later STRIKE-ONLY reading does not reconcile a Coinbase borrow (only a CB-bearing reading is an anchor)', () => {
    const u = unreconciledCbFlows([
      reading('r1', '2026-01-05', 5, 60000),
      flow('c', 'draw', 10000, '2026-01-10', 10, { target: 'cb', fee: 200 }),
      reading('r2', '2026-01-15', 15),   // no cbBal
    ]);
    expect(u.events.map((e) => e.id)).toEqual(['c']);
    expect(u.anchorCbBal).toBe(60000);
  });

  it('(f) Strike flows are ignored', () => {
    expect(unreconciledCbFlows([reading('r', '2026-01-05', 5, 60000), flow('s', 'draw', 1000, '2026-01-10', 10)]).events).toEqual([]);
  });

  it('with no CB reading at all, every Coinbase flow counts and there is no suggestion', () => {
    const u = unreconciledCbFlows([flow('c', 'draw', 10000, '2026-01-10', 10, { target: 'cb', fee: 200 })]);
    expect(u.events).toHaveLength(1);
    expect(u.anchorCbBal).toBeNull();
    expect(u.suggestedCbBal).toBeNull();
  });
});

describe('PRE-EXISTING defect — the stale Coinbase prefill re-stamps the anchor (characterised, NOT fixed)', () => {
  const current: ReadingAnchorState = {
    advisorActualBlocBalance: 5000, advisorActualBlocBalanceAsOf: '2026-01-05',
    cbLoanBalance: 60000, cbLoanBalanceAsOf: '2026-01-05',
    cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
  };

  it('a later reading repeating the prior cbBal re-stamps cbLoanBalanceAsOf — the interest since then vanishes', () => {
    // Exactly what saving the EventSheet's pre-filled Coinbase balance unedited produces. apply()'s early return
    // needs value AND date to match; the date differs, so it falls through to R.date >= curAsOf and re-anchors.
    // Needs no borrow. Pinned so a future fix is a conscious change.
    const patch = deriveReadingAnchors([reading('r1', '2026-01-05', 5, 60000), reading('r2', '2026-02-05', 20, 60000)], current);
    expect(patch.cbLoanBalance).toBe(60000);
    expect(patch.cbLoanBalanceAsOf).toBe('2026-02-05');
  });

  it('control: the SAME reading (value and date both match) is a no-op', () => {
    expect(deriveReadingAnchors([reading('r1', '2026-01-05', 5, 60000)], current)).toEqual({});
  });
});
