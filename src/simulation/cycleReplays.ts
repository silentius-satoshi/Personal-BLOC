import { plConvergencePath } from './powerLaw';

/**
 * THE BEAR-MARKET REPLAYS (FIRE plan §4.3; D1 A′, F9 — batch 1 build 3): "if a 2013, 2017 or 2021 bear began the day you
 * stopped working". Dated prices in, replays out — derived, never typed: no multiplier array, the Compass's or anyone's,
 * enters the repo (R0), and no price series is committed — the face derives the replays from the history the app loads
 * (D-2).
 *
 *  • THE TOP — month 0 (×1) is each cycle's top: the highest point inside its window, in the finest data given. Never a
 *    month-end: a month-end misses the top, and a replay measured from one reads milder at every month.
 *  • THE MONTHS — month k is the k-th month-end close strictly after the top, ÷ the top, through the first close at or
 *    above it (the reclaim). A close is `breakerFromHistory`'s: the last point strictly before the next month's first UTC
 *    midnight, junk at 7 days or more before it, months closed before `today` only — ONE rule, restated here because the
 *    breaker's copy is private to a component module; MONTH-END ≡ BREAKER (`cycleReplays.test.ts`) pins the two equal.
 *  • THE SPLICE — a replay begins at exactly the stop month's price on the face's path, wherever the cycle is; then the
 *    trend from wherever it ended: `plConvergencePath` at convergeMonths = Infinity, where w = 1 and the band's
 *    coefficient cancels (M2's tail), taken as a ratio on the face's own calendar, so a clamped day of the month never
 *    shifts it off the support line the face draws.
 *
 * 🔴 A BELIEF leaf beside cyclePath.ts: it imports only ./powerLaw. Nothing in the risk core imports it, and fire.ts never
 * does — the view builds the replay path and hands the engine a plain number[] (R2).
 */

/** Structurally `HistoryPoint` (`supportPolicyInputs`) and `PricePoint` (`usePowerLawData`). */
export interface DatedPrice { timestamp: number; price: number }

export type ReplayCycleId = '2013' | '2017' | '2021';
/** A cycle, named by its top's window — UTC dates, both days inclusive. */
export interface ReplayCycle { id: ReplayCycleId; topFromISO: string; topToISO: string }

/** Late 2013, Dec 2017, Nov 2021. The 2011 crash (a thin market) is left out; the 2025 cycle is one line once its bear is done. */
export const REPLAY_CYCLES: readonly ReplayCycle[] = [
  { id: '2013', topFromISO: '2013-11-01', topToISO: '2013-12-31' },
  { id: '2017', topFromISO: '2017-12-01', topToISO: '2017-12-31' },
  { id: '2021', topFromISO: '2021-11-01', topToISO: '2021-11-30' },
];

/** A close must be LESS than this far before its month's end — `breakerFromHistory`'s CLOSE_MAX_GAP_DAYS. */
export const MONTH_END_MAX_GAP_DAYS = 7;
const DAY_MS = 86_400_000;

export interface MonthEnd {
  monthStartMs: number;
  /** The month's last day, `yyyy-mm-dd` (UTC) — the breaker's `lastMonthEndISO` form. */
  endISO: string;
  /** The close's point — null when the month is junk. */
  closeTimestamp: number | null;
  price: number | null;
}

export interface Replay {
  id: ReplayCycleId;
  peakTimestamp: number;
  peakUsd: number;
  /** mult[0] = 1 (the top); mult[k] = the k-th month-end close strictly after the top ÷ the top, through the reclaim. */
  mult: number[];
  /** The close each mult[k] reads: `monthEndISO[k − 1]`. */
  monthEndISO: string[];
  troughMult: number;
  troughMonth: number;
  /** The first k with mult[k] ≥ 1 — the replay's last month; null when the data ends first. */
  reclaimMonth: number | null;
}

export interface ReplayReading { id: ReplayCycleId; replay: Replay | null; reason: null | 'noPeak' | 'gap' }

const monthStartUTC = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const nextMonthStartUTC = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The usable points, oldest first: a finite time and a finite price above 0. */
const cleanPoints = (history: ReadonlyArray<DatedPrice>): DatedPrice[] => history
  .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.price) && p.price > 0)
  .slice()
  .sort((a, b) => a.timestamp - b.timestamp);

/** Every calendar month (UTC) from the first point's month through the last month that closed before `today`, with its
 *  close — breakerFromHistory's grid and rule. */
