import { describe, it, expect, beforeEach, vi } from 'vitest';

// The records publish the store kicks (dynamic import, bootstrap.ts's kickRecordsPublish) — a spy, so nothing publishes.
vi.mock('../../lib/nostr/syncEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nostr/syncEngine')>();
  return { ...actual, publishRecordsNow: vi.fn() };
});

import { useStore } from '../useStore';
import { publishRecordsNow } from '../../lib/nostr/syncEngine';
import { rollupMonth, priorStocksForMonth } from '../../simulation/logUtils';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

/**
 * Hardening 2 — advisorJournalSlice.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HJ.json).
 * The real store, signed out (no publish), as dailyModeStore.test.ts drives it. Round synthetic figures.
 */
const START = '2026-06-01';
let n = 0;
const id = (): string => `h2-${++n}`;
const entry = (over: Partial<MonthlyLogEntry>): MonthlyLogEntry => ({
  month: 1, date: START, btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
  loggedAt: 1, updatedAt: 1, expensesActual: 0, source: 'daily', confirmed: false, ...over,
});
const month = (m: number): MonthlyLogEntry | undefined => useStore.getState().monthlyLog.find((e) => e.month === m);

beforeEach(() => {
  useStore.setState({
    advisorStartDate: START, monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, recordsDirty: false,
    isAuthenticated: false, nostrSigner: null, nostrPubkey: '', monthBucketReconcileDone: false,
  } as never);
});

describe('Hardening 2 — advisorJournalSlice', () => {
  it('HJ-15 · journal.md § Strategy-Month Calendar Fix — the one-shot reconcile re-rolls month 12 too', () => {
    // A Strike draw on 2027-05-15 is month 12 of a 2026-06-01 plan; month 12's stored entry predates it (rolled under the
    // old buckets) and says nothing was spent.
    const draw = { id: id(), ts: 10, date: '2027-05-15', kind: 'draw', amount: 1_000 } as DayEvent;
    useStore.setState({ dayLog: [draw], monthlyLog: [entry({ month: 12, date: '2027-05-01', expensesActual: 0 })] } as never);
    useStore.getState().reconcileMonthBuckets();
    expect(month(12)?.expensesActual, 'HJ-15 month 12 re-rolled').toBe(1_000);
  });

  it('HJ-16 · journal.md § Strategy-Month Calendar Fix — the reconcile leaves a current signed carry-forward month signed (idempotent)', () => {
    // Readings in months 1 and 2; month 3 has only a draw, so it carries month 2's stocks ($3,000), provisional.
    const reading = (strikeBal: number, date: string): DayEvent =>
      ({ id: id(), ts: 10 + n, date, kind: 'balanceReading', reading: { strikeBal, strikeLtv: 0.1 } }) as DayEvent;
    const dayLog = [reading(2_000, '2026-06-15'), reading(3_000, '2026-07-15'),
      { id: id(), ts: 30, date: '2026-08-15', kind: 'draw', amount: 1_000 } as DayEvent];
    const dates = ['2026-06-01', '2026-07-01', '2026-08-01'];
    // Every month seeded to its own fresh rollup and signed: nothing for the reconcile to change.
    const monthlyLog = [1, 2, 3].map((m) => entry({
      month: m, date: dates[m - 1], ...rollupMonth(dayLog, m, START, priorStocksForMonth(dayLog, START, m)).entry,
      source: 'daily', confirmed: true,
    }));
    expect(monthlyLog[2].strikeBal, 'HJ-16 premise: month 3 carries month 2\'s stocks').toBe(3_000);
    useStore.setState({ dayLog, monthlyLog } as never);
    useStore.getState().reconcileMonthBuckets();
    expect([month(3)?.strikeBal, month(3)?.confirmed], 'HJ-16 month 3 unchanged, still signed').toEqual([3_000, true]);
  });

  it('HJ-18 · daily-mode.md § Daily Mode (P4c-3b) — signing off a provisional month keeps it provisional (only a reading clears it)', () => {
    useStore.setState({ monthlyLog: [entry({ month: 1, provisional: true, confirmed: false })] } as never);
    useStore.getState().confirmMonth(1);
    expect([month(1)?.confirmed, month(1)?.provisional], 'HJ-18 signed, still an estimate').toEqual([true, true]);
  });

  it('HY-09 · sync.md "`publishRecords` cadence" — a monthly log write kicks the records publish at once, not at the next sync tick', async () => {
    await vi.dynamicImportSettled();
    vi.mocked(publishRecordsNow).mockClear();
    useStore.getState().upsertLogEntry(entry({ month: 1, source: 'manual', expensesActual: 100 }));
    await vi.dynamicImportSettled();
    expect(month(1)?.expensesActual, 'HY-09 premise: the write landed').toBe(100);
    expect(publishRecordsNow, 'HY-09 the publish kicked').toHaveBeenCalledTimes(1);
  });
});
