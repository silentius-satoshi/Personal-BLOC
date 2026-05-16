import type { LivingInputs, StrategyResult, StrategyMonthData } from './types';
import { getBtcPrice } from './livingUtils';

export function runSmartBLOC_Living(
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
      m, startPrice, monthlyGrowthRate, bearMarket, timeHorizonMonths, annualBtcGrowth
    );

    // Step 1: interest capitalizes
    const interest = loc * monthlyRate;
    loc += interest;
    cumulativeInterest += interest;

    // Step 2: draw expenses
    loc += expenses;

    // Step 3: LTV ceiling check — uses variable ltvCeiling, not hardcoded 0.15
    const collateralValue = btc * btcPrice;
    let paydown = 0;
    if (collateralValue > 0 && loc / collateralValue > inputs.ltvCeiling) {
      paydown = Math.min(income, loc - collateralValue * inputs.ltvCeiling);
    }

    // Step 4: income buys BTC after paydown
    const btcPurchased = (income - paydown) / btcPrice;
    btc += btcPurchased;
    loc -= paydown;

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
    timeHorizonMonths, startPrice, monthlyGrowthRate, bearMarket, timeHorizonMonths, annualBtcGrowth
  );
  const finalNetWorthNominal = btc * finalBtcPrice - loc;
  const finalNetWorthReal    = finalNetWorthNominal / cumulativeInflation;
  const finalLtv = btc * finalBtcPrice > 0 ? loc / (btc * finalBtcPrice) : 0;

  return {
    label: 'Smart BLOC (Crash-Safe)',
    color: '#4ECB82',
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
