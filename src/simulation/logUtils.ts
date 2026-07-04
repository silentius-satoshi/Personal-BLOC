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
// startingBtcHeld reads the LIVE current position (last entry ANY confirmed status + pending, via
// deriveCurrentPosition) so the advisor seed and the SafetyDashboard collateral can never disagree —
// pendingCollateralAdjustment is a NOW-relative delta and must be added to the current anchor, never to a
// stale last-confirmed one (that produced negative collateral → 0.0% LTV → Buy $0 on device).
// startingBlocBalance/startingMonth stay anchored on the last CONFIRMED entry (so a living unconfirmed month
// doesn't advance the projection start).
export function deriveAdvisorStart(
  monthlyLog: MonthlyLogEntry[],
  advisorActualBtcHeld: number,
  advisorActualBlocBalance: number,   // forwarded to deriveCurrentPosition (position base only — startingBlocBalance still comes from monthStartBalance / last confirmed strikeBal)
  currentStrategyMonth: number,
  pendingCollateralAdjustment: number,
  monthStartBalance: number,   // BLOC balance at the START of the current month — projection base (NOT live drawn)
): {
  startingBlocBalance: number;
  startingBtcHeld:     number;
  startingMonth:       number;
} {
  // ONE definition of current position (shared with the safety anchors); pending is always now-relative.
  const position = deriveCurrentPosition(monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, pendingCollateralAdjustment);

  // Anchor bloc/month on CONFIRMED entries only — under one-ledger the current month is a LIVING unconfirmed daily
  // rollup (confirmed===false); it must NOT advance the projection start past itself. `confirmed !== false` keeps
  // legacy/undefined (=confirmed) + signed-off (true) entries and excludes only the living unconfirmed month.
  const confirmed = monthlyLog.filter((e) => e.confirmed !== false);
  if (confirmed.length === 0) {
    return {
      startingBlocBalance: monthStartBalance,   // start-of-month base; live-drawn (advisorActualBlocBalance) is a separate concept
      startingBtcHeld:     position.btcHeld,
      startingMonth:       currentStrategyMonth,
    };
  }
  const sorted = [...confirmed].sort((a, b) => a.month - b.month);
  const last = sorted[sorted.length - 1];
  return {
    startingBlocBalance: last.strikeBal,
    startingBtcHeld:     position.btcHeld,
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
 * UNclamped 1-based strategy-month index (may be <1 pre-start or >12 past-end) — CALENDAR-ANNIVERSARY
 * stepping from advisorStartDate (UTC). Month N spans [start+(N−1) months, start+N months). Day-of-month
 * clamps for 29/30/31 starts (start Jan 31 → the Feb anniversary is Feb 28/29). Both parsed at UTC-midnight
 * (the codebase's date-only-ISO convention; mirrors strategyMonthDate). THE single source both the clamped
 * bucket AND the >12 completion check use — replaced the old floor(elapsedDays/30.4375) day-arithmetic, which
 * pulled boundary days into the wrong month (e.g. a Jun-1 start bucketed Jul 1 = 30 elapsed days into Month 1).
 */
export function strategyMonthIndex(date: string, advisorStartDate: string): number {
  const d = new Date(date), s = new Date(advisorStartDate);            // both UTC-midnight
  let m = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + (d.getUTCMonth() - s.getUTCMonth());
  const daysInDMonth   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const anniversaryDay = Math.min(s.getUTCDate(), daysInDMonth);       // clamp start-day for short months
  if (d.getUTCDate() < anniversaryDay) m -= 1;                          // before this month's anniversary
  return m + 1;
}

/** Strategy month for a date, clamped to 1..12. */
export function bucketEventToMonth(date: string, advisorStartDate: string): number {
  return Math.min(Math.max(1, strategyMonthIndex(date, advisorStartDate)), 12);
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
  const collateralDelta = strikeCollateralDelta(dayLog, advisorStartDate, month);   // single definition (reused by the reconcile)
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
      case 'minPayment':
        // Balance-NEUTRAL: paying billed interest doesn't reduce principal. Sums to strikeMinPaid ONLY
        // (never paydown/balance); stocks still come from readings. Marks the source income (an event
        // only exists when the minimum is paid from income).
        entry.strikeMinPaid   = (entry.strikeMinPaid ?? 0) + ev.amount;
        entry.strikeMinSource = 'income';
        hasFlow = true;
        break;
      case 'deposit':
      case 'withdraw':
        if (ev.target === 'strike') hasFlow = true;   // collateralDelta summed once via strikeCollateralDelta (above)
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

/**
 * Net target:'strike' collateral BTC for a month (deposit +, withdraw −), bucketed by `bucketFn`. PURE.
 * The SINGLE definition of the strike-collateral summation — rollupMonth uses it (default bucket), and the
 * one-shot reconcile compares it under the new vs. the legacy bucket to catch a boundary collateral move
 * that no rollup-entry field would reveal (collateralDelta is returned separately from the entry).
 */
export function strikeCollateralDelta(
  dayLog: DayEvent[],
  advisorStartDate: string,
  month: number,
  bucketFn: (date: string, advisorStartDate: string) => number = bucketEventToMonth,
): number {
  let delta = 0;
  for (const ev of dayLog) {
    if ((ev.kind === 'deposit' || ev.kind === 'withdraw') && ev.target === 'strike'
        && bucketFn(ev.date, advisorStartDate) === month) {
      delta += ev.kind === 'withdraw' ? -ev.amount : ev.amount;   // amount = magnitude; sign by kind
    }
  }
  return delta;
}

/**
 * The prior strategy-month's LAST balanceReading stocks (by ts) — the carry-forward source for rollupMonth's
 * provisional path. Extracted so the store's rerollMonth AND the reconcile's diff compute identical priorStocks.
 */
export function priorStocksForMonth(
  dayLog: DayEvent[],
  advisorStartDate: string,
  month: number,
): { strikeBal: number; strikeLtv: number; cbBal?: number; cbLtv?: number; cbCollateral?: number } | undefined {
  const priorReadings = dayLog
    .filter((e): e is Extract<DayEvent, { kind: 'balanceReading' }> =>
      e.kind === 'balanceReading' && bucketEventToMonth(e.date, advisorStartDate) === month - 1)
    .sort((a, b) => a.ts - b.ts);
  const pr = priorReadings.length ? priorReadings[priorReadings.length - 1].reading : undefined;
  return pr
    ? { strikeBal: pr.strikeBal, strikeLtv: pr.strikeLtv, cbBal: pr.cbBal, cbLtv: pr.cbLtv, cbCollateral: pr.cbCollateral }
    : undefined;
}

// The rollup-owned keys a re-roll can change (everything rollupMonth may emit). btcHeld/collateralAdjustment/
// source/confirmed/loggedAt/ndpPaid/miningSats are store-owned, NOT compared here.
const ROLLUP_NUM_KEYS = ['expensesActual', 'btcBought', 'income', 'paydown', 'strikeMinPaid', 'strikeBal', 'strikeLtv', 'cbBal', 'cbLtv'] as const;

/**
 * True when the stored entry's rollup-owned fields already equal a fresh rollup (numbers normalized 0≡absent;
 * strikeMinSource/provisional strict). The reconcile's no-op guard — skip unchanged months (preserve confirmed,
 * no publish). `entry === undefined` ⇒ equal iff the fresh rollup is empty. Does NOT see collateralDelta (that's
 * compared separately — see strikeCollateralDelta).
 */
export function sameRollupFields(entry: MonthlyLogEntry | undefined, fresh: Partial<MonthlyLogEntry>): boolean {
  if (!entry) return Object.keys(fresh).length === 0;
  for (const k of ROLLUP_NUM_KEYS) if ((entry[k] ?? 0) !== (fresh[k] ?? 0)) return false;
  if ((entry.strikeMinSource ?? undefined) !== (fresh.strikeMinSource ?? undefined)) return false;
  if ((entry.provisional ?? undefined) !== (fresh.provisional ?? undefined)) return false;
  return true;
}

/**
 * ⚠ RECONCILE COMPARISON ONLY — the PRE-FIX floor(elapsedDays/30.4375) bucketing. Exported solely so the
 * one-shot reconcile can compare old-vs-new strike-collateral attribution. NEVER use this for live bucketing
 * (use bucketEventToMonth); do not reuse elsewhere.
 */
export const legacyBucketEventToMonth = (date: string, advisorStartDate: string): number =>
  Math.min(
    Math.max(1, Math.floor((new Date(date).getTime() - new Date(advisorStartDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)) + 1),
    12,
  );

/**
 * Single derived clock for cbCollateralBtc (Daily Mode P2a, Seam 2). Returns the cbCollateral of the MOST-RECENT event
 * by ts that carries one — across BOTH balanceReading (reading.cbCollateral, when present) AND cbCollateralReading
 * (cbCollateral). If none exists, falls back to the persisted cache `currentCbCollateralBtc` — NEVER undefined
 * (consumers like runAdvisor require a number).
 */
export function deriveCbCollateral(dayLog: DayEvent[], currentCbCollateralBtc?: number): number {
  let best: { ts: number; v: number } | null = null;
  for (const e of dayLog) {
    const v = e.kind === 'cbCollateralReading' ? e.cbCollateral
            : e.kind === 'balanceReading'      ? e.reading.cbCollateral
            : undefined;
    if (v !== undefined && (best === null || e.ts >= best.ts)) best = { ts: e.ts, v };
  }
  return best ? best.v : (currentCbCollateralBtc ?? 0);
}

/**
 * Collateral-Truth v20 — the READING-ANCHORED Strike-collateral derive (mirrors deriveCbCollateral, but
 * single-source: only balanceReading.reading.strikeCollateral — there is no strikeCollateralReading kind).
 * THE definition of current Strike collateral (getCurrentBtcHeld):
 *   anchor = the strikeCollateral-bearing balanceReading latest by (DATE, then ts) — same idiom as
 *            deriveReadingAnchors; result = anchor.strikeCollateral + Σ of target:'strike' deposit/withdraw
 *            moves STRICTLY AFTER the anchor (e.date > anchor.date, or e.date === anchor.date && e.ts >
 *            anchor.ts), signed by kind (deposit +, withdraw −; amount = magnitude — same convention as
 *            strikeCollateralDelta). No anchor → fallback ?? 0 (never undefined — runAdvisor needs a number).
 *
 * ⚠ Ordering differs from deriveCbCollateral's pure-ts on PURPOSE. A backfilled (past-dated) strike move
 * dated BEFORE the anchor is already reflected in that reading's stated total and must NOT be re-summed;
 * date-primary with a ts tiebreak encodes exactly that. And the ts tiebreak is STRICT (> not ≥) so an
 * atomic flow+reading sharing a ts (LD6 — the sheet emits the deposit and its reading with the same ts)
 * is NOT double-counted: the reading already states the post-move total. Buys are invisible by construction.
 */
export function deriveStrikeCollateral(dayLog: DayEvent[], fallback?: number): number {
  let anchor: Extract<DayEvent, { kind: 'balanceReading' }> | null = null;
  for (const e of dayLog) {
    if (e.kind !== 'balanceReading' || e.reading.strikeCollateral === undefined) continue;
    if (anchor === null || e.date > anchor.date || (e.date === anchor.date && e.ts > anchor.ts)) anchor = e;
  }
  if (anchor === null) return fallback ?? 0;

  let total = anchor.reading.strikeCollateral as number;
  for (const e of dayLog) {
    if ((e.kind === 'deposit' || e.kind === 'withdraw') && e.target === 'strike'
        && (e.date > anchor.date || (e.date === anchor.date && e.ts > anchor.ts))) {
      total += e.kind === 'withdraw' ? -e.amount : e.amount;   // amount = magnitude; sign by kind
    }
  }
  return total;
}

// §5b Readings-Unification — the live safety anchors + their freshness stamps.
export interface ReadingAnchorState {
  advisorActualBlocBalance:     number; advisorActualBlocBalanceAsOf: string | null;
  cbLoanBalance:                number; cbLoanBalanceAsOf:            string | null;
  cbLiquidationPrice:           number; cbLiquidationPriceAsOf:       string | null;
}
// Only the fields to write (empty = change nothing). asOf ← the source reading's DATE.
export interface ReadingAnchorPatch {
  advisorActualBlocBalance?:     number; advisorActualBlocBalanceAsOf?: string;
  cbLoanBalance?:                number; cbLoanBalanceAsOf?:            string;
  cbLiquidationPrice?:           number; cbLiquidationPriceAsOf?:       string;
}
// The reading removed/date-moved by the current mutation (the delete-fallback source proxy). `oldDate` +
// each pre-mutation value let deriveReadingAnchors tell "this reading WAS the anchor source" via date+value.
export interface ReadingMutationCtx { oldDate: string; strikeBal?: number; cbBal?: number; cbLiqPrice?: number }

/**
 * §5b Readings-Unification — PURE selector for the live safety anchors. Picks the DATE-latest surviving
 * balanceReading (ties → latest ts) and returns ONLY the anchor fields to write, each with asOf ← reading.date:
 *   strikeBal → advisorActualBlocBalance · cbBal → cbLoanBalance · cbLiqPrice → cbLiquidationPrice.
 * - Guard (normal add / forward-edit): apply a field only if reading.date ≥ that anchor's asOf (null asOf =
 *   never anchored → always apply). Manual/knob edits stamp asOf=today, so a stale reading can't clobber them.
 * - Orphan re-point (delete / backdate of the source): when `removed` WAS the source — proxied by
 *   (removed.oldDate === anchor.asOf AND removed.<field> === current anchor value; date + value, not date
 *   alone, so an unrelated same-day delete can't clobber a knob-set anchor with a different value) — re-point
 *   that field to the surviving date-latest reading UNCONDITIONALLY (fall off the deleted value). No surviving
 *   reading (or it lacks the field) → left unchanged (never nulled, never points at a deleted reading).
 * ⚠ Run this ONLY on local dayLog actions (add/update/delete) — NEVER on the sync/merge (setDayLog) path.
 */
export function deriveReadingAnchors(
  dayLog: DayEvent[],
  current: ReadingAnchorState,
  removed?: ReadingMutationCtx,
): ReadingAnchorPatch {
  let latest: Extract<DayEvent, { kind: 'balanceReading' }> | null = null;
  for (const e of dayLog) {
    if (e.kind !== 'balanceReading') continue;
    if (latest === null || e.date > latest.date || (e.date === latest.date && e.ts >= latest.ts)) latest = e;
  }
  const patch: ReadingAnchorPatch = {};
  if (latest === null) return patch;   // no readings → orphaned anchors keep their last value
  const R = latest;

  const apply = (
    candidate: number | undefined,
    curValue: number,
    curAsOf: string | null,
    removedField: number | undefined,
    setField: (v: number) => void,
    setAsOf: (d: string) => void,
  ): void => {
    if (candidate === undefined) return;   // this reading doesn't carry the field
    if (candidate === curValue && R.date === curAsOf) return;   // already anchored to this exact reading → no-op (idempotent seam, no redundant publish)
    const orphaned = removed !== undefined && removed.oldDate === curAsOf && removedField === curValue;
    if (orphaned || curAsOf === null || R.date >= curAsOf) { setField(candidate); setAsOf(R.date); }
  };

  apply(R.reading.strikeBal, current.advisorActualBlocBalance, current.advisorActualBlocBalanceAsOf,
    removed?.strikeBal, (v) => { patch.advisorActualBlocBalance = v; }, (d) => { patch.advisorActualBlocBalanceAsOf = d; });
  apply(R.reading.cbBal, current.cbLoanBalance, current.cbLoanBalanceAsOf,
    removed?.cbBal, (v) => { patch.cbLoanBalance = v; }, (d) => { patch.cbLoanBalanceAsOf = d; });
  apply(R.reading.cbLiqPrice, current.cbLiquidationPrice, current.cbLiquidationPriceAsOf,
    removed?.cbLiqPrice, (v) => { patch.cbLiquidationPrice = v; }, (d) => { patch.cbLiquidationPriceAsOf = d; });

  return patch;
}
