import { describe, it, expect } from 'vitest';
import { hasLoggedData } from '../hasLoggedData';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';

// R2c-2 — the nag's data gate. hasLoggedData reads only dayLog + monthlyLog, so a Pick fixture suffices.
const dayEvent = { id: 'a', date: '2026-01-01', ts: 1, kind: 'draw', amount: 100 } as DayEvent;
const monthEntry = { month: 1, date: '2026-01-01' } as unknown as MonthlyLogEntry;

describe('hasLoggedData', () => {
  it('empty plan (no dayLog, no monthlyLog) → false', () => {
    expect(hasLoggedData({ dayLog: [], monthlyLog: [] })).toBe(false);
  });

  it('one dayLog event → true', () => {
    expect(hasLoggedData({ dayLog: [dayEvent], monthlyLog: [] })).toBe(true);
  });

  it('one monthly record → true', () => {
    expect(hasLoggedData({ dayLog: [], monthlyLog: [monthEntry] })).toBe(true);
  });

  it('both present → true', () => {
    expect(hasLoggedData({ dayLog: [dayEvent], monthlyLog: [monthEntry] })).toBe(true);
  });
});
