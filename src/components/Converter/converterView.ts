/**
 * The Sats page's shared figures, pure — no store, no React (spec `pbloc-spec-sats-rates-v1.md`). ONE definition of the
 * unit and the dollar format the page prints (ConverterMain's converter card and its Satoshi Rates, ConverterSidebar's
 * Key Equivalences), plus the rates table's rows. The table lives under the converter in ConverterMain; a row fills the
 * converter (S2).
 */
export const SATS_PER_BTC = 100_000_000;

/** The Sats page's dollar format: 6 decimals under a cent, 4 under a dollar, then 2, grouped. */
export function fmtUsdLocal(n: number): string {
  if (n < 0.01) return '$' + n.toFixed(6);
  if (n < 1)    return '$' + n.toFixed(4);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The rates table's nine rows: 1 sat to 1 bitcoin. */
export const RATE_SATS = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000] as const;

export interface RateRow {
  sats: number;
  /** "丰 1,000" */
  satsText: string;
  /** "₿ 0.00001000" */
  btcText: string;
  /** "$0.8200", or "—" with no price (S4). */
  usdText: string;
}

/**
 * The rates table's rows at `btcPrice`.
 * - D1 (the owner): the cells carry no unit words — the column headers name them — so a row fits one line on a phone.
 * - S4: without a usable price (≤ 0, NaN, ∞) the dollar column reads "—", as the Key Equivalences do — never
 *   "$0.000000".
 */
export function rateRows(btcPrice: number): RateRow[] {
  return RATE_SATS.map((sats) => ({
    sats,
    satsText: `丰 ${sats.toLocaleString()}`,
    btcText: `₿ ${(sats / SATS_PER_BTC).toFixed(8)}`,
    usdText: Number.isFinite(btcPrice) && btcPrice > 0 ? fmtUsdLocal((sats / SATS_PER_BTC) * btcPrice) : '—',
  }));
}
