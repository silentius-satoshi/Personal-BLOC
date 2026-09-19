export interface SimInputs {
  income: number;
  expenses: number;
  startPrice: number;
  apr: number;
  startBTC: number;
  creditLine?: number;
}

export interface MonthData {
  month: number;
  btcPrice: number;
  btc: number;
  loc: number;
  ltv: number;
  paydown: number;
  btcPurchased: number;
  interest: number;
  portfolioValue: number;
  netEquity: number;
  crashLTV: number;
  ltvPeak: number;   // in-month HIGH LTV (post-draw, PRE-paydown, PRE-buy) — the ratio the paydown answers. `ltv` is the
                     // settled figure. runBLOC is the ONLY builder of MonthData, so this is required. ∞ = debt, no collateral
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

// --- Daily Mode Types ---

export type DayEventKind = 'draw' | 'buy' | 'paydown' | 'minPayment' | 'deposit' | 'withdraw' | 'balanceReading' | 'cbCollateralReading';

interface DayEventBase { id: string; date: string; /* ISO yyyy-mm-dd */ ts: number; /* ms */ }

export type DayEvent =
  | (DayEventBase & { kind: 'draw' | 'paydown'; amount: number /* USD */;
                      target?: 'strike' | 'cb';   // ⚠ ABSENT MEANS 'strike' — every draw/paydown logged before CB flows existed. Read via flowVenue(), never bare.
                      fee?: number                /* USD — Coinbase origination fee (cbBorrowFee), capitalised; draw + target:'cb' only */ })
  | (DayEventBase & { kind: 'minPayment'; amount: number /* USD — Strike monthly minimum paid from income; balance-neutral (rolls up to strikeMinPaid, NOT paydown) */ })
  | (DayEventBase & { kind: 'buy'; amount: number /* BTC acquired */; usd?: number })
  | (DayEventBase & { kind: 'deposit' | 'withdraw'; amount: number /* BTC, signed by kind */; target: 'strike' | 'cb' | 'cold' })
  | (DayEventBase & { kind: 'cbCollateralReading'; cbCollateral: number /* BTC — CB-only; feeds the derived cbCollateralBtc clock */ })
  | (DayEventBase & { kind: 'balanceReading'; reading: {
        strikeBal: number; strikeLtv: number;       // always required (read off Strike)
        strikeCollateral?: number;                  // Strike collateral BTC — reading-anchored (Collateral-Truth v20); feeds the derived strikeCollateralBtc clock via deriveStrikeCollateral
        cbBal?: number; cbLtv?: number;             // required at runtime iff hasCbLoan
        cbCollateral?: number;                      // CB collateral BTC — required at runtime iff hasCbLoan; feeds the derived cbCollateralBtc clock
        cbLiqPrice?: number;                        // §5b — optional CB liquidation price; anchor input (re-anchors cbLiquidationPrice), NOT a monthly stock (never in the rollup entry)
        price?: number;                             // optional spot price at reading time
      } });
// NOTE: Strike collateral (btcHeld) is READING-ANCHORED (Collateral-Truth v20) — DERIVED via
//       deriveStrikeCollateral = the strikeCollateral-bearing reading latest by (date, then ts) + target:'strike'
//       deposit/withdraw moves strictly after it. NOT synced as a setting (local derived cache strikeCollateralBtc,
//       converges cross-device via the dayLog on the records channel). Buys NEVER count toward Strike collateral.
//       cbCollateralBtc is DERIVED = latest cbCollateral-bearing event by ts (balanceReading or cbCollateralReading); NOT synced as a setting.
//       deposit/withdraw target:'strike' feeds collateralDelta (rollup report-only) + the strike derive; target:'cb' is journal-only (CB collateral comes from the reading).
//       target:'cold' feeds deriveColdStorage (the owner's anchor + cold moves after it) and is journal-only for the monthly
//       rollup — it is the ONLY source of cold movement, because cold has no statement and therefore no reading.
//       draw/paydown target:'cb' are JOURNAL-ONLY — they record a Coinbase borrow (with its origination fee) or paydown;
//       CB debt stocks keep coming from the reading, exactly as target:'cb' collateral moves do. A CB borrow is a
//       refinance, NOT an expense, so it must never reach expensesActual. Two guards enforce that: the target skip in
//       rollupMonth (no corruption) and isMonthlyMeaningful (no create/flip/reopen).

// --- Monthly Log ---

export interface MonthlyLogEntry {
  month:          number;    // 1–12, relative to advisorStartDate
  date:           string;    // ISO date string (first day of that month)
  btcBought:      number;
  income:         number;    // income allocated to BTC (after paydown)
  paydown:        number;    // BLOC paydown amount
  strikeBal:      number;    // BLOC balance end-of-month
  strikeLtv:      number;    // stored as decimal, e.g. 0.1483 = 14.83%
  cbBal?:         number;    // omit if !hasCbLoan
  cbLtv?:         number;    // omit if !hasCbLoan
  miningSats?:    number;    // omit if !showMiningInLog
  ndpPaid?:       number;    // OPTIONAL — actual NDP (non-draw payment) recorded this month; omit when no NDP paid
  strikeMinPaid?:  number;             // OPTIONAL — Strike monthly minimum actually paid this month (income source); omit when rolled
  strikeMinSource?: 'income' | 'roll'; // OPTIONAL — the min-payment source in effect when this month was logged
  loggedAt:       number;    // Unix ms timestamp
  btcHeld?:       number;    // Strike collateral RECORDED from this month's balance reading (rollupMonth stamps it from
                             // reading.strikeCollateral). undefined = never recorded. NEVER computed. 0 is a real position.
  expensesActual: number;    // actual expenses recorded for this month
  updatedAt?:     number;    // Unix ms; stamped by upsertLogEntry on every save. Legacy entries lack it — merge falls back to loggedAt.
  collateralAdjustment?: number;  // OPTIONAL — net BTC deposited(+)/withdrawn(−) that month, separate from btcBought.
                                  // STORE-OWNED: written only by graduation in upsertLogEntry. Remote pre-v4 entries lack it (?? 0 everywhere).
  source?:      'manual' | 'daily';  // undefined on legacy entries — treated as 'manual'; 'daily' = rolled up from dayLog (P2 stamps it)
  confirmed?:   boolean;             // undefined on legacy entries — treated as true; false = needs review (P2 stamps it)
  provisional?: boolean;             // OPTIONAL — rollupMonth: true on carry-forward (flows, no balanceReading, priorStocks used);
                                     // false when a reading supplies the stocks; absent on legacy / no-stock months
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
