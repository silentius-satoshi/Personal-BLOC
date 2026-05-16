import type { SimInputs, STSMonthData } from './types';

export function runSTS(
  annualRate: number,
  inputs: Pick<SimInputs, 'income' | 'expenses' | 'startPrice' | 'startBTC'>
): STSMonthData[] {
  const { income, expenses, startPrice, startBTC } = inputs;
  const surplus = Math.max(0, income - expenses);
  const monthlyGrowthRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  let btc = startBTC;

  const rows: STSMonthData[] = [{ month: 0, btcPrice: startPrice, btc }];

  for (let m = 1; m <= 60; m++) {
    const btcPrice = startPrice * Math.pow(1 + monthlyGrowthRate, m);
    btc += surplus / btcPrice;
    rows.push({ month: m, btcPrice, btc });
  }

  return rows;
}
