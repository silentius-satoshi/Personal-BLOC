import { runCyclingSim, allInEquity, type CyclingInputs } from './cyclingSim';
import { deriveOwnership } from './ownership';

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
  /** ⚠ THREE arguments — a CyclingRow's `btcHeld` is all three pools, cold INCLUDED. Passing `coldBtc` as a 4th
   *  would double-count the pool, and `yoursShare` is clamped so the wrong answer still looks plausible. */
  yoursAtHorizon: number;
  coldAtHorizon: number;
  allInEquity: number;
}

/**
 * Every path's outcome, and which index is worst.
 *
 * WORST, in order: any liquidation beats none; an EARLIER liquidation beats a later one; then the least `yours`
 * at the horizon; then the lowest index.
 *
 * ⚠ A run whose policy did not apply as asked is NOT ranked (M4). A silently policy-absent run is a different
 * strategy, so crowning it "worst" would compare two plans, not two futures.
 */
export function evaluatePaths(
  inputs: Omit<CyclingInputs, 'pricePath'>, paths: number[][], labels: string[],
): { perPath: PathOutcome[]; worstIndex: number } {
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
      yoursAtHorizon: deriveOwnership(last.btcHeld, last.debt, last.price).yoursBtc,
      coldAtHorizon: last.coldBtc,
      allInEquity: allInEquity(r),
    });
    if (r.policyApplied === wantPolicy) rankable.push(i);
  });

  const pool = rankable.length > 0 ? rankable : perPath.map((_, i) => i);
  let worstIndex = pool[0] ?? 0;
  for (const i of pool) {
    if (i === worstIndex) continue;
    if (worseThan(perPath[i], perPath[worstIndex])) worstIndex = i;
  }
  return { perPath, worstIndex };
}

/** Strictly worse than `b` — ties keep `b`, so the lowest index wins a dead heat. */
function worseThan(a: PathOutcome, b: PathOutcome): boolean {
  if (a.liqMonth !== null && b.liqMonth === null) return true;
  if (a.liqMonth === null && b.liqMonth !== null) return false;
  if (a.liqMonth !== null && b.liqMonth !== null && a.liqMonth !== b.liqMonth) return a.liqMonth < b.liqMonth;
  return a.yoursAtHorizon < b.yoursAtHorizon;
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
