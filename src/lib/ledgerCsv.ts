import type { DayEvent, MonthlyLogEntry } from '../simulation/types';
import { bucketEventToMonth } from '../simulation/logUtils';

/**
 * Ledger data utilities (M-L1) — PURE, no React. Backs the Almanac Ledger face:
 *  - `ledgerFaceAvailable` — the data-presence gate (the grid's tile hides + an open Ledger falls back to the grid when
 *    empty — BL45; the sub-nav pill and the Halving Clock before).
 *  - `buildLedgerCsv` — a spreadsheet-ready CSV export of `monthlyLog` (Copy / Download buttons).
 *  - `coldMovedByMonth` / `hasColdColumn` / `coldTotals` / `coldFootnote` / `fmtColdBtc` — the computed "→ Cold"
 *    column (shown when none is logged or this device can place a move — BL49), its row-scoped total, and the
 *    disclosure line for cold movement in months with no row.
 *  - `coldMovedOf` / `coldMovesFromSnapshot` — the column's months on this device: the owner's journal, or a trusted
 *    viewer's copy of them from the owner's snapshot (BL48).
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

/**
 * BL48 (V2 A) — the → Cold column's months on THIS device. The owner works them out from his journal; a trusted viewer,
 * whose journal is empty, reads the owner's — worked out on the owner's device and sent in the trusted snapshot
 * (`coldMovedByMonth`, payloads.ts), as the cold total and the Strike deposit date already are. ONE rule, as
 * `strikeDepositOf` reads the hold: the Ledger face reads it for its column, its totals and its CSV. A viewer without
 * them — a safe viewer is never sent them, and an older owner's snapshot has none — gets null: no column (BL49 — a zero
 * the device doesn't know isn't a zero). An owner who logged none sends an empty map: the column, at zero.
 */
export function coldMovedOf(st: {
  viewerMode: boolean; viewerColdMovedByMonth: Record<number, number> | null; dayLog: DayEvent[]; advisorStartDate: string;
}): Record<number, number> | null {
  return st.viewerMode ? st.viewerColdMovedByMonth : coldMovedByMonth(st.dayLog, st.advisorStartDate);
}

/**
 * BL49 v1.1 — a month the device can place: its key reads back as a whole month ≥ 1 (JSON turns each month into a
 * string) and its figure is a finite number. ONE rule for the viewer's copy (`coldMovesFromSnapshot` keeps only these)
 * and the column's gate (`hasColdColumn` asks for one), so the owner's Ledger and his viewer's show "→ Cold" on the same
 * snapshots. A blank start date or an unreadable event date buckets to NaN (`bucketEventToMonth`), a move with no
 * amount sums to NaN, and amounts past ~1.8e308 to Infinity, which JSON can't carry — none is placed.
 */
function coldMonthOk(k: string, v: unknown): v is number {
  const m = Number(k);
  return Number.isInteger(m) && m >= 1 && typeof v === 'number' && Number.isFinite(v);
}

/**
 * The snapshot's months as a viewer stores them (viewerSync's trusted apply): the months `coldMonthOk` places; anything
 * else is dropped. An empty map — the owner logged no cold move — stays empty: the column, at zero (BL49). A snapshot
 * with no such field, or a map with nothing placed in it, gives null: no column.
 */
export function coldMovesFromSnapshot(v: unknown): Record<number, number> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const sent = Object.entries(v as Record<string, unknown>);
  const out: Record<number, number> = {};
  for (const [k, val] of sent) {
    if (coldMonthOk(k, val)) out[Number(k)] = val;
  }
  return sent.length === 0 || Object.keys(out).length > 0 ? out : null;
}

/** Half a satoshi. Cold nets below this are float residue (0.1 − 0.04 − 0.06 = 6.9e-18), not movement. ONE constant for
 *  every cold gate — the cells, the totals and the footnote must treat a given value identically. */
export const COLD_EPS = 5e-9;

/** BL49 (the owner's call A) — the → Cold column shows whenever this device knows the cold moves: on the owner's, his
 *  journal's — none logged included, an empty map; on a trusted viewer's whenever the owner's snapshot carried them, an
 *  empty map included (`coldMovedOf`). A quiet month reads "—" and the total ₿0.00000 — never a column of zeros. Not for
 *  a viewer whose snapshot carried none (an older owner build): a zero the device doesn't know isn't a zero. Nor (v1.1)
 *  for moves it can't place: a map with no month `coldMonthOk` places has no column, and the viewer's copy of it is
 *  none — as before BL49, but for an infinite figure, which the owner's Ledger alone showed (the owner's call, v1.2).
 *  The gate asks of the owner's map what the viewer's copy keeps of it: the two Ledgers agree by construction. */
