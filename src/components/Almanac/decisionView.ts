import type { CyclingResult, CyclingRow, PolicyIgnoredReason } from '../../simulation/cyclingSim';
import { allInEquity } from '../../simulation/cyclingSim';
import { deriveOwnership } from '../../simulation/ownership';
import type { PlacementPlan } from '../../simulation/placement';
import { MOVE_THRESHOLD_BTC } from '../../simulation/placement';
import type { PolicyState } from '../../simulation/supportPolicy';
import { HARD_BREAKER_DEPTH, HARD_BREAKER_MONTHS } from '../../simulation/supportPolicy';
import { ceilingLiquidationMultiple } from '../../simulation/cbDefense';
import { cbMetrics } from '../../simulation/cbMetrics';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { STRIKE_CURE_LTV, STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import type { PathKind } from '../../simulation/cyclePath';
import type { WorstBy } from '../../simulation/planSearch';
import { STRIKE_HOLD_DAYS, atTriggerLine } from '../Tools/crashPlaybookView';
import {
  DISPLAY_DUST_BTC, fmtBelowPct, policyIgnoredNote, shownBtc, shownUsd, goalActs, GOAL_STAND_DOWN_WORDS,
} from './supportPolicyView';
import { netCoinsBtc, atGoalOf } from '../../simulation/goal';
import type { PlacementInput } from '../../simulation/placement';
import { fmtTurnDate, type NeverDrawVerdict } from './cyclingFaceView';
import type { BreakerSeed } from './supportPolicyInputs';
import { ALL_IN, fmtUSD } from '../../utils/format';
import { deriveVenueSplit } from '../../simulation/viewerVenue';
import type { Venue } from '../../lib/venueColors';
import { monthYear } from './futuresView';

/**
 * The Decision face's SCHEDULE and THE MOVE's copy — pure, so every sentence is testable without a render harness.
 *
 * 🔴 THE FACE COMPOSES NO COPY. Every line THE MOVE shows comes from `moveCard`, and every action in the schedule
 * comes from `ACTION_FIELDS`. A sentence written in JSX is a sentence no test can reach.
 *
 * 🔴 THE CLIFF IS `cbMetrics().liqPrice`, wherever it prints or draws — the same formula the Safety Dashboard and
 * the CB Loan tab already use. Never a second one.
 */

// ── the schedule ─────────────────────────────────────────────────────────────────────────────────────────────

export type ActionKind =
  | 'draw' | 'buy' | 'refinance' | 'strikeToCoinbase' | 'strikeToCold' | 'coinbaseToCold'
  | 'coldToCoinbase' | 'strikeReleaseToCoinbase' | 'debtShift' | 'defenseShort'
  | 'coldToStrike' | 'cashCure' | 'coldCure' | 'strikeSale'
  | 'cashToBills' | 'payMinimum' | 'repayStrike' | 'repayCoinbase' | 'unpaid' | 'liquidation';

export interface Action { kind: ActionKind; usd: number | null; btc: number | null; text: string }

export interface ScheduleRow {
  m: number;
  label: string;
  actions: Action[];
  keepAtSupportBtc: number | null;
  zone: PolicyState | null;
  crash: boolean;
  /** BL14 — the month acted at the owner's goal (net coins at or above it): it borrowed and bought nothing. */
  atGoal: boolean;
}

/** BL14 — a goal month's mark, said in full (the schedule's zone cell, its title and aria-label): the plan borrows and buys
 *  nothing — or, in a month whose crash defense drew on Strike (its row lists the debt shift, δ-L2), it buys nothing and
 *  borrows only for that defense. */
export const goalMarkLabel = (r: Pick<ScheduleRow, 'actions'>): string =>
  `At your goal — the plan ${goalActs(r.actions.some((a) => a.kind === 'debtShift'))}`;
/** BL14 — the printout's word for a goal month, beside its zone. */
export const GOAL_MARK_TEXT = 'at your goal';

/** A crash month's moves are the playbook's, not placement's — the face points at the Emergency Console for them. */
const CRASH_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'coldToCoinbase', 'strikeReleaseToCoinbase', 'debtShift', 'defenseShort', 'coldToStrike',
  'cashCure', 'coldCure', 'strikeSale', 'liquidation',
]);

/** BTC to 3 dp — the schedule's and the card's one ₿ format. Never called below `DISPLAY_DUST_BTC`. */
export const fmtBtc3 = (n: number): string => n.toFixed(3);

/** A dollar formatter. The face prints whole dollars (`fmtUSD`, the default everywhere here); THIS MONTH and Daily
 *  pass `fmtUSDCents` through `planSchedule`, so "Why this plan?" reads the face's own words to the cent (Run 2.1,
 *  BL19). The words never change — only how their dollars print. */
export type UsdFmt = (n: number) => string;

/**
 * THE ONE field → action table, in the engine's own month order. Every row field that is an owner ACTION, an unpaid
 * bill or an event is here; the completeness sweep enumerates this list, so a field added to `CyclingRow` without a
 * row here is a step the printed schedule would silently drop.
 */
interface ActionField {
  kind: ActionKind;
  /** The row field this reads. `null` for the liquidation event, which is a month, not an amount. */
  field: keyof CyclingRow | null;
  unit: 'usd' | 'btc';
  text: (row: CyclingRow, usd?: UsdFmt) => string;
}

