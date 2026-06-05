type Tier = 'min' | 'rec' | 'ideal' | 'custom';

export interface BlocYearOneInputs {
  collateralBtc:  number;
  btcPrice:       number;
  income:         number;
  expenses:       number;
  apr:            number;
  ltvCeiling:     number;
  creditLine:     number;
  btcGrowthRate:  number;  // annualized decimal (e.g. 0.33), 0 = flat
}

export interface BlocMonthRow {
  month: number;
  incomeTowardBtc: number;
  paydown: number;
  btcBought: number;
  strikeBalance: number;
  strikeCollateral: number;
  strikeLtv: number;
  phase: 1 | 2 | 3 | 4;
  creditExceeded: boolean;
  availableCredit: number;
  btcPriceThisMonth: number;
}

export interface BlocYearOneResult {
  rows: BlocMonthRow[];
  totalIncomeTowardBtc: number;
  totalPaydown: number;
  totalBtcBought: number;
  finalBalance: number;
  finalCollateral: number;
  finalLtv: number;
  totalInterestAccrued: number;
}

export function getCollateralForTier(
  tier: Tier,
  expenses: number,
  btcPrice: number,
  advisorActualBtcHeld: number,
): number {
  const ltvMap = { min: 0.15, rec: 0.05, ideal: 0.02 };
  if (tier === 'custom') return advisorActualBtcHeld;
  return expenses / (ltvMap[tier] * btcPrice);
}

export function runBlocYearOne(inputs: BlocYearOneInputs): BlocYearOneResult {
  const { collateralBtc, btcPrice, income, expenses, apr, ltvCeiling, creditLine, btcGrowthRate } = inputs;
  const monthlyRate = apr / 12;

  let balance = 0;
  let btcHeld = collateralBtc;
  let firstPaydownSeen = false;

  const rows: BlocMonthRow[] = [];
  let totalIncomeBtc = 0, totalPaydown = 0, totalBtc = 0, totalInterest = 0;

  for (let month = 1; month <= 12; month++) {
    const btcPriceThisMonth = btcPrice * Math.pow(1 + btcGrowthRate, (month - 1) / 12);

    // Step 1: Draw expenses — capped at available credit
    const availableToDraw = Math.max(0, creditLine - balance);
    const actualDraw = Math.min(expenses, availableToDraw);
    const creditExceeded = actualDraw < expenses;
    balance += actualDraw;

    // Step 2: Interest accrues on new balance
    const interest = balance * monthlyRate;
    balance += interest;
    totalInterest += interest;

    // Step 3: LTV paydown check
    const colVal = btcHeld * btcPriceThisMonth;
    const target = colVal * ltvCeiling;

    let paydown = 0;
    if (balance > target) {
      paydown = Math.min(income, balance - target);
      balance -= paydown;
    }

    // Step 4: Remaining income buys BTC
    const incomeTowardBtc = income - paydown;
    const btcBought = incomeTowardBtc / btcPriceThisMonth;
    btcHeld += btcBought;

    const ltv = balance / (btcHeld * btcPriceThisMonth);
    const availableCredit = Math.max(0, creditLine - balance);

    let phase: 1 | 2 | 3 | 4;
    if (creditExceeded) {
      phase = 4;
    } else if (paydown > 0) {
      if (!firstPaydownSeen) {
        phase = 2;
        firstPaydownSeen = true;
      } else {
        phase = 3;
      }
    } else {
      phase = 1;
    }

    rows.push({
      month, incomeTowardBtc, paydown, btcBought,
      strikeBalance: balance, strikeCollateral: btcHeld,
      strikeLtv: ltv, phase,
      creditExceeded,
      availableCredit,
      btcPriceThisMonth,
    });

    totalIncomeBtc += incomeTowardBtc;
    totalPaydown += paydown;
    totalBtc += btcBought;
  }

  return {
    rows,
    totalIncomeTowardBtc: totalIncomeBtc,
    totalPaydown,
    totalBtcBought: totalBtc,
    finalBalance: balance,
    finalCollateral: btcHeld,
    finalLtv: rows[11].strikeLtv,
    totalInterestAccrued: totalInterest,
  };
}
