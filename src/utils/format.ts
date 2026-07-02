import type { MiningCurrency } from '../simulation/types';

export const fmtUSD = (n: number): string =>
  '$' + Math.round(Math.abs(n)).toLocaleString();

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
