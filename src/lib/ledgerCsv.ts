import type { DayEvent, MonthlyLogEntry } from '../simulation/types';
import { bucketEventToMonth } from '../simulation/logUtils';

/**
 * Ledger data utilities (M-L1) — PURE, no React. Backs the Almanac Ledger face:
 *  - `ledgerFaceAvailable` — the data-presence gate (sub-nav self-hides + fallback-to-halving when empty).
 *  - `buildLedgerCsv` — a spreadsheet-ready CSV export of `monthlyLog` (Copy / Download buttons).
 *  - `coldMovedByMonth` / `hasColdColumn` — the computed "→ Cold" column.
 * The Ledger WRITES NOTHING — this is projection + export only.
 */

/** Data-presence predicate: the Ledger face is only offered when there's at least one logged month.
 *  A safe viewer with an empty monthlyLog therefore never sees it. */
export function ledgerFaceAvailable(monthlyLog: MonthlyLogEntry[]): boolean {
  return monthlyLog.length > 0;
}

/**
 * Net BTC moved INTO cold storage per strategy month: deposit target:'cold' adds, withdraw target:'cold' subtracts,
 * 'strike'/'cb' moves are ignored. A month with no cold activity is ABSENT.
 * ⚠ COMPUTED at render from the dayLog, NEVER stored on MonthlyLogEntry. Cold moves are journal-only
 * (isMonthlyMeaningful) — they never re-roll a month — so a stored figure would go stale by construction, and making
 * them re-roll would reopen signed months (the BUG1 class). It explains the gap between "BTC bought" and "Strike col".
 */
export function coldMovedByMonth(dayLog: DayEvent[], advisorStartDate: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const ev of dayLog) {
    if ((ev.kind === 'deposit' || ev.kind === 'withdraw') && ev.target === 'cold') {
      const m = bucketEventToMonth(ev.date, advisorStartDate);
      out[m] = (out[m] ?? 0) + (ev.kind === 'withdraw' ? -ev.amount : ev.amount);   // amount = magnitude; sign by kind
    }
  }
  return out;
}

/** The → Cold column shows only when a month that HAS a ledger row moved a non-zero amount — an owner with no cold
 *  activity (and every viewer, whose dayLog is []) sees no new column. */
export function hasColdColumn(entries: MonthlyLogEntry[], coldByMonth: Record<number, number> | undefined): boolean {
  if (!coldByMonth) return false;
  return entries.some((e) => (coldByMonth[e.month] ?? 0) !== 0);
}

export interface LedgerCsvOpts {
  hasCbLoan: boolean;
  showMining: boolean;
  /** Net BTC into cold per month (coldMovedByMonth). Omitted → no → Cold column. */
  coldByMonth?: Record<number, number>;
}

/** RFC-4180 cell escaping: wrap in double quotes + double any embedded quote when the value contains
 *  a comma, quote, CR or LF. ISO dates and raw numbers never trigger it, but the guard is cheap + correct. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** A number → raw-decimal string; `undefined`/`null` (legacy-missing optional cell) → empty string. */
function num(value: number | undefined | null): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Build the Ledger CSV. Columns mirror the visible table (plus an ISO `Date` column so spreadsheets get a
 * sortable calendar date alongside the integer `Mo`):
 *   Mo, Date, Income→BTC, Paydown, BTC bought, Strike bal, Strike col, [→ Cold iff hasColdColumn], Strike LTV
 *   [+ CB bal, CB LTV  iff hasCbLoan] [+ Mining sats iff showMining]
 * Raw decimals (no $/₿/% ornament); `strikeLtv`/`cbLtv` stay the stored decimal (0.1483). Missing optional
 * cells → empty (an unrecorded Strike col is empty, never 0). CRLF line endings, no trailing newline, NO totals row
 * (the totals live in the UI only).
 */
export function buildLedgerCsv(entries: MonthlyLogEntry[], opts: LedgerCsvOpts): string {
  const { hasCbLoan, showMining, coldByMonth } = opts;

  // Real sort convention: single-key ascending by month (dayLog uses (ts,id); monthlyLog never does).
  const sorted = [...entries].sort((a, b) => a.month - b.month);
  const showCold = hasColdColumn(sorted, coldByMonth);

  const header = ['Mo', 'Date', 'Income→BTC', 'Paydown', 'BTC bought', 'Strike bal', 'Strike col'];
  if (showCold) header.push('→ Cold');
  header.push('Strike LTV');
  if (hasCbLoan) header.push('CB bal', 'CB LTV');
  if (showMining) header.push('Mining sats');

  const rows = sorted.map((e) => {
    const cells = [
      num(e.month),
      e.date ?? '',
      num(e.income),
      num(e.paydown),
      num(e.btcBought),
      num(e.strikeBal),
      num(e.btcHeld),
    ];
    if (showCold) cells.push(num(coldByMonth?.[e.month]));
    cells.push(num(e.strikeLtv));
    if (hasCbLoan) cells.push(num(e.cbBal), num(e.cbLtv));
    if (showMining) cells.push(num(e.miningSats));
    return cells;
  });

  return [header, ...rows]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n');
}
