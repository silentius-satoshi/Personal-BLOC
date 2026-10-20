// Pure helpers the plan screens and Smart BLOC's Playbook share — standalone, NO store/UI imports.
//  - the paydown badge (classifyPaydownState / paydownReadout) — Smart BLOC's Playbook (components/Playbook);
//  - Strike's minimum payment status (minPaymentStatus) — THIS MONTH's card, Daily and its sheets.
// The old Monthly Playbook card's helpers (deriveForMonth, composeMonthSummary, isOperatingMonth, displaySettledLtv,
// isLtvFigureStressed) left with the Advisor's rows: since the plan of record's Run 2 no screen called them, and Run 3
// deleted them (spec pbloc-spec-plan-of-record-v1 §13.11, §15).

// ── The paydown badge (numbers only — the copy lives in components/Playbook/playbookView.ts) ──────────────────

/**
 * What a month's ceiling defense did. Four states, from three numbers already on the row:
 *  - quiet       — no paydown, and the peak never crossed the ceiling
 *  - defended    — a paydown fired and the LTV settled at or below the ceiling (routine plan mechanics, not an alarm)
 *  - partial     — a paydown fired but the income ran out: the LTV SETTLED ABOVE the ceiling (defending and losing)
 *  - undefended  — the peak crossed the ceiling and NO paydown fired (no income left to pay it down)
 *  - noCollateral — the draw landed with NO collateral behind it (peak ∞ — debt against zero collateral)
 * partial, undefended and noCollateral are the genuine alarms. ⚠ Keep partial distinct from defended: both have a
 * paydown, and collapsing them makes a losing month look identical to a healthy one.
 * `stillAbove` carries a 1e-9 tolerance: a paydown sized exactly to the gap lands ON the ceiling as a float.
 * ⚠ The noCollateral guard runs FIRST: a paydown CAN fire at zero collateral (runAdvisor paid the whole balance down
 * against a 0 target, until it left in 5e), and the settled blocLtv there is 0, so below the `paydown > 0` line it would
 * classify the worst state as routine 'defended'.
 * ⚠ `peak === 0` stays 'quiet' — ∞ is debt with nothing behind it; 0 is nothing at all. Don't "simplify" to `peak > 0`.
 */
export type PaydownState = 'quiet' | 'defended' | 'partial' | 'undefended' | 'noCollateral';
const CEILING_EPS = 1e-9;

export function classifyPaydownState(peak: number, paydown: number, settled: number, ceiling: number): PaydownState {
  if (!Number.isFinite(peak)) return 'noCollateral';   // ⚠ FIRST — see the doc comment
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
  plan:      { paydown: number; blocLtv: number; blocLtvPeak: number } | null,
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
