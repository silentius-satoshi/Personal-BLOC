import type { MonthlyLogEntry } from './types';

export function recomputeBtcHeld(
  log: MonthlyLogEntry[],
  baseBtcHeld: number,
): MonthlyLogEntry[] {
  const sorted = [...log].sort((a, b) => a.month - b.month);
  let running = baseBtcHeld;
  return sorted.map(e => {
    running += (e.btcBought ?? 0);
    return { ...e, btcHeld: running };
  });
}

export function deriveAdvisorStart(
  monthlyLog: MonthlyLogEntry[],
  advisorActualBtcHeld: number,
  advisorActualBlocBalance: number,
  currentStrategyMonth: number,
): {
  startingBlocBalance: number;
  startingBtcHeld:     number;
  startingMonth:       number;
} {
  if (monthlyLog.length === 0) {
    return {
      startingBlocBalance: advisorActualBlocBalance,
      startingBtcHeld:     advisorActualBtcHeld,
      startingMonth:       currentStrategyMonth,
    };
  }
  const sorted = [...monthlyLog].sort((a, b) => a.month - b.month);
  const last = sorted[sorted.length - 1];
  return {
    startingBlocBalance: last.strikeBal,
    startingBtcHeld:     last.btcHeld,
    startingMonth:       Math.min(last.month + 1, 12),
  };
}

export function deriveCurrentPosition(
  monthlyLog: MonthlyLogEntry[],
  baseBtcHeld: number,
  baseBlocBalance: number,
): { btcHeld: number; blocBalance: number; lastLoggedMonth: number | null } {
  if (monthlyLog.length === 0) {
    return { btcHeld: baseBtcHeld, blocBalance: baseBlocBalance, lastLoggedMonth: null };
  }
  const sorted = [...monthlyLog].sort((a, b) => a.month - b.month);
  const last   = sorted[sorted.length - 1];
  return {
    btcHeld:         last.btcHeld,
    blocBalance:     last.strikeBal,
    lastLoggedMonth: last.month,
  };
}

export function upsertEntry(
  entries: MonthlyLogEntry[],
  newEntry: MonthlyLogEntry,
): MonthlyLogEntry[] {
  const filtered = entries.filter((e) => e.month !== newEntry.month);
  return [...filtered, newEntry].sort((a, b) => a.month - b.month);
}
