// Daily-routing helpers (Phase 1c) — moved verbatim out of the store module. Store-touching helpers receive zustand's
// set/get (so this file never imports the composed store — the cycle rule); pure ones are unchanged. The only body
// change is getState()→get() / setState()→set(). Called from the dayLog + monthlyLog slice actions (which pass set/get).
import type { StoreSet, StoreGet } from './types';
import type { PlanField } from './settingsFields';
import type { DayEvent, MonthlyLogEntry } from '../simulation/types';
import { bucketEventToMonth, rollupMonth, flowVenue, deriveCbCollateral, deriveStrikeCollateral, deriveReadingAnchors, priorStocksForMonth, type ReadingMutationCtx } from '../simulation/logUtils';

// ISO first-day of a strategy month (month 1 = advisorStartDate's month). advisorStartDate is a
// date-only 'yyyy-mm-dd' string → new Date(...) parses it at UTC MIDNIGHT (JS spec). The output feeds
// bucketEventToMonth/calendarModel's UTC-string calendar-date convention, so this stays UTC-consistent
// throughout (UTC accessors, not local) — mixing local getMonth/setMonth with a UTC-parsed input was the
// bug (an off-by-one near month boundaries in behind-UTC zones).
function strategyMonthDate(advisorStartDate: string, month: number): string {
  const start = new Date(advisorStartDate);
  const targetMonth = start.getUTCMonth() + (month - 1);
  const year = start.getUTCFullYear() + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(start.getUTCDate(), new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().split('T')[0];
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
// deposit/withdraw is meaningful ONLY with target:'strike' — target:'cb' is journal-only (CB collateral comes from the
// reading) and target:'cold' is journal-only (cold feeds deriveColdStorage, never the rollup). A draw/paydown with
// target:'cb' is journal-only too (a Coinbase borrow/paydown; CB debt comes from the reading). None of them triggers a
// re-roll or keeps a month alive. Shared by monthOf + rerollMonth so the two can't drift (BUG1 class — a cb- or
// cold-only event must never create a month, flip a manual month to source:'daily', or reopen a confirmed one).
// ⚠ This is ONE of TWO guards for CB draw/paydown, and it does NOT prevent corruption: rerollMonth only uses it for
// the empty check, then hands rollupMonth the FULL dayLog. The target skip inside rollupMonth keeps a CB flow's amount
// out of expensesActual/paydown; this line keeps a CB flow from creating, flipping or reopening a month. Keep both.
export function isMonthlyMeaningful(ev: DayEvent): boolean {
  if (ev.kind === 'cbCollateralReading') return false;
  if ((ev.kind === 'deposit' || ev.kind === 'withdraw') && ev.target !== 'strike') return false;
  if ((ev.kind === 'draw' || ev.kind === 'paydown') && flowVenue(ev) !== 'strike') return false;
  return true;
}

// 5d (BL13) — an edit that can change only a buy's DOLLARS: both events are buys with the same id, date and BTC (a re-save
// with nothing changed counts too). The month's review shows the buy's bitcoin ("Bought bitcoin +₿X"), never its dollars:
// they feed only Income → BTC (the Ledger, the month log, the CSV). So rerollMonth's `dollarsOnly` path writes Income →
// BTC alone and keeps the sign-off — correcting a buy logged days late costs no re-sign, and a re-sign would re-stamp its
// settings side effects with the re-sign day. Every other edit re-rolls the month and reopens it (LD4), as before.
export function buyDollarsOnlyEdit(before: DayEvent | undefined, after: DayEvent): boolean {
  return before !== undefined && before.kind === 'buy' && after.kind === 'buy' && before.id === after.id
    && before.date === after.date && before.amount === after.amount;
}

// 5d — the dollars-only path writes onto the month's stored entry as it stands, so that entry must be CURRENT: it has
// absorbed every monthly-meaningful event of its month. A pull applies events and entries raw (sync.ts — no re-roll),
// so a device can hold an event without its month's re-rolled entry. Two signs of a lag, either one enough: an event in
// the month newer than the entry's last save (updatedAt, else loggedAt — the merge's own fallback); or BTC bought that
// isn't the events' (no sign-off records its own, and a dollars-only edit can't change it). A month that isn't
// daily-owned, or isn't logged, isn't current either. Not current → the full path, as before 5d: rebuilt, and reopened.
export function monthEntryCurrent(get: StoreGet, month: number): boolean {
  const s = get();
  const start = s.advisorStartDate;
  const entry = s.monthlyLog.find((e) => e.month === month);
  if (!entry || entry.source !== 'daily') return false;
  const savedAt = entry.updatedAt ?? entry.loggedAt;
  const inMonth = s.dayLog.filter((e) => isMonthlyMeaningful(e) && bucketEventToMonth(e.date, start) === month);
  if (inMonth.some((e) => e.ts > savedAt)) return false;
  const { entry: fresh } = rollupMonth(s.dayLog, month, start);
  return Math.abs((entry.btcBought ?? 0) - (fresh.btcBought ?? 0)) <= 1e-9;
}

// Re-roll ONE strategy month from the current dayLog → Partial→Full bridge → upsertLogEntry → Seam 1 collateral.
// Only monthly-meaningful events decide whether the month exists (cbCollateralReading, target:'cb'/'cold' moves and
// target:'cb' draw/paydown are journal-only — never create/flip). The rollup itself reads the full dayLog and skips
// the journal-only kinds on its own. `dollarsOnly` (5d) — set by updateDayEvent only for a dollars-only buy edit
// (buyDollarsOnlyEdit) on a month whose stored entry is current (monthEntryCurrent) — writes only Income → BTC onto it.
export function rerollMonth(get: StoreGet, month: number, opts?: { dollarsOnly?: boolean }): void {
  const s = get();
  const start = s.advisorStartDate;
  const monthlyEvents = s.dayLog.filter((e) => isMonthlyMeaningful(e) && bucketEventToMonth(e.date, start) === month);
  const existing = s.monthlyLog.find((e) => e.month === month);

  if (monthlyEvents.length === 0) {
    // Emptied daily month → remove the stale rolled-up entry (only if it was daily-owned).
    if (existing && existing.source === 'daily') get().deleteLogEntry(month);
    return;
  }

  // priorStocks = the prior strategy-month's LAST balanceReading by date, then orderTs (shared with the reconcile — no drift).
  const priorStocks = priorStocksForMonth(s.dayLog, start, month);

  const { entry: rollupEntry } = rollupMonth(s.dayLog, month, start, priorStocks);   // collateralDelta retired (v20) — Strike collateral is reading-anchored, not chained from rollup

  // 5d (D1) — a dollars-only buy edit on a current entry can move Income → BTC alone, so only Income → BTC is written: the
  // month's sign-off, and every figure the sign-off recorded (expenses actually paid, the minimum, the NDP, a hand-entered
  // collateral), stay as they are. ⚠ Never the full spread here: it would overwrite those with the rollup's (the review
  // rounds its seeds, and the owner may change them) while the month stayed signed — figures nobody signed.
  if (opts?.dollarsOnly && existing) {
    get().upsertLogEntry({ ...existing, income: rollupEntry.income ?? existing.income });
    return;
  }

  // Partial→Full bridge: spread the rollup onto the EXISTING month (preserve miningSats/ndpPaid/loggedAt/btcHeld), or
  // onto a full numeric seed for a NEW month (NEVER onto {} — would leave required fields undefined). ⚠ The seed carries
  // NO btcHeld: Strike collateral is RECORDED only when the month's reading states it (rollupMonth stamps it). A 0 here
  // would record a false position — nothing recomputes the column any more to overwrite a placeholder.
  const base: MonthlyLogEntry = existing ?? {
    month,
    date:           strategyMonthDate(start, month),
    btcBought:      0,
    income:         0,
    paydown:        0,
    strikeBal:      0,
    strikeLtv:      0,
    loggedAt:       monthlyEvents.reduce((mx, e) => Math.max(mx, e.ts), 0) || Date.now(),
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
