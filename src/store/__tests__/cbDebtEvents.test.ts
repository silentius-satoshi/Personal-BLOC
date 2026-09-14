import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../useStore';
import { rebuildEditedFlow } from '../../components/Daily/eventSheetModel';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

// Real store. isAuthenticated:false → every publish path early-returns (no async / timers).
// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const START = '2026-01-01';   // strategy month 1 = January 2026

type Flow = Extract<DayEvent, { kind: 'draw' | 'paydown' }>;
const flow = (id: string, kind: 'draw' | 'paydown', amount: number, date: string, ts: number, extra: Partial<Flow> = {}): Flow =>
  ({ id, date, ts, kind, amount, ...extra });
const add = (ev: DayEvent) => useStore.getState().addDayEvent(ev);
const m1 = () => useStore.getState().monthlyLog.find((e) => e.month === 1);

beforeEach(() => {
  useStore.setState({
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, planEvents: [],
    recordsDirty: false, planDirty: false, advisorStartDate: START, hasCbLoan: true,
  } as never);
});

describe('⭐ a Coinbase borrow never reaches expensesActual — mixed month, CB logged FIRST', () => {
  it('a Coinbase borrow then a Strike draw in the same month → expensesActual is the Strike draw only', () => {
    add(flow('c', 'draw', 5000, '2026-01-03', 3, { target: 'cb', fee: 100 }));
    expect(useStore.getState().monthlyLog).toEqual([]);   // journal-only so far
    // The Strike draw re-rolls the month over the FULL dayLog — which already holds the Coinbase borrow.
    add(flow('s', 'draw', 1000, '2026-01-10', 10));
    expect(m1()?.expensesActual).toBe(1000);
  });

  it('a Coinbase paydown then a Strike paydown → entry.paydown is the Strike paydown only', () => {
    add(flow('c', 'paydown', 2000, '2026-01-03', 3, { target: 'cb' }));
    add(flow('s', 'paydown', 300, '2026-01-10', 10));
    expect(m1()?.paydown).toBe(300);
  });
});

describe('⭐ a Coinbase flow never creates, flips or reopens a month (the BUG1 class)', () => {
  it('a month holding only Coinbase flows creates no entry', () => {
    add(flow('c1', 'draw', 5000, '2026-01-03', 3, { target: 'cb', fee: 100 }));
    add(flow('c2', 'paydown', 2000, '2026-01-04', 4, { target: 'cb' }));
    expect(useStore.getState().monthlyLog).toEqual([]);
  });

  it('a manual month stays manual, and a confirmed month stays confirmed', () => {
    const entry = {
      month: 1, date: START, btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
      loggedAt: 1, btcHeld: 0, expensesActual: 0, source: 'manual', confirmed: true,
    } as MonthlyLogEntry;
    useStore.setState({ monthlyLog: [entry] } as never);
    add(flow('c', 'draw', 5000, '2026-01-03', 3, { target: 'cb', fee: 100 }));
    const m = m1()!;
    expect(m.source).toBe('manual');
    expect(m.confirmed).toBe(true);
    expect(m.expensesActual).toBe(0);
  });
});

describe('Strike draws are unaffected', () => {
  it('an explicit target:"strike" draw rolls up exactly like a legacy target-less one', () => {
    add(flow('s', 'draw', 1000, '2026-01-10', 10, { target: 'strike' }));
    expect(m1()).toMatchObject({ expensesActual: 1000, source: 'daily' });
  });
});

describe('editing', () => {
  it('editing a Coinbase borrow keeps it a Coinbase borrow — still no month, still journal-only', () => {
    const cb = flow('c', 'draw', 5000, '2026-01-03', 3, { target: 'cb', fee: 100 });
    add(cb);
    useStore.getState().updateDayEvent(rebuildEditedFlow(cb, 8000, 60_000));
    expect(useStore.getState().monthlyLog).toEqual([]);
    expect(useStore.getState().dayLog[0]).toMatchObject({ kind: 'draw', amount: 8000, target: 'cb' });
  });

  it('⭐ flipping a Strike draw to Coinbase re-rolls the OLD month (the monthOf(before) ∪ monthOf(after) union)', () => {
    // The flipped event is journal-only, so monthOf(after) is null — ONLY monthOf(before) re-rolls the month. Drop that
    // line and the stale Strike figure stays forever. A DRAW-ONLY month on purpose: with another event in the month,
    // the pre-existing stale-field defect below would keep the 1000 and this could not tell the union apart.
    const s = flow('s', 'draw', 1000, '2026-01-10', 10);
    add(s);
    expect(m1()?.expensesActual).toBe(1000);
    useStore.getState().updateDayEvent({ ...s, target: 'cb' });
    expect(m1()?.expensesActual ?? 0).toBe(0);
  });
});

describe('PRE-EXISTING defect — a re-roll never clears a flow field the month no longer has (characterised, NOT fixed)', () => {
  it('deleting the last Strike draw of a month that still has other events leaves expensesActual stale', () => {
    // rerollMonth writes { ...existing, ...rollupEntry } and rollupMonth only emits keys for flows present, so a key that
    // drops out keeps its old value. Predates Coinbase flows — it applies to any draw/paydown/buy delete or edit.
    // Pinned so a future fix is a conscious change.
    add(flow('s', 'draw', 1000, '2026-01-10', 10));
    add(flow('p', 'paydown', 300, '2026-01-12', 12));
    useStore.getState().deleteDayEvent('s');
    expect(m1()).toMatchObject({ paydown: 300, expensesActual: 1000 });
  });
});
