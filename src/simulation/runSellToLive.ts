import type { LivingInputs, StrategyResult, StrategyMonthData } from './types';
import { getBtcPrice } from './livingUtils';

export function runSellToLive(
  inputs: LivingInputs,
  noBtcFinalNominal: number
): StrategyResult {
  const {
    btcHoldings, startPrice, income, expenses,
    annualBtcGrowth, inflationRate, timeHorizonMonths, capitalGainsTaxRate,
    bearMarket,
  } = inputs;

  const monthlyGrowthRate = Math.pow(1 + annualBtcGrowth, 1 / 12) - 1;
  const monthlyInflation  = Math.pow(1 + inflationRate, 1 / 12) - 1;

  let btc = btcHoldings;
  let cumulativeBtcSold    = 0;
  let cumulativeDollarSold = 0;
  let cumulativeInflation  = 1;

  const monthlyData: StrategyMonthData[] = [{
    month: 0,
    btcPrice: startPrice,
    btcHeld: btc,
    locBalance: 0,
    interestPaid: 0,
    taxesPaid: 0,
    netWorthNominal: btc * startPrice,
    netWorthReal: btc * startPrice,
  }];

  for (let m = 1; m <= timeHorizonMonths; m++) {
    const btcPrice = getBtcPrice(
      m, startPrice, monthlyGrowthRate, bearMarket, timeHorizonMonths, annualBtcGrowth,
      inputs.bearPeriodMonths, inputs.annualDecline,
    );

    // All income buys BTC
    const btcBought = income / btcPrice;
    btc += btcBought;

    // Sell BTC to cover expenses
    const btcSold = expenses / btcPrice;
    btc -= btcSold;
    cumulativeBtcSold    += btcSold;
    cumulativeDollarSold += expenses;

    cumulativeInflation *= (1 + monthlyInflation);

    const totalGains = Math.max(0, cumulativeDollarSold - cumulativeBtcSold * startPrice);
    const taxesPaid  = totalGains * capitalGainsTaxRate;

    const netWorthNominal = btc * btcPrice - taxesPaid;
    monthlyData.push({
      month: m,
      btcPrice,
      btcHeld: btc,
      locBalance: 0,
      interestPaid: 0,
      taxesPaid,
      netWorthNominal,
      netWorthReal: netWorthNominal / cumulativeInflation,
    });
  }

  const finalBtcPrice = getBtcPrice(
    timeHorizonMonths, startPrice, monthlyGrowthRate, bearMarket, timeHorizonMonths, annualBtcGrowth,
    inputs.bearPeriodMonths, inputs.annualDecline,
  );
  const totalGains = Math.max(0, cumulativeDollarSold - cumulativeBtcSold * startPrice);
  const finalTaxesPaid = totalGains * capitalGainsTaxRate;
  const finalNetWorthNominal = btc * finalBtcPrice - finalTaxesPaid;
  const finalNetWorthReal    = finalNetWorthNominal / cumulativeInflation;

  return {
    label: 'Sell to Live (No LoC)',
    color: '#888888',
    monthlyData,
    finalBtcHeld: btc,
    finalLocBalance: 0,
    finalInterestPaid: 0,
    finalTaxesPaid,
    finalNetWorthNominal,
    finalNetWorthReal,
    finalLtv: 0,
    crashLtv: 0,
    realReturn: (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal,
  };
}
