import { runCyclingSim, allInEquity, type CyclingInputs, type CyclingRow } from './cyclingSim';
import { deriveOwnership } from './ownership';
import { cbSeizurePrice } from './cbMetrics';

/**
 * Path evaluation for the Decision face: run the SAME inputs across several modelled price futures and say which
 * one is worst. It is a CONSUMER of `runCyclingSim`, like `runAdvisor` — the paths arrive from the view as plain
 * `number[]`, so no belief crosses into the engine here.
 *
 * ⚠ These extra runs are a SELECTOR ONLY — they pick the "Worst (modeled)" crown. Every lens on the face reads
 * the one displayed run, never these. A second truth is exactly what this must not become.
 */

export interface PathOutcome {
  pricePath: number[];
  label: string;
  liqMonth: number | null;
  /** The smallest cushion from month 1 until a liquidation — `minCushionOf` the run's rows. ∞ when the path has no
   *  Coinbase loan in any of those months. */
  minCushion: number;
  /** ⚠ THREE arguments — a CyclingRow's `btcHeld` is all three pools, cold INCLUDED. Passing `coldBtc` as a 4th
   *  would double-count the pool, and `yoursShare` is clamped so the wrong answer still looks plausible.
   *  Reported, NOT ranked (W1). */
  yoursAtHorizon: number;
  coldAtHorizon: number;
  allInEquity: number;
}

/** The rule that decided the crown — the first rule on which the crown is the extreme of the whole ranked field. */
export type WorstBy = 'liquidation' | 'cushion' | 'equity' | 'index';

/**
 * Two cushions within this RELATIVE distance tie. Paths the engine holds on the same line — the 70% defense line,
 * the sweep floor — reach cushions an ulp or two apart (1.2285714285714284 against …286), and those last bits come
 * from Math.pow, which differs across Node versions. Measured over 180 policy-off scenarios, an exact comparison
 * crowned one path over another by 2e-16 in 16 of them, pre-empting the dollars the ranking puts next. The repo's
 * `× (1 ± 1e-9)` float guard (SUPPORT_EPS, firstUnheldMonth).
 */
export const CUSHION_EPS = 1e-9;

/**
 * The smallest cushion over `rows`: the minimum of price ÷ Coinbase's seizure price, over months 1 to the horizon.
 *
 * ⚠ It skips MONTH 0 (T1, spec v1.11) — by the row's own month, never its array position. Month 0 is today: the
 * anchor price and the opening position, the same row on every path, so its cushion can never tell two futures
 * apart. Counted, a position that is tightest TODAY ties every path on cushion, and the dollars decide instead. The
 * chart's cliff still draws today.
 *
 * From month 1 it counts every row `cbSeizurePrice` gives a seizure price for, so it also skips the liquidation row
 * and every row after it, a debt under the dust floor, and a month with no Coinbase collateral — exactly the months
 * the chart's cliff leaves blank. ∞ when no such row has a seizure price: no loan, nothing to come close to.
 */
export function minCushionOf(
  rows: readonly Pick<CyclingRow, 'm' | 'price' | 'cbDebt' | 'cbCollateralBtc' | 'postLiquidation'>[],
): number {
  let min = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!(row.m >= 1)) continue;   // month 0 is today; a junk month is not ≥ 1 either
    const seizure = cbSeizurePrice(row);
    if (seizure === null) continue;
    const cushion = row.price / seizure;
    if (Number.isFinite(cushion) && cushion < min) min = cushion;
  }
  return min;
}

type RankKey = Pick<PathOutcome, 'liqMonth' | 'minCushion' | 'allInEquity'>;

/** The ranking rules in priority order. Each returns 1 when `a` is worse than `b` under it, −1 when better, 0 on a
 *  tie (NaN reads as a tie — it never crowns anything). */
const RULES: readonly (readonly [Exclude<WorstBy, 'index'>, (a: RankKey, b: RankKey) => number])[] = [
  // Any liquidation is worse than none, and an EARLIER one is worse than a later one.
  ['liquidation', (a, b) => {
    if (a.liqMonth === null || b.liqMonth === null) {
      if (a.liqMonth === b.liqMonth) return 0;
      return a.liqMonth !== null ? 1 : -1;
    }
    return a.liqMonth < b.liqMonth ? 1 : b.liqMonth < a.liqMonth ? -1 : 0;
  }],
  // The smaller cushion comes closer to Coinbase's seizure price. Within CUSHION_EPS is a tie; ∞ ties ∞.
  ['cushion', (a, b) => {
    if (a.minCushion < b.minCushion * (1 - CUSHION_EPS)) return 1;
    if (b.minCushion < a.minCushion * (1 - CUSHION_EPS)) return -1;
    return 0;
  }],
  // The least all-in equity ends poorest.
  ['equity', (a, b) => (a.allInEquity < b.allInEquity ? 1 : b.allInEquity < a.allInEquity ? -1 : 0)],
];

