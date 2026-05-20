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
  bearPeriodMonths: number;
  annualDecline: number;   // decimal, e.g. -0.50
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

// --- Mining Tab Types ---

export type MiningCurrency = 'usd' | 'sats' | 'btc';
export type MiningStrategy = 'solo' | 'split' | 'pooled';

export interface MiningDevice {
  name: string;
  hashrateTH: number;
  powerW: number;
  efficiencyJTH: number;
  enabled: boolean;
  soloMining: boolean;
  poolName: string;
  poolFee: number;
}

export interface MiningInputs {
  devices: MiningDevice[];
  electricityRateCents: number;
  btcPriceOverride: number | null;
  networkHashrateEH: number;
  selectedStrategy: MiningStrategy;
  currency: MiningCurrency;
  projectionYears: number;
  btcPriceScenarios: number[];
}

export interface MiningStrategyResult {
  id: MiningStrategy;
  label: string;
  emoji: string;
  devices: {
    device: MiningDevice;
    dailyEV_usd: number;
    dailyEV_sats: number;
    type: 'solo' | 'pooled';
  }[];
  totalHashTH: number;
  soloHashTH: number;
  pooledHashTH: number;
  dailyEV_usd: number;
  dailyEV_sats: number;
  dailyEV_btc: number;
  monthlyNet_usd: number;
  monthlyNet_sats: number;
  monthlyNet_btc: number;
  yearlyNet_usd: number;
  yearlyNet_sats: number;
  yearlyNet_btc: number;
  totalPowerW: number;
  monthlyElecCost_usd: number;
  lotteryOdds: {
    dailyProbability: number;
    annualProbability: number;
    expectedYearsToBlock: number;
    jackpotValue_usd: number;
    jackpotValue_sats: number;
    jackpotValue_btc: number;
  } | null;
  projection: {
    year: number;
    satsAccumulated: number;
    valueByScenario: Record<number, number>;
  }[];
  poolSetup: {
    deviceName: string;
    hashrateTH: number;
    poolName: string;
    poolFee: number;
    type: 'solo' | 'pooled';
  }[];
}
