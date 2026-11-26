/**
 * A price line's move — ONE expression for the Dashboard chart's change (its "(1D)" beside the price) and the Engine's
 * price bar (its 24-hour pill, its line and its range, BL67), so the two never disagree. Pure: no store, no clock, no DOM.
 *
 * A line is the chart's history with the live price as its last point (`withLivePoint`, lib/liveFeed.ts), oldest first.
 */
export interface PricePoint { price: number }

/** Its last price against its first, in percent; null with fewer than two points, or a first price that isn't above 0. */
export function lineChangePct(line: readonly PricePoint[]): number | null {
  if (line.length < 2) return null;
  const first = line[0].price;
  const last = line[line.length - 1].price;
  return first > 0 ? ((last - first) / first) * 100 : null;
}

/** Its lowest and highest price; null with fewer than two points. */
export function lineRange(line: readonly PricePoint[]): { lo: number; hi: number } | null {
  if (line.length < 2) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of line) {
    if (p.price < lo) lo = p.price;
    if (p.price > hi) hi = p.price;
  }
  return { lo, hi };
}
