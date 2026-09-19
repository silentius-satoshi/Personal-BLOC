import type { DayEvent, MonthlyLogEntry } from '../simulation/types';
import { bucketEventToMonth } from '../simulation/logUtils';

/**
 * Ledger data utilities (M-L1) — PURE, no React. Backs the Almanac Ledger face:
 *  - `ledgerFaceAvailable` — the data-presence gate (sub-nav self-hides + fallback-to-halving when empty).
 *  - `buildLedgerCsv` — a spreadsheet-ready CSV export of `monthlyLog` (Copy / Download buttons).
 *  - `coldMovedByMonth` / `hasColdColumn` / `coldTotals` / `coldFootnote` / `fmtColdBtc` — the computed "→ Cold"
 *    column, its row-scoped total, and the disclosure line for cold movement in months with no row.
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

/** Half a satoshi. Cold nets below this are float residue (0.1 − 0.04 − 0.06 = 6.9e-18), not movement. ONE constant for
 *  every cold gate — the column, the totals and the footnote must treat a given value identically. */
export const COLD_EPS = 5e-9;

/** The → Cold column shows only when a month that HAS a ledger row moved a real amount (≥ COLD_EPS) — an owner with no
 *  cold activity (and every viewer, whose dayLog is []) sees no new column. */
export function hasColdColumn(entries: MonthlyLogEntry[], coldByMonth: Record<number, number> | undefined): boolean {
  if (!coldByMonth) return false;
  return entries.some((e) => Math.abs(coldByMonth[e.month] ?? 0) >= COLD_EPS);
}

/**
 * The → Cold column split two ways: `logged` is cold movement in months WITH a ledger row (the sum of the visible cells,
 * so the column foots); `unlogged` is movement in months with no row at all. Each half below COLD_EPS snaps to 0 — which
 * also stops a residue total rendering as "-0.00000".
 * ⚠ The total stays ROW-SCOPED on purpose: a totals cell that isn't the sum of the cells above it can't be checked. The
 *   remainder is DISCLOSED (coldFootnote), the way a reconciling item is.
 * ⚠ INVARIANT: logged + unlogged equals the sum of every value in coldByMonth, to within COLD_EPS per half.
 */
export function coldTotals(entries: MonthlyLogEntry[], coldByMonth: Record<number, number> | undefined):
  { logged: number; unlogged: number } {
  if (!coldByMonth) return { logged: 0, unlogged: 0 };
  const hasRow = new Set(entries.map((e) => e.month));
  let logged = 0;
  let unlogged = 0;
  // Iterate coldByMonth, NOT entries — a month can move cold without having a row, which is the whole point.
  for (const [m, v] of Object.entries(coldByMonth)) {
    if (hasRow.has(Number(m))) logged += v;
    else unlogged += v;
  }
  const snap = (n: number) => (Math.abs(n) < COLD_EPS ? 0 : n);
  return { logged: snap(logged), unlogged: snap(unlogged) };
}

/** A cold figure for display. 5 dp like the rest of the Ledger, but widened to 8 dp (satoshi precision) whenever 5 dp
 *  would print a real move as zero — a 300-sat move must read 0.00000300, never "0.00000" or "-0.00000". An exact 0
 *  (a total that nets out, or a snapped residue) reads "0.00000". Per-month cells snap |n| < COLD_EPS to "—" before
 *  calling this; the TOTAL never does — a column that nets to zero totals ₿0.00000, not "—". */
export function fmtColdBtc(n: number): string {
  if (n === 0) return '0.00000';   // also -0 (=== 0), so a sign can never leak
  return Number(n.toFixed(5)) === 0 ? n.toFixed(8) : n.toFixed(5);
}

/** The disclosure line for cold movement outside the table, or null when there is none (|unlogged| < COLD_EPS).
 *  `columnShown` = hasColdColumn(...). With a column: "‡ …— not in the total above." Without one there is no total
 *  and nothing to anchor, so the line has no ‡ and says the months have no row. Figure = fmtColdBtc(|unlogged|). */
export function coldFootnote(unlogged: number, columnShown: boolean): string | null {
  if (Math.abs(unlogged) < COLD_EPS) return null;
  const x = fmtColdBtc(Math.abs(unlogged));
  const dir = unlogged > 0 ? 'moved to cold' : 'moved out of cold';
  return columnShown
    ? `‡ ${x} ₿ ${dir} in months with no logged activity — not in the total above.`
    : `${x} ₿ ${dir} in months with no logged activity — those months have no row here.`;
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
