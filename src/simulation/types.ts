export interface SimInputs {
  income: number;
  expenses: number;
  startPrice: number;
  apr: number;
  foldRate: number;
  startBTC: number;
}

export interface MonthData {
  month: number;
  btcPrice: number;
  btc: number;
  loc: number;
  fbtc: number;
  comb: number;
  ltv: number;
  paydown: number;
  btcPurchased: number;
  foldBTCThisMonth: number;
  interest: number;
  portfolioValue: number;
  netEquity: number;
  crashLTV: number;
}

export interface STSMonthData {
  month: number;
  btcPrice: number;
  btc: number;
}

export interface LivingInputs {
  btcHoldings: number;
  startPrice: number;
  income: number;
  expenses: number;
  annualBtcGrowth: number;       // decimal e.g. 0.50
  apr: number;                   // decimal e.g. 0.13
  inflationRate: number;         // decimal e.g. 0.02
  timeHorizonMonths: number;
  ltvCeiling: number;            // decimal — from ltvType map
  capitalGainsTaxRate: number;   // decimal e.g. 0.15
  bearMarket: boolean;
}

export interface StrategyMonthData {
  month: number;
  btcPrice: number;
  btcHeld: number;
  locBalance: number;
  interestPaid: number;          // cumulative
  taxesPaid: number;             // cumulative
  netWorthNominal: number;
  netWorthReal: number;          // inflation-adjusted
}

export interface StrategyResult {
  label: string;
  color: string;
  monthlyData: StrategyMonthData[];
  finalBtcHeld: number;
  finalLocBalance: number;
  finalInterestPaid: number;
  finalTaxesPaid: number;
  finalNetWorthNominal: number;
  finalNetWorthReal: number;
  finalLtv: number;
  crashLtv: number;
  realReturn: number;
}
