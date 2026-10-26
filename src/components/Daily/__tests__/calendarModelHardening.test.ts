import { describe, it, expect } from 'vitest';
import { buildDayCells, buildMonthRollup } from '../calendarModel';
import type { DayEvent } from '../../../simulation/types';

describe('calendarModel hardening', () => {
  it("HJ-21 · journal.md § Logging Consolidation — Strike's minimum is balance-neutral: summed into minPayment, never into paydown", () => {
    const log: DayEvent[] = [{ id: 'm', date: '2026-06-10', ts: 1, kind: 'minPayment', amount: 200 }];
    const s = buildMonthRollup(log, '2026-06-01', 1).streams;
    expect(s.paydown).toBe(0);
    expect(s.minPayment).toBe(200);
  });

  it('HJ-22 · daily-mode.md § P4c-1a Week|Month calendar — a withdraw-only day carries the logged pip', () => {
    const log: DayEvent[] = [{ id: 'w', date: '2026-06-10', ts: 1, kind: 'withdraw', target: 'strike', amount: 0.05 }];
    expect(buildDayCells(log, ['2026-06-10'])[0].pips).toEqual(['logged']);
  });
});
