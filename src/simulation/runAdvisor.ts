import { cbBorrowFee, cbMaxDrawForHeadroom } from './runCoinbaseLoan';   // Coinbase origination-fee brackets (facts, not cycle)
import { bucketEventToMonth, strategyMonthIndex } from './logUtils';   // calendar-anniversary bucketing (cycle-free: logUtils → types only)
import { todayLocalISO } from '../utils/format';

export type AdvisorTier = 1 | 2 | 3 | 4;

// "Today" = the user's LOCAL calendar day, bucketed by the SAME calendar-anniversary function as every event
// date (both yyyy-mm-dd parsed UTC-midnight → compared by Y/M/D; no local/UTC mixing). Replaced Date.now() +
// the old floor(elapsedDays/30.4375) day-arithmetic — one clock now, shared with bucketEventToMonth.
export function getCurrentStrategyMonth(startDate: string): number {
  return bucketEventToMonth(todayLocalISO(), startDate);
}

// Complete once past month 12 — the UNclamped index (bucketEventToMonth saturates at 12; the check needs >12).
export function isStrategyComplete(startDate: string): boolean {
  return strategyMonthIndex(todayLocalISO(), startDate) > 12;
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
  blocLtvCeiling: number;
  cbBalance:        number;
  cbCollateralBtc:  number;
  cbAprPct:         number;
  cbMonthlyPayment: number;
  cbPaymentStrategy: 'monthly' | 'ltvTriggered';
  cbLtvTriggerPct:   number;
  cbLtvTargetPct:    number;
  cbRotateBackPct:   number;
  startingBlocBalance: number;
  startingBtcHeld:     number;
  startingMonth:       number;
  btcGrowthRate:       number;  // annualized decimal (e.g. 0.33), 0 = flat
  blocMinPaymentSource?: 'income' | 'roll';  // how the monthly BLOC minimum (interest) is paid; default 'roll' (capitalize)
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
  strikeRepayFee:   number;    // Coinbase origination fee on that rotation, capitalised into cbBalance (0 if not fired)
  strikeRepayFired: boolean;   // true when the reverse trigger fired this month
  blocMinPayment:   number;    // BLOC minimum (interest) paid from income this month (0 in roll mode)
  blocMinShortfall: number;    // interest that capitalized because income couldn't cover the minimum (0 in roll / when covered)
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
    cbPaymentStrategy, cbLtvTriggerPct, cbLtvTargetPct, cbRotateBackPct,
    startingBlocBalance, startingBtcHeld, startingMonth, btcGrowthRate,
  } = inputs;
  const blocMinPaymentSource = inputs.blocMinPaymentSource ?? 'roll';

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
    let strikeRepayFee:     number  = 0;
    let cbLtvTriggered:    boolean = false;
    let cbPaydownCapped:   boolean = false;
    let cbPaydownShortfall: number = 0;
    let strikeRepayDraw:  number  = 0;
    let strikeRepayFired: boolean = false;
    let blocMinPayment:   number  = 0;
    let blocMinShortfall: number  = 0;

    // CB interest accrues on opening balance (both paths)
    const cbInterest = cbBal * cbMonthlyRate;
    cbBal += cbInterest;

    if (cbPaymentStrategy === 'ltvTriggered') {
      // Check trigger AFTER interest accrual
      const cbLtvNow = cbCollateralBtc * btcPriceThisMonth > 0
        ? cbBal / (cbCollateralBtc * btcPriceThisMonth) : 0;
      // Skip the forward-paydown / reverse-rotation block entirely when thresholds are
      // mis-ordered (nonsense config) — no paydown churn. Draw / interest / paydown / BTC still run.
      const thresholdsOrdered = cbRotateBackPct < cbLtvTargetPct && cbLtvTargetPct < cbLtvTriggerPct;
      if (thresholdsOrdered && cbLtvNow >= cbLtvTriggerPct / 100) {
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
      } else if (thresholdsOrdered && cbLtvNow <= cbRotateBackPct / 100 && blocBalance > 0) {
        // REVERSE rotation: draw cheap CB debt UP TO target, repay expensive Strike.
        // Gated to start only when CB LTV ≤ rotate-back; fills the loan back up TO target
        // (not to rotate-back) — the neutral zone between rotate-back and trigger prevents
        // month-to-month oscillation.
        const cbCeiling  = cbCollateralBtc * btcPriceThisMonth * (cbLtvTargetPct / 100);
        const cbHeadroom = Math.max(0, cbCeiling - cbBal);   // fill to TARGET, not to rotate-back
        // Coinbase charges an origination fee on EVERY borrow and CAPITALISES it, so the target has to
        // hold principal + fee. Gross the headroom down through the same brackets instead of drawing it
        // all as cash and breaching the target by the fee.
        strikeRepayDraw  = Math.min(blocBalance, cbMaxDrawForHeadroom(cbHeadroom, cbBal));
        if (strikeRepayDraw > 0) {
          strikeRepayFee   = cbBorrowFee(strikeRepayDraw, cbBal);
          cbBal        += strikeRepayDraw + strikeRepayFee;   // draw from CB to repay Strike; fee capitalises
          blocBalance  -= strikeRepayDraw;   // Strike balance reduced by the CASH only — the fee buys nothing
          strikeRepayFired = true;
        }
      }

      // Full expense BLOC draw regardless of tier (CB priority rules suspended)
      blocDraw = Math.min(expenses, Math.max(0, creditLine - blocBalance));
      fiatGap  = expenses - blocDraw;

      // BLOC: draw then interest (interest off the post-draw balance in both modes)
      blocBalance  += blocDraw;
      blocInterest  = blocBalance * blocMonthlyRate;

      // Min-payment source: 'roll' capitalizes interest; 'income' pays it from income.
      let incomeBudget: number;
      if (blocMinPaymentSource === 'income') {
        const minPay     = blocInterest;
        blocMinPayment   = Math.min(income, minPay);
        blocMinShortfall = Math.max(0, minPay - income);
        blocBalance     += blocMinShortfall;             // only the UNPAID remainder capitalizes
        incomeBudget     = Math.max(0, income - blocMinPayment);
      } else {
        blocBalance     += blocInterest;                 // roll: full capitalization (byte-identical)
        incomeBudget     = income;
      }

      // BLOC LTV paydown check — funded from the (min-payment-reduced) income budget
      const blocTarget = btcHeld * btcPriceThisMonth * blocLtvCeiling;
      blocPaydown = blocBalance > blocTarget
        ? Math.min(incomeBudget, blocBalance - blocTarget)   // up to 100% of income — matches runBLOC's 15% ceiling defense
        : 0;

      // No CB payment from income in ltvTriggered mode
      cbTotalPayment = 0;
      cbExtraPayment = 0;

      blocBalance -= blocPaydown;
      incomeToBtc  = incomeBudget - blocPaydown;

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

      // BLOC: draw then interest (interest off the post-draw balance in both modes)
      blocBalance  += blocDraw;
      blocInterest  = blocBalance * blocMonthlyRate;

      // Min-payment source: 'roll' capitalizes interest; 'income' pays it from income.
      let incomeBudget: number;
      if (blocMinPaymentSource === 'income') {
        const minPay     = blocInterest;
        blocMinPayment   = Math.min(income, minPay);
        blocMinShortfall = Math.max(0, minPay - income);
        blocBalance     += blocMinShortfall;             // only the UNPAID remainder capitalizes
        incomeBudget     = Math.max(0, income - blocMinPayment);
      } else {
        blocBalance     += blocInterest;                 // roll: full capitalization (byte-identical)
        incomeBudget     = income;
      }

      // BLOC LTV paydown check — funded from the (min-payment-reduced) income budget
      const blocTarget = btcHeld * btcPriceThisMonth * blocLtvCeiling;
      blocPaydown = blocBalance > blocTarget
        ? Math.min(incomeBudget, blocBalance - blocTarget)   // up to 100% of income — matches runBLOC's 15% ceiling defense
        : 0;

      // Income allocation by tier — seeded from the reduced budget
      let remainingIncome = incomeBudget - blocPaydown;
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
      strikeRepayDraw, strikeRepayFee, strikeRepayFired,
      blocMinPayment, blocMinShortfall,
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
