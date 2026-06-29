import { describe, it, expect } from 'vitest';
import { monthDateRange, weekDates, buildDayCells } from '../calendarModel';
import { bucketEventToMonth } from '../../../simulation/logUtils';
import type { DayEvent } from '../../../simulation/types';

const START = '2025-01-01';
const DAY_MS = 86_400_000;

describe('monthDateRange', () => {
  it('every returned date buckets back to the requested month', () => {
    for (const m of [1, 2, 6, 12]) {
      for (const d of monthDateRange(START, m)) {
        expect(bucketEventToMonth(d, START)).toBe(m);
      }
    }
  });

  it('is ascending and contiguous (one calendar day apart)', () => {
    const dates = monthDateRange(START, 4);
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]).getTime();
      const cur = new Date(dates[i]).getTime();
      expect(cur).toBe(prev + DAY_MS);   // contiguous + ascending
    }
    // a strategy month is ~30–31 calendar days
    expect(dates.length).toBeGreaterThanOrEqual(30);
    expect(dates.length).toBeLessThanOrEqual(31);
  });

  it('month 1 starts at advisorStartDate', () => {
    expect(monthDateRange(START, 1)[0]).toBe(START);
  });

  it('boundary: last date of month N and first of month N+1 bucket correctly + are adjacent', () => {
    const m3 = monthDateRange(START, 3);
    const m4 = monthDateRange(START, 4);
    const lastM3 = m3[m3.length - 1];
    const firstM4 = m4[0];
    expect(bucketEventToMonth(lastM3, START)).toBe(3);
    expect(bucketEventToMonth(firstM4, START)).toBe(4);
    expect(new Date(firstM4).getTime()).toBe(new Date(lastM3).getTime() + DAY_MS);
  });
});

describe('weekDates', () => {
  it('returns 7 dates Monday→Sunday containing the input', () => {
    // 2025-01-08 is a Wednesday
    const wk = weekDates('2025-01-08');
    expect(wk).toHaveLength(7);
    expect(wk).toContain('2025-01-08');
    expect(wk[0]).toBe('2025-01-06');   // Monday
    expect(wk[6]).toBe('2025-01-12');   // Sunday
  });

  it('Monday input → Monday is first', () => {
    expect(weekDates('2025-01-06')[0]).toBe('2025-01-06');
  });

  it('Sunday input → still Monday-first (Sunday is last)', () => {
    const wk = weekDates('2025-01-12');   // Sunday
    expect(wk[0]).toBe('2025-01-06');
    expect(wk[6]).toBe('2025-01-12');
  });
});

describe('buildDayCells', () => {
  const draw:    DayEvent = { id: 'a', date: '2025-01-05', ts: 1, kind: 'draw', amount: 1000 };
  const reading: DayEvent = { id: 'b', date: '2025-01-06', ts: 2, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.12 } };
  const cbDep:   DayEvent = { id: 'c', date: '2025-01-07', ts: 3, kind: 'deposit', amount: 0.1, target: 'cb' };
  const strikeDep: DayEvent = { id: 'd', date: '2025-01-08', ts: 4, kind: 'deposit', amount: 0.2, target: 'strike' };

  it('a draw day → [logged]', () => {
    const cells = buildDayCells([draw], ['2025-01-05']);
    expect(cells[0].pips).toEqual(['logged']);
    expect(cells[0].day).toBe(5);
  });

  it('a balanceReading day → [reading]', () => {
    expect(buildDayCells([reading], ['2025-01-06'])[0].pips).toEqual(['reading']);
  });

  it('a day with both flow and reading → both', () => {
    const both: DayEvent = { ...reading, date: '2025-01-05', id: 'e' };
    expect(buildDayCells([draw, both], ['2025-01-05'])[0].pips).toEqual(['logged', 'reading']);
  });

  it('a CB-target deposit → [logged, cbCollateral]', () => {
    expect(buildDayCells([cbDep], ['2025-01-07'])[0].pips).toEqual(['logged', 'cbCollateral']);
  });

  it('a Strike-target deposit → [logged] only (no cbCollateral)', () => {
    expect(buildDayCells([strikeDep], ['2025-01-08'])[0].pips).toEqual(['logged']);
  });

  it('an empty day → []', () => {
    expect(buildDayCells([draw], ['2025-01-09'])[0].pips).toEqual([]);
  });

  it('weekday is Monday-anchored (Mon=0 … Sun=6)', () => {
    // 2025-01-06 = Monday → 0; 2025-01-12 = Sunday → 6
    expect(buildDayCells([], ['2025-01-06'])[0].weekday).toBe(0);
    expect(buildDayCells([], ['2025-01-12'])[0].weekday).toBe(6);
  });
});

describe('timezone safety', () => {
  it('month-boundary dates produce the exact expected yyyy-mm-dd strings (no drift)', () => {
    // Start on a date where naive local-tz math could slip a day.
    const start = '2025-03-31';
    const m1 = monthDateRange(start, 1);
    expect(m1[0]).toBe('2025-03-31');
    // every date is a well-formed yyyy-mm-dd and buckets to 1
    for (const d of m1) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(bucketEventToMonth(d, start)).toBe(1);
    }
  });
});
