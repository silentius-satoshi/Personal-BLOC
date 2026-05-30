type Tier = 'min' | 'rec' | 'ideal' | 'custom';

export interface BlocYearOneInputs {
  collateralBtc: number;
  btcPrice: number;
  income: number;
  expenses: number;
  apr: number;
  ltvCeiling: number;
}

export interface BlocMonthRow {
  month: number;
  incomeTowardBtc: number;
  paydown: number;
  btcBought: number;
  strikeBalance: number;
  strikeCollateral: number;
  strikeLtv: number;
  phase: 1 | 2 | 3;
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
  customCollateral: number,
): number {
  const ltvMap = { min: 0.15, rec: 0.05, ideal: 0.02 };
  if (tier === 'custom') return customCollateral;
  return expenses / (ltvMap[tier] * btcPrice);
}

export function runBlocYearOne(inputs: BlocYearOneInputs): BlocYearOneResult {
  const { collateralBtc, btcPrice, income, expenses, apr, ltvCeiling } = inputs;
  const monthlyRate = apr / 12;

  let balance = 0;
  let btcHeld = collateralBtc;
  let firstPaydownSeen = false;

  const rows: BlocMonthRow[] = [];
  let totalIncomeBtc = 0, totalPaydown = 0, totalBtc = 0, totalInterest = 0;

  for (let month = 1; month <= 12; month++) {
    // Draw first, then interest (spec order — differs from runBLOC.ts)
    balance += expenses;

    const interest = balance * monthlyRate;
    balance += interest;
    totalInterest += interest;

    const colVal = btcHeld * btcPrice;
    const target = colVal * ltvCeiling;

    let paydown = 0;
    if (balance > target) {
      paydown = Math.min(income, balance - target);
      balance -= paydown;
    }

    const incomeTowardBtc = income - paydown;
    const btcBought = incomeTowardBtc / btcPrice;
    btcHeld += btcBought;

    const ltv = balance / (btcHeld * btcPrice);

    let phase: 1 | 2 | 3;
    if (paydown === 0) {
      phase = 1;
    } else if (!firstPaydownSeen) {
      phase = 2;
      firstPaydownSeen = true;
    } else {
      phase = 3;
    }

    rows.push({ month, incomeTowardBtc, paydown, btcBought, strikeBalance: balance, strikeCollateral: btcHeld, strikeLtv: ltv, phase });

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
