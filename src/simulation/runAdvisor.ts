// The Advisor's helpers: the strategy month, its end, and the NDP's status. The Advisor engine (`runAdvisor`), its tier
// helpers and its projection's types left the code in 5e (batch 1, D5-A): no screen had called it since the plan of
// record's Run 3, when THIS MONTH, Daily and the Advisor tab moved to the plan (`planRun`). The file keeps its name, so
// its importers keep theirs.
import { bucketEventToMonth, strategyMonthIndex } from './logUtils';   // calendar-anniversary bucketing (cycle-free: logUtils → types only)
import { todayLocalISO } from '../utils/format';

// "Today" = the user's LOCAL calendar day, bucketed by the SAME calendar-anniversary function as every event
// date (both yyyy-mm-dd parsed UTC-midnight → compared by Y/M/D; no local/UTC mixing). Replaced Date.now() +
// the old floor(elapsedDays/30.4375) day-arithmetic — one clock now, shared with bucketEventToMonth.
export function getCurrentStrategyMonth(startDate: string): number {
  return bucketEventToMonth(todayLocalISO(), startDate);
}

// Complete once past month 12 — the UNclamped index (bucketEventToMonth saturates at 12; the check needs >12).
export function isStrategyComplete(startDate: string): boolean {
  return strategyMonthIndex(todayLocalISO(), startDate) > 12;
}

export type NdpStatus = 'never' | 'ok' | 'upcoming' | 'soon' | 'overdue';

export interface NdpInfo {
  status:          NdpStatus;
  daysRemaining:   number | null;
  nextDueDate:     Date | null;
  estimatedAmount: number;
}

export function getNdpStatus(
  lastPaidDate: string | null,
  balance: number,
  aprPct: number,
): NdpInfo {
  const estimatedAmount = Math.round(balance * (aprPct / 100 / 12));

  if (!lastPaidDate) {
    return { status: 'never', daysRemaining: null, nextDueDate: null, estimatedAmount };
  }

  const nextDue = new Date(new Date(lastPaidDate).getTime() + 365 * 24 * 60 * 60 * 1000);
  const daysRemaining = Math.ceil((nextDue.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  const status: NdpStatus =
    daysRemaining < 0   ? 'overdue'
    : daysRemaining <= 30 ? 'soon'
    : daysRemaining <= 60 ? 'upcoming'
    : 'ok';

  return { status, daysRemaining, nextDueDate: nextDue, estimatedAmount };
}
