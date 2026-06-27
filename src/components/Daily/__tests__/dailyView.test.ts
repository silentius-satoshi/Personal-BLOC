import { describe, it, expect } from 'vitest';
import { selectMonthEvents, describeDayEvent } from '../dailyView';
import type { DayEvent } from '../../../simulation/types';

const START = '2025-01-01';

describe('selectMonthEvents', () => {
  const m1a: DayEvent = { id: 'a', date: '2025-01-05', ts: 200, kind: 'draw', amount: 1000 };
  const m1b: DayEvent = { id: 'b', date: '2025-01-20', ts: 100, kind: 'paydown', amount: 500 };
  const m2:  DayEvent = { id: 'c', date: '2025-02-15', ts: 300, kind: 'draw', amount: 800 };

  it('filters to the requested strategy month via bucketEventToMonth', () => {
    expect(selectMonthEvents([m1a, m1b, m2], 1, START).map((e) => e.id)).toEqual(['b', 'a']);
    expect(selectMonthEvents([m1a, m1b, m2], 2, START).map((e) => e.id)).toEqual(['c']);
  });

  it('sorts ascending by ts (chronological within the month)', () => {
    const out = selectMonthEvents([m1a, m1b], 1, START);
    expect(out.map((e) => e.ts)).toEqual([100, 200]);
  });

  it('returns empty for a month with no events', () => {
    expect(selectMonthEvents([m1a, m1b, m2], 5, START)).toEqual([]);
  });
});

describe('describeDayEvent', () => {
  it('draw → USD detail', () => {
    const d = describeDayEvent({ id: '1', date: START, ts: 1, kind: 'draw', amount: 1200 });
    expect(d.label).toBe('Credit-line draw');
    expect(d.detail).toBe('$1,200');
  });

  it('buy → BTC + usd estimate when present, BTC-only when absent', () => {
    const withUsd = describeDayEvent({ id: '2', date: START, ts: 1, kind: 'buy', amount: 0.0125, usd: 1000 });
    expect(withUsd.label).toBe('Bought Bitcoin');
    expect(withUsd.detail).toBe('₿ 0.0125 (~$1,000)');
    const noUsd = describeDayEvent({ id: '3', date: START, ts: 1, kind: 'buy', amount: 0.0125 });
    expect(noUsd.detail).toBe('₿ 0.0125');
  });

  it('paydown → USD detail', () => {
    expect(describeDayEvent({ id: '4', date: START, ts: 1, kind: 'paydown', amount: 500 }).detail).toBe('$500');
  });

  it('deposit / withdraw → labels carry the target', () => {
    const dep = describeDayEvent({ id: '5', date: START, ts: 1, kind: 'deposit', amount: 0.1, target: 'strike' });
    expect(dep.label).toBe('Deposit to Strike');
    expect(dep.detail).toBe('₿ 0.1');
    const wd = describeDayEvent({ id: '6', date: START, ts: 1, kind: 'withdraw', amount: 0.05, target: 'cb' });
    expect(wd.label).toBe('Withdraw from Coinbase');
    expect(wd.detail).toBe('₿ 0.05');
  });

  it('cbCollateralReading → BTC detail', () => {
    expect(describeDayEvent({ id: '7', date: START, ts: 1, kind: 'cbCollateralReading', cbCollateral: 1.48 }).detail).toBe('₿ 1.48');
  });

  it('balanceReading → Strike always, CB appended when present', () => {
    const strikeOnly = describeDayEvent({
      id: '8', date: START, ts: 1, kind: 'balanceReading',
      reading: { strikeBal: 5000, strikeLtv: 0.15 },
    });
    expect(strikeOnly.label).toBe('Balance reading');
    expect(strikeOnly.detail).toBe('Strike $5,000 (15.0% LTV)');

    const withCb = describeDayEvent({
      id: '9', date: START, ts: 1, kind: 'balanceReading',
      reading: { strikeBal: 5000, strikeLtv: 0.15, cbBal: 60000, cbLtv: 0.72 },
    });
    expect(withCb.detail).toBe('Strike $5,000 (15.0% LTV) · CB $60,000 (72.0% LTV)');
  });
});