export const ACTION_FIELDS: readonly ActionField[] = [
  { kind: 'draw', field: 'strikeDrawn', unit: 'usd', text: (r, usd = fmtUSD) => `Draw ${usd(r.strikeDrawn)} on Strike for bills.` },
  {
    kind: 'cashToBills', field: 'cashToBillsUsd', unit: 'usd',
    text: (r, usd = fmtUSD) => `Pay ${usd(r.cashToBillsUsd)} of bills from your cash reserve.`,
  },
  { kind: 'unpaid', field: 'unfundedUsd', unit: 'usd', text: (r, usd = fmtUSD) => `${usd(r.unfundedUsd)} of bills go unpaid.` },
  {
    kind: 'payMinimum', field: 'strikeMinPaidUsd', unit: 'usd',
    text: (r, usd = fmtUSD) => `Pay Strike's minimum, ${usd(r.strikeMinPaidUsd)}, from income.`,
  },
  {
    kind: 'repayStrike', field: 'strikeRepaidUsd', unit: 'usd',
    text: (r, usd = fmtUSD) => `Repay ${usd(r.strikeRepaidUsd)} of Strike from spare income.`,
  },
  {
    kind: 'repayCoinbase', field: 'cbRepaidUsd', unit: 'usd',
    text: (r, usd = fmtUSD) => `Repay ${usd(r.cbRepaidUsd)} of Coinbase from spare income.`,
  },
  {
    kind: 'buy', field: 'btcBoughtUsd', unit: 'usd',
    // fmtBtc3 is never called below the dust floor: a buy under it has no "≈ 0.000 ₿" (Run 2 — THIS MONTH prints this).
    text: (r, usd = fmtUSD) => {
      const btc = r.price > 0 ? r.btcBoughtUsd / r.price : 0;
      return `Buy ${usd(r.btcBoughtUsd)} of bitcoin${shownBtc(btc) ? ` (≈ ${fmtBtc3(btc)} ₿)` : ''} and pledge it to Coinbase.`;
    },
  },
  {
    kind: 'strikeToCoinbase', field: 'strikeToCbBtc', unit: 'btc',
    text: (r) => `Release ${fmtBtc3(r.strikeToCbBtc)} ₿ of Strike collateral into Coinbase.`
      + (r.strikeToCbBtc < MOVE_THRESHOLD_BTC ? ' (small — can wait)' : ''),
  },
  {
    // BL32 — the stand-down's step 5: Strike releases straight to cold (Today's words, `todayActions`, for a month's row).
    kind: 'strikeToCold', field: 'strikeToColdBtc', unit: 'btc',
    text: (r) => `Release ${fmtBtc3(r.strikeToColdBtc)} ₿ of Strike collateral to cold storage.`
      + (r.strikeToColdBtc < MOVE_THRESHOLD_BTC ? ' (small — can wait)' : ''),
  },
  {
    kind: 'refinance', field: 'refinancedUsd', unit: 'usd',
    // A fee under the dust floor is not named — the schedule never prints "$0" (Run 2 — THIS MONTH prints this).
    text: (r, usd = fmtUSD) => `Move ${usd(r.refinancedUsd)} of Strike debt to Coinbase`
      + `${shownUsd(r.refinancedFeeUsd) ? ` (Coinbase's fee: ${usd(r.refinancedFeeUsd)})` : ''}.`,
  },
  {
    kind: 'coldToCoinbase', field: 'topUpFromColdBtc', unit: 'btc',
    text: (r) => `Move ${fmtBtc3(r.topUpFromColdBtc)} ₿ from cold storage into Coinbase.`,
  },
  {
    kind: 'strikeReleaseToCoinbase', field: 'topUpFromStrikeBtc', unit: 'btc',
    text: (r) => `Release ${fmtBtc3(r.topUpFromStrikeBtc)} ₿ of Strike collateral into Coinbase to defend it.`,
  },
  {
    kind: 'debtShift', field: 'defenseDrawnUsd', unit: 'usd',
    text: (r, usd = fmtUSD) => `Draw ${usd(r.defenseDrawnUsd)} on Strike and pay Coinbase down with it.`,
  },
  {
    kind: 'coldToStrike', field: 'strikeTopUpBtc', unit: 'btc',
    text: (r) => `Move ${fmtBtc3(r.strikeTopUpBtc)} ₿ from cold storage into Strike to hold its line.`,
  },
  {
    kind: 'defenseShort', field: 'defenseShortfallUsd', unit: 'usd',
    text: (r, usd = fmtUSD) => `The defense falls ${usd(r.defenseShortfallUsd)} short — Coinbase stays over its defense line.`,
  },
  {
    kind: 'cashCure', field: 'cashToCureUsd', unit: 'usd',
    text: (r, usd = fmtUSD) => `Pay ${usd(r.cashToCureUsd)} from your cash reserve to cure Strike's margin call.`,
  },
  {
    kind: 'coldCure', field: 'strikeCureColdBtc', unit: 'btc',
    text: (r) => `Move ${fmtBtc3(r.strikeCureColdBtc)} ₿ from cold storage into Strike to cure its margin call.`,
  },
  {
    kind: 'strikeSale', field: 'strikeLiquidatedBtc', unit: 'btc',
    text: (r) => `Strike sells ${fmtBtc3(r.strikeLiquidatedBtc)} ₿ of collateral (margin call).`,
  },
  {
    kind: 'coinbaseToCold', field: 'sweptToColdBtc', unit: 'btc',
    text: (r) => `Move ${fmtBtc3(r.sweptToColdBtc)} ₿ from Coinbase to cold storage.`
      + (r.sweptToColdBtc < MOVE_THRESHOLD_BTC ? ' (small — can wait)' : ''),
  },
  { kind: 'liquidation', field: null, unit: 'usd', text: () => 'Coinbase liquidates the loan.' },
];

const amountOf = (row: CyclingRow, f: ActionField): number => {
  if (f.field === null) return 0;
  const v = row[f.field];
  return typeof v === 'number' ? v : 0;
};

/** How the run's liquidation was read: on the way down (Policy v2 — before the month acted, at the liquidation
 *  price) or at month-end (after it, at the month's price). */
export interface SeizureRead { onTheWayDown: boolean; priceUsd: number | null }
export const MONTH_END_SEIZURE: SeizureRead = { onTheWayDown: false, priceUsd: null };

/** Every action a MONTH ≥ 1 performs, read verbatim from its row. An amount under its floor is left out — a
 *  schedule never prints "$0" or "0.000 ₿". The liquidation is listed where it happened: LAST at a month-end seizure
 *  (after the month acted), FIRST on the way down (before it did — the actions after it are the survivor's), naming
 *  the price only above the dust floor. */
export function rowActions(
  row: CyclingRow, liqMonth: number | null, seizure: SeizureRead = MONTH_END_SEIZURE, usd: UsdFmt = fmtUSD,
): Action[] {
  const out: Action[] = [];
  for (const f of ACTION_FIELDS) {
    if (f.field === null) {
      if (liqMonth === null || row.m !== liqMonth) continue;
      if (seizure.onTheWayDown) {
        // The liquidation is ACTION_FIELDS' last entry, so every other action is already in `out`.
        const p = seizure.priceUsd;
        const at = p !== null && shownUsd(p) ? `, at ${usd(p)}` : '';
        out.unshift({ kind: f.kind, usd: null, btc: null, text: `Coinbase liquidates the loan on the way down${at}.` });
      } else {
        out.push({ kind: f.kind, usd: null, btc: null, text: f.text(row, usd) });
      }
      continue;
    }
    const v = amountOf(row, f);
    if (f.unit === 'usd' ? !shownUsd(v) : !shownBtc(v)) continue;
    out.push({ kind: f.kind, usd: f.unit === 'usd' ? v : null, btc: f.unit === 'btc' ? v : null, text: f.text(row, usd) });
  }
  return out;
}

/**
 * TODAY's row reads the PLAN, never a row — the engine has not run this month yet.
 *
 * ⚠ N5 — NO actions unless the move is actually made (`'ready'` and `worthMoving`): under the threshold nothing
 * moves, and THE MOVE's batch line says why. ⚠ And no leg is ever marked "(small — can wait)": when today's
 * total is worth moving, EVERY leg moves today, which is what the seeded run assumes (D10). A per-leg marker
 * there contradicted "Strike releases this today". Future rows keep their markers — those moves are the engine's.
 */
export function todayActions(plan: PlacementPlan): Action[] {
  if (plan.state !== 'ready' || !plan.worthMoving) return [];
  const out: Action[] = [];
  if (shownBtc(plan.strikeToCbBtc)) {
    out.push({
      kind: 'strikeToCoinbase', usd: null, btc: plan.strikeToCbBtc,
      text: `Release ${fmtBtc3(plan.strikeToCbBtc)} ₿ of Strike collateral into Coinbase.`,
    });
  }
  if (shownBtc(plan.strikeToColdBtc)) {
    out.push({
      kind: 'strikeToCold', usd: null, btc: plan.strikeToColdBtc,
      text: `Release ${fmtBtc3(plan.strikeToColdBtc)} ₿ of Strike collateral to cold storage.`,
    });
  }
  if (shownBtc(plan.cbToColdBtc)) {
    out.push({
      kind: 'coinbaseToCold', usd: null, btc: plan.cbToColdBtc,
      text: `Move ${fmtBtc3(plan.cbToColdBtc)} ₿ from Coinbase to cold storage.`,
    });
  }
  return out;
}

export function planSchedule(sim: CyclingResult, plan: PlacementPlan, usd: UsdFmt = fmtUSD): ScheduleRow[] {
  // ⚠ Today's move is the POLICY's: when the run did not apply it (off, or ignored), THE MOVE card names no move,
  // so neither does the Today row — and it shows no keep, as the policy-absent rows below it don't.
  const rows: ScheduleRow[] = [{
    m: 0,
    label: 'Today',
    actions: sim.policyApplied ? todayActions(plan) : [],
    keepAtSupportBtc: sim.policyApplied ? plan.strikeKeepBtc : null,
    zone: sim.policyApplied ? sim.rows[0]?.policyZone ?? null : null,
    crash: false,
    // Today's row is THE MOVE's: it reads the goal only to stand down (BL32), which THE MOVE's card says in words — the
    // mark stays the months' (a month at the goal borrows and buys nothing; Today places collateral and does neither).
    atGoal: false,
  }];
  for (const row of sim.rows) {
    if (row.m === 0) continue;
    const actions = rowActions(row, sim.liqMonth, { onTheWayDown: sim.seizedOnTheWayDown, priceUsd: sim.seizurePriceUsd }, usd);
    rows.push({
      m: row.m,
      label: `Month ${row.m}`,
      actions,
      keepAtSupportBtc: row.strikeKeepBtc,
      zone: row.policyZone,
      crash: actions.some((a) => CRASH_KINDS.has(a.kind)),
      atGoal: row.atGoal === true,
    });
  }
  return rows;
}

export function planOutcome(sim: CyclingResult): {
  cold: number; yours: number; allIn: number; liqMonth: number | null;
} {
  const last = sim.last;
  return {
    cold: last.coldBtc,
    // THREE arguments — a row's `btcHeld` already holds cold.
    yours: deriveOwnership(last.btcHeld, last.debt, last.price).yoursBtc,
    allIn: allInEquity(sim),
    liqMonth: sim.liqMonth,
  };
}

/** When the owner has no Coinbase loan, the plan may still OPEN one — say when, rather than letting a schedule of
 *  Coinbase moves appear out of nowhere (decision 2). `null` once they have a loan, or if the plan never uses one. */
export function coinbaseLoanLine(
  sim: CyclingResult, plan: PlacementPlan, hasCbLoan: boolean,
): string | null {
  if (hasCbLoan) return null;
  // ⚠ F2 — "today" only when the move is actually MADE: a sub-threshold plan reaches Coinbase in `after` but
  // moves nothing today, and the line said "collateral moves to Coinbase today". And only when the run applied the
  // policy — off or ignored, THE MOVE card names no move today.
  const movesToday = sim.policyApplied && plan.state === 'ready' && plan.worthMoving && shownBtc(plan.strikeToCbBtc);
  const firstMove = sim.rows.find((r) => r.m > 0 && shownBtc(r.strikeToCbBtc));
  if (!movesToday && firstMove === undefined) return null;
  const when = movesToday ? 'today' : `in month ${firstMove!.m}`;
  const firstBorrow = sim.rows.find((r) => r.m > 0 && shownUsd(r.refinancedUsd));
  return firstBorrow === undefined
    ? `You have no Coinbase loan yet. This plan opens one: collateral moves to Coinbase ${when}, but this path never `
      + 'borrows on Coinbase.'
    : `You have no Coinbase loan yet. This plan opens one: collateral moves to Coinbase ${when}, and the first `
      + `borrow is in month ${firstBorrow.m}.`;
}

/**
 * The print artifact — the schedule as plain text, carrying THE MOVE and the disclaimer with it.
 * `consoleRuns` is REQUIRED: a crash row prints `crashNote(consoleRuns)`, the one sentence the screen shows too
 * (D13), so the printout can't drift from the face.
 */
export function scheduleToText(
  rows: ScheduleRow[], header: string, move: string, disclaimer: string, consoleRuns: boolean,
): string {
  const out: string[] = [header, '', move, ''];
  for (const r of rows) {
    if (r.actions.length === 0) continue;
    const marks = [r.zone, r.atGoal ? GOAL_MARK_TEXT : null].filter((x): x is string => x !== null);
    out.push(`${r.label}${marks.length > 0 ? ` (${marks.join(' · ')})` : ''}`);
    for (const a of r.actions) out.push(`  - ${a.text}`);
    if (r.crash) out.push(`  ! ${crashNote(consoleRuns)}`);
    out.push('');
  }
  out.push(disclaimer);
  return out.join('\n');
}

/**
 * D13 — a crash month points to the Emergency Console; it never restates it. `consoleRuns` is `hasCbLoan` (D3, the plan
 * of record's Run 4 — it was the LTV-triggered strategy until that retired): the console only runs then, and only then
 * does the face add a tap-through to it.
 */
export function crashNote(consoleRuns: boolean): string {
  const head = "A crash month — these are the monthly model's estimates; on the day, work from the Emergency Console";
  return consoleRuns ? `${head}.` : `${head} ${CONSOLE_GATE}.`;
}

/** Where the console is when it isn't running — its one gate, the Coinbase loan's switch (D3, Run 4). */
const CONSOLE_GATE = '(it runs once your Coinbase loan is switched on)';

/** The crash row's tap-through, named for its month (C2: it sits on a row of its own, beneath the row button). */
export const consoleLinkLabel = (m: number): string => `Open the Emergency Console for month ${m}`;

// ── THE MOVE's copy (v1.3) ───────────────────────────────────────────────────────────────────────────────────

export type MoveTone = 'plain' | 'good' | 'warn' | 'bad';
/** The line's button — the one what-if THE MOVE offers. The face renders it and composes nothing. */
export interface LineAction { kind: 'tryLine' | 'backToLine'; label: string; lineUsd: number }
export interface MoveLine { key: string; tone: MoveTone; text: string; action?: LineAction }
export interface MoveCardCopy { title: string; lines: MoveLine[] }

export const MOVE_CARD_TITLE = "The support policy's move this month";
/** N3 — what the card says when the plan could not be worked out at all. */
export const UNAVAILABLE_LINE =
  "The move can't be worked out right now — today's price, the support line or a balance isn't available.";

/** The face's framing line, under its title. */
export const DECISION_FRAMING =
  "What the support policy would do this month, and the modeled plan that follows — a model, never advice.";

/** B3 — THE MOVE is measured at S₀ and today's anchor, so no path choice changes it. The owner's copy never says
 *  "THE MOVE" (this spec's internal name). */
export const PATH_INVARIANT_LINE =
  "This move is measured at today's support and today's price, so switching paths below doesn't change it.";

/** G5 — the price history is still in flight. `[]` until it lands is NOT "didn't load". Sweep 2c (L3): exactly as long
 *  as the plain reading ("Month-ends through DD Mon YYYY: the model isn't treated as broken.", 66 characters) and
 *  ending in the same 35, so in the card's monospace face it wraps as the plain reading does at every width — THE MOVE
 *  card keeps its height and the chart under it holds still when the history lands. Measured at every screen from 300
 *  to 1440 px; a line one character shorter took one line fewer at 511–517 px. */
export const BREAKER_LOADING_LINE = "While price history is loading, the model isn't treated as broken.";

/** §4.7 (Run 2) — the card IS the plan of record's move: THIS MONTH and Daily show the same one. */
export const PLAN_OF_RECORD_LINE = "This is your plan of record's move this month — the support policy, with your settings.";
/** §4.7 — with a what-if on the move (the policy's settings or the line), the card shows the what-if's move instead. */
export const PLAN_WHAT_IF_LINE = 'A what-if — your plan is unchanged.';
export const planOfRecordLine = (whatIf: boolean): string => (whatIf ? PLAN_WHAT_IF_LINE : PLAN_OF_RECORD_LINE);

/** What the breaker fold found — `null` when the price history did not load. */
export interface BreakerReading {
  broken: boolean;
  /** Consecutive month-ends at or above support while broken. */
  monthsAtOrAbove: number;
  /** Consecutive month-ends below support while NOT broken — one short of the trip is worth saying. */
  monthsBelow: number;
  /** The last month-end the fold read, already formatted for display. */
  lastMonthEndLabel: string;
}

export interface MoveCardContext {
  /** §4.7 — a what-if engaged on the move (the policy's settings or the line): the first line says so. */
  whatIf: boolean;
  policyApplied: boolean;
  policyEnabled: boolean;
  policyIgnoredReason: PolicyIgnoredReason | null;
  plan: PlacementPlan;
  /** Strike's 60-day hold: the face reads `strikeDepositOf` → `strikeHoldAt` (the owner's LOGGED deposits, or a
   *  trusted viewer's snapshot date). */
  holdThroughISO: string | null;
  holdDepositISO: string | null;
  /** `'loading'` while the history fetch is in flight; `null` once it settled with nothing usable. */
  breaker: BreakerReading | 'loading' | null;
  /** The run's re-arm rule, in months (null = a true latch). */
  rearmRule: number | null;
  /** The line the RUN uses, and the owner's own — equal unless the what-if is engaged. */
  runLineUsd: number;
  ownerLineUsd: number;
  suggestedLineUsd: number;
  expenses: number;
  bearBufferMonths: number;
  cbStop: number;
  support: number;
  price: number;
  cbDebt: number;
  cbLtvTriggerPct: number;
  cbLtvTargetPct: number;
  hasCbLoan: boolean;
  /** A Coinbase loan is switched on, so the Emergency Console runs (D3, Run 4 — the LTV-triggered strategy until then). */
  consoleRuns: boolean;
  /** BL14 (δ4) — the plan's next decision is at the owner's goal (`atGoalThisMonthOf`: THIS MONTH's own figure — THE
   *  MOVE's coins and debts at its price, after a month of Coinbase's interest — so the card stays the same on every path and
   *  agrees with THIS MONTH's goal line). The plan borrows nothing while it stays there, so the over-limit line drops "before
   *  it borrows again" (the N8 rule). False (or absent) with no goal. */
  atGoalThisMonth?: boolean;
}

/** BL14 (δ4) — net coins THIS MONTH, as the engine reads them at month 1 on a flat path: THE MOVE's own position (moves
 *  between Strike, Coinbase and cold never change net coins) at its price, once a month of Coinbase's interest is added,
 *  before Strike's — THIS MONTH's goal line's figure. Null when unreadable. */
export function netCoinsThisMonthOf(
  input: Pick<PlacementInput, 'strikeCollateralBtc' | 'cbCollateralBtc' | 'coldBtc' | 'strikeBalance' | 'cbDebt' | 'price'>,
  cbAprPct: number,
): number | null {
  return netCoinsBtc({
    strikeBtc: input.strikeCollateralBtc, cbBtc: input.cbCollateralBtc, coldBtc: input.coldBtc,
    strikeBalanceUsd: input.strikeBalance, cbDebtUsd: input.cbDebt * (1 + cbAprPct / 100 / 12), price: input.price,
  });
}

/** BL14 (δ4) — that figure against the goal (the engine's own rule, `atGoalOf`). False with no goal. */
export const atGoalThisMonthOf = (
  input: Parameters<typeof netCoinsThisMonthOf>[0], cbAprPct: number, goal: number | null,
): boolean => goal !== null && atGoalOf(netCoinsThisMonthOf(input, cbAprPct), goal);

const pctInt = (x: number): string => `${Math.round(x * 100)}%`;
const line = (key: string, tone: MoveTone, text: string): MoveLine => ({ key, tone, text });

/**
 * THE MOVE, as data. Every sentence §7 specifies, in §7's order, each with a tone — so Run B renders and composes
 * nothing. A line only appears when it is TRUE of its inputs, and no figure under its dust floor is ever named.
 */
export function moveCard(ctx: MoveCardContext): MoveCardCopy {
  const lines: MoveLine[] = [line('planOfRecord', 'plain', planOfRecordLine(ctx.whatIf))];
  const { plan } = ctx;

  if (!ctx.policyApplied) {
    lines.push(ctx.policyEnabled
      ? line('state', 'warn', policyIgnoredNote(ctx.policyIgnoredReason))
      : line('state', 'plain', 'This card needs the support policy — turn it on in the card below.'));
    return { title: MOVE_CARD_TITLE, lines };
  }

  // ── N3: nothing can be worked out, so say THAT and stop. Every line below reads a figure the plan could not
  // compute — the why line printed "at support ($0)" or "($NaN)", and the aligned line said the position was
  // already where it should be, which is a claim about a position nobody knows.
  if (plan.state === 'unavailable') {
    lines.push(line('state', 'warn', UNAVAILABLE_LINE));
    return { title: MOVE_CARD_TITLE, lines };
  }

  // 🔴 F3 — ONE predicate for "has a Coinbase loan", used by the why line, the cliff and the paydown clause.
  // `hasCbLoan` alone is a SETTING: a paid-off loan still has it, and printed "$0 debt" and a "$0" seizure price
  // (fmtUSD rounds to whole dollars, so $0.40 owed reads as $0).
  const hasLoan = ctx.hasCbLoan && shownUsd(ctx.cbDebt);

  // ── the moves ──────────────────────────────────────────────────────────────────────────────────────────────
  // Only when the move is actually MADE (N5): under the threshold nothing moves, and the batch line says why —
  // listing legs there described a position that will not exist.
  const parts: string[] = [];
  if (plan.state === 'ready' && plan.worthMoving) {
    // BL32 — at the stand-down the plan keeps nothing on Strike: coins still there wait out Strike's hold, and the hold
    // line says when they go — never "keep … on Strike" beside "keeps nothing on Strike".
    if (shownBtc(plan.after.strikeCollateralBtc) && !plan.standDown) {
      parts.push(`keep ${fmtBtc3(plan.after.strikeCollateralBtc)} ₿ on Strike`);
    }
    if (shownBtc(plan.strikeToCbBtc)) parts.push(`move ${fmtBtc3(plan.strikeToCbBtc)} ₿ to Coinbase`);
    if (shownBtc(plan.strikeToColdBtc)) parts.push(`move ${fmtBtc3(plan.strikeToColdBtc)} ₿ to cold`);
    if (shownBtc(plan.cbToColdBtc)) parts.push(`move ${fmtBtc3(plan.cbToColdBtc)} ₿ from Coinbase to cold`);
    if (parts.length > 0) lines.push(line('moves', 'good', `Today: ${parts.join(' · ')}`));
  }

  // ── why ────────────────────────────────────────────────────────────────────────────────────────────────────
  const room = ctx.bearBufferMonths;
  const billsKnown = Number.isFinite(ctx.expenses) && ctx.expenses > 0;
  const cbClause = !hasLoan
    ? (room > 0 && billsKnown
      ? `Coinbase keeps ${room} months of bills of room at support`
      : 'Coinbase needs to keep nothing')
    : (room > 0 && billsKnown
      ? `Coinbase keeps what its ${fmtUSD(ctx.cbDebt)} debt plus ${room} months of bills need at support`
      : `Coinbase keeps what its ${fmtUSD(ctx.cbDebt)} debt needs at support`);
  // BL32 — at the stand-down nothing is kept for the line or the buffer, so the keeps' sentence would be false.
  lines.push(line('why', 'plain', plan.standDown
    ? `At your goal with both loans repaid, ${GOAL_STAND_DOWN_WORDS}.`
    : `Strike keeps what your ${fmtUSD(ctx.runLineUsd)} line needs at support (${fmtUSD(ctx.support)}); ${cbClause}.`));

  // ── the state line ─────────────────────────────────────────────────────────────────────────────────────────
  // 🔴 F4 — an EXHAUSTIVE switch with a `never` default. As an if/else-if chain a state with no branch fell into
  // the READY arm, so an inert plan would have printed "Nothing to move — Strike and Coinbase hold no more than
  // they need at support." and the compiler could not see it. Adding a PlacementState now fails `tsc`.
  const movedBtc = plan.strikeToCbBtc + plan.strikeToColdBtc + plan.cbToColdBtc;
  switch (plan.state) {
  case 'cbPastLiquidation':
    lines.push(line('state', 'bad',
      `Coinbase is at or past its ${pctInt(CB_LLTV)} liquidation line — the policy moves nothing today.`
      + consoleTail(ctx)));
    break;
  case 'broken':
    // The breaker line below says until when.
    lines.push(line('state', 'bad',
      'The model is treated as broken — the policy moves nothing off Strike or Coinbase today.'));
    break;
  case 'paused':
    lines.push(line('state', 'warn',
      'Price is below support — the policy moves nothing off Strike or Coinbase today.'));
    break;
  case 'ready': {
    if (plan.strikeLeg === 'moves' && plan.worthMoving && shownBtc(plan.strikeToCbBtc + plan.strikeToColdBtc)) {
      lines.push(line('state', 'good', 'Strike releases this today.'));
    } else if (plan.strikeLeg === 'hold') {
      lines.push(line('state', 'warn',
        `Strike's ${STRIKE_HOLD_DAYS}-day hold runs through ${ctx.holdThroughISO ?? 'the hold date'}`
        + `${ctx.holdDepositISO !== null ? ` (you logged a Strike deposit on ${ctx.holdDepositISO})` : ''} — move then.`));
    } else if (plan.strikeLeg === 'ltv') {
      lines.push(line('state', 'warn', ltvBlockedText(plan)));
    }
    // The batch line, then the aligned line — an over-the-limit position replaces the latter.
    if (!plan.worthMoving && shownBtc(movedBtc)) {
      lines.push(line('batch', 'plain',
        `Nothing worth moving yet — ${fmtBtc3(movedBtc)} ₿ is under the ${MOVE_THRESHOLD_BTC} ₿ threshold; `
        + "next month's re-plan picks it up."));
    } else if (plan.strikeLeg === 'nothing' && movedBtc < DISPLAY_DUST_BTC && !shownUsd(plan.cbOverCeilingUsd)) {
      lines.push(line('aligned', 'plain', plan.standDown
        ? 'Nothing to move — every coin is already in cold storage.'   // BL32 — both keeps are zero, so both hold none
        : 'Nothing to move — Strike and Coinbase hold no more than they need at support.'));
    }
    break;
  }
  default: {
    const never: never = plan.state;
    throw new Error(`unhandled placement state: ${String(never)}`);
  }
  }

  // ── the breaker ────────────────────────────────────────────────────────────────────────────────────────────
  lines.push(breakerLine(ctx));

  // ── short of the line ──────────────────────────────────────────────────────────────────────────────────────
  if (shownBtc(plan.strikeShortBtc)) {
    lines.push(line('short', 'warn',
      `Strike holds ${fmtBtc3(plan.strikeShortBtc)} ₿ less than your line needs at support — at support today the `
      + `policy's Strike limit leaves ${shownUsd(plan.strikeRoomUsd) ? `${fmtUSD(plan.strikeRoomUsd)} of room` : 'no room'}.`));
  }

  // ── over the limit (S3) ────────────────────────────────────────────────────────────────────────────────────
  // ⚠ N8 — never once the loan is past 86%: a seized loan is not repaid from spare income, so the sentence would
  // describe a recovery that cannot happen. The FIELD is still reported on the plan.
  if (plan.state !== 'cbPastLiquidation' && shownUsd(plan.cbOverCeilingUsd)) {
    lines.push(line('overLimit', 'warn',
      `Coinbase is ${fmtUSD(plan.cbOverCeilingUsd)} over its limit at support — the policy repays that from spare `
      + `income${ctx.atGoalThisMonth === true ? '' : ' before it borrows again'}.`));
  }

  // ── the cliff (S2) ─────────────────────────────────────────────────────────────────────────────────────────
  // ⚠ It reads `opening` (N5) — the position the owner actually ends up holding, not the deferred `after`.
  // Policy v2, Run B (B3): never a seizure price under the dust floor ("$0"), F11's words at both ends (fmtBelowPct —
  // never "0%" or "100% below"), and the cheap price alert right after the cliff, only while there is one.
  if (hasLoan) {
    const m = cbMetrics(ctx.cbDebt, plan.opening.cbCollateralBtc, ctx.price, ctx.cbLtvTriggerPct);
    if (shownUsd(m.liqPrice) && m.liqPrice < ctx.price) {
      lines.push(line('cliff', 'warn',
        `Coinbase seizes this loan at ${fmtUSD(m.liqPrice)} — ${fmtBelowPct(Math.abs(m.pctToLiq))} below today.`));
      const alert = alertLine(ctx, m);
      if (alert !== null) lines.push(alert);
      const depth = ceilingLiquidationMultiple(ctx.cbStop, CB_LLTV);
      if (Number.isFinite(depth)) {
        lines.push(line('cliffDepth', 'plain',
          `At its limit at support, Coinbase survives price down to ${depth.toFixed(2)}× support `
          + `(${fmtUSD(depth * ctx.support)}).`));
      }
    }
  }

  // ── the line ───────────────────────────────────────────────────────────────────────────────────────────────
  lines.push(...lineLines(ctx, hasLoan));

  // ── path-invariant by construction (B3) ────────────────────────────────────────────────────────────────────
  lines.push(line('pathInvariant', 'plain', PATH_INVARIANT_LINE));
  return { title: MOVE_CARD_TITLE, lines };
}

/** THE MOVE's seeding gate lives with the plan's two builders (planRun — BL57: the futures worker composes the FIRE
 *  face's borrow lane through them, and never loads this module); named here too, for the Decision face's readers. */
export { seedsFromMove } from './planRun';

/**
 * Policy v2, Run B (B3) — the cheap alert: the price at which Coinbase reaches the owner's trigger (`cbMetrics`'
 * `triggerPrice`, on the opening). Between the cliff and today: set a price alert there in the exchange app. At or past
 * it today: work from the Emergency Console now — "at or past", since at exactly the trigger "past" is false.
 * A trigger counts only when it is a finite positive percent that fires BEFORE the seizure (its price above the
 * cliff): 0% would put its price at ∞, and 86% or more at or under the cliff. And never on a sliver of a loan (R11): a
 * $200 loan more than 99% below today would ask for an alert at $222.
 */
function alertLine(ctx: MoveCardContext, m: { liqPrice: number; triggerPrice: number; pctToLiq: number }): MoveLine | null {
  const t = ctx.cbLtvTriggerPct;
  const T = m.triggerPrice;
  if (!(Number.isFinite(t) && t > 0 && T > m.liqPrice)) return null;
  if (T < ctx.price && Math.abs(m.pctToLiq) < 0.995) {
    return line('alert', 'plain',
      `Set a price alert at ${fmtUSD(T)} in your exchange app — Coinbase reaches your ${t}% trigger there.${consoleTail(ctx)}`);
  }
  if (T >= ctx.price) {
    return line('alert', 'warn', atTriggerLine(t, ctx.consoleRuns));
  }
  return null;
}

function consoleTail(ctx: MoveCardContext): string {
  return ctx.consoleRuns
    ? ' On the day, work from the Emergency Console.'
    : ` On the day, work from the Emergency Console ${CONSOLE_GATE}.`;
}

/** Strike's excess exists but its own rules block the release — say WHICH rule. */
function ltvBlockedText(plan: PlacementPlan): string {
  // Above the retrieve line nothing leaves at all; at or under it, the "under 50% after" rule is what binds.
  return plan.releasableBtc <= 0
    ? `Strike releases nothing while its LTV is above ${pctInt(STRIKE_RETRIEVE_MAX_LTV)} — pay it down first.`
    : `Releasing all of it would leave Strike at ${pctInt(STRIKE_MAX_DRAW_LTV)} LTV or more — pay it down first.`;
}

function breakerLine(ctx: MoveCardContext): MoveLine {
  const depth = Math.round(HARD_BREAKER_DEPTH * 100);
  if (ctx.breaker === 'loading') return line('breaker', 'plain', BREAKER_LOADING_LINE);
  if (ctx.breaker === null) {
    return line('breaker', 'warn',
      "Price history didn't load, so this run assumes the model isn't treated as broken.");
  }
  const { broken, monthsAtOrAbove, monthsBelow, lastMonthEndLabel } = ctx.breaker;
  if (broken) {
    const until = ctx.rearmRule !== null
      ? ` — no new debt until ${ctx.rearmRule} months back on the line (${monthsAtOrAbove} so far)`
      : ' — no new debt for the rest of this run';
    return line('breaker', 'bad',
      `Month-ends through ${lastMonthEndLabel}: the model is treated as broken${until}.`);
  }
  const head = `Month-ends through ${lastMonthEndLabel}: the model isn't treated as broken.`;
  return monthsBelow === HARD_BREAKER_MONTHS - 1
    ? line('breaker', 'warn',
      `${head} ${lastMonthEndLabel} closed more than ${depth}% under support — one more like it and the model is `
      + 'treated as broken.')
    : line('breaker', 'plain', head);
}

/** The suggested line, in words — ONE copy: THE MOVE's line and (the plan of record's Run 4) the Smart BLOC tab's
 *  recommendations, where the year-one model's "Recommended min" stood. `covers` — the owner's line is already at or
 *  above it ("Suggested" would then read as advice to lower the line). */
export function suggestedLineWords(
  ownerLineUsd: number, suggestedUsd: number, hasLoan: boolean, triggerPct: number, targetPct: number,
): { covers: boolean; text: string } {
  const paydown = hasLoan ? ` and one Coinbase paydown (${Math.round(triggerPct)}% → ${Math.round(targetPct)}%)` : '';
  return ownerLineUsd >= suggestedUsd
    ? { covers: true, text: `Your ${fmtUSD(ownerLineUsd)} line already covers ${LINE_MONTHS_WORD} months of bills${paydown}.` }
    : { covers: false, text: `A ${fmtUSD(suggestedUsd)} line would cover ${LINE_MONTHS_WORD} months of bills${paydown}, with 25% spare.` };
}

function lineLines(ctx: MoveCardContext, hasLoan: boolean): MoveLine[] {
  const whatIf = Math.abs(ctx.runLineUsd - ctx.ownerLineUsd) >= 1;
  if (whatIf) {
    const out: MoveLine[] = [{
      ...line('line', 'plain', `Modeling a ${fmtUSD(ctx.runLineUsd)} line.`),
      action: { kind: 'backToLine', label: `Back to ${fmtUSD(ctx.ownerLineUsd)}`, lineUsd: ctx.ownerLineUsd },
    }];
    if (ctx.runLineUsd > ctx.ownerLineUsd) {
      out.push(line('lineHold', 'warn',
        `Raising your line restarts Strike's ${STRIKE_HOLD_DAYS}-day hold — move the coins first.`));
    }
    return out;
  }
  // BL32 (δ1) — at the stand-down nothing backs the line: the plan keeps nothing on Strike, and Strike lends at most half
  // its collateral's value. "Covers two months of bills" would be false, and "Try $X" changes nothing (both keeps are 0 at
  // any line) — so no line words. The what-if above stays: it is the way back.
  if (ctx.plan.standDown) return [];
  const w = suggestedLineWords(ctx.ownerLineUsd, ctx.suggestedLineUsd, hasLoan, ctx.cbLtvTriggerPct, ctx.cbLtvTargetPct);
  return w.covers
    ? [line('line', 'good', w.text)]
    : [{
      ...line('line', 'plain', w.text),
      action: { kind: 'tryLine', label: `Try ${fmtUSD(ctx.suggestedLineUsd)}`, lineUsd: ctx.suggestedLineUsd },
    }];
}

const LINE_MONTHS_WORD = 'two';

// ── R1 (BL45, B′) — THE MOVE in sections ─────────────────────────────────────────────────────────────────────
// The card's lines, arranged: "To do today" first — THIS MONTH's own rows (`todayActions`) and today's state lines —
// then one card per venue (Strike, Coinbase, cold storage), each folding under a row with the ₿ it holds once today's
// move is made (`opening`), then the quiet foot. ONE source: every line comes from `moveCard`, whose rules decide when
// it shows — all but "Nothing to move today." (`NOTHING_TODAY_LINE`), the view's own; a fact that splits a line into an
// amount and its parts reads the same inputs through the same formulas, and the FIGURES sweep holds the two to the same
// figures. The figures are THE MOVE's — its inputs, its moves, the position the owner ends up holding; the one new
// figure is cold storage's share of every coin (the Dashboard's split, `deriveVenueSplit`). The printout keeps
// `moveCard`'s lines (`moveCardText`): the schedule under it lists today's moves.

/** The section's label. */
export const TODO_LABEL = 'To do today';
/** Nothing moves today and no state line says why — the section is never empty (a Coinbase over its limit, say). */
export const NOTHING_TODAY_LINE = 'Nothing to move today.';
export const VENUE_NAME: Readonly<Record<Venue, string>> = Object.freeze({
  strike: 'Strike', coinbase: 'Coinbase', cold: 'Cold storage',
});

/** A fact's part, listed under its amount — its dot the venue's colour, or else the fact's tone. */
export interface FactPart { text: string; venue: Venue | null }
/** One fact on a venue's card: a label, an amount (or a short sentence) and its parts. */
export interface MoveFact {
  key: string;
  /** `null` — a line of its own across the card: the rarer lines keep `moveCard`'s words. */
  label: string | null;
  value: string;
  parts: FactPart[];
  tone: MoveTone;
  action?: LineAction;
  /** In view while the card is folded: every warning, and the line's what-if with its way back (BL45 — a warning
   *  never folds out of sight). */
  folded: boolean;
}
/** One of today's moves — THIS MONTH's own row — and the two venues it moves between, from and to. */
export interface TodoRow { key: string; text: string; venues: [Venue, Venue] }
/** A venue's card: its row (dot, name, the ₿ it holds once today's move is made) and its facts. `rowName` is the row's
 *  name for a screen reader — its name and its ₿, apart. */
export interface VenueCard {
  venue: Venue; name: string; held: string; rowName: string; facts: MoveFact[];
  /** BL54 — the Cold storage card's look ahead, on the path below; on no other card. */
  ahead?: AheadSection;
}
/** BL54 — the look ahead: its label (the path, by the dock's name) and its facts, shown when the card is open. */
export interface AheadSection { label: string; facts: MoveFact[] }
export interface MoveSections {
  title: string;
  lead: MoveLine[];
  /** `null` with nothing to arrange — the policy off or ignored, or the plan unavailable: the card is its lines. */
  todo: { rows: TodoRow[]; notes: MoveLine[] } | null;
  venues: VenueCard[];
  foot: MoveLine[];
}
/** What the owner holds today, before the move — THE MOVE's own inputs (`PlacementInput`). */
export type HeldBtc = Pick<PlacementInput, 'strikeCollateralBtc' | 'cbCollateralBtc' | 'coldBtc'>;

/** Today's three legs, by kind: the venues each moves between, from and to (`todayActions`' kinds). */
export const TODAY_VENUES: Readonly<Partial<Record<ActionKind, [Venue, Venue]>>> = Object.freeze({
  strikeToCoinbase: ['strike', 'coinbase'], strikeToCold: ['strike', 'cold'], coinbaseToCold: ['coinbase', 'cold'],
});

/** A share of every coin, as a whole percent — the card's own ends (never "0%" or "100%" for a part, as `fmtBelowPct`). */
export function fmtSharePct(share: number): string {
  if (share >= 1) return '100%';
  const pct = Math.round(share * 100);
  return pct < 1 ? 'less than 1%' : pct > 99 ? 'more than 99%' : `${pct}%`;
}

const heldText = (btc: number): string => (shownBtc(btc) ? `${fmtBtc3(btc)} ₿` : '—');
const rowNameOf = (venue: Venue, btc: number): string => `${VENUE_NAME[venue]}, ${shownBtc(btc) ? `${fmtBtc3(btc)} ₿` : 'none'}`;
const keepsText = (after: number, before: number): string =>
  `${shownBtc(after) ? `${fmtBtc3(after)} ₿` : 'nothing'} of ${fmtBtc3(before)} ₿`;
const fact = (
  key: string, label: string, value: string, parts: FactPart[], tone: MoveTone = 'plain', folded = false,
): MoveFact => ({ key, label, value, parts, tone, folded });
/** A line kept whole — in view folded when it warns, or when `folded` says so. */
const lineFact = (l: MoveLine, folded = l.tone === 'warn' || l.tone === 'bad'): MoveFact => ({
  key: l.key, label: null, value: l.text, parts: [], tone: l.tone, ...(l.action !== undefined ? { action: l.action } : {}), folded,
});
const part = (text: string, venue: Venue | null = null): FactPart => ({ text, venue });
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * THE MOVE in sections (B′). `card` is `moveCard(ctx)` — the very lines, from the very context — and `today` THE MOVE's
 * input holdings. Every line of `card` is placed but two: `moves` (its figures are the To do rows and the venues' rows)
 * and, but at the stand-down, `why` (its figures are the venues' For).
 */
// ── R1b (BL54) — Cold storage, ahead ─────────────────────────────────────────────────────────────────────────
// The Cold storage card always shows (0 ₿ included) and, under today's facts, says what the plan does with cold on the
// path the face shows — the displayed run, the schedule's own, its stress included when one is on: the next move into
// cold, the goal (with one set) and the cold at the horizon. Its figures are that run's — the schedule's and the lower
// Cold storage card's — so they move with the path, as the schedule does; today's facts don't, and the footer's "This
// move…" stays true. The one part of the card that is not `moveCard`'s lines.

/** The look ahead's label, before the path's name (BL54). */
export const AHEAD_LABEL = 'Ahead, on the path below';
/** A count of months: "1 month", "7 months". */
export const monthsText = (m: number): string => `${m} month${m === 1 ? '' : 's'}`;
/** Net coins, signed, as the goal tile says them: never "-0.000". */
const netText = (btc: number): string => { const t = fmtBtc3(btc); return t === '-0.000' ? '0.000' : t; };

/** What the Cold storage card reads of the path below (BL54). */
export interface ColdAheadInput {
  /** The schedule's rows (`planSchedule` of the displayed run): its moves into cold, as the face lists them. */
  schedule: ReadonlyArray<Pick<ScheduleRow, 'm' | 'actions'>>;
  /** The displayed run's rows: the goal's months and the cold at the horizon. */
  rows: ReadonlyArray<Pick<CyclingRow, 'm' | 'atGoal' | 'goalStandDown' | 'coldBtc' | 'netCoinsBtc'>>;
  /** The owner's goal in net coins; `null` with none — and then no Goal line. */
  goalNetBtc: number | null;
  /** Month 0's local date, `yyyy-mm-dd` — the months' names ("Dec 2026"). */
  startISO: string;
  /** The path as the dock names it — "Support", "Fair", "4-yr cycle", "Worst (stitched)" — and Worst (modeled) with its
   *  crown, as the schedule's header names it ("Worst (modeled): Resistance path"). */
  pathLabel: string;
  /** A stress is on — the run is the stressed one, and the label says so. */
  stressed: boolean;
}

/** The schedule's moves INTO cold — never coins leaving it, or moving between Strike and Coinbase. */
const INTO_COLD: ReadonlySet<ActionKind> = new Set<ActionKind>(['strikeToCold', 'coinbaseToCold']);

/** BL54 — the Cold storage card's look ahead. `null` with nothing ahead to read (a run of month 0 alone). */
export function coldAhead(a: ColdAheadInput): AheadSection | null {
  const last = a.rows[a.rows.length - 1];
  if (last === undefined || last.m < 1) return null;
  const horizon = last.m;
  const when = (m: number): string => monthYear(a.startISO, m);
  const facts: MoveFact[] = [];
  // Next — the first month after today whose row moves coins into cold (BL54), whatever their size: its month, and what
  // comes from Strike and from Coinbase, a move under THE MOVE's threshold marked "(small — can wait)" as the row marks
  // it. ⚠ No threshold on the month: THE MOVE batches a month's moves by their total, Strike's release into Coinbase
  // included (D16), so a small sweep into cold can go with a bigger move that month — and on the board's plans it does
  // (spec `pbloc-spec-cold-ahead-v1` §3, C3).
  const next = a.schedule.find((r) => r.m >= 1 && r.actions.some((x) => INTO_COLD.has(x.kind) && x.btc !== null));
  if (next === undefined) {
    facts.push(fact('coldNext', 'Next', `none within ${monthsText(horizon)}`, []));
  } else {
    const parts = [part(when(next.m))];
    for (const x of next.actions) {
      if (x.btc === null) continue;
      const small = x.btc < MOVE_THRESHOLD_BTC ? ' (small — can wait)' : '';
      if (x.kind === 'strikeToCold') parts.push(part(`${fmtBtc3(x.btc)} ₿ from Strike${small}`, 'strike'));
      if (x.kind === 'coinbaseToCold') parts.push(part(`${fmtBtc3(x.btc)} ₿ from Coinbase${small}`, 'coinbase'));
    }
    facts.push(fact('coldNext', 'Next', `in ${monthsText(next.m)}`, parts));
  }
  // Goal — with one set: when net coins first reach it, and the month from which every coin goes to cold (at it, both
  // loans repaid: `goalStandDown`). "Goes to", never "is in": Strike's 60-day hold can keep its coins a month or two
  // more (`cyclingSim` moves them only once `m >= strikeHoldUntil`) — the stand-down's own words
  // (`supportPolicyView`'s GOAL_STAND_DOWN_WORDS).
  if (a.goalNetBtc !== null) {
    const goal = `${fmtBtc3(a.goalNetBtc)} ₿`;
    const reach = a.rows.find((r) => r.atGoal === true);
    if (reach === undefined) {
      const net = last.netCoinsBtc;
      facts.push(fact('coldGoal', 'Goal', `not within ${monthsText(horizon)}`,
        net === null ? [] : [part(`net coins ${netText(net)} ₿ of ${goal} by ${when(horizon)}`)]));
    } else {
      const parts = [part(reach.m === 0 ? `net coins at your ${goal} goal` : `${when(reach.m)} — net coins reach ${goal}`)];
      const all = a.rows.find((r) => r.goalStandDown);
      if (all !== undefined) {
        parts.push(part(all.m === 0 ? 'every coin goes to cold storage today'
          : `every coin goes to cold storage from ${when(all.m)}`, 'cold'));
      }
      facts.push(fact('coldGoal', 'Goal', reach.m === 0 ? 'reached' : `in ${monthsText(reach.m)}`, parts));
    }
  }
  // By the end — the cold at the horizon (the outcome strip's first tile, on the same run).
  facts.push(fact('coldEnd', 'By the end', shownBtc(last.coldBtc) ? `${fmtBtc3(last.coldBtc)} ₿` : 'nothing',
    [part(`${when(horizon)}, in ${monthsText(horizon)}`)]));
  return { label: `${AHEAD_LABEL}: ${a.pathLabel}${a.stressed ? ', stressed' : ''}`, facts };
}

export function moveSections(
  card: MoveCardCopy, ctx: MoveCardContext, today: HeldBtc, ahead: ColdAheadInput | null = null,
): MoveSections {
  const at = (key: string): MoveLine | undefined => card.lines.find((l) => l.key === key);
  const { plan } = ctx;
  if (!ctx.policyApplied || plan.state === 'unavailable') {
    return { title: card.title, lead: card.lines, todo: null, venues: [], foot: [] };
  }
  const hasLoan = ctx.hasCbLoan && shownUsd(ctx.cbDebt);   // moveCard's own F3 predicate
  const made = plan.state === 'ready' && plan.worthMoving;  // todayActions' own gate (N5)
  const lead = card.lines.filter((l) => l.key === 'planOfRecord');

  // ── To do today ──
  const rows: TodoRow[] = todayActions(plan).flatMap((a) => {
    const v = TODAY_VENUES[a.kind];
    return v !== undefined ? [{ key: a.kind, text: a.text, venues: v }] : [];
  });
  const notes = card.lines.filter((l) =>
    l.key === 'state' || l.key === 'batch' || l.key === 'aligned' || (l.key === 'why' && plan.standDown));
  if (rows.length === 0 && notes.length === 0) notes.push(line('todayNone', 'plain', NOTHING_TODAY_LINE));

  // ── Strike ──
  const strike: MoveFact[] = [];
  if (made && !plan.standDown && shownBtc(plan.strikeToCbBtc + plan.strikeToColdBtc)) {
    strike.push(fact('strikeKeeps', 'Keeps', keepsText(plan.opening.strikeCollateralBtc, today.strikeCollateralBtc), []));
  }
  if (!plan.standDown) {
    strike.push(fact('strikeFor', 'For', `your ${fmtUSD(ctx.runLineUsd)} line`, [part(`At support: ${fmtUSD(ctx.support)}`)]));
  }
  const short = at('short');
  if (short !== undefined) strike.push(lineFact(short));
  const ln = at('line');
  if (ln !== undefined) {
    if (ln.tone === 'good' && ln.action === undefined) {
      // "Your $L line already covers two months of bills and one Coinbase paydown (T% → G%)." — its For holds the $L.
      const covers = [part(`${cap(LINE_MONTHS_WORD)} months of bills`)];
      if (hasLoan) {
        covers.push(part(`One Coinbase paydown, ${Math.round(ctx.cbLtvTriggerPct)}% → ${Math.round(ctx.cbLtvTargetPct)}%`));
      }
      strike.push(fact('line', 'The line', 'covers', covers, 'good'));
    } else {
      // A suggestion keeps its sentence and its Try; a what-if, its way back — in view, since the card's figures are
      // the what-if's.
      strike.push(lineFact(ln, ln.action?.kind === 'backToLine'));
    }
  }
  const lineHold = at('lineHold');
  if (lineHold !== undefined) strike.push(lineFact(lineHold));
  const venues: VenueCard[] = [{
    venue: 'strike', name: VENUE_NAME.strike, held: heldText(plan.opening.strikeCollateralBtc),
    rowName: rowNameOf('strike', plan.opening.strikeCollateralBtc), facts: strike,
  }];

  // ── Coinbase — with the loan switched on, or coins there today or after the move ──
  if (ctx.hasCbLoan || shownBtc(today.cbCollateralBtc) || shownBtc(plan.opening.cbCollateralBtc)) {
    const cb: MoveFact[] = [];
    if (made && !plan.standDown && shownBtc(plan.cbToColdBtc)) {
      cb.push(fact('cbKeeps', 'Keeps', keepsText(plan.opening.cbCollateralBtc, today.cbCollateralBtc), []));
    }
    if (made && shownBtc(plan.strikeToCbBtc)) {
      cb.push(fact('cbToday', 'Today', `+${fmtBtc3(plan.strikeToCbBtc)} ₿`, [part('from Strike', 'strike')]));
    }
    if (!plan.standDown) {
      // moveCard's `why` clause, as a noun phrase: what Coinbase keeps coins for at support.
      const room = ctx.bearBufferMonths;
      const billsKnown = Number.isFinite(ctx.expenses) && ctx.expenses > 0;
      const forText = hasLoan
        ? (room > 0 && billsKnown
          ? `its ${fmtUSD(ctx.cbDebt)} debt plus ${room} months of bills at support`
          : `its ${fmtUSD(ctx.cbDebt)} debt at support`)
        : (room > 0 && billsKnown ? `${room} months of bills of room at support` : null);
      if (forText !== null) cb.push(fact('cbFor', 'For', forText, []));
    }
    const over = at('overLimit');
    if (over !== undefined) cb.push(lineFact(over));
    if (at('cliff') !== undefined) {
      const m = cbMetrics(ctx.cbDebt, plan.opening.cbCollateralBtc, ctx.price, ctx.cbLtvTriggerPct);
      cb.push(fact('cliff', 'Seizes at', fmtUSD(m.liqPrice),
        [part(`${fmtBelowPct(Math.abs(m.pctToLiq))} below today`)], 'warn', true));
      const alert = at('alert');
      if (alert !== undefined) {
        cb.push(alert.tone === 'plain'
          ? fact('alert', 'Price alert', fmtUSD(m.triggerPrice), [
            part(`Your ${ctx.cbLtvTriggerPct}% trigger`),
            part(consoleTail(ctx).trim().replace(/\.$/, '')),
          ])
          : lineFact(alert));   // at or past the trigger: moveCard's words, in view folded
      }
      if (at('cliffDepth') !== undefined) {
        const depth = ceilingLiquidationMultiple(ctx.cbStop, CB_LLTV);
        cb.push(fact('cliffDepth', 'Survives',
          `down to ${depth.toFixed(2)}× support (${fmtUSD(depth * ctx.support)}), at its limit`, []));
      }
    }
    venues.push({
      venue: 'coinbase', name: VENUE_NAME.coinbase, held: heldText(plan.opening.cbCollateralBtc),
      rowName: rowNameOf('coinbase', plan.opening.cbCollateralBtc), facts: cb,
    });
  }

  // ── Cold storage — always (BL54): today's, today's arrival, and the look ahead on the path below ──
  {
    const o = plan.opening;
    const split = deriveVenueSplit(o.strikeCollateralBtc, o.cbCollateralBtc, o.coldBtc);
    // The share with coins there only — never "less than 1%" of nothing.
    const share = shownBtc(o.coldBtc) ? [part(`${fmtSharePct(split.coldShare)} of all ${fmtBtc3(split.combinedBtc)} ₿`, 'cold')] : [];
    const now = shownBtc(today.coldBtc) ? `${fmtBtc3(today.coldBtc)} ₿ in your own custody` : 'nothing yet';
    const coldIn = made ? plan.strikeToColdBtc + plan.cbToColdBtc : 0;
    const cold: MoveFact[] = [];
    if (shownBtc(coldIn)) {
      const from: FactPart[] = [];
      if (shownBtc(plan.strikeToColdBtc)) from.push(part(`${fmtBtc3(plan.strikeToColdBtc)} ₿ from Strike`, 'strike'));
      if (shownBtc(plan.cbToColdBtc)) from.push(part(`${fmtBtc3(plan.cbToColdBtc)} ₿ from Coinbase`, 'coinbase'));
      cold.push(fact('coldNow', 'Now', now, []), fact('coldToday', 'Today', `+${fmtBtc3(coldIn)} ₿`, from),
        fact('coldAfter', 'After', `${fmtBtc3(o.coldBtc)} ₿`, share));
    } else {
      cold.push(fact('coldNow', 'Now', now, share));
    }
    const look = ahead === null ? null : coldAhead(ahead);
    venues.push({
      venue: 'cold', name: VENUE_NAME.cold, held: heldText(o.coldBtc), rowName: rowNameOf('cold', o.coldBtc), facts: cold,
      ...(look !== null ? { ahead: look } : {}),
    });
  }

  const foot = card.lines.filter((l) => l.key === 'breaker' || l.key === 'pathInvariant');
  return { title: card.title, lead, todo: { rows, notes }, venues, foot };
}

// ── Run B — the rest of the face's copy ──────────────────────────────────────────────────────────────────────
// ⚠ I31 (Run B): DecisionFace.tsx holds labels only. Every sentence it shows lives here, where a test reaches it.

/** The breaker seed, as the card reads it. A seed is a reading; no seed is `'loading'` while the fetch is in flight
 *  and `null` once it settled with nothing usable (G5). The date goes through the fixed month table (no "Sept"). */
export function breakerReading(seed: BreakerSeed | null, loading: boolean): BreakerReading | 'loading' | null {
  if (seed === null) return loading ? 'loading' : null;
  const d = new Date(seed.lastMonthEndISO);
  return {
    broken: seed.state.broken,
    monthsAtOrAbove: seed.state.monthsAtOrAbove,
    monthsBelow: seed.state.monthsBelow,
    lastMonthEndLabel: Number.isFinite(d.getTime()) ? fmtTurnDate(d) : seed.lastMonthEndISO,
  };
}

/** B2 — §4.5's chart note: in manual price mode, today's point is the owner's own price. */
export function manualPriceNote(mode: 'live' | 'manual'): string | null {
  return mode === 'manual' ? "Today's point is your manual price, not the live quote." : null;
}

/**
 * G4 — the parents' disclaimer, Strategy's policy-aware wording, as ONE string for the screen and the printout.
 * Every figure comes from its constant.
 */
export function decisionDisclaimer(policyApplied: boolean): string {
  return 'A pattern, not a forecast. The power law is a historical regression, firewalled from every risk '
    + `calculation. Both facilities are full-recourse; Morpho liquidates instantly at ${pctInt(CB_LLTV)} with no cure `
    + `window, Strike calls at ${pctInt(STRIKE_MARGIN_CALL_LTV)} with 72 hours to cure. `
    + (policyApplied
      ? 'With the support policy on, a Strike margin call is modelled — cash, then cold, then a sale back to '
        + `${pctInt(STRIKE_CURE_LTV)}.`
      : 'The engine flags a Strike call but does not model the seizure.')
    + ' Not financial advice.';
}

/**
 * D2 — the face's path choice. The two worst options are face-local, NEVER members of `PathKind`: the face
 * resolves either to a plain `number[]` before the engine sees it, and neither ever reaches `plBandsAt`,
 * `plBandAt` or `PL_BAND_LABEL` (all `Record<PlBand, …>`).
 */
export type DecisionPath = PathKind | 'worstStitched' | 'worstModeled';

/** A modelled path as a noun: "Support path", "Fair path", "Resistance path" — and "4-yr cycle", which is no line.
 *  `label` is the resolved kind's own label (the face passes `PL_BAND_LABEL[kind]` or '4-yr cycle'). */
export function pathNoun(kind: PathKind, label: string): string {
  return kind === 'fourYear' ? label : `${label} path`;
}

/** D3 — the two worst options' sublabels. Stitched says so while it is just Support under another name; modeled
 *  names its crown, so it renames itself when a what-if moves the crown. */
export function pathSublabel(
  choice: 'worstStitched' | 'worstModeled', stitchedIsSupport: boolean, crownNoun: string,
): string {
  if (choice === 'worstStitched') {
    return stitchedIsSupport ? 'identical to Support on these settings' : "stitched floor — no single model's future";
  }
  return `currently the ${crownNoun}`;
}

export interface PathNoteInput {
  choice: DecisionPath;
  /** The kind the displayed path resolves to — the crown's kind for Worst (modeled); null for the stitched floor. */
  kind: PathKind | null;
  /** That kind's own label ("Support", "Fair", "Resistance", "4-yr cycle"). */
  label: string;
  /** Today's value of the band, for a band path; null for the cycle and the stitched floor. */
  bandTodayUsd: number | null;
  onTheLine: boolean;
  priceHeld: boolean;
  anchorPrice: number;
  /** The displayed path's month 1; null when the path has none. */
  month1Usd: number | null;
  /** `nextTurnsText(…)` for the cycle; '' when none. */
  nextTurns: string;
  /** The stitched floor is Support bit for bit (D4) — the note says so while it holds. */
  stitchedIsSupport: boolean;
  /** The rule that crowned Worst (modeled) — the ranking's own `worstBy`; the crown sentence names it. */
  worstBy: WorstBy;
}

/** I31 / W1 — the crown sentence names the rule that decided it. On that rule the crown is the extreme of the whole
 *  field (`pickWorst`), so the sentence is true against every modelled future, not just the runner-up. */
const CROWN_CLAUSE: Record<WorstBy, string> = {
  liquidation: 'The modelled future that liquidates first',
  cushion: "The modelled future that comes closest to Coinbase's seizure price",
  equity: 'The modelled future that ends poorest in dollars',
  index: 'The modelled futures tie on these settings',
};

const signedPct = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

/**
 * The path note under the picker — the parents' words for a modelled path, plus what the two worst options are.
 * ⚠ The month-1 step is printed SIGNED and computed from the path, never a direction word: on the line, month 0
 * is the live price and month 1 sits ON the curve, so the step's sign depends on the anchor (the named trap).
 */
export function pathNote(n: PathNoteInput): string {
  const d4 = n.stitchedIsSupport
    ? ' No modelled future dips under Support on these settings, so the stitched floor is Support itself.'
    : '';
  if (n.choice === 'worstStitched' || n.kind === null) {
    return "The lowest price any modelled future shows in each month — no single model's future." + d4;
  }
  const step = n.onTheLine && n.month1Usd !== null && n.month1Usd > 0 && n.anchorPrice > 0
    ? ` Month 1 steps ${signedPct(n.month1Usd / n.anchorPrice - 1)} to ${fmtUSD(n.month1Usd)}.`
    : '';
  const from = `Converges from ${n.priceHeld ? 'the held' : "today's"} ${fmtUSD(n.anchorPrice)} toward`;
  const body = n.kind === 'fourYear'
    ? `${n.onTheLine ? 'Rides' : from} the 4-yr cycle — tops on the fair line, troughs on the support line.`
      + (n.nextTurns !== '' ? ` ${n.nextTurns}.` : '')
    : `${n.onTheLine ? 'Sits on' : from} the power-law ${n.label.toLowerCase()} line`
      + (n.bandTodayUsd !== null && n.bandTodayUsd > 0 ? ` — today at ${fmtUSD(n.bandTodayUsd)}.` : '.');
  const crown = n.choice === 'worstModeled'
    ? `${CROWN_CLAUSE[n.worstBy]} — currently the ${pathNoun(n.kind, n.label)}. `
    : '';
  return crown + body + step + d4;
}

/** G8 — the schedule's header, on screen and in the printout: "the MODELED plan", the date, the path, the horizon,
 *  and what is held today (the move conserves the total, so seeding never changes it). */
export function scheduleHeader(o: { todayISO: string; pathLabel: string; months: number; openingBtc: number }): string {
  const d = new Date(o.todayISO);
  const parts = [
    'The MODELED plan',
    Number.isFinite(d.getTime()) ? fmtTurnDate(d) : o.todayISO,
    o.pathLabel,
    `${o.months}-month horizon`,
  ];
  if (shownBtc(o.openingBtc)) parts.push(`from ${fmtBtc3(o.openingBtc)} ₿ held today`);
  return parts.join(' · ');
}

export interface OutcomeTile {
  key: 'cold' | 'yours' | 'vsNeverDraw' | 'liquidation';
  label: string;
  value: string;
  sub: string;
  tone: MoveTone;
}

const signedBtc3 = (n: number): string => `${n < 0 ? '−' : ''}${fmtBtc3(Math.abs(n))} ₿`;

/** §7's outcome strip, read off the displayed run. Every figure passes its dust floor — a tile never prints "$0" or
 *  "0.000 ₿"; dust reads as "none" or "even". */
export function outcomeTiles(
  o: { cold: number; yours: number; allIn: number; liqMonth: number | null },
  verdict: NeverDrawVerdict, basisClause: string, horizonMonth: number,
): OutcomeTile[] {
  const delta = verdict.equityDelta;
  return [
    {
      key: 'cold', label: 'In cold storage',
      value: shownBtc(o.cold) ? `${fmtBtc3(o.cold)} ₿` : 'none',
      sub: `at month ${horizonMonth}`,
      tone: shownBtc(o.cold) ? 'good' : 'plain',
    },
    {
      key: 'yours', label: 'Yours',
      value: shownBtc(Math.abs(o.yours)) ? signedBtc3(o.yours) : 'none',
      sub: `held less debt, at month ${horizonMonth}`,
      tone: o.yours < 0 && shownBtc(Math.abs(o.yours)) ? 'warn' : 'plain',
    },
    {
      key: 'vsNeverDraw', label: 'vs never drawing',
      value: shownUsd(Math.abs(delta)) ? `${delta >= 0 ? '+' : '−'}${fmtUSD(Math.abs(delta))}` : 'even',
      sub: `${ALL_IN} equity${basisClause}`,
      // BL14 — a tie (with a goal only) is neither good nor bad.
      tone: verdict.kind === 'liquidated' ? 'bad' : verdict.kind === 'even' ? 'plain' : verdict.wins ? 'good' : 'warn',
    },
    {
      key: 'liquidation', label: 'Coinbase liquidation',
      value: o.liqMonth === null ? 'none' : `month ${o.liqMonth}`,
      sub: o.liqMonth === null ? `through month ${horizonMonth}` : `Morpho seizes at ${pctInt(CB_LLTV)}`,
      tone: o.liqMonth === null ? 'good' : 'bad',
    },
  ];
}

/** The Download's file name. */
export const scheduleFileName = (todayISO: string): string => `personal-bloc-decision-plan-${todayISO}.txt`;

/** THE MOVE as plain text, for the printout: the title, then every line in the card's order. */
export function moveCardText(card: MoveCardCopy): string {
  return [card.title, ...card.lines.map((l) => l.text)].join('\n');
}

/** The stress card's note. THE MOVE is measured at today's anchor, so a stress never moves it — the note says so. */
export function stressNote(supportAtMonthUsd: number): string {
  return 'Stress from this month forward — the chart, the schedule and the outcome follow; '
    + "the move above stays measured at today's price. Changing the month or any input resets."
    + (shownUsd(supportAtMonthUsd) && Number.isFinite(supportAtMonthUsd)
      ? ` Support line at this month: ${fmtUSD(supportAtMonthUsd)}.`
      : '');
}

/** The parents' below-support note, as a string the face renders. */
export const BELOW_SUPPORT_NOTE =
  'Below the power-law support line — outside the fitted drawdown envelope. Nothing calibrates this depth.';

/** D2 — the schedule's keep column. The header must fit one line in its column at phone width (the e2e measures it
 *  at 390px and 375px); the key, under the schedule's header line, says what the column is. It is THE MOVE's phrase
 *  for the same formula (Z12): max(line, balance) / (skStop × support) — the engine's `strikeKeepBtc`. */
export const SCHEDULE_KEEP_HEADER = 'Strike keep';
export const SCHEDULE_KEEP_KEY = 'Strike keep: what your full line needs on Strike at support.';

/** The legend note (`pathOnSupport`): after today the displayed path IS the support line — both green, the dashed
 *  path drawn over it — so the legend's Support line can't be told apart. */
export const ON_SUPPORT_NOTE = 'After today the modeled path runs on the support line, so the two are drawn as one.';