export function hasColdColumn(coldByMonth: Record<number, number> | null | undefined): boolean {
  if (coldByMonth == null) return false;
  const months = Object.entries(coldByMonth);
  return months.length === 0 || months.some(([k, v]) => coldMonthOk(k, v));
}

/**
 * The → Cold column split two ways: `logged` is cold movement in months WITH a ledger row (the sum of the visible cells,
 * so the column foots); `unlogged` is movement in months with no row at all. Each half below COLD_EPS snaps to 0 — which
 * also stops a residue total rendering as "-0.00000".
 * ⚠ The total stays ROW-SCOPED on purpose: a totals cell that isn't the sum of the cells above it can't be checked. The
 *   remainder is DISCLOSED (coldFootnote), the way a reconciling item is.
 * ⚠ INVARIANT: logged + unlogged equals the sum of every value in coldByMonth, to within COLD_EPS per half.
 */
export function coldTotals(entries: MonthlyLogEntry[], coldByMonth: Record<number, number> | null | undefined):
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
  /** Net BTC into cold per month (coldMovedOf). Omitted or null → no → Cold column; a map → as `hasColdColumn` says (an
   *  empty one → the column, BL49). */
  coldByMonth?: Record<number, number> | null;
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

/** Sweep 2b, F2 — a dollar cell to the cent and a coin cell to the satoshi, as a spreadsheet reads them: a "." whatever the
 *  device's language, no grouping, no exponent, no trailing zeros, rounded half-up as the screen rounds. A sum of cents
 *  that `String` printed `1334.6599999999999` reads `1334.66`; a coin figure it printed `5e-7` reads `0.0000005`. A −0 —
 *  a tiny negative rounded away included — prints `0`. Empty for `undefined`/`null`, as `num`; a figure that isn't a
 *  finite number (broken data only) prints as `num` prints it. */
const CSV_USD = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 2 });
const CSV_BTC = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 8 });
function decimalCell(f: Intl.NumberFormat, value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return num(value);
  const s = f.format(value);
  return s === '-0' ? '0' : s;
}
const usdCell = (v: number | undefined | null): string => decimalCell(CSV_USD, v);
const btcCell = (v: number | undefined | null): string => decimalCell(CSV_BTC, v);
/** The → Cold cell: a month whose moves net to float residue (|n| < COLD_EPS) reads empty, as the face's "—" (BL49's
 *  follow-up); a quiet month has no figure, so it reads empty too. */
const coldCell = (v: number | undefined): string => (v !== undefined && Math.abs(v) < COLD_EPS ? '' : btcCell(v));

/**
 * Build the Ledger CSV. Columns mirror the visible table (plus an ISO `Date` column so spreadsheets get a
 * sortable calendar date alongside the integer `Mo`):
 *   Mo, Date, Income→BTC, Paydown, BTC bought, Strike bal, Strike col, [→ Cold iff hasColdColumn — none logged, or a
 *   month placed: BL49], Strike LTV
 *   [+ CB bal, CB LTV  iff hasCbLoan] [+ Mining sats iff showMining]
 * Decimals with no ornament ($/₿/%): dollars to the cent and coins to the satoshi (`usdCell`, `btcCell` — Sweep 2b,
 * F2); `strikeLtv`/`cbLtv` stay the stored decimal (0.1483), and Mo and Mining sats as stored (`num`). Missing optional
 * cells → empty (an unrecorded Strike col is empty, never 0), and so is a month whose cold moves net to float residue,
 * as the face's "—". CRLF line endings, no trailing newline, NO totals row (the totals live in the UI only).
 */
export function buildLedgerCsv(entries: MonthlyLogEntry[], opts: LedgerCsvOpts): string {
  const { hasCbLoan, showMining, coldByMonth } = opts;

  // Real sort convention: single-key ascending by month (dayLog uses (ts,id); monthlyLog never does).
  const sorted = [...entries].sort((a, b) => a.month - b.month);
  const showCold = hasColdColumn(coldByMonth);

  const header = ['Mo', 'Date', 'Income→BTC', 'Paydown', 'BTC bought', 'Strike bal', 'Strike col'];
  if (showCold) header.push('→ Cold');
  header.push('Strike LTV');
  if (hasCbLoan) header.push('CB bal', 'CB LTV');
  if (showMining) header.push('Mining sats');

  const rows = sorted.map((e) => {
    const cells = [
      num(e.month),
      e.date ?? '',
      usdCell(e.income),
      usdCell(e.paydown),
      btcCell(e.btcBought),
      usdCell(e.strikeBal),
      btcCell(e.btcHeld),
    ];
    if (showCold) cells.push(coldCell(coldByMonth?.[e.month]));
    cells.push(num(e.strikeLtv));
    if (hasCbLoan) cells.push(usdCell(e.cbBal), num(e.cbLtv));
    if (showMining) cells.push(num(e.miningSats));
    return cells;
  });

  return [header, ...rows]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n');
}
