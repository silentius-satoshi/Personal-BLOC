import type { CyclingRow } from '../../simulation/cyclingSim';
import { cbMetrics } from '../../simulation/cbMetrics';
import { addMonths } from '../../simulation/powerLaw';
import type { HistoryPoint } from './supportPolicyInputs';
import { shownUsd } from './supportPolicyView';

/**
 * The Decision face's chart series — pure, so the seam, the gaps and the cliff are all testable.
 *
 * 🔴 THE CLIFF IS `cbMetrics().liqPrice`, the same formula THE MOVE prints and the Safety Dashboard already uses.
 * Never a second one.
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
 * Coinbase's seizure price in each month — the price at which its LTV reaches 86%.
 * `null` with no loan, with no Coinbase collateral, and ON and AFTER the liquidation row (there is no loan left
 * to seize, so a line there would be a cliff for a position that no longer exists).
 */
export function cliffPath(rows: readonly CyclingRow[], cbLtvTriggerPct: number): (number | null)[] {
  let liq: number | null = null;
  for (const r of rows) if (r.postLiquidation && liq === null) liq = r.m;
  return rows.map((r) => {
    if (liq !== null && r.m >= liq) return null;
    // ⚠ F3 — the SAME dust floor THE MOVE's cliff line uses: a balance under 50¢ is not a loan, and
    // `fmtUSD` would print its seizure price as "$0" ("Coinbase seizes this loan at $0 — 100% below today").
    if (!shownUsd(r.cbDebt) || !(r.cbCollateralBtc > 0)) return null;
    const p = cbMetrics(r.cbDebt, r.cbCollateralBtc, r.price, cbLtvTriggerPct).liqPrice;
    return ok(p) ? p : null;
  });
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
