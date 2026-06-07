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
  cbPaymentStrategy: 'monthly' | 'ltvTriggered';
  cbLtvTriggerPct:   number;
  cbLtvTargetPct:    number;
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
  cbPaydownDraw:     number;   // BLOC draw used to pay down CB this month (0 if not triggered)
  cbLtvTriggered:    boolean;  // true when CB LTV trigger fired this month
  cbPaydownCapped:   boolean;  // true when paydown hit the credit ceiling
  cbPaydownShortfall: number;  // desired - actual (0 when not capped)
  strikeRepayDraw:  number;    // amount rotated from Strike to CB (0 if not fired)
  strikeRepayFired: boolean;   // true when the reverse trigger fired this month
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
    cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct,
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

    // Shared per-month variables — declared before branch so both paths can access them
    let blocDraw:        number;
    let fiatGap:         number;
    let blocInterest:    number;
    let blocPaydown:     number;
    let cbTotalPayment:  number;
    let cbExtraPayment:  number;
    let incomeToBtc:     number;
    let btcBought:       number;
    let cbPaydownDraw:      number  = 0;
    let cbLtvTriggered:    boolean = false;
    let cbPaydownCapped:   boolean = false;
    let cbPaydownShortfall: number = 0;
    let strikeRepayDraw:  number  = 0;
    let strikeRepayFired: boolean = false;

    // CB interest accrues on opening balance (both paths)
    const cbInterest = cbBal * cbMonthlyRate;
    cbBal += cbInterest;

    if (cbPaymentStrategy === 'ltvTriggered') {
      // Check trigger AFTER interest accrual
      const cbLtvNow = cbCollateralBtc * btcPriceThisMonth > 0
        ? cbBal / (cbCollateralBtc * btcPriceThisMonth) : 0;
      if (cbLtvNow >= cbLtvTriggerPct / 100) {
        const targetBal       = cbCollateralBtc * btcPriceThisMonth * (cbLtvTargetPct / 100);
        const desiredPaydown  = Math.max(0, cbBal - targetBal);
        const availableCredit = Math.max(0, creditLine - blocBalance);
        cbPaydownDraw   = Math.min(desiredPaydown, availableCredit);
        cbBal          -= cbPaydownDraw;
        blocBalance    += cbPaydownDraw;  // Strike LOC funds the CB paydown
        cbLtvTriggered  = true;
        if (cbPaydownDraw < desiredPaydown) {
          cbPaydownCapped    = true;
          cbPaydownShortfall = desiredPaydown - cbPaydownDraw;
        }
      } else if (cbLtvNow < cbLtvTargetPct / 100 && blocBalance > 0) {
        const cbRoom = Math.max(0,
          cbCollateralBtc * btcPriceThisMonth * (cbLtvTargetPct / 100) - cbBal
        );
        strikeRepayDraw = Math.min(blocBalance, cbRoom);
        if (strikeRepayDraw > 0) {
          cbBal        += strikeRepayDraw;   // draw from CB to repay Strike
          blocBalance  -= strikeRepayDraw;   // Strike balance reduced
          strikeRepayFired = true;
        }
      }

      // Full expense BLOC draw regardless of tier (CB priority rules suspended)
      blocDraw = Math.min(expenses, Math.max(0, creditLine - blocBalance));
      fiatGap  = expenses - blocDraw;

      // BLOC: draw then interest
      blocBalance  += blocDraw;
      blocInterest  = blocBalance * blocMonthlyRate;
      blocBalance  += blocInterest;

      // BLOC LTV paydown check — funded from income
      const blocTarget = btcHeld * btcPriceThisMonth * blocLtvCeiling;
      blocPaydown = blocBalance > blocTarget
        ? Math.min(income * 0.3, blocBalance - blocTarget)
        : 0;

      // No CB payment from income in ltvTriggered mode
      cbTotalPayment = 0;
      cbExtraPayment = 0;

      blocBalance -= blocPaydown;
      incomeToBtc  = income - blocPaydown;

    } else {
      // Monthly payment strategy (original logic)
      cbPaydownDraw  = 0;
      cbLtvTriggered = false;

      // BLOC draw by tier
      if (tier === 4 || tier === 3) {
        blocDraw = Math.min(expenses, Math.max(0, creditLine - blocBalance));
      } else if (tier === 2) {
        blocDraw = Math.min(expenses * 0.5, Math.max(0, creditLine - blocBalance));
      } else {
        blocDraw = 0;
      }
      fiatGap = expenses - blocDraw;

      // BLOC: draw then interest
      blocBalance  += blocDraw;
      blocInterest  = blocBalance * blocMonthlyRate;
      blocBalance  += blocInterest;

      // BLOC LTV paydown check — funded from income
      const blocTarget = btcHeld * btcPriceThisMonth * blocLtvCeiling;
      blocPaydown = blocBalance > blocTarget
        ? Math.min(income * 0.3, blocBalance - blocTarget)
        : 0;

      // Income allocation by tier
      let remainingIncome = income - blocPaydown;
      cbExtraPayment = 0;
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
      cbTotalPayment = Math.min(cbMonthlyPayment + cbExtraPayment, cbBal);
      cbBal       -= cbTotalPayment;
      blocBalance -= blocPaydown;

      incomeToBtc = remainingIncome;
    }

    // Buy BTC with remaining income (both paths)
    btcBought = btcPriceThisMonth > 0 ? incomeToBtc / btcPriceThisMonth : 0;
    btcHeld  += btcBought;

    const blocLtv     = btcHeld * btcPriceThisMonth > 0 ? blocBalance / (btcHeld * btcPriceThisMonth) : 0;
    const cbLtv       = cbCollateralBtc * btcPriceThisMonth > 0 ? cbBal / (cbCollateralBtc * btcPriceThisMonth) : 0;
    const totalInterest = blocInterest + cbInterest;

    totalBtcBought    += btcBought;
    totalInterestPaid += totalInterest;
    totalFiatGap      += fiatGap;

    rows.push({
      month, tier, tierLabel: getTierLabel(tier),
      isCurrentMonth: month === startingMonth,
      blocDraw, fiatGap,
      cbPayment: cbTotalPayment, cbExtraPayment,
      cbPaydownDraw, cbLtvTriggered, cbPaydownCapped, cbPaydownShortfall,
      strikeRepayDraw, strikeRepayFired,
      btcBought, incomeToBtc,
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
