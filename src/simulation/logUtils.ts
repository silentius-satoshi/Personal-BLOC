import type { DayEvent, MonthlyLogEntry } from './types';

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

// --- Daily Mode (P1) — pure rollup of granular DayEvents into a strategy-month entry ---

/**
 * Map a calendar date to its strategy-month index (1–12). Replicates getCurrentStrategyMonth's formula
 * (runAdvisor.ts) but using the EVENT date instead of Date.now() — getCurrentStrategyMonth is Date.now()-bound and
 * can't bucket an arbitrary date, so the math is duplicated here to keep logUtils import-standalone (no cross-sim imports).
 */
export function bucketEventToMonth(date: string, advisorStartDate: string): number {
  const elapsed = Math.floor((new Date(date).getTime() - new Date(advisorStartDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
  return Math.min(Math.max(1, elapsed + 1), 12);
}

/**
 * Roll a month's DayEvents up into a Partial<MonthlyLogEntry> + the net Strike collateral delta. PURE.
 * Flows accumulate (draw→expensesActual, buy→btcBought [+income iff usd], paydown→paydown); target:'strike'
 * deposit/withdraw feed collateralDelta (signed by kind — deposit +, withdraw −); target:'cb' and cbCollateralReading
 * are journal-only (ignored). Stocks come from the LATEST balanceReading by ts (strikeBal/strikeLtv always; cbBal/cbLtv
 * iff present). cbCollateral is NEVER placed in entry (it feeds a derived store value in P2). btcHeld/collateralAdjustment/
 * source/confirmed are NEVER set here (store-owned / P2-stamped). Carry-forward: flows but no reading + priorStocks →
 * stocks from priorStocks + provisional:true. Empty month → { entry: {}, collateralDelta: 0 }.
 */
export function rollupMonth(
  dayLog: DayEvent[],
  month: number,
  advisorStartDate: string,
  priorStocks?: { strikeBal: number; strikeLtv: number; cbBal?: number; cbLtv?: number; cbCollateral?: number },
): { entry: Partial<MonthlyLogEntry>; collateralDelta: number } {
  const inMonth = dayLog.filter((e) => bucketEventToMonth(e.date, advisorStartDate) === month);
  const entry: Partial<MonthlyLogEntry> = {};
  let collateralDelta = 0;
  let hasFlow = false;

  for (const ev of inMonth) {
    switch (ev.kind) {
      case 'draw':
        entry.expensesActual = (entry.expensesActual ?? 0) + ev.amount;
        hasFlow = true;
        break;
      case 'buy':
        entry.btcBought = (entry.btcBought ?? 0) + ev.amount;
        if (ev.usd !== undefined) entry.income = (entry.income ?? 0) + ev.usd;
        hasFlow = true;
        break;
      case 'paydown':
        entry.paydown = (entry.paydown ?? 0) + ev.amount;
        hasFlow = true;
        break;
      case 'deposit':
      case 'withdraw':
        if (ev.target === 'strike') {
          collateralDelta += ev.kind === 'withdraw' ? -ev.amount : ev.amount;   // amount = magnitude; sign by kind
          hasFlow = true;
        }
        // target:'cb' → journal-only, ignored
        break;
      // cbCollateralReading → ignored by rollupMonth; balanceReading → handled below
    }
  }

  // Stocks: latest balanceReading by ts.
  const readings = inMonth.filter((e): e is Extract<DayEvent, { kind: 'balanceReading' }> => e.kind === 'balanceReading');
  if (readings.length > 0) {
    const latest = readings.reduce((a, b) => (b.ts >= a.ts ? b : a));
    entry.strikeBal = latest.reading.strikeBal;
    entry.strikeLtv = latest.reading.strikeLtv;
    if (latest.reading.cbBal !== undefined) entry.cbBal = latest.reading.cbBal;
    if (latest.reading.cbLtv !== undefined) entry.cbLtv = latest.reading.cbLtv;
    // cbCollateral intentionally NOT placed in entry (derived store value in P2)
  } else if (hasFlow && priorStocks) {
    // Carry-forward fallback: a month with flows but no reading borrows the prior month's stocks, flagged provisional.
    entry.strikeBal = priorStocks.strikeBal;
    entry.strikeLtv = priorStocks.strikeLtv;
    if (priorStocks.cbBal !== undefined) entry.cbBal = priorStocks.cbBal;
    if (priorStocks.cbLtv !== undefined) entry.cbLtv = priorStocks.cbLtv;
    entry.provisional = true;
  }

  return { entry, collateralDelta };
}
