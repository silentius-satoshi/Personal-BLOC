// Pure date model for the Daily Mode calendar (P4c-1a). Standalone — NO store/UI/price dependency
// (only imports the pure bucketEventToMonth helper + the DayEvent type, mirroring dailyView.ts).
//
// CRITICAL: the month range uses bucketEventToMonth's STRATEGY-month definition (~30.4375 days from
// advisorStartDate) — NOT calendar months — so a day's cell and the events bucketed to that month agree.
// All date math is UTC-based: bucketEventToMonth parses 'yyyy-mm-dd' via new Date(iso) = UTC midnight, so
// we enumerate via getTime() + N*86400000, format back with toISOString().split('T')[0], and derive the
// weekday via getUTCDay() (getDay() would drift a day in tz-behind-UTC locales).
import { bucketEventToMonth } from '../../simulation/logUtils';
import type { DayEvent } from '../../simulation/types';

export type PipKind = 'logged' | 'reading' | 'cbCollateral';

export interface DayCell {
  date:    string;      // ISO yyyy-mm-dd
  day:     number;      // day-of-month (1–31)
  weekday: number;      // Mon=0 … Sun=6
  pips:    PipKind[];
}

const DAY_MS = 86_400_000;
const STRATEGY_MONTH_DAYS = 30.4375;

// ISO 'yyyy-mm-dd' → ms at UTC midnight (matches bucketEventToMonth's new Date(iso) parse).
const isoToUtcMs = (iso: string): number => new Date(iso).getTime();
// ms → ISO 'yyyy-mm-dd' (UTC). toISOString is always UTC, so no local-tz drift.
const utcMsToIso = (ms: number): string => new Date(ms).toISOString().split('T')[0];
// weekday for a UTC-midnight date, Monday-anchored (Sun=0→6, Mon=1→0, … Sat=6→5).
const utcWeekdayMon0 = (iso: string): number => (new Date(iso).getUTCDay() + 6) % 7;

/**
 * Ascending ISO dates d for which bucketEventToMonth(d, advisorStartDate) === month.
 * Enumerates a safe day-offset window around [(month-1)*30.4375, month*30.4375) and keeps only dates that
 * bucket to `month` — the bucket-filter self-corrects the boundaries; iteration order gives ascending +
 * contiguous. A strategy month spans ~30–31 calendar days.
 */
export function monthDateRange(advisorStartDate: string, month: number): string[] {
  const startMs = isoToUtcMs(advisorStartDate);
  // Clamp the low bound to 0 — never enumerate before advisorStartDate. bucketEventToMonth clamps to min 1,
  // so pre-start days would otherwise also bucket to month 1 and leak in (month 1 must begin exactly at start).
  const loOffset = Math.max(0, Math.floor((month - 1) * STRATEGY_MONTH_DAYS) - 2);
  const hiOffset = Math.ceil(month * STRATEGY_MONTH_DAYS) + 2;
  const out: string[] = [];
  for (let off = loOffset; off <= hiOffset; off++) {
    const iso = utcMsToIso(startMs + off * DAY_MS);
    if (bucketEventToMonth(iso, advisorStartDate) === month) out.push(iso);
  }
  return out;
}

/**
 * The 7 ISO dates (Monday→Sunday) of the week containing selectedDay. UTC-based / tz-safe.
 */
export function weekDates(selectedDay: string): string[] {
  const t = isoToUtcMs(selectedDay);
  const mondayMs = t - utcWeekdayMon0(selectedDay) * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => utcMsToIso(mondayMs + i * DAY_MS));
}

/**
 * One DayCell per date with its pips. 'logged' = any flow/move event on that date (draw/buy/paydown/
 * deposit/withdraw); 'reading' = any balanceReading; 'cbCollateral' = a CB-targeted deposit (in ADDITION
 * to 'logged'). A day with no events → pips: [].
 */