/**
 * The worst of `keys` over `pool` (indices into `keys`, in ascending order), and the rule that decided it.
 *
 * WORST = CLOSEST TO A FORCED SALE, in order: (1) any liquidation is worse than none, and an earlier one worse than a
 * later one; (2) the smallest cushion (`minCushion`, from month 1, ties within CUSHION_EPS); (3) the least all-in
 * equity; (4) the lowest index — a dead heat keeps the path already crowned.
 *
 * `worstBy` is the FIRST rule on which ANY ranked path differs from the crown. On that rule the crown is the extreme
 * of the whole field, not just ahead of the runner-up, so the note's sentence ("comes closest to Coinbase's seizure
 * price", "ends poorest in dollars") is true against every path. The runner-up's rule could be false: tied on
 * cushion with a richer path, the crown wins on dollars — while a third path, farther from seizure, ends poorer
 * still. `'index'` when nothing in the field differs from the crown: a tie on every rule, or a lone path.
 */
export function pickWorst(
  keys: readonly RankKey[], pool: readonly number[],
): { worstIndex: number; worstBy: WorstBy } {
  const cmp = (a: RankKey, b: RankKey): number => {
    for (const [, rule] of RULES) {
      const c = rule(a, b);
      if (c !== 0) return c;
    }
    return 0;
  };
  let worstIndex = pool[0] ?? 0;
  for (const i of pool) if (i !== worstIndex && cmp(keys[i], keys[worstIndex]) > 0) worstIndex = i;
  const crown = keys[worstIndex];
  const decided = crown === undefined
    ? undefined
    : RULES.find(([, rule]) => pool.some((i) => i !== worstIndex && rule(keys[i], crown) !== 0));
  return { worstIndex, worstBy: decided?.[0] ?? 'index' };
}

/**
 * Every path's outcome, which index is worst, and the rule that decided it (`pickWorst`).
 *
 * WORST MEANS CLOSEST TO A FORCED SALE (spec v1.9, W1). v1.8 broke a no-liquidation tie on the fewest ₿ "yours" at
 * the horizon. Modelled paths bottom out at or near support, which the policy sizes its loans to survive, so they
 * almost never liquidate — and that tiebreak crowned Resistance, the most bullish path, where the owner simply buys
 * fewer coins. The cushion measures the risk instead, against the seizure price the chart's cliff draws
 * (`cbSeizurePrice` — one rule, two readers).
 *
 * It measures Coinbase's seizure only: a Strike margin-call sale needs a price far under support on the policy's
 * sizing, which the modelled paths never reach.
 *
 * ⚠ A run whose policy did not apply as asked is NOT ranked (M4). A silently policy-absent run is a different
 * strategy, so crowning it "worst" would compare two plans, not two futures.
 */
export function evaluatePaths(
  inputs: Omit<CyclingInputs, 'pricePath'>, paths: number[][], labels: string[],
): { perPath: PathOutcome[]; worstIndex: number; worstBy: WorstBy } {
  const wantPolicy = inputs.supportPolicy !== undefined;
  const perPath: PathOutcome[] = [];
  const rankable: number[] = [];

  paths.forEach((pricePath, i) => {
    const r = runCyclingSim({ ...inputs, pricePath });
    const last = r.last;
    perPath.push({
      pricePath,
      label: labels[i] ?? `path ${i}`,
      liqMonth: r.liqMonth,
      minCushion: minCushionOf(r.rows),
      yoursAtHorizon: deriveOwnership(last.btcHeld, last.debt, last.price).yoursBtc,
      coldAtHorizon: last.coldBtc,
      allInEquity: allInEquity(r),
    });
    if (r.policyApplied === wantPolicy) rankable.push(i);
  });

  const pool = rankable.length > 0 ? rankable : perPath.map((_, i) => i);
  return { perPath, ...pickWorst(perPath, pool) };
}

/**
 * The STITCHED floor: the lowest price any of the modelled paths shows in each month. It is no single model's
 * future — it is the envelope under all of them, and the face labels it that way.
 * Ragged or empty input → `[]` (a stitched floor over paths of different lengths would be a different horizon
 * each month, which is not a path).
 */
export function worstCasePath(paths: number[][]): number[] {
  if (paths.length === 0) return [];
  const n = paths[0].length;
  if (n === 0 || paths.some((p) => p.length !== n)) return [];
  return Array.from({ length: n }, (_, m) => Math.min(...paths.map((p) => p[m])));
}

/**
 * Two series are the SAME only bit for bit: equal length, and `Object.is` at every month. The Decision face uses
 * it to disable "Worst (stitched)" while the stitched floor is just Support under another name (D4) — an option
 * that draws the same line twice is not a second future. ⚠ Never a tolerance: a stitched floor an ulp under
 * Support somewhere IS a different series, and the face must offer it.
 */
export function sameSeries(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
