import { addMonths, plBandAt, plFloor } from '../../simulation/powerLaw';
import type { CyclingMode, SupportPolicyInputs } from '../../simulation/cyclingSim';
import {
  nextRearmableBreakerState, REARMABLE_BREAKER_START, type RearmableBreakerState,
} from '../../simulation/supportPolicy';
import { STRIKE_CURE_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../../simulation/strikeCredit';
import { strikeLiqLtvOf } from './cyclingFaceView';
import { DEFAULT_BREAKER_REARM_MONTHS, type EffectivePolicySettings } from './supportPolicyView';

/**
 * The faces' ONE §2 crossing for the support-anchored policy (Run 2). The ONLY module in `src/components/` that
 * builds a support path, so it may import the power law; the view helpers may not (the cyclingFaceView rule).
 *
 * 🔴 The support path is a BELIEF handed to the engine as a plain `number[]`. A face builds it here and nowhere else,
 * and never stresses or phase-shifts it: the stress lens moves the price, not the line.
 */

/** support[m] = `plBandAt('floor', startDate, m)` for m = 0..max(0, floor(months)) — the SAME function the price path
 *  and the faces' "Support line at this month" readout use, so it is bit-aligned with an on-the-line price path.
 *  A non-finite horizon gives month 0 only. */
export function buildSupportPath(startDate: Date, months: number): number[] {
  const n = Number.isFinite(months) ? Math.max(0, Math.floor(months)) : 0;
  return Array.from({ length: n + 1 }, (_, m) => plBandAt('floor', startDate, m));
}

/**
 * The engine's policy input, as a face builds it — `undefined` when the policy is off or the mode is not `cycle` (the
 * engine then runs byte-identically to today). The stops, zones and buffer come from the range-clamped settings; the
 * engine clamps the stops to the defense lines itself, through the same `effectivePolicyStops` the readout uses.
 * The cash reserve is months of the face's effective bills. The re-arm key is present only while
 * `DEFAULT_BREAKER_REARM_MONTHS` is defined, so a latched run is the same object shape as Run 1's.
 * It never sets the engine's test-only inputs.
 */
export function supportPolicyFor(
  settings: EffectivePolicySettings,
  supportPath: number[],
  expenses: number,
  strikeLiquidationLtvPct: number,
  mode: CyclingMode,
): SupportPolicyInputs | undefined {
  if (!settings.enabled || mode !== 'cycle') return undefined;
  const bills = Number.isFinite(expenses) && expenses > 0 ? expenses : 0;
  const policy: SupportPolicyInputs = {
    supportPath,
    cbStopAtSupportPct: settings.cbStopAtSupportPct,
    strikeStopAtSupportPct: settings.strikeStopAtSupportPct,
    accumulateBelow: settings.accumulateBelow,
    payDownAbove: settings.payDownAbove,
    bearBufferMonths: settings.bearBufferMonths,
    openingCashUsd: settings.cashReserveMonths * bills,
    strikeCureLtv: STRIKE_CURE_LTV,
    strikePartialLiqLtv: strikeLiqLtvOf(strikeLiquidationLtvPct),
    strikeRetrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV,
  };
  if (DEFAULT_BREAKER_REARM_MONTHS !== undefined) policy.breakerRearmMonths = DEFAULT_BREAKER_REARM_MONTHS;
  return policy;
}

// ── THE POLICY'S MEMORY, rebuilt from PRICES (Decision face, D14) ────────────────────────────────────────────────
//
// The real balances carry every past decision. The BREAKER is the one thing they do not carry, so a run shown as
// "this month's move" folds it over real month-end closes vs support and seeds the engine with it. There is no
// decision log: the fold is a pure function of prices, and it uses the engine's OWN trip rule
// (`nextRearmableBreakerState`), never a second copy of it.
//
// ⚠ This module does NOT import `Tools/crashPlaybookView` (R4). `holdMonthsFrom` takes the `throughISO` that
// `strikeHoldFrom` already computed; the face calls that helper itself.

/** The support line at each of `dates` — `plFloor`, the same belief `buildSupportPath` reads, so the chart's
 *  history half and the engine's forward path are one line. Bit-aligned with `buildSupportPath` by construction. */
export function supportAtDates(dates: ReadonlyArray<Date>): number[] {
  return dates.map((d) => plFloor(d));
}

/** Structurally `PricePoint` (hooks/usePowerLawData) — declared here so the one §2 crossing imports no hook. */
export interface HistoryPoint { timestamp: number; price: number }

export interface BreakerSeed {
  state: RearmableBreakerState;
  /** The last month-end the fold actually read, `yyyy-mm-dd` — so the card can date its line and stale history shows. */
  lastMonthEndISO: string;
}

/** A month's close must be LESS than this far before the month's end, or the month is junk (the full history is
 *  sampled a few days apart). ⚠ EXACTLY 7 days is junk — the test pins both sides of the boundary. */
const CLOSE_MAX_GAP_DAYS = 7;
const DAY_MS = 86_400_000;

const monthStartUTC = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const nextMonthStartUTC = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The policy's breaker AS OF TODAY, folded over real month-end closes — never over a decision log (D14).
 *
 * The grid is every calendar month (UTC) from the first month in `history` through the last month that CLOSED
 * before `today`. Today's own price is the run's month 0 and never feeds the breaker — the engine's own rule.
 * A month's close is the last history point before the next month's first UTC midnight, and only when it is less
 * than `CLOSE_MAX_GAP_DAYS` before it; a missing or non-positive close is JUNK, and junk carries the state
 * unchanged, exactly as the engine's own junk rule does.
 *
 * `null` when no month has a usable close (the fetch failed, or the history is empty) — the caller then runs clean
 * and SAYS so, rather than silently assuming "not broken".
 */
export function breakerFromHistory(
  history: ReadonlyArray<HistoryPoint>, today: Date, rearmMonths: number | null,
): BreakerSeed | null {
  const pts = history
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.price) && p.price > 0)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  if (pts.length === 0) return null;
  const todayMs = today.getTime();
  if (!Number.isFinite(todayMs)) return null;

  // Month grid: first month in history → the last month that closed before today.
  const firstStart = monthStartUTC(pts[0].timestamp);
  const thisMonthStart = monthStartUTC(todayMs);
  const starts: number[] = [];
  for (let t = firstStart; t < thisMonthStart; t = nextMonthStartUTC(t)) starts.push(t);
  if (starts.length === 0) return null;

  const ends = starts.map((t) => nextMonthStartUTC(t));
  const supports = supportAtDates(ends.map((t) => new Date(t - DAY_MS)));

  let state = REARMABLE_BREAKER_START;
  let lastMonthEndISO: string | null = null;
  let i = 0;
  for (let g = 0; g < starts.length; g++) {
    const end = ends[g];
    // The last point strictly before the next month's first UTC midnight.
    let close: HistoryPoint | null = null;
    while (i < pts.length && pts[i].timestamp < end) { close = pts[i]; i += 1; }
    if (close === null || end - close.timestamp >= CLOSE_MAX_GAP_DAYS * DAY_MS) continue;   // junk: carry
    const support = supports[g];
    if (!(Number.isFinite(support) && support > 0)) continue;                              // junk: carry
    state = nextRearmableBreakerState(state, close.price, support, g, rearmMonths);
    lastMonthEndISO = isoOf(end - DAY_MS);
  }
  return lastMonthEndISO === null ? null : { state, lastMonthEndISO };
}

/**
 * Strike's 60-day hold in ENGINE months: the first m ≥ 0 whose month start is strictly past `throughISO`, so the
 * engine's own gate (`m >= strikeHoldUntil`) blocks a migration or a release until the hold has passed.
 * `null` (no logged deposit in the window) or a past date → 0.
 */
export function holdMonthsFrom(throughISO: string | null, startDate: Date): number {
  if (throughISO === null) return 0;
  const through = Date.parse(throughISO);
  if (!Number.isFinite(through)) return 0;
  for (let m = 0; m <= 1200; m++) {
    if (addMonths(startDate, m).getTime() > through) return m;
  }
  return 0;
}