export function buildDayCells(dayLog: DayEvent[], dates: string[]): DayCell[] {
  return dates.map((date) => {
    const onDay = dayLog.filter((e) => e.date === date);
    const pips: PipKind[] = [];
    if (onDay.some((e) => e.kind === 'draw' || e.kind === 'buy' || e.kind === 'paydown' || e.kind === 'deposit' || e.kind === 'withdraw')) {
      pips.push('logged');
    }
    if (onDay.some((e) => e.kind === 'balanceReading')) pips.push('reading');
    if (onDay.some((e) => e.kind === 'deposit' && e.target === 'cb')) pips.push('cbCollateral');
    return { date, day: Number(date.split('-')[2]), weekday: utcWeekdayMon0(date), pips };
  });
}

// ─── P4c-1b — activity builders (the calendar drives the activity card) ───
// These reproduce DailyModeView's prior inline agg EXACTLY (draw/paydown sums, buyBtc sum,
// netBtc = buys + strike deposits − strike withdrawals; CB-target moves are journal-only → excluded
// from netBtc). Pure — no store/UI/price dependency.

export interface StreamAgg { draw: number; paydown: number; buyBtc: number; }

export interface DayActivity {
  date:    string;
  netBtc:  number;
  streams: StreamAgg;
  events:  DayEvent[];
  isEmpty: boolean;
}

export interface MonthRollup {
  month:      number;
  netBtc:     number;
  streams:    StreamAgg;
  entryCount: number;     // distinct dates with at least one event
  events:     DayEvent[];
}

// Shared aggregation — the single source for both day + month totals.
function aggregateEvents(events: DayEvent[]): { streams: StreamAgg; netBtc: number } {
  let draw = 0, paydown = 0, buyBtc = 0, netBtc = 0;
  for (const ev of events) {
    if      (ev.kind === 'draw')    draw += ev.amount;
    else if (ev.kind === 'paydown') paydown += ev.amount;
    else if (ev.kind === 'buy')   { buyBtc += ev.amount; netBtc += ev.amount; }
    else if (ev.kind === 'deposit'  && ev.target === 'strike') netBtc += ev.amount;
    else if (ev.kind === 'withdraw' && ev.target === 'strike') netBtc -= ev.amount;
  }
  return { streams: { draw, paydown, buyBtc }, netBtc };
}

/** All events on a single ISO date (asc by ts) + that day's stream totals / netBtc. */
export function buildDayActivity(dayLog: DayEvent[], date: string): DayActivity {
  const events = dayLog.filter((e) => e.date === date).sort((a, b) => a.ts - b.ts);
  const { streams, netBtc } = aggregateEvents(events);
  return { date, netBtc, streams, events, isEmpty: events.length === 0 };
}

/**
 * A strategy month's events (asc by ts) + month totals. Filters via bucketEventToMonth (the same
 * bucketing as selectMonthEvents/rollupMonth) so the totals match the month log. entryCount = number
 * of distinct dates among the events.
 */
export function buildMonthRollup(dayLog: DayEvent[], advisorStartDate: string, month: number): MonthRollup {
  const events = dayLog
    .filter((e) => bucketEventToMonth(e.date, advisorStartDate) === month)
    .sort((a, b) => a.ts - b.ts);
  const { streams, netBtc } = aggregateEvents(events);
  const entryCount = new Set(events.map((e) => e.date)).size;
  return { month, netBtc, streams, entryCount, events };
}

/** Group events by date (each group asc by ts), groups sorted DESC by date (newest first). */
export function groupEventsByDay(events: DayEvent[]): { date: string; events: DayEvent[] }[] {
  const byDate = new Map<string, DayEvent[]>();
  for (const ev of events) {
    const arr = byDate.get(ev.date);
    if (arr) arr.push(ev);
    else byDate.set(ev.date, [ev]);
  }
  return Array.from(byDate.entries())
    .map(([date, evs]) => ({ date, events: [...evs].sort((a, b) => a.ts - b.ts) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
