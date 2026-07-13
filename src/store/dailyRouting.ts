// Daily-routing helpers (Phase 1c) — moved verbatim out of the store module. Store-touching helpers receive zustand's
// set/get (so this file never imports the composed store — the cycle rule); pure ones are unchanged. The only body
// change is getState()→get() / setState()→set(). Called from the dayLog + monthlyLog slice actions (which pass set/get).
import type { StoreSet, StoreGet } from './types';
import type { PlanField } from './settingsFields';
import type { DayEvent, MonthlyLogEntry } from '../simulation/types';
import { bucketEventToMonth, rollupMonth, deriveCbCollateral, deriveStrikeCollateral, deriveReadingAnchors, priorStocksForMonth, type ReadingMutationCtx } from '../simulation/logUtils';

// ISO first-day of a strategy month (month 1 = advisorStartDate's month). advisorStartDate is a
// date-only 'yyyy-mm-dd' string → new Date(...) parses it at UTC MIDNIGHT (JS spec). The output feeds
// bucketEventToMonth/calendarModel's UTC-string calendar-date convention, so this stays UTC-consistent
// throughout (UTC accessors, not local) — mixing local getMonth/setMonth with a UTC-parsed input was the
// bug (an off-by-one near month boundaries in behind-UTC zones).
function strategyMonthDate(advisorStartDate: string, month: number): string {
  const d = new Date(advisorStartDate);
  d.setUTCMonth(d.getUTCMonth() + (month - 1));
  return d.toISOString().split('T')[0];
}

// Seam 2 clock: refresh the derived cbCollateralBtc cache from the current dayLog (cheap, idempotent).
export function refreshCbCollateralCache(set: StoreSet, get: StoreGet): void {
  const s = get();
  set({ cbCollateralBtc: deriveCbCollateral(s.dayLog, s.cbCollateralBtc) });
}

// Collateral-Truth v20 — the Strike-collateral equivalent: refresh the derived strikeCollateralBtc cache
// (reading-anchored) from the current dayLog. Mirrors refreshCbCollateralCache; called beside it in the mutators.
export function refreshStrikeCollateralCache(set: StoreSet, get: StoreGet): void {
  const s = get();
  set({ strikeCollateralBtc: deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc) });
}

// §5b Readings-Unification seam — couple the live safety anchors (advisorActualBlocBalance / cbLoanBalance /
// cbLiquidationPrice) to the DATE-latest balanceReading. Runs on LOCAL dayLog actions ONLY (add/update/delete),
// NEVER in setDayLog — a sync/merge must not jolt this device's SafetyDashboard; the anchor travels cross-device
// via the PLAN-EVENTS channel (4c: emitPlanSets — was syncSettingsToNostr) instead, like a manual re-anchor.
// Distinct from cbCollateralBtc's continuous derive (that IS refreshed in setDayLog — a sum over ordered events,
// not a synced scalar). `removed` = the pre-mutation reading (deleted / date-moved) for the delete-fallback source
// proxy (nuance 5). Idempotent (deriveReadingAnchors returns an empty patch when nothing changed) → no redundant
// publish. The whole patch (≤3 anchor+AsOf pairs) rides ONE emitPlanSets → one shared ts (atomic; the AsOf halves
// can never tear from their values).
export function refreshBalanceAnchors(_set: StoreSet, get: StoreGet, removed?: ReadingMutationCtx): void {
  const s = get();
  const patch = deriveReadingAnchors(s.dayLog, {
    advisorActualBlocBalance: s.advisorActualBlocBalance, advisorActualBlocBalanceAsOf: s.advisorActualBlocBalanceAsOf,
    cbLoanBalance:            s.cbLoanBalance,            cbLoanBalanceAsOf:            s.cbLoanBalanceAsOf,
    cbLiquidationPrice:       s.cbLiquidationPrice,       cbLiquidationPriceAsOf:       s.cbLiquidationPriceAsOf,
  }, removed);
  if (Object.keys(patch).length === 0) return;
  get().emitPlanSets(Object.entries(patch) as [PlanField, unknown][]);
}

