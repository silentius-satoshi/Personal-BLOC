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
  minPayment:          number;   // income → BLOC minimum (interest) payment (= row.blocMinPayment; 0 in roll mode)
  blocInterest:        number;   // monthly BLOC interest (capitalizes in roll mode; paid in income mode)
  blocLtv:             number;   // projected EoM Strike LTV (decimal)
  cbLtv:               number;   // projected EoM CB LTV (decimal; 0 if !hasCbLoan)
  allocatedFromIncome: number;   // paydown + btcBoughtUsd + cbPayment + minPayment (= income for a clean projection)
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
  const minPayment   = row.blocMinPayment;
  const paydown      = Math.max(0, income - (hasCbLoan ? row.cbPayment : 0) - row.incomeToBtc - minPayment);
  const allocatedFromIncome = paydown + btcBoughtUsd + cbPayment + minPayment;
  return {
    blocDraw:     row.blocDraw,
    fiatGap:      row.fiatGap,
    btcBoughtUsd,
    btcBought:    row.btcBought,
    cbPayment,
    paydown,
    minPayment,
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
  isLogged:      boolean;
  hasCbLoan:     boolean;
  cbLtv:         number;    // decimal — actual (logged) or projected
  triggerPct:    number;    // e.g. 75
  draw:          number;    // USD drawn from the credit line for expenses
  btcBoughtUsd:  number;    // USD into BTC
  cbPayment:     number;    // USD paid to CB (monthly)
  rotationFired: boolean;   // Strike→CB reverse rotation fired this month
  rotationAmount: number;   // USD rotated
  interest:      number;    // monthly BLOC interest (USD)
  minPayment:    number;    // BLOC minimum paid from income (USD); >0 → income source, 0 → roll (capitalizes)
}

/**
 * Plain-English narration of the selected month. Voice depends on state:
 *  - logged  → past-tense actuals
 *  - otherwise (current + future) → plan voice (what the projection says to do — the current month is
 *    now rendered identically to any projected month; the Ledger owns actuals, so no skip-adjusted voice).
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
  } else {
    if (a.draw > 0)         parts.push(`Draw ${usd(a.draw)} from your credit line for expenses.`);
    if (a.btcBoughtUsd > 0) parts.push(`Buy ${usd(a.btcBoughtUsd)} of Bitcoin.`);
    if (a.hasCbLoan) {
      if (a.rotationFired && a.rotationAmount > 0) parts.push(`Rotate ${usd(a.rotationAmount)} to the cheaper CB loan.`);
      else if (a.cbPayment > 0)                    parts.push(`Pay ${usd(a.cbPayment)} to your Coinbase loan.`);
    }
  }

  if (a.minPayment > 0) {
    // Income source: the monthly minimum (interest) is paid from income rather than capitalizing.
    const verb = a.isLogged ? 'Paid the' : 'Pay the';
    parts.push(`${verb} ${usd(a.minPayment)} Strike minimum from income.`);
  } else if (a.interest > 0) {
    parts.push(`Interest of ${usd(a.interest)} capitalizes onto the balance.`);
  }
  return parts.join(' ');
}

// ── Strike minimum payment lifecycle (Logging Consolidation §2b) ───────────────────────────────
export type MinPaymentStatus = 'PAID' | 'DUE' | 'MISSED' | 'ROLLS';

/**
 * Pure status of this month's Strike minimum. Roll mode has no loggable event → always ROLLS.
 * Income mode: PAID once the month's logged minPayment sum covers the owed figure; else DUE on/before
 * the due day, MISSED past it. All inputs passed in (no Date reads) so it stays pure/testable.
 *   paidSoFar   — sum of this month's logged minPayment events (USD)
 *   owed        — blocStatementMinimum ?? estimate (USD)
 *   dueDay      — blocMinPaymentDueDay (1–28)
 *   todayDay    — current day-of-month (1–31); only meaningful for the CURRENT month
 *   isCurrent   — whether the queried month is the current strategy month (past/future never MISSED-nag)
 */
export function minPaymentStatus(args: {
  source: 'income' | 'roll';
  paidSoFar: number;
  owed: number;
  dueDay: number;
  todayDay: number;
  isCurrent: boolean;
}): MinPaymentStatus {
  if (args.source === 'roll') return 'ROLLS';
  if (args.owed > 0 && args.paidSoFar + 0.005 >= args.owed) return 'PAID';
  if (args.paidSoFar > 0) return 'PAID';                       // any logged payment when owed is unknown/0
  if (args.isCurrent && args.todayDay > args.dueDay) return 'MISSED';
  return 'DUE';
}
