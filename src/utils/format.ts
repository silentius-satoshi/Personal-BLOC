import type { MiningCurrency } from '../simulation/types';

export const fmtUSD = (n: number): string =>
  '$' + Math.round(Math.abs(n)).toLocaleString();

/**
 * THE chart-tooltip price — the Decision and Power Law tooltips both print through it (P1). `fmtUSD` rounds to whole
 * dollars, so a real sub-50¢ price read "$0". Whole dollars from $1; below that, two significant digits (never
 * exponent notation); under a cent, "under $0.01" (the power-law bands near GENESIS reach ~1e-12). "—" for a value no
 * tooltip shows — ≤ 0 or not finite; both tooltips drop those rows first.
 */
export function fmtTooltipUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1) return fmtUSD(v);
  if (v < 0.01) return 'under $0.01';
  const r = Number(v.toPrecision(2));   // two significant digits: 0.045, 0.5, 0.07
  if (r >= 1) return fmtUSD(r);         // 0.995 and up round to a dollar
  let s = r.toFixed(Math.max(2, 1 - Math.floor(Math.log10(r))));
  while (s.endsWith('0') && s.length - s.indexOf('.') - 1 > 2) s = s.slice(0, -1);   // 0.040 → 0.04, keep 0.50
  return '$' + s;
}

/** A dollar amount below this prints as "$0" — float dust (a ceiling-capped refinance can leave ~1e-10 over the
 *  limit), never a statement worth a sentence. ⚠ THE one dust floor: the policy's copy, the all-in verdict, the
 *  Decision face and Coinbase's seizure price (`cbSeizurePrice`, simulation/cbMetrics) all read it. It lives here, not
 *  in a component module, because src/simulation needs it too; `supportPolicyView` re-exports it for the faces. Never
 *  a second constant — a source guard counts the definitions. */
export const DUST_USD = 0.5;
export const shownUsd = (x: number): boolean => Number.isFinite(x) && x >= DUST_USD;

// LOCAL calendar-day ISO strings (yyyy-mm-dd) — getFullYear/getMonth/getDate are LOCAL accessors, unlike
// toISOString() (always UTC). Use these anywhere "today" or a specific local Date must become the correct
// wall-clock calendar day string; UTC-anchored/UTC-convention dates (Almanac, calendarModel.ts) do NOT use these.
export const toLocalISO = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const todayLocalISO = (): string => toLocalISO(new Date());

export function fmtMiningUSD(n: number): string {
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 100)  return '$' + n.toFixed(2);
  return '$' + Math.round(n).toLocaleString();
}

export function fmtMining(value_usd: number, currency: MiningCurrency, btcPrice: number): string {
  if (currency === 'usd') return fmtMiningUSD(value_usd);
  const sats = Math.round((value_usd / btcPrice) * 100_000_000);
  if (currency === 'sats') return `${sats.toLocaleString()} sats`;
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
}

// Relative freshness for the viewer surfaces ("updated Nm ago" — home pill + viewer Settings sync row).
// Extracted from ViewerHomeView (Viewer V4) so both consumers share one convention.
export function relativeAge(ts: number | null): string {
  if (!ts) return 'syncing…';
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins <= 0) return 'updated just now';
  if (mins < 60) return `updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `updated ${hrs}h ago`;
  return `updated ${Math.floor(hrs / 24)}d ago`;
}

/**
 * LTV fraction → display string. THE single LTV formatter for the whole app.
 *
 * ⚠ `(x * 100).toFixed(1)` on a non-finite number silently renders the string "Infinity%". That is
 * reachable: `computeStrikeLtv` and `computeLiquidationAnalysis` deliberately return POSITIVE_INFINITY
 * for debt with no collateral (returning 0 there would render the worst possible state as perfectly
 * safe). Every surface that prints an LTV must route through here, or the honest engine value becomes a
 * broken string in the exact panel someone reads during a margin crisis.
 *
 * Infinity → "∞"; NaN / −Infinity → "—" (unknown, not zero).
 */
export function fmtLtvPct(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return fraction > 0 ? '∞' : '—';
  return `${(fraction * 100).toFixed(decimals)}%`;
}
