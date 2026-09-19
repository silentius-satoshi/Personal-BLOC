// Pure form helpers shared by the two monthly-log editors (MonthlyLogSection + MonthlyLogOverlay). A .ts module on
// purpose — there is no render harness (zero .test.tsx), so logic left inside a .tsx cannot be tested.

import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';
import { bucketEventToMonth, priorStocksForMonth } from '../../simulation/logUtils';

/**
 * The editor's "Strike collateral" field → an entry fragment. MonthlyLogEntry.btcHeld is RECORDED Strike collateral:
 * a blank (or unparseable) field OMITS it — `{}` — and never writes 0, because 0 is a real position and nothing
 * recomputes the column any more to overwrite a placeholder. A typed "0" is a statement and records 0.
 * Used by the two WIDE forms (manual months). The daily-month correction uses parseCollateralInput instead.
 */
export function strikeColFragment(value: string): { btcHeld?: number } {
  const n = parseFloat(value);
  return value.trim() !== '' && Number.isFinite(n) ? { btcHeld: n } : {};
}

// Digits with at most ONE decimal separator ("." or "," — a comma-decimal locale types "0,42"; BTC amounts carry no
// thousands separators) and at most 8 decimals (a satoshi). No sign, no exponent, no trailing junk.
const COLLATERAL_INPUT = /^(?:\d+(?:[.,]\d{0,8})?|[.,]\d{1,8})$/;
const MAX_BTC = 21_000_000;

/**
 * The daily-month correction's raw text → a BTC amount, or null when it isn't one. STRICT, unlike parseFloat:
 * "0.42abc", "-1", "1e-3", "1,000.5", "0..4" and anything over 8 decimals or 21M → null. Blank → null too.
 * ⚠ null NEVER means "clear the record" — the caller disables Save instead. Clearing is its own explicit button
 *   (collateralCorrection(e, null)). A type="number" input would hand React '' for ANY unparseable entry, so the
 *   field that feeds this is type="text" inputMode="decimal": a typo can never silently delete the month's btcHeld.
 */
export function parseCollateralInput(value: string): number | null {
  const t = value.trim();
  if (!COLLATERAL_INPUT.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n <= MAX_BTC ? n : null;
}

/**
 * A daily-owned month's collateral correction: the EXISTING entry with only btcHeld replaced — or REMOVED when
 * `btcHeld` is null (the explicit "Clear record" button). Everything else, `source` included, is carried through.
 * ⚠ Never override `source`. The entry is daily, so the spread already carries `source: 'daily'` and the M2 guard
 *   (advisorJournalSlice upsertLogEntry) is satisfied rather than bypassed. A forced `source: 'daily'` would silently
 *   flip a manual month to daily-owned (permanently read-only) if this were ever called on one.
 * ⚠ `confirmed` and `loggedAt` are preserved: correcting a record is not editing the month's activity, and btcHeld is
 *   not a figure the sign-off attests (upsertLogEntry never touches `confirmed`; it stamps `updatedAt` itself).
 */
export function collateralCorrection(entry: MonthlyLogEntry, btcHeld: number | null): MonthlyLogEntry {
  const next: MonthlyLogEntry = { ...entry };
  if (btcHeld === null) delete next.btcHeld;   // spreading {} would NOT remove the key
  else next.btcHeld = btcHeld;
  return next;
}

/**
 * How long a hand-entered btcHeld on a daily month survives:
 *  - stated  — the LATEST in-month reading states strikeCollateral; the next re-roll stamps it (the correction can't hold).
 *  - stable  — the next re-roll leaves btcHeld absent, so rerollMonth's bridge keeps the correction.
 *  - fragile — no in-month reading, and the prior month's latest reading states collateral: the carry-forward stamps it.
 */
export type CorrectionDurability = 'stated' | 'stable' | 'fragile';

/**
 * What the NEXT re-roll of `month` does to a hand-entered btcHeld — mirrors rollupMonth's branch choice exactly:
 * the LATEST in-month balanceReading by ts (the same `b.ts >= a.ts ? b : a` rule) decides stated/stable; with no
 * in-month reading, priorStocksForMonth (the exact priorStocks rerollMonth passes) decides fragile/stable.
 * (A daily month with no in-month reading always holds a flow, so the carry-forward's `hasFlow` condition holds.)
 * ⚠ It describes the next re-roll GIVEN TODAY'S dayLog: deleting the month's reading, or backfilling a prior-month
 *   reading that states collateral, moves the month to `fragile` — which is why DURABILITY_HINT.stable names both.
 * ⚠ If rollupMonth's reading selection or carry-forward ever changes, this must change with it — the store tests
 *   tie the classifier to real re-rolls.
 */
export function correctionDurability(dayLog: DayEvent[], advisorStartDate: string, month: number): CorrectionDurability {
  const readings = dayLog.filter((e): e is Extract<DayEvent, { kind: 'balanceReading' }> =>
    e.kind === 'balanceReading' && bucketEventToMonth(e.date, advisorStartDate) === month);
  if (readings.length > 0) {
    const latest = readings.reduce((a, b) => (b.ts >= a.ts ? b : a));
    return latest.reading.strikeCollateral !== undefined ? 'stated' : 'stable';
  }
  return priorStocksForMonth(dayLog, advisorStartDate, month)?.strikeCollateral !== undefined ? 'fragile' : 'stable';
}

/** The line shown with a daily month's collateral correction — what will (and won't) keep the figure. */
export const DURABILITY_HINT: Record<CorrectionDurability, string> = {
  stated:  "Set by this month's balance reading — edit that reading in the Ledger to change it.",
  stable:  'Your entry stays until a balance reading states collateral — in this month, or in last month while this month has none.',
  fragile: "This month has no balance reading — logging or editing an event here will replace your entry with last month's figure.",
};
