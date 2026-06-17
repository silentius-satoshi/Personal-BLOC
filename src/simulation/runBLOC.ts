import type { SimInputs, MonthData } from './types';

export function calcTiers(expenses: number, btcPrice: number) {
  return {
    min:   expenses / (0.15 * btcPrice),
    rec:   expenses / (0.05 * btcPrice),
    ideal: expenses / (0.02 * btcPrice),
  };
}

export function runBLOC(annualRate: number, inputs: SimInputs): MonthData[] {
  const { income, expenses, startPrice, apr, startBTC } = inputs;
  const monthlyRate = apr / 12;
  const monthlyGrowthRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const LTV_CEILING = 0.15;

  let btc = startBTC;
  let loc = 0;

  const rows: MonthData[] = [{
    month: 0,
    btcPrice: startPrice,
    btc,
    loc,
    ltv: 0,
    paydown: 0,
    btcPurchased: 0,
    interest: 0,
    portfolioValue: startBTC * startPrice,
    netEquity: startBTC * startPrice,
    crashLTV: 0,
  }];

  for (let m = 1; m <= 60; m++) {
    // Step 1: price appreciates
    const btcPrice = startPrice * Math.pow(1 + monthlyGrowthRate, m);

    // Step 2: interest capitalizes onto LoC (must be before expenses draw)
    const interest = loc * monthlyRate;
    loc += interest;

    // Step 3: monthly expenses drawn from LoC (post-interest loc), capped at credit line
    const cap = inputs.creditLine ?? Infinity;
    const availableToDraw = Math.max(0, cap - loc);
    const actualDraw = Math.min(expenses, availableToDraw);
    loc += actualDraw;

    // Step 4: LTV check against post-draw loc
    const collateralValue = btc * btcPrice;
    let paydown = 0;
    if (collateralValue > 0 && loc / collateralValue > LTV_CEILING) {
      paydown = Math.min(income, loc - collateralValue * LTV_CEILING);
    }

    // Step 5: income buys Bitcoin after any paydown
    const btcPurchased = (income - paydown) / btcPrice;
    btc += btcPurchased;
    loc -= paydown;

    const ltv = btc * btcPrice > 0 ? loc / (btc * btcPrice) : 0;
    const portfolioValue = btc * btcPrice;

    rows.push({
      month: m,
      btcPrice,
      btc,
      loc,
      ltv,
      paydown,
      btcPurchased,
      interest,
      portfolioValue,
      netEquity: portfolioValue - loc,
      crashLTV: ltv / 0.20,
    });
  }

  return rows;
}
