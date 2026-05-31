export type AdvisorTier = 1 | 2 | 3 | 4;

export function getCurrentStrategyMonth(startDate: string): number {
  const elapsed = Math.floor((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
  return Math.min(Math.max(1, elapsed + 1), 12);
}

export function isStrategyComplete(startDate: string): boolean {
  return Math.floor((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4375)) >= 12;
}

export function getTier(cbLtv: number): AdvisorTier {
  if (cbLtv >= 0.70) return 1;
  if (cbLtv >= 0.65) return 2;
  if (cbLtv >= 0.55) return 3;
  return 4;
}

export function getTierLabel(tier: AdvisorTier): string {
  return { 1: 'Emergency', 2: 'Warning', 3: 'Watch', 4: 'Safe' }[tier];
}

export function getTierColor(tier: AdvisorTier): string {
  return { 1: 'var(--red)', 2: 'var(--orange)', 3: 'var(--amber)', 4: 'var(--green)' }[tier];
}

export interface AdvisorInputs {
  btcPrice:       number;
  income:         number;
  expenses:       number;
  blocApr:        number;
  creditLine:     number;
  collateralBtc:  number;
  blocLtvCeiling: number;
  cbBalance:        number;
  cbCollateralBtc:  number;
  cbAprPct:         number;
  cbMonthlyPayment: number;
  startingBlocBalance: number;
  startingBtcHeld:     number;
  startingMonth:       number;
  btcGrowthRate:       number;  // annualized decimal (e.g. 0.33), 0 = flat
}

export interface AdvisorMonthRow {
  month:          number;
  tier:           AdvisorTier;
  tierLabel:      string;
  isCurrentMonth: boolean;
  blocDraw:       number;
  fiatGap:        number;
  cbPayment:      number;
  cbExtraPayment: number;
  btcBought:      number;
  incomeToBtc:    number;
  blocBalance:    number;
  blocLtv:        number;
  cbBalance:      number;
  cbLtv:          number;
  btcHeld:        number;
  blocInterest:   number;
  cbInterest:     number;
  totalInterest:  number;
}

export interface AdvisorResult {
  rows:              AdvisorMonthRow[];
  totalBtcBought:    number;
  totalInterestPaid: number;
  totalFiatGap:      number;
  finalBtcHeld:      number;
  finalBlocBalance:  number;
  finalCbBalance:    number;
}

export function runAdvisor(inputs: AdvisorInputs): AdvisorResult {
  const {
    btcPrice, income, expenses,
    blocApr, creditLine, blocLtvCeiling,
    cbBalance: initialCbBalance, cbCollateralBtc,
    cbAprPct, cbMonthlyPayment,
    startingBlocBalance, startingBtcHeld, startingMonth, btcGrowthRate,
  } = inputs;

  const blocMonthlyRate = blocApr / 100 / 12;
  const cbMonthlyRate   = cbAprPct / 100 / 12;

  let blocBalance = startingBlocBalance;
  let cbBal       = initialCbBalance;
  let btcHeld     = startingBtcHeld;

  const rows: AdvisorMonthRow[] = [];
  let totalBtcBought    = 0;
  let totalInterestPaid = 0;
  let totalFiatGap      = 0;

  for (let month = startingMonth; month <= 12; month++) {
    const monthsElapsed = month - startingMonth;
    const btcPriceThisMonth = btcPrice * Math.pow(1 + btcGrowthRate, monthsElapsed / 12);

    const cbLtvStart = cbCollateralBtc * btcPriceThisMonth > 0 ? cbBal / (cbCollateralBtc * btcPriceThisMonth) : 0;
    const tier = getTier(cbLtvStart);

    // CB interest accrues on opening balance
    const cbInterest = cbBal * cbMonthlyRate;
    cbBal += cbInterest;

    // BLOC draw by tier
    let blocDraw = 0;
    if (tier === 4 || tier === 3) {
      blocDraw = Math.min(expenses, Math.max(0, creditLine - blocBalance));
    } else if (tier === 2) {
      blocDraw = Math.min(expenses * 0.5, Math.max(0, creditLine - blocBalance));
    }
    const fiatGap = expenses - blocDraw;

    // BLOC: draw then interest
    blocBalance += blocDraw;
    const blocInterest = blocBalance * blocMonthlyRate;
    blocBalance += blocInterest;

    // BLOC LTV paydown check — funded from income
    const blocTarget = btcHeld * btcPriceThisMonth * blocLtvCeiling;
    let blocPaydown  = 0;
    if (blocBalance > blocTarget) {
      blocPaydown = Math.min(income * 0.3, blocBalance - blocTarget);
    }

    // Income allocation
    let remainingIncome = income - blocPaydown;
    let cbExtraPayment  = 0;

    if (tier === 1) {
      cbExtraPayment  = remainingIncome;
      remainingIncome = 0;
    } else if (tier === 2) {
      cbExtraPayment  = remainingIncome * 0.5;
      remainingIncome = remainingIncome * 0.5;
    } else if (tier === 3) {
      cbExtraPayment  = remainingIncome * 0.25;
      remainingIncome = remainingIncome * 0.75;
    }

    // Apply payments
    const cbTotalPayment = Math.min(cbMonthlyPayment + cbExtraPayment, cbBal);
    cbBal       -= cbTotalPayment;
    blocBalance -= blocPaydown;

    // Buy BTC with remaining income
    const incomeToBtc = remainingIncome;
    const btcBought   = btcPriceThisMonth > 0 ? incomeToBtc / btcPriceThisMonth : 0;
    btcHeld += btcBought;

    const blocLtv     = btcHeld * btcPriceThisMonth > 0 ? blocBalance / (btcHeld * btcPriceThisMonth) : 0;
    const cbLtv       = cbCollateralBtc * btcPriceThisMonth > 0 ? cbBal / (cbCollateralBtc * btcPriceThisMonth) : 0;
    const totalInterest = blocInterest + cbInterest;

    totalBtcBought    += btcBought;
    totalInterestPaid += totalInterest;
    totalFiatGap      += fiatGap;

    rows.push({
      month, tier, tierLabel: getTierLabel(tier),
      isCurrentMonth: month === startingMonth,
      blocDraw, fiatGap, cbPayment: cbTotalPayment,
      cbExtraPayment, btcBought, incomeToBtc,
      blocBalance, blocLtv, cbBalance: cbBal, cbLtv, btcHeld,
      blocInterest, cbInterest, totalInterest,
    });
  }

  return {
    rows,
    totalBtcBought,
    totalInterestPaid,
    totalFiatGap,
    finalBtcHeld:     btcHeld,
    finalBlocBalance: blocBalance,
    finalCbBalance:   cbBal,
  };
}

export type NdpStatus = 'never' | 'ok' | 'upcoming' | 'soon' | 'overdue';

export interface NdpInfo {
  status:          NdpStatus;
  daysRemaining:   number | null;
  nextDueDate:     Date | null;
  estimatedAmount: number;
}

export function getNdpStatus(
  lastPaidDate: string | null,
  balance: number,
  aprPct: number,
): NdpInfo {
  const estimatedAmount = Math.round(balance * (aprPct / 100 / 12));

  if (!lastPaidDate) {
    return { status: 'never', daysRemaining: null, nextDueDate: null, estimatedAmount };
  }

  const nextDue = new Date(new Date(lastPaidDate).getTime() + 365 * 24 * 60 * 60 * 1000);
  const daysRemaining = Math.ceil((nextDue.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  const status: NdpStatus =
    daysRemaining < 0   ? 'overdue'
    : daysRemaining <= 30 ? 'soon'
    : daysRemaining <= 60 ? 'upcoming'
    : 'ok';

  return { status, daysRemaining, nextDueDate: nextDue, estimatedAmount };
}
