import type { MiningCurrency } from '../simulation/types';

export const fmtUSD = (n: number): string =>
  '$' + Math.round(Math.abs(n)).toLocaleString();

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
