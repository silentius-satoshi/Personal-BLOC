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
  blocLtv:             number;   // projected EoM Strike LTV (decimal) — SETTLED: after the paydown and the buy
  blocLtvPeak:         number;   // projected in-month HIGH (post-draw, pre-paydown, pre-buy) — what the paydown answers
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
  // The engine's own ceiling-defense figure. It used to be RECONSTRUCTED as an income residual, which agrees in every
  // reachable configuration but would invent a paydown if a row carrying cbPayment > 0 ever met hasCbLoan:false.
  const paydown      = row.blocPaydown;
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
    blocLtvPeak:  row.blocLtvPeak,
    cbLtv:        hasCbLoan ? row.cbLtv : 0,
    allocatedFromIncome,
    isFullyAllocated: income > 0 && Math.abs(income - allocatedFromIncome) < 1,
  };
}

// ── The paydown badge (numbers only — the copy lives in components/Playbook/playbookView.ts) ──────────────────

/**
 * What a month's ceiling defense did. Four states, from three numbers already on the row:
 *  - quiet       — no paydown, and the peak never crossed the ceiling
 *  - defended    — a paydown fired and the LTV settled at or below the ceiling (routine plan mechanics, not an alarm)
 *  - partial     — a paydown fired but the income ran out: the LTV SETTLED ABOVE the ceiling (defending and losing)
 *  - undefended  — the peak crossed the ceiling and NO paydown fired (no income left to pay it down)
 * partial and undefended are the only genuine alarms. ⚠ Keep partial distinct from defended: both have a paydown,
 * and collapsing them makes a losing month look identical to a healthy one.
 * `stillAbove` carries a 1e-9 tolerance: a paydown sized exactly to the gap lands ON the ceiling as a float.
 * At zero collateral, runAdvisor's settled blocLtv is a pre-existing 0 (it should be ∞), and that shows through here.
 */
export type PaydownState = 'quiet' | 'defended' | 'partial' | 'undefended';
const CEILING_EPS = 1e-9;

export function classifyPaydownState(peak: number, paydown: number, settled: number, ceiling: number): PaydownState {
  if (paydown > 0) return settled > ceiling + CEILING_EPS ? 'partial' : 'defended';
  return peak > ceiling + CEILING_EPS ? 'undefended' : 'quiet';
}

export interface PaydownReadout {
  mode:        'actual' | 'inProgress' | 'projected' | 'none';
  ltv:         number;               // actual/inProgress: the ledger LTV; projected: the plan's settled EoM LTV
  peakLtv:     number;               // the plan's in-month peak (0 for actual/none)
  paydown:     number;               // actual: the ledger's; inProgress/projected: the PLANNED paydown
  paydownDone: number;               // inProgress: the ledger paydown so far; actual: = paydown; else 0
  state:       PaydownState | null;  // the PLAN's state (null for actual/none — a ledger month has no peak)
}

/**
 * The Playbook header's LTV + paydown pair, from ONE source. Mixing sources is the defect this replaces: barStrikeLtv
 * already preferred the ledger while the paydown flag always read the plan ("12.8% — paydown triggered").
 *  - a logged month that is NOT current → the ledger (actual LTV, actual paydown). The ledger wins even when it logged
 *    no paydown and the plan projected one.
 *  - the CURRENT month with an entry → in progress: the ledger LTV so far, but the PLANNED paydown stays the
 *    instruction (with the ledger's progress). The owner journals in Simple mode daily, so the current month has an
 *    entry from its first event — letting the ledger win here would hide the plan all month.
 *  - otherwise → the plan.
 * The ledger paydown is Strike-only (CB paydowns are journal-only), and it inherits the pre-existing stale-field
 * defect: deleting a month's last Strike paydown leaves entry.paydown at its old value.
 */
export function paydownReadout(
  plan:      Pick<MonthPlan, 'paydown' | 'blocLtv' | 'blocLtvPeak'> | null,
  logged:    { paydown: number; strikeLtv: number } | null,
  isCurrent: boolean,
  ceiling:   number,
): PaydownReadout {
  const planState = plan ? classifyPaydownState(plan.blocLtvPeak, plan.paydown, plan.blocLtv, ceiling) : null;
  if (logged && isCurrent && plan) {
    return { mode: 'inProgress', ltv: logged.strikeLtv, peakLtv: plan.blocLtvPeak, paydown: plan.paydown, paydownDone: logged.paydown, state: planState };
  }
  if (logged) {
    return { mode: 'actual', ltv: logged.strikeLtv, peakLtv: 0, paydown: logged.paydown, paydownDone: logged.paydown, state: null };
  }
  if (plan) {
    return { mode: 'projected', ltv: plan.blocLtv, peakLtv: plan.blocLtvPeak, paydown: plan.paydown, paydownDone: 0, state: planState };
  }
  return { mode: 'none', ltv: 0, peakLtv: 0, paydown: 0, paydownDone: 0, state: null };
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
