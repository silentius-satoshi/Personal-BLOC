// Pure helpers for the Simple Mode "Monthly Playbook" plan card.
// Standalone — NO store/UI imports (type-only import of AdvisorMonthRow). The scrubber feeds these:
// deriveForMonth = the UNSKIPPED forward projection for a given month (drives non-current rows/bars/
// summary); isOperatingMonth = the operate/preview predicate; composeMonthSummary = the plain-English
// narration (skip-aware on the current month, plan voice for future, past-tense for logged).
// The current-month SKIP-ADJUSTED reality is NOT computed here — it stays in SimpleModeView (reusing
// the existing allocatedFromIncome / eomLtv derivations). See spec v2 "projection-vs-reality split".
import type { AdvisorMonthRow } from './runAdvisor';

const usd = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString();

export interface MonthPlan {
  blocDraw:            number;
  fiatGap:             number;
  btcBoughtUsd:        number;   // income → BTC, in USD (= row.incomeToBtc)
  btcBought:           number;   // income → BTC, in BTC
  cbPayment:           number;   // monthly CB payment (0 in ltvTriggered / !hasCbLoan)
  paydown:             number;   // income → BLOC paydown
  blocInterest:        number;   // monthly BLOC interest (capitalizes)
  blocLtv:             number;   // projected EoM Strike LTV (decimal)
  cbLtv:               number;   // projected EoM CB LTV (decimal; 0 if !hasCbLoan)
  allocatedFromIncome: number;   // paydown + btcBoughtUsd + cbPayment (= income for a clean projection)
  isFullyAllocated:    boolean;
}

/**
 * Unskipped forward projection for a single advisor-row month. The advisor fully allocates income
 * (paydown + BTC + CB = income), so a projection is always fully allocated — uncommitted current-month
 * skips never reach here (they only color the current-month card in SimpleModeView).
 */
export function deriveForMonth(
  row: AdvisorMonthRow,
  income: number,
  hasCbLoan: boolean,
  cbPaymentStrategy: 'monthly' | 'ltvTriggered',
): MonthPlan {
  const cbPayment    = hasCbLoan && cbPaymentStrategy === 'monthly' ? row.cbPayment : 0;
  const btcBoughtUsd = row.incomeToBtc;
  const paydown      = Math.max(0, income - (hasCbLoan ? row.cbPayment : 0) - row.incomeToBtc);
  const allocatedFromIncome = paydown + btcBoughtUsd + cbPayment;
  return {
    blocDraw:     row.blocDraw,
    fiatGap:      row.fiatGap,
    btcBoughtUsd,
    btcBought:    row.btcBought,
    cbPayment,
    paydown,
    blocInterest: row.blocInterest,
    blocLtv:      row.blocLtv,
    cbLtv:        hasCbLoan ? row.cbLtv : 0,
    allocatedFromIncome,
    isFullyAllocated: income > 0 && Math.abs(income - allocatedFromIncome) < 1,
  };
}

/** The operate/preview mode-switch predicate: live controls only on the current month. */
export function isOperatingMonth(selectedMonth: number, currentMonth: number): boolean {
  return selectedMonth === currentMonth;
}

export interface MonthSummaryArgs {
  month:         number;
  isCurrent:     boolean;
  isLogged:      boolean;
  hasCbLoan:     boolean;
  cbLtv:         number;    // decimal — skip-adjusted (current), actual (logged), or projected
  triggerPct:    number;    // e.g. 75
  draw:          number;    // USD drawn from the credit line for expenses
  btcBoughtUsd:  number;    // USD into BTC
  cbPayment:     number;    // USD paid to CB (monthly)
  rotationFired: boolean;   // Strike→CB reverse rotation fired this month
  rotationAmount: number;   // USD rotated
  interest:      number;    // monthly BLOC interest (USD)
  // current-month skip flags (ignored unless isCurrent)
  skipDraw:      boolean;
  skipBtc:       boolean;
  skipCb:        boolean;
  unallocated:   number;    // income left unallocated by a skip (current month)
}

/**
 * Plain-English narration of the selected month. Voice depends on state:
 *  - logged  → past-tense actuals
 *  - current → skip-adjusted reality (branches on the skip flags)
 *  - future  → plan voice (what the projection says to do)
 * Only applicable clauses are included (no CB clause when !hasCbLoan; rotation vs paydown per fired).
 */
export function composeMonthSummary(a: MonthSummaryArgs): string {
  const parts: string[] = [];
  const ltvPct = Math.round(a.cbLtv * 100);

  if (a.hasCbLoan) {
    const near = a.cbLtv * 100 >= a.triggerPct - 5;
    const verb = a.isLogged ? 'was' : 'is';
    parts.push(`Month ${a.month}: CB LTV ${verb} ${ltvPct}% — ${near ? 'approaching' : 'below'} your ${a.triggerPct}% trigger.`);
  } else {
    parts.push(`Month ${a.month}:`);
  }

  if (a.isLogged) {
    if (a.draw > 0)                    parts.push(`You drew ${usd(a.draw)} for expenses.`);
    if (a.btcBoughtUsd > 0)            parts.push(`Bought ${usd(a.btcBoughtUsd)} of Bitcoin.`);
    if (a.hasCbLoan && a.cbPayment > 0) parts.push(`Paid ${usd(a.cbPayment)} to your Coinbase loan.`);
  } else if (a.isCurrent) {
    if (a.skipDraw)        parts.push(`You've skipped the credit-line draw — covering ${usd(a.draw)} from savings.`);
    else if (a.draw > 0)   parts.push(`Draw ${usd(a.draw)} from your credit line for expenses.`);

    if (a.skipBtc)              parts.push(`You've skipped this month's Bitcoin buy — ${usd(a.unallocated)} income unallocated.`);
    else if (a.btcBoughtUsd > 0) parts.push(`Buy ${usd(a.btcBoughtUsd)} of Bitcoin.`);

    if (a.hasCbLoan) {
      if (a.skipCb)                                  parts.push(`You've skipped the Coinbase payment this month.`);
      else if (a.rotationFired && a.rotationAmount > 0) parts.push(`Rotate ${usd(a.rotationAmount)} to the cheaper CB loan.`);
      else if (a.cbPayment > 0)                      parts.push(`Pay ${usd(a.cbPayment)} to your Coinbase loan.`);
    }
  } else {
    if (a.draw > 0)         parts.push(`Draw ${usd(a.draw)} from your credit line for expenses.`);
    if (a.btcBoughtUsd > 0) parts.push(`Buy ${usd(a.btcBoughtUsd)} of Bitcoin.`);
    if (a.hasCbLoan) {
      if (a.rotationFired && a.rotationAmount > 0) parts.push(`Rotate ${usd(a.rotationAmount)} to the cheaper CB loan.`);
      else if (a.cbPayment > 0)                    parts.push(`Pay ${usd(a.cbPayment)} to your Coinbase loan.`);
    }
  }

  if (a.interest > 0) parts.push(`Interest of ${usd(a.interest)} capitalizes onto the balance.`);
  return parts.join(' ');
}
