import type { MonthlyLogEntry } from './types';

export function recomputeBtcHeld(
  log: MonthlyLogEntry[],
  baseBtcHeld: number,
): MonthlyLogEntry[] {
  const sorted = [...log].sort((a, b) => a.month - b.month);
  let running = baseBtcHeld;
  return sorted.map(e => {
    running += (e.btcBought ?? 0) + (e.collateralAdjustment ?? 0);
    return { ...e, btcHeld: running };
  });
}

// pendingCollateralAdjustment is REQUIRED (not defaulted) on both derives — a default 0 would let an
// unthreaded surface silently show stale current; the compiler must flag every call site.
export function deriveAdvisorStart(
  monthlyLog: MonthlyLogEntry[],
  advisorActualBtcHeld: number,
  _advisorActualBlocBalance: number,   // retained for signature stability — live-drawn balance is no longer the start base (see monthStartBalance)
  currentStrategyMonth: number,
  pendingCollateralAdjustment: number,
  monthStartBalance: number,   // BLOC balance at the START of the current month — projection base (NOT live drawn)
): {
  startingBlocBalance: number;
  startingBtcHeld:     number;
  startingMonth:       number;
} {
  if (monthlyLog.length === 0) {
    return {
      startingBlocBalance: monthStartBalance,   // start-of-month base; live-drawn (advisorActualBlocBalance) is a separate concept
      startingBtcHeld:     advisorActualBtcHeld + pendingCollateralAdjustment,
      startingMonth:       currentStrategyMonth,
    };
  }
  const sorted = [...monthlyLog].sort((a, b) => a.month - b.month);
  const last = sorted[sorted.length - 1];
  return {
    startingBlocBalance: last.strikeBal,
    startingBtcHeld:     last.btcHeld + pendingCollateralAdjustment,
    startingMonth:       Math.min(last.month + 1, 12),
  };
}

export function deriveCurrentPosition(
  monthlyLog: MonthlyLogEntry[],
  baseBtcHeld: number,
  baseBlocBalance: number,
  pendingCollateralAdjustment: number,
): { btcHeld: number; blocBalance: number; lastLoggedMonth: number | null } {
  if (monthlyLog.length === 0) {
    return { btcHeld: baseBtcHeld + pendingCollateralAdjustment, blocBalance: baseBlocBalance, lastLoggedMonth: null };
  }
  const sorted = [...monthlyLog].sort((a, b) => a.month - b.month);
  const last   = sorted[sorted.length - 1];
  return {
    btcHeld:         last.btcHeld + pendingCollateralAdjustment,
    blocBalance:     last.strikeBal,
    lastLoggedMonth: last.month,
  };
}

/**
 * Forward-expenditure re-anchor nudge (Simple Mode Outlook, spec §9). Compares the trailing 3-entry
 * average of expensesActual against the static `expenses` assumption. Fires at >5% drift; once
 * dismissed at avg=D, stays hidden until the average moves >5% (of the assumption) past D.
 * Pure — needs 3 logged entries to average (fewer → no nudge).
 */
export function computeExpenseReanchor(
  monthlyLog: MonthlyLogEntry[],
  expenses: number,
  dismissedAt: number,
): { show: boolean; avg: number } {
  const recent = [...monthlyLog].sort((a, b) => b.month - a.month).slice(0, 3);
  if (recent.length < 3) return { show: false, avg: 0 };
  const avg   = recent.reduce((s, e) => s + (e.expensesActual ?? 0), 0) / recent.length;
  const drift = expenses > 0 ? Math.abs(avg - expenses) / expenses : 0;
  const materialSinceDismissal =
    dismissedAt === 0 || (expenses > 0 && Math.abs(avg - dismissedAt) / expenses > 0.05);
  return { show: drift > 0.05 && materialSinceDismissal, avg };
}

export function upsertEntry(
  entries: MonthlyLogEntry[],
  newEntry: MonthlyLogEntry,
): MonthlyLogEntry[] {
  const filtered = entries.filter((e) => e.month !== newEntry.month);
  return [...filtered, newEntry].sort((a, b) => a.month - b.month);
}
