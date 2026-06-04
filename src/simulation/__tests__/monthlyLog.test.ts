import { describe, it, expect } from 'vitest';
import { deriveAdvisorStart, upsertEntry } from '../logUtils';
import type { MonthlyLogEntry } from '../types';

function makeEntry(month: number, overrides: Partial<MonthlyLogEntry> = {}): MonthlyLogEntry {
  return {
    month,
    date:      `2026-0${month}-01`,
    btcBought: 0.05,
    income:    500,
    paydown:   0,
    strikeBal: month * 3500,
    strikeLtv: 0.15,
    loggedAt:  Date.now(),
    ...overrides,
  };
}

describe('deriveAdvisorStart', () => {
  it('returns manual store fields unchanged when log is empty', () => {
    const result = deriveAdvisorStart([], 0.70, 5000, 4);
    expect(result.startingBlocBalance).toBe(5000);
    expect(result.startingBtcHeld).toBe(0.70);
    expect(result.startingMonth).toBe(4);
  });

  it('uses most recent entry strikeBal as startingBlocBalance', () => {
    const log = [makeEntry(1, { strikeBal: 3500 }), makeEntry(2, { strikeBal: 7000 }), makeEntry(3, { strikeBal: 9180 })];
    const result = deriveAdvisorStart(log, 0.70, 0, 4);
    expect(result.startingBlocBalance).toBe(9180);
  });

  it('accumulates btcBought from all entries and adds to advisorActualBtcHeld', () => {
    const log = [makeEntry(1, { btcBought: 0.05 }), makeEntry(2, { btcBought: 0.03 }), makeEntry(3, { btcBought: 0.02 })];
    const result = deriveAdvisorStart(log, 0.70, 0, 4);
    expect(result.startingBtcHeld).toBeCloseTo(0.70 + 0.05 + 0.03 + 0.02);
  });

  it('sets startingMonth to last.month + 1', () => {
    const log = [makeEntry(3)];
    const result = deriveAdvisorStart(log, 0, 0, 1);
    expect(result.startingMonth).toBe(4);
  });

  it('clamps startingMonth to 12 when last entry is month 12', () => {
    const log = [makeEntry(12)];
    const result = deriveAdvisorStart(log, 0, 0, 12);
    expect(result.startingMonth).toBe(12);
  });
});

describe('upsertEntry', () => {
  it('appends a new entry when month does not exist', () => {
    const entries = [makeEntry(1), makeEntry(2)];
    const result = upsertEntry(entries, makeEntry(3));
    expect(result).toHaveLength(3);
    expect(result[2].month).toBe(3);
  });

  it('replaces an existing entry with the same month number', () => {
    const entries = [makeEntry(1), makeEntry(2, { btcBought: 0.01 })];
    const updated = makeEntry(2, { btcBought: 0.99 });
    const result = upsertEntry(entries, updated);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.month === 2)?.btcBought).toBe(0.99);
  });

  it('keeps entries sorted ascending by month', () => {
    const entries = [makeEntry(3), makeEntry(1)];
    const result = upsertEntry(entries, makeEntry(2));
    expect(result.map((e) => e.month)).toEqual([1, 2, 3]);
  });
});
