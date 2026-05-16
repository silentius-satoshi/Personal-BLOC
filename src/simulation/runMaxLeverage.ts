import type { LivingInputs, StrategyResult, StrategyMonthData } from './types';
import { getBtcPrice } from './livingUtils';

export function runMaxLeverage(
  inputs: LivingInputs,
  noBtcFinalNominal: number
): StrategyResult {
  const {
    btcHoldings, startPrice, income, expenses,
    annualBtcGrowth, apr, inflationRate,
    timeHorizonMonths, bearMarket,
  } = inputs;

  const monthlyGrowthRate = Math.pow(1 + annualBtcGrowth, 1 / 12) - 1;
  const monthlyRate       = apr / 12;
  const monthlyInflation  = Math.pow(1 + inflationRate, 1 / 12) - 1;

  let btc = btcHoldings;
  let loc = 0;
  let cumulativeInterest  = 0;
  let cumulativeInflation = 1;

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

    // Draw expenses FIRST — then interest is calculated on the higher balance
    loc += expenses;

    // Interest accrued on post-draw balance — paid from income, NOT added to LoC
    const interest = loc * monthlyRate;
    cumulativeInterest += interest;

    // No paydown ever — income minus interest payment buys BTC
    const availableForBtc = Math.max(0, income - interest);
    const btcPurchased    = availableForBtc / btcPrice;
    btc += btcPurchased;

    cumulativeInflation *= (1 + monthlyInflation);

    const netWorthNominal = btc * btcPrice - loc;
    monthlyData.push({
      month: m,
      btcPrice,
      btcHeld: btc,
      locBalance: loc,
      interestPaid: cumulativeInterest,
      taxesPaid: 0,
      netWorthNominal,
      netWorthReal: netWorthNominal / cumulativeInflation,
    });
  }

  const finalBtcPrice = getBtcPrice(
    timeHorizonMonths, startPrice, monthlyGrowthRate, bearMarket, timeHorizonMonths, annualBtcGrowth,
    inputs.bearPeriodMonths, inputs.annualDecline,
  );
  const finalNetWorthNominal = btc * finalBtcPrice - loc;
  const finalNetWorthReal    = finalNetWorthNominal / cumulativeInflation;
  const finalLtv = btc * finalBtcPrice > 0 ? loc / (btc * finalBtcPrice) : 0;

  return {
    label: 'Max Leverage (Dangerous)',
    color: '#E8836A',
    monthlyData,
    finalBtcHeld: btc,
    finalLocBalance: loc,
    finalInterestPaid: cumulativeInterest,
    finalTaxesPaid: 0,
    finalNetWorthNominal,
    finalNetWorthReal,
    finalLtv,
    crashLtv: finalLtv / 0.20,
    realReturn: (finalNetWorthReal - noBtcFinalNominal) / noBtcFinalNominal,
  };
}
