import { describe, it, expect } from 'vitest';
import {
  deriveStrikeCollateral, unreconciledCbFlows, deriveCurrentPosition, computeExpenseReanchor, deriveColdStorage, coldMovesSinceAnchor,
} from '../logUtils';
import type { DayEvent, MonthlyLogEntry } from '../types';

const reading = (id: string, date: string, ts: number, r: Partial<Extract<DayEvent, { kind: 'balanceReading' }>['reading']>): DayEvent =>
  ({ id, date, ts, kind: 'balanceReading', reading: { strikeBal: 0, strikeLtv: 0, ...r } });

const entry = (month: number, over: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry => ({
  month, date: `2026-0${month}-01`, btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0, loggedAt: 1,
  btcHeld: 0, expensesActual: 0, ...over,
});

describe('logUtils hardening', () => {
  it('HJ-05 · journal.md Strike collateral (v20 Collateral-Truth) — the anchor is the latest by (date, ts): a same-day tie goes to the later ts, not array order', () => {
    const log = [
      reading('a', '2026-01-20', 30, { strikeCollateral: 0.9 }),
      reading('b', '2026-01-20', 20, { strikeCollateral: 0.6 }),
    ];
    expect(deriveStrikeCollateral(log, 0)).toBe(0.9);
  });

  it('HJ-06 · journal.md § Coinbase borrow & paydown events — the CB anchor is the latest reading by date, then ts', () => {
    const log: DayEvent[] = [
      reading('r1', '2026-01-20', 10, { cbBal: 70000 }),
      reading('r2', '2026-01-05', 30, { cbBal: 50000 }),   // backfilled later (higher ts) but OLDER by date
      { id: 'd', date: '2026-01-10', ts: 20, kind: 'draw', target: 'cb', amount: 10000 },
    ];
    const r = unreconciledCbFlows(log);
    expect(r.events).toHaveLength(0);          // the borrow predates the 01-20 anchor: already inside its 70,000
    expect(r.anchorCbBal).toBe(70000);
    expect(r.suggestedCbBal).toBe(70000);
  });

  it('HJ-07 · journal.md `deriveCurrentPosition` — the last LOGGED month is read whatever the array order', () => {
    const unsorted = [entry(3, { strikeBal: 9000 }), entry(1, { strikeBal: 3000 })];
    expect(deriveCurrentPosition(unsorted, 1, 0)).toEqual({ btcHeld: 1, blocBalance: 9000, lastLoggedMonth: 3 });
  });

  it('HJ-25 · file-structure.md logUtils — the expenses re-anchor prompt fires at drift > 5%: exactly 5% does not', () => {
    const log = [1, 2, 3].map((m) => entry(m, { expensesActual: 4200 }));
    // avg 4200 vs plan 4000: |4200 - 4000| / 4000 = 200 / 4000 = 0.05 exactly
    expect(computeExpenseReanchor(log, 4000, 0)).toEqual({ show: false, avg: 4200 });
    // just past 5%: avg 4201 -> 201 / 4000 > 0.05
    const over = [1, 2, 3].map((m) => entry(m, { expensesActual: 4201 }));
    expect(computeExpenseReanchor(over, 4000, 0).show).toBe(true);
  });

  it('HJ-26 · engines.md § coldStorageBtc — a non-finite as-of is no anchor: every cold move counts, like null', () => {
    const log: DayEvent[] = [{ id: 'c', date: '2026-01-10', ts: 5, kind: 'deposit', target: 'cold', amount: 0.2 }];
    expect(deriveColdStorage(log, 1, NaN)).toBeCloseTo(1 + 0.2, 12);
    expect(deriveColdStorage(log, 1, null)).toBeCloseTo(1 + 0.2, 12);
    expect(coldMovesSinceAnchor(log, NaN)).toBe(1);
  });
});
