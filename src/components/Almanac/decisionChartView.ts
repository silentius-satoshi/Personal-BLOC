import type { CyclingRow } from '../../simulation/cyclingSim';
import { cbSeizurePrice } from '../../simulation/cbMetrics';
import { sameSeries } from '../../simulation/planSearch';
import { addMonths } from '../../simulation/powerLaw';
import type { HistoryPoint } from './supportPolicyInputs';

/**
 * The Decision face's chart series — pure, so the seam, the gaps and the cliff are all testable.
 *
 * 🔴 THE CLIFF IS `cbSeizurePrice` — `cbMetrics().liqPrice` per row, the formula THE MOVE prints and the Safety
 * Dashboard already uses, and the line the Worst (modeled) ranking measures its cushion against. Never a second one.
 * ⚠ An uncomputable point is a GAP (`null`), never 0 — a zero would draw a line to the floor of a log axis and
 * read as a crash that never happened.
 */

export interface SeriesPoint { t: number; price: number }
export interface GapPoint { t: number; price: number | null }

export interface DecisionChartSeries {
  /** Downsampled full history, ending exactly at `(seamT, P)`. */
  history: SeriesPoint[];
  /** The selected path, starting at the SAME `(seamT, P)` — no gap, no double-plot. */
  forward: SeriesPoint[];
  floor: SeriesPoint[];
  support: GapPoint[];
  /** Coinbase's seizure price per month; `null` where there is none to draw. */
  cliff: GapPoint[];
  seamT: number;
}

/** History is stride-downsampled to at most this, keeping the first and last points. */
export const MAX_HISTORY_POINTS = 800;

const ok = (x: number): boolean => Number.isFinite(x) && x > 0;

/**
 * Coinbase's seizure price in each month — the price at which its LTV reaches 86%. It is `cbSeizurePrice` per row:
 * 🔴 THE one rule the Worst (modeled) ranking reads too (`minCushionOf`), so the line drawn here and the crown's
 * "closest to Coinbase's seizure price" can never disagree. `null` with no loan (⚠ F3 — a balance under the dust
 * floor is not one, and `fmtUSD` would print its seizure price as "$0"), with no Coinbase collateral, and ON and
 * AFTER the liquidation row (there is no loan left to seize, so a line there would be a cliff for a position that no
 * longer exists).
 */
export function cliffPath(rows: readonly CyclingRow[]): (number | null)[] {
  return rows.map((r) => cbSeizurePrice(r));
}

/** Keep at most `max` points, evenly strided, always keeping the first and the last. */
export function downsample<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max || max < 2) return xs.slice();
  const stride = Math.ceil((xs.length - 1) / (max - 1));
  const out: T[] = [];
  for (let i = 0; i < xs.length - 1; i += stride) out.push(xs[i]);
  out.push(xs[xs.length - 1]);
  return out;
}

export function buildChartSeries(
  history: readonly HistoryPoint[],
  startDate: Date,
  forward: readonly number[],
  floor: readonly number[],
  supportPath: readonly number[],
  /** ⚠ A FUNCTION, not an index-aligned array (N2). The caller can only compute support over the RAW history,
   *  but this series is built from the KEPT points — filtered for junk, then downsampled — so an array indexed
   *  by the caller's own ordering drew the wrong date's support at nearly every point (the last one was off by
   *  99%, the worst by ×3.4e12). Passing the function means no index-aligned array crosses this boundary: the
   *  caller never has to know which points were kept. The face passes `supportAtDates`. */
  historySupportAt: (dates: ReadonlyArray<Date>) => number[],
  horizonMonths: number,
  cliff: readonly (number | null)[],
): DecisionChartSeries {
  const seamT = startDate.getTime();
  const spot = ok(forward[0]) ? forward[0] : Number.NaN;
  const months = Math.max(0, Math.min(horizonMonths, forward.length - 1));
  const tAt = (m: number): number => addMonths(startDate, m).getTime();

  // ── history, ending exactly at the seam ────────────────────────────────────────────────────────────────────
  const clean = history
    .filter((p) => Number.isFinite(p.timestamp) && p.timestamp < seamT && ok(p.price))
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  const kept = downsample(clean, Math.max(2, MAX_HISTORY_POINTS - 1));
  const hist: SeriesPoint[] = kept.map((p) => ({ t: p.timestamp, price: p.price }));
  // THE SEAM: history's last point IS forward's first, so the two meet with no gap and no double-plot.
  if (Number.isFinite(spot)) hist.push({ t: seamT, price: spot });

  const series = (src: readonly number[]): SeriesPoint[] => {
    const out: SeriesPoint[] = [];
    for (let m = 0; m <= months; m++) if (ok(src[m])) out.push({ t: tAt(m), price: src[m] });
    return out;
  };
  const gapped = (src: readonly (number | null | undefined)[]): GapPoint[] => {
    const out: GapPoint[] = [];
    for (let m = 0; m <= months; m++) {
      const v = src[m];
      out.push({ t: tAt(m), price: typeof v === 'number' && ok(v) ? v : null });
    }
    return out;
  };

  // The support line spans both halves: history through `historySupportAt` evaluated at the KEPT points' own
  // dates, forward through the engine's own path.
  const histSupport = historySupportAt(kept.map((p) => new Date(p.timestamp)));
  const supportSeries: GapPoint[] = kept.map((p, i) => {
    const v = histSupport[i];
    return { t: p.timestamp, price: typeof v === 'number' && ok(v) ? v : null };
  });
  supportSeries.push(...gapped(supportPath));

  return {
    history: hist,
    forward: series(forward),
    floor: series(floor),
    support: supportSeries,
    cliff: gapped(cliff),
    seamT,
  };
}

/**
 * The log Y-axis's domain: every plotted price, 20% below the lowest and 25% above the highest. A log axis cannot
 * take `'auto'` near zero, so the face always passes an explicit positive domain. Gaps (`null`) are skipped, so a gap
 * never drags the floor to 0. Nothing plotted ⇒ `null`, and the face shows its placeholder.
 */
export function chartDomain(series: DecisionChartSeries): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = 0;
  for (const pts of [series.history, series.forward, series.floor, series.support, series.cliff]) {
    for (const p of pts) {
      const v = p.price;
      if (v === null || !ok(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) && hi > 0 ? [lo * 0.8, hi * 1.25] : null;
}

/** The time axis's extent: the earliest and latest point of any series. Nothing plotted ⇒ `null`. */
export function xExtent(series: DecisionChartSeries): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const pts of [series.history, series.forward, series.floor, series.support, series.cliff]) {
    for (const p of pts) {
      if (!Number.isFinite(p.t)) continue;
      if (p.t < lo) lo = p.t;
      if (p.t > hi) hi = p.t;
    }
  }
  if (Number.isFinite(series.seamT)) {
    lo = Math.min(lo, series.seamT);
    hi = Math.max(hi, series.seamT);
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

// The date ticks moved to `lib/chartZoom.ts` (`timeTicks`) with chart zoom — one ladder, shared by every zoomed chart.

/**
 * The legend note's test: after today, IS the displayed path the support line — so the dashed path covers it and the
 * two read as one line? Months 1…horizon, bit for bit through `sameSeries` — never a tolerance, the Worst (stitched)
 * rule. Month 0 is today's spot price, so it is skipped. A short or ragged series, or a horizon under a month: false.
 */
export function pathOnSupport(path: readonly number[], support: readonly number[], months: number): boolean {
  if (!Number.isInteger(months) || months < 1) return false;
  if (path.length < months + 1 || support.length < months + 1) return false;
  return sameSeries(path.slice(1, months + 1), support.slice(1, months + 1));
}
