/**
 * The futures' batch runner — the ENGINE side of the §2 wall. It runs `runCyclingSim` over price paths it is handed as
 * plain `number[]`s and sums up what happened. 🔴 Its only imports are the engine and the ownership leaf; it never sees
 * a belief (powerLaw, cycleModel, cyclePath, pricePaths). Pure and clock-free.
 *
 * What one future reports, read off the run's last row:
 *   • yours — held minus owed, in bitcoin (`deriveOwnership`, the faces' "Yours"; three arguments, because the row's
 *     `btcHeld` already counts the cold pool);
 *   • cold — what sits in cold storage (`last.coldBtc`);
 *   • beats never drawing — the faces' verdict rule: all-in equity above the never-draw baseline's, on the same path
 *     (`verdictVsNeverDraw`'s `wins`);
 *   • seized — Morpho took the Coinbase loan, either read at a month-end (`liqMonth`) or ON THE WAY DOWN
 *     (`firstOpenPastLltvMonth`, the engine's own test, computed with the policy on or off). Under the applied policy
 *     the two agree; without it the month-end reading rescues loans Morpho had already taken, and only the second test
 *     sees them;
 *   • when — the month of that first seizure (`seizedMonth`, the earlier of the two tests). The summary turns the
 *     months into the words' WHEN (Run 2, W-3): how many went by month 12, and the month by which half had gone.
 *
 * ⚠ `countsSeizures` — the coin figures mean something only when the run's own model seizes on the way down, which is
 * when the support policy applied (`policyApplied`; every future shares the inputs and the path length, so it is one
 * answer for the batch). Without it, a rescued future still carries coins Morpho would have taken, and the faces show
 * the chance of a seizure alone (measured on REPRO over 20 years, policy off: `liqMonth` in 0.6% of the futures, the
 * way-down test in 95.1%).
 */
import { runCyclingSim, allInEquity, baselineAllInEquity, type CyclingInputs } from './cyclingSim';
import { deriveOwnership } from './ownership';

export interface FutureOutcome {
  yoursBtc: number;
  coldBtc: number;
  beatsNeverDraw: boolean;
  seized: boolean;
  /** When Morpho first takes the loan: the earlier of `liqMonth` and `firstOpenPastLltvMonth` (Run 2, W-3); null when
   *  neither fires. */
  seizedMonth: number | null;
}

export interface Spread { p10: number; p50: number; p90: number }

export interface FuturesSummary {
  /** The number of futures run. */
  count: number;
  /** Their horizon, in months. */
  months: number;
  yoursBtc: Spread;
  coldBtc: Spread;
  /** How many futures end with more all-in equity than never drawing, on the same path. */
  beatsNeverDraw: number;
  /** How many futures lose the Coinbase loan to Morpho — at a month-end or on the way down. */
  seized: number;
  /** Of those, how many go by month 12 — within the first year, month 12 included (Run 2, W-3). */
  seizedWithinYear: number;
  /** The month by which half of the seizures have happened: the LOWER median of the seized futures' months — the
   *  smallest m with at least half of them seized by m (Run 2, W-3); null when none seizes. */
  seizedHalfByMonth: number | null;
  /** Month 0's LOCAL date, `yyyy-mm-dd` — the faces' `new Date(todayLocalISO())`, held as UTC midnight — passed
   *  through untouched so the words can name a month and a year. */
  startISO: string;
  /** The support policy applied, so the run itself seizes on the way down and its coin figures can be shown. */
  countsSeizures: boolean;
}

/** Every future's engine inputs: a face's own run, minus its price path. */
export type FuturesInputs = Omit<CyclingInputs, 'pricePath'>;

/** What one future comes to at the horizon. */
export function futureOutcome(inputs: FuturesInputs, prices: number[]): FutureOutcome & { policyApplied: boolean } {
  const r = runCyclingSim({ ...inputs, pricePath: prices });
  const { last } = r;
  const tests = [r.liqMonth, r.firstOpenPastLltvMonth].filter((m): m is number => m !== null);
  const seizedMonth = tests.length > 0 ? Math.min(...tests) : null;
  return {
    yoursBtc: deriveOwnership(last.btcHeld, last.debt, last.price).yoursBtc,
    coldBtc: last.coldBtc,
    beatsNeverDraw: allInEquity(r) > baselineAllInEquity(r),
    seized: seizedMonth !== null,
    seizedMonth,
    policyApplied: r.policyApplied,
  };
}

/** The p-th quantile of an array sorted ASCENDING, interpolated between the two nearest ranks; NaN when empty. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const spreadOf = (xs: number[]): Spread => {
  const s = [...xs].sort((a, b) => a - b);
  return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) };
};

/** The engine over every path, summed up. Each path is a plain price path as long as the run. */
export function runFutures(inputs: FuturesInputs, paths: readonly number[][], startISO: string): FuturesSummary {
  const yours: number[] = [];
  const cold: number[] = [];
  const seizedMonths: number[] = [];
  let beats = 0;
  let seized = 0;
  let applied = false;
  for (let i = 0; i < paths.length; i++) {
    const o = futureOutcome(inputs, paths[i]);
    yours.push(o.yoursBtc);
    cold.push(o.coldBtc);
    if (o.beatsNeverDraw) beats += 1;
    if (o.seized) seized += 1;
    if (o.seizedMonth !== null) seizedMonths.push(o.seizedMonth);
    if (i === 0) applied = o.policyApplied;
  }
  seizedMonths.sort((a, b) => a - b);
  return {
    count: paths.length,
    months: paths.length > 0 ? paths[0].length - 1 : 0,
    yoursBtc: spreadOf(yours),
    coldBtc: spreadOf(cold),
    beatsNeverDraw: beats,
    seized,
    seizedWithinYear: seizedMonths.filter((m) => m <= 12).length,
    seizedHalfByMonth: seizedMonths.length > 0 ? seizedMonths[Math.ceil(seizedMonths.length / 2) - 1] : null,
    startISO,
    countsSeizures: applied,
  };
}
