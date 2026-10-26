import { fireTimeline, FIRE_SEARCH_MAX_STEPS, type FireInputs } from './fire';

/**
 * THE BREAK-EVEN GROWTH (FIRE plan M3; D1 A′ — batch 1 build 3): the lowest STEADY yearly growth at which the plan lasts
 * the horizon, its stop month held fixed — "lasts as long as bitcoin grows at least X% a year". The one fixed-rate
 * quantity, a yardstick that puts the belief behind a withdrawal rate on screen — never a price path (R3): no face draws
 * it or runs a plan on it.
 *
 * ⚠ Its steady paths are built with Math.pow, so it stays OUT of fire.ts's exact core (fire.ts never imports it) and its
 * figures are tested to a tolerance, never an exact golden (R7, `.claude/rules/general.md`).
 */

/** The search's bracket, a year: −50% to +100%. */
export const BREAK_EVEN_BRACKET: readonly [number, number] = [-0.5, 1];
/** The bisection's gap — a year's growth, as a decimal. */
export const BREAK_EVEN_TOL = 1e-7;

export interface FireBreakEven {
  /** A decimal a year — the lowest tested growth that lasts; null when nothing in the bracket does, or nothing to read. */
  yearlyGrowth: number | null;
  /** It lasts at the bracket's floor: the break-even is at or below it. */
  atFloor: boolean;
  bracket: readonly [number, number];
  /** The face's own stop month, held fixed. */
  stopMonth: number | null;
  reason: null | 'invalid' | 'noStopMonth' | 'stopBeyondHorizon' | 'nothingLasts';
}

/** price_m = p0 × (1 + g)^(m/12) for m = 0 … months − 1: a steady path from the face's month-0 price. */
export function steadyPath(p0: number, yearlyGrowth: number, months: number): number[] {
  const n = Number.isFinite(months) ? Math.max(0, Math.floor(months)) : 0;
  return Array.from({ length: n }, (_, m) => p0 * Math.pow(1 + yearlyGrowth, m / 12));
}

/**
 * The break-even beside the face's own path: its stop month is read off `fireTimeline(x, prices)` and HELD FIXED — under
 * 'atFi' the stop would move with the growth, and lasting would no longer grow with it — then steady paths from
 * `prices[0]`, `prices.length` months long, are bisected inside the bracket, keeping the lasting end.
 */
export function breakEvenGrowth(
  x: FireInputs, prices: readonly number[], opts: { bracket?: readonly [number, number]; tol?: number } = {},
): FireBreakEven {
  const bracket = opts.bracket ?? BREAK_EVEN_BRACKET;
  const tol = opts.tol ?? BREAK_EVEN_TOL;
  const out = (yearlyGrowth: number | null, atFloor: boolean, stopMonth: number | null, reason: FireBreakEven['reason']): FireBreakEven =>
    ({ yearlyGrowth, atFloor, bracket, stopMonth, reason });
  const [floor, top] = bracket;
  if (!(Number.isFinite(floor) && Number.isFinite(top) && floor > -1 && floor < top) || !(Number.isFinite(tol) && tol > 0)) {
    return out(null, false, null, 'invalid');
  }
  const own = fireTimeline(x, prices);
  if (!own.valid) return out(null, false, null, 'invalid');
  const stop = own.stopMonth;
  if (stop === null) return out(null, false, null, 'noStopMonth');
  if (stop >= own.months) return out(null, false, stop, 'stopBeyondHorizon');
  const fixed: FireInputs = { ...x, stopMonth: stop };
  const lastsAt = (g: number): boolean => fireTimeline(fixed, steadyPath(prices[0], g, prices.length)).lasts;
  if (lastsAt(floor)) return out(floor, true, stop, null);
  if (!lastsAt(top)) return out(null, false, stop, 'nothingLasts');
  let lo = floor, hi = top;
  for (let i = 0; i < FIRE_SEARCH_MAX_STEPS && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    if (lastsAt(mid)) hi = mid; else lo = mid;
  }
  return out(hi, false, stop, null);
}
