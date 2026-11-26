import { describe, it, expect, vi } from 'vitest';
import { monthOf, monthEntryCurrent, rerollMonth, readingCtx } from '../dailyRouting';
import type { StoreGet } from '../types';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

/**
 * Hardening 2 — dailyRouting.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HJ.json).
 * The helpers take zustand's `get`; a fake one hands them the few fields they read. Round synthetic figures.
 */
const START = '2026-06-01';
function fake(o: { dayLog?: DayEvent[]; monthlyLog?: MonthlyLogEntry[] } = {}) {
  const upsertLogEntry = vi.fn();
  const deleteLogEntry = vi.fn();
  const state = { advisorStartDate: START, dayLog: o.dayLog ?? [], monthlyLog: o.monthlyLog ?? [], upsertLogEntry, deleteLogEntry };
  return { get: (() => state) as unknown as StoreGet, upsertLogEntry, deleteLogEntry };
}
const ev = (o: Record<string, unknown>): DayEvent => ({ id: `e${String(o.ts ?? 1)}`, ts: 1, ...o }) as unknown as DayEvent;

describe('Hardening 2 — dailyRouting', () => {
  it('HJ-02 · journal.md "A Coinbase borrow/paydown is journal-only at EVERY dayLog reader" — monthOf names no month for a Coinbase draw', () => {
    const { get } = fake();
    const strikeDraw = ev({ date: '2026-06-10', kind: 'draw', amount: 1_000, target: 'strike' });
    const cbDraw = ev({ date: '2026-06-10', kind: 'draw', amount: 1_000, target: 'cb' });
    expect(monthOf(get, strikeDraw), 'HJ-02 premise: a Strike draw names its month').toBe(1);
    expect(monthOf(get, cbDraw), 'HJ-02 a Coinbase draw re-rolls no month').toBeNull();
  });

  it('HJ-03 · journal.md "A buy\'s dollars are the owner\'s" — a Coinbase borrow logged after the sign-off leaves the month\'s entry current', () => {
    const entry = { month: 1, source: 'daily', btcBought: 0.01, updatedAt: 100, loggedAt: 100 } as unknown as MonthlyLogEntry;
    const buy = ev({ ts: 50, date: '2026-06-05', kind: 'buy', amount: 0.01, usd: 650 });
    const cbDraw = ev({ ts: 200, date: '2026-06-20', kind: 'draw', amount: 1_000, target: 'cb' });
    const strikeDraw = ev({ ts: 200, date: '2026-06-20', kind: 'draw', amount: 1_000, target: 'strike' });
    // A dollars-only buy edit may then write Income → BTC alone, keeping the sign-off.
    expect(monthEntryCurrent(fake({ dayLog: [buy, cbDraw], monthlyLog: [entry] }).get, 1), 'HJ-03 a journal-only event is no lag').toBe(true);
    expect(monthEntryCurrent(fake({ dayLog: [buy, strikeDraw], monthlyLog: [entry] }).get, 1), 'HJ-03 premise: a Strike draw after the save is one')
      .toBe(false);
  });

  it('HJ-14 · journal.md § Strategy-Month Calendar Fix — a month the journal creates is dated at its own anniversary, never the next', () => {
    for (const [month, date, expected] of [[1, '2026-06-10', '2026-06-01'], [3, '2026-08-10', '2026-08-01']] as const) {
      const f = fake({ dayLog: [ev({ date, kind: 'draw', amount: 1_000, target: 'strike' })] });
      rerollMonth(f.get, month);
      expect(f.upsertLogEntry, `HJ-14 premise: month ${month} is created`).toHaveBeenCalledTimes(1);
      expect((f.upsertLogEntry.mock.calls[0][0] as MonthlyLogEntry).date, `HJ-14 month ${month}`).toBe(expected);
    }
  });

  it('HJ-17 · daily-mode.md § Daily Mode (P2a — store wiring) — an emptied month is removed only when the journal owns it; a hand-logged month stays', () => {
    const manual = fake({ monthlyLog: [{ month: 1, source: 'manual' } as unknown as MonthlyLogEntry] });
    rerollMonth(manual.get, 1);
    expect(manual.deleteLogEntry, 'HJ-17 the owner\'s manual record is never deleted').not.toHaveBeenCalled();
    const daily = fake({ monthlyLog: [{ month: 1, source: 'daily' } as unknown as MonthlyLogEntry] });
    rerollMonth(daily.get, 1);
    expect(daily.deleteLogEntry, 'HJ-17 premise: a daily-owned emptied month is removed').toHaveBeenCalledWith(1);
  });

  it('HJ-20 · journal.md § Logging Consolidation §5b (Readings-Unification) — the reading context carries the Coinbase liquidation price, so deleting its reading can fall back', () => {
    const reading = ev({
      date: '2026-01-20', kind: 'balanceReading', reading: { strikeBal: 0, strikeLtv: 0, cbBal: 50_000, cbLiqPrice: 61_000 },
    });
    expect(readingCtx(reading)).toEqual({ oldDate: '2026-01-20', strikeBal: 0, cbBal: 50_000, cbLiqPrice: 61_000 });
  });
});