export function monthEndCloses(history: ReadonlyArray<DatedPrice>, today: Date): MonthEnd[] {
  const pts = cleanPoints(history);
  const todayMs = today.getTime();
  if (pts.length === 0 || !Number.isFinite(todayMs)) return [];
  const out: MonthEnd[] = [];
  let i = 0;
  for (let t = monthStartUTC(pts[0].timestamp); t < monthStartUTC(todayMs); t = nextMonthStartUTC(t)) {
    const end = nextMonthStartUTC(t);
    let close: DatedPrice | null = null;
    while (i < pts.length && pts[i].timestamp < end) { close = pts[i]; i += 1; }
    const endISO = isoOf(end - DAY_MS);
    if (close === null || end - close.timestamp >= MONTH_END_MAX_GAP_DAYS * DAY_MS) {
      out.push({ monthStartMs: t, endISO, closeTimestamp: null, price: null });
    } else {
      out.push({ monthStartMs: t, endISO, closeTimestamp: close.timestamp, price: close.price });
    }
  }
  return out;
}

/** The highest point in [from, to) — ties go to the earliest. */
function highest(pts: ReadonlyArray<DatedPrice>, from: number, to: number): DatedPrice | null {
  let top: DatedPrice | null = null;
  for (const p of pts) if (p.timestamp >= from && p.timestamp < to && (top === null || p.price > top.price)) top = p;
  return top;
}

/** Each cycle's replay, derived from the dated prices given (the finest the caller has). */
export function deriveReplays(
  history: ReadonlyArray<DatedPrice>, today: Date, cycles: readonly ReplayCycle[] = REPLAY_CYCLES,
): ReplayReading[] {
  const pts = cleanPoints(history);
  const ends = monthEndCloses(pts, today);
  return cycles.map((cycle): ReplayReading => {
    const from = Date.parse(`${cycle.topFromISO}T00:00:00Z`);
    const to = Date.parse(`${cycle.topToISO}T00:00:00Z`) + DAY_MS;
    const top = highest(pts, from, to);   // the top in the finest data — never a month-end
    if (top === null) return { id: cycle.id, replay: null, reason: 'noPeak' };
    const topMonth = monthStartUTC(top.timestamp);
    const mult = [1];
    const monthEndISO: string[] = [];
    let reclaimMonth: number | null = null;
    for (const e of ends) {
      if (e.monthStartMs < topMonth) continue;
      if (e.closeTimestamp !== null && e.closeTimestamp <= top.timestamp) continue;   // the top's own month closed ON the top
      if (e.price === null) return { id: cycle.id, replay: null, reason: 'gap' };     // a junk month: never a carried figure
      mult.push(e.price / top.price);
      monthEndISO.push(e.endISO);
      if (e.price >= top.price) { reclaimMonth = mult.length - 1; break; }
    }
    if (mult.length === 1) return { id: cycle.id, replay: null, reason: 'gap' };      // no month-end after the top yet
    let troughMonth = 0;
    for (let k = 1; k < mult.length; k++) if (mult[k] < mult[troughMonth]) troughMonth = k;
    return {
      id: cycle.id, reason: null,
      replay: { id: cycle.id, peakTimestamp: top.timestamp, peakUsd: top.price, mult, monthEndISO, troughMult: mult[troughMonth], troughMonth, reclaimMonth },
    };
  });
}

/**
 * The face's path with a replay spliced in at `stopMonth`: the base before it, exactly the stop month's price at it, then
 * that price × each multiple, then the trend tail to the horizon (`base.length`). `startDate` is the base's month 0, a UTC
 * midnight (powerLaw's convention). A stop month at or past the horizon — or junk — returns the base; a replay longer than
 * the horizon is cut there, with no tail.
 */
export function replayPath(base: readonly number[], startDate: Date, stopMonth: number, replay: Replay): number[] {
  const n = base.length;
  const out = base.slice();
  const stop = Number.isFinite(stopMonth) ? Math.max(0, Math.floor(stopMonth)) : n;
  if (stop >= n) return out;
  out[stop] = base[stop];   // the bear begins at exactly the stop month's price, wherever the cycle is
  const last = Math.min(n - 1, stop + replay.mult.length - 1);
  for (let m = stop + 1; m <= last; m++) out[m] = base[stop] * replay.mult[m - stop];
  if (last < n - 1) {
    // trend[m] ÷ trend[last] = support(m) ÷ support(last) on the face's calendar: w = 1, the band's coefficient cancels.
    const trend = plConvergencePath(1, 'floor', startDate, n - 1, Number.POSITIVE_INFINITY);
    for (let m = last + 1; m < n; m++) out[m] = out[last] * (trend[m] / trend[last]);
  }
  return out;
}
