export const CB_LLTV = 0.86;
export const CB_WARN_LTV = 0.65;  // Coinbase/Morpho warning band start (watch→warning boundary; see classifyLtv)
export const CB_LIF  = 1 / (0.3 * CB_LLTV + 0.7);  // ≈ 1.04384

export interface CbLoanInputs {
  loanBalance:   number;
  collateralBtc: number;
  aprPct:        number;
  monthlyPayment: number;
  btcPrice:      number;
}

export type CbLtvStatus =
  | 'safe'
  | 'watch'
  | 'warning'
  | 'emergency'
  | 'critical'
  | 'liquidated';

export interface CbMonthRow {
  month:     number;
  balance:   number;
  interest:  number;
  payment:   number;
  netChange: number;
  ltv:       number;
  status:    CbLtvStatus;
}

export interface CbLoanProjection {
  rows:           CbMonthRow[];
  finalBalance:   number;
  finalLtv:       number;
  totalInterest:  number;
  totalPayments:  number;
}

export function classifyLtv(ltv: number): CbLtvStatus {
  if (ltv < 0.55) return 'safe';
  if (ltv < CB_WARN_LTV) return 'watch';
  if (ltv < 0.70) return 'warning';
  if (ltv < 0.84) return 'emergency';
  if (ltv < 0.86) return 'critical';
  return 'liquidated';
}

export function runCoinbaseLoan(inputs: CbLoanInputs): CbLoanProjection {
  const { loanBalance, collateralBtc, aprPct, monthlyPayment, btcPrice } = inputs;
  const monthlyRate = aprPct / 100 / 12;

  let balance = loanBalance;
  const rows: CbMonthRow[] = [];
  let totalInterest = 0;
  let totalPayments = 0;

  for (let month = 1; month <= 12; month++) {
    const prevBalance = balance;

    const interest = balance * monthlyRate;
    balance += interest;

    const payment = Math.min(monthlyPayment, balance);
    balance -= payment;

    const netChange = balance - prevBalance;
    const ltv = balance / (collateralBtc * btcPrice);

    totalInterest += interest;
    totalPayments += payment;

    rows.push({ month, balance, interest, payment, netChange, ltv, status: classifyLtv(ltv) });
  }

  return {
    rows,
    finalBalance:  balance,
    finalLtv:      rows[11].ltv,
    totalInterest,
    totalPayments,
  };
}

export interface LiquidationScenario {
  repayPct:               number;
  debtRepaid:             number;
  collateralSeizedUsd:    number;
  collateralSeizedBtc:    number;
  lifBonus:               number;
  remainingDebt:          number;
  remainingCollateralBtc: number;
  remainingCollateralUsd: number;
  newLtv:                 number;
  stillLiquidatable:      boolean;
}

export interface LiquidationAnalysis {
  userSuppliedPrice:          number;
  effectivePrice:             number;
  isAlreadyLiquidatable:      boolean;
  lif:                        number;
  lifPct:                     number;
  collateralAtEffectivePrice: number;
  equity:                     number;
  scenarios:                  LiquidationScenario[];
}

export function computeLiquidationAnalysis(
  loanBalance:      number,
  collateralBtc:    number,
  btcPrice:         number,
  liquidationPrice: number,
): LiquidationAnalysis {
  const isAlreadyLiquidatable     = btcPrice <= liquidationPrice;
  const effectivePrice             = isAlreadyLiquidatable ? btcPrice : liquidationPrice;
  const collateralAtEffectivePrice = collateralBtc * effectivePrice;
  const equity                     = collateralAtEffectivePrice - loanBalance;

  const scenarios: LiquidationScenario[] = ([0.25, 0.50, 0.75, 1.0] as const).map((repayPct) => {
    const debtRepaid             = loanBalance * repayPct;
    const collateralSeizedUsd    = debtRepaid * CB_LIF;
    const collateralSeizedBtc    = collateralSeizedUsd / effectivePrice;
    const lifBonus               = debtRepaid * (CB_LIF - 1);
    const remainingDebt          = loanBalance - debtRepaid;
    const remainingCollateralBtc = collateralBtc - collateralSeizedBtc;
    const remainingCollateralUsd = remainingCollateralBtc * effectivePrice;
    const newLtv                 = remainingCollateralUsd > 0 ? remainingDebt / remainingCollateralUsd : 0;
    return {
      repayPct, debtRepaid, collateralSeizedUsd, collateralSeizedBtc,
      lifBonus, remainingDebt, remainingCollateralBtc, remainingCollateralUsd,
      newLtv, stillLiquidatable: newLtv >= CB_LLTV,
    };
  });

  return {
    userSuppliedPrice: liquidationPrice,
    effectivePrice,
    isAlreadyLiquidatable,
    lif:    CB_LIF,
    lifPct: (CB_LIF - 1) * 100,
    collateralAtEffectivePrice,
    equity,
    scenarios,
  };
}
