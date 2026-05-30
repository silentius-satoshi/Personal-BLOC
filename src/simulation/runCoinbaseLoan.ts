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
  if (ltv < 0.65) return 'watch';
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
