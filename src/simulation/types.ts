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
