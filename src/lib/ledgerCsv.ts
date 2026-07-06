import type { MonthlyLogEntry } from '../simulation/types';

/**
 * Ledger data utilities (M-L1) — PURE, no React. Backs the Almanac Ledger face:
 *  - `ledgerFaceAvailable` — the data-presence gate (sub-nav self-hides + fallback-to-halving when empty).
 *  - `buildLedgerCsv` — a spreadsheet-ready CSV export of `monthlyLog` (Copy / Download buttons).
 * The Ledger WRITES NOTHING — this is projection + export only.
 */

/** Data-presence predicate: the Ledger face is only offered when there's at least one logged month.
 *  A safe viewer with an empty monthlyLog therefore never sees it. */
export function ledgerFaceAvailable(monthlyLog: MonthlyLogEntry[]): boolean {
  return monthlyLog.length > 0;
}

export interface LedgerCsvOpts {
  hasCbLoan: boolean;
  showMining: boolean;
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
 *   Mo, Date, Income→BTC, Paydown, BTC bought, Strike bal, Strike col, Strike LTV
 *   [+ CB bal, CB LTV  iff hasCbLoan] [+ Mining sats iff showMining]
 * Raw decimals (no $/₿/% ornament); `strikeLtv`/`cbLtv` stay the stored decimal (0.1483). Missing optional
 * cells → empty. CRLF line endings, no trailing newline, NO totals row (the totals live in the UI only).
 */
export function buildLedgerCsv(entries: MonthlyLogEntry[], opts: LedgerCsvOpts): string {
  const { hasCbLoan, showMining } = opts;

  const header = ['Mo', 'Date', 'Income→BTC', 'Paydown', 'BTC bought', 'Strike bal', 'Strike col', 'Strike LTV'];
  if (hasCbLoan) header.push('CB bal', 'CB LTV');
  if (showMining) header.push('Mining sats');

  // Real sort convention: single-key ascending by month (dayLog uses (ts,id); monthlyLog never does).
  const sorted = [...entries].sort((a, b) => a.month - b.month);

  const rows = sorted.map((e) => {
    const cells = [
      num(e.month),
      e.date ?? '',
      num(e.income),
      num(e.paydown),
      num(e.btcBought),
      num(e.strikeBal),
      num(e.btcHeld),
      num(e.strikeLtv),
    ];
    if (hasCbLoan) cells.push(num(e.cbBal), num(e.cbLtv));
    if (showMining) cells.push(num(e.miningSats));
    return cells;
  });

  return [header, ...rows]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n');
}