// The pre-mutation reading context for the delete-fallback proxy — only a balanceReading can be an anchor source.
export function readingCtx(ev: DayEvent | undefined): ReadingMutationCtx | undefined {
  if (!ev || ev.kind !== 'balanceReading') return undefined;
  return { oldDate: ev.date, strikeBal: ev.reading.strikeBal, cbBal: ev.reading.cbBal, cbLiqPrice: ev.reading.cbLiqPrice };
}

// A day event is "monthly-meaningful" if it can affect a monthlyLog entry. cbCollateralReading is clock-only, and a
// deposit/withdraw with target:'cb' is journal-only (CB collateral comes from the reading) — neither triggers a re-roll
// or keeps a month alive. Shared by monthOf + rerollMonth so the two can't drift (BUG1 class — a cb-only event must
// never flip a month to source:'daily').
export function isMonthlyMeaningful(ev: DayEvent): boolean {
  if (ev.kind === 'cbCollateralReading') return false;
  if ((ev.kind === 'deposit' || ev.kind === 'withdraw') && ev.target === 'cb') return false;
  return true;
}

// Re-roll ONE strategy month from the current dayLog → Partial→Full bridge → upsertLogEntry → Seam 1 collateral.
// Only monthly-meaningful events count (cbCollateralReading + target:'cb' moves are journal-only — never create/flip).
export function rerollMonth(get: StoreGet, month: number): void {
  const s = get();
  const start = s.advisorStartDate;
  const monthlyEvents = s.dayLog.filter((e) => isMonthlyMeaningful(e) && bucketEventToMonth(e.date, start) === month);
  const existing = s.monthlyLog.find((e) => e.month === month);

  if (monthlyEvents.length === 0) {
    // Emptied daily month → remove the stale rolled-up entry (only if it was daily-owned).
    if (existing && existing.source === 'daily') get().deleteLogEntry(month);
    return;
  }

  // priorStocks = the prior strategy-month's LAST balanceReading by ts (shared with the reconcile — no drift).
  const priorStocks = priorStocksForMonth(s.dayLog, start, month);

  const { entry: rollupEntry } = rollupMonth(s.dayLog, month, start, priorStocks);   // collateralDelta retired (v20) — Strike collateral is reading-anchored, not chained from rollup

  // Partial→Full bridge: spread the rollup onto the EXISTING month (preserve miningSats/ndpPaid/loggedAt), or onto a
  // full numeric seed for a NEW month (NEVER onto {} — would leave required fields undefined). recomputeBtcHeld (inside
  // upsertLogEntry) fixes the btcHeld:0 placeholder.
  const base: MonthlyLogEntry = existing ?? {
    month,
    date:           strategyMonthDate(start, month),
    btcBought:      0,
    income:         0,
    paydown:        0,
    strikeBal:      0,
    strikeLtv:      0,
    loggedAt:       monthlyEvents.reduce((mx, e) => Math.max(mx, e.ts), 0) || Date.now(),
    btcHeld:        0,
    expensesActual: 0,
  };
  const confirmed = base.confirmed === true ? false : (base.confirmed ?? false);   // reopen-on-edit (LD4); new = false
  get().upsertLogEntry({ ...base, ...rollupEntry, source: 'daily', confirmed });
  // Seam-1 retired (Collateral-Truth v20): target:'strike' moves feed getCurrentBtcHeld via deriveStrikeCollateral
  // (reading-anchored), not a pending adjustment. The mutators refresh strikeCollateralBtc directly.
}

// The strategy month a monthly-meaningful event affects (clock-only / journal-only events → null, no re-roll).
export function monthOf(get: StoreGet, ev: DayEvent | undefined): number | null {
  if (!ev || !isMonthlyMeaningful(ev)) return null;
  return bucketEventToMonth(ev.date, get().advisorStartDate);
}
