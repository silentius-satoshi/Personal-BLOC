import type { LivingInputs, StrategyResult, StrategyMonthData } from './types';

export function runNoBitcoin(inputs: LivingInputs): StrategyResult {
  const {
    btcHoldings, startPrice, income, expenses,
    inflationRate, timeHorizonMonths,
  } = inputs;

  const monthlyInflation = Math.pow(1 + inflationRate, 1 / 12) - 1;

  let cashBalance = btcHoldings * startPrice;
  const surplus = Math.max(0, income - expenses);

  const monthlyData: StrategyMonthData[] = [{
    month: 0,
    btcPrice: startPrice,
    btcHeld: 0,
    locBalance: 0,
    interestPaid: 0,
    taxesPaid: 0,
    netWorthNominal: cashBalance,
    netWorthReal: cashBalance,
  }];

  let cumulativeInflation = 1;

  for (let m = 1; m <= timeHorizonMonths; m++) {
    cashBalance += surplus;
    cumulativeInflation *= (1 + monthlyInflation);

    monthlyData.push({
      month: m,
      btcPrice: startPrice,
      btcHeld: 0,
      locBalance: 0,
      interestPaid: 0,
      taxesPaid: 0,
      netWorthNominal: cashBalance,
      netWorthReal: cashBalance / cumulativeInflation,
    });
  }

  const finalNetWorthNominal = cashBalance;
  const finalNetWorthReal = cashBalance / cumulativeInflation;

  return {
    label: 'No Bitcoin (Cash Only)',
    color: '#555555',
    monthlyData,
    finalBtcHeld: 0,
    finalLocBalance: 0,
    finalInterestPaid: 0,
    finalTaxesPaid: 0,
    finalNetWorthNominal,
    finalNetWorthReal,
    finalLtv: 0,
    crashLtv: 0,
    realReturn: -inflationRate,
  };
}
