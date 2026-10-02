import type { CyclingResult, CyclingRow, PolicyIgnoredReason, PolicyRunContext } from '../../simulation/cyclingSim';
import { allInEquity, supportPolicyResolution } from '../../simulation/cyclingSim';
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
import { STRIKE_HOLD_DAYS } from '../Tools/crashPlaybookView';
import { DISPLAY_DUST_BTC, fmtBelowPct, policyIgnoredNote, shownBtc, shownUsd } from './supportPolicyView';
import { fmtTurnDate, type NeverDrawVerdict } from './cyclingFaceView';
import type { BreakerSeed } from './supportPolicyInputs';
import { fmtUSD } from '../../utils/format';

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
  | 'cashToBills' | 'repayStrike' | 'repayCoinbase' | 'unpaid' | 'liquidation';

export interface Action { kind: ActionKind; usd: number | null; btc: number | null; text: string }

export interface ScheduleRow {
  m: number;
  label: string;
  actions: Action[];
  keepAtSupportBtc: number | null;
  zone: PolicyState | null;
  crash: boolean;
}

/** A crash month's moves are the playbook's, not placement's — the face points at the Emergency Console for them. */
const CRASH_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'coldToCoinbase', 'strikeReleaseToCoinbase', 'debtShift', 'defenseShort', 'coldToStrike',
  'cashCure', 'coldCure', 'strikeSale', 'liquidation',
]);

/** BTC to 3 dp — the schedule's and the card's one ₿ format. Never called below `DISPLAY_DUST_BTC`. */
export const fmtBtc3 = (n: number): string => n.toFixed(3);

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
  text: (row: CyclingRow) => string;
}

export const ACTION_FIELDS: readonly ActionField[] = [
  { kind: 'draw', field: 'strikeDrawn', unit: 'usd', text: (r) => `Draw ${fmtUSD(r.strikeDrawn)} on Strike for bills.` },
  {
    kind: 'cashToBills', field: 'cashToBillsUsd', unit: 'usd',
    text: (r) => `Pay ${fmtUSD(r.cashToBillsUsd)} of bills from your cash reserve.`,
  },
  { kind: 'unpaid', field: 'unfundedUsd', unit: 'usd', text: (r) => `${fmtUSD(r.unfundedUsd)} of bills go unpaid.` },
  {
    kind: 'repayStrike', field: 'strikeRepaidUsd', unit: 'usd',
    text: (r) => `Repay ${fmtUSD(r.strikeRepaidUsd)} of Strike from spare income.`,
  },
  {
    kind: 'repayCoinbase', field: 'cbRepaidUsd', unit: 'usd',
    text: (r) => `Repay ${fmtUSD(r.cbRepaidUsd)} of Coinbase from spare income.`,
  },
  {
    kind: 'buy', field: 'btcBoughtUsd', unit: 'usd',
    text: (r) => `Buy ${fmtUSD(r.btcBoughtUsd)} of bitcoin (≈ ${fmtBtc3(r.price > 0 ? r.btcBoughtUsd / r.price : 0)} ₿) `
      + 'and pledge it to Coinbase.',
  },
  {
    kind: 'strikeToCoinbase', field: 'strikeToCbBtc', unit: 'btc',
    text: (r) => `Release ${fmtBtc3(r.strikeToCbBtc)} ₿ of Strike collateral into Coinbase.`
      + (r.strikeToCbBtc < MOVE_THRESHOLD_BTC ? ' (small — can wait)' : ''),
  },
  {
    kind: 'refinance', field: 'refinancedUsd', unit: 'usd',
    text: (r) => `Move ${fmtUSD(r.refinancedUsd)} of Strike debt to Coinbase `
      + `(Coinbase's fee: ${fmtUSD(r.refinancedFeeUsd)}).`,
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
    text: (r) => `Draw ${fmtUSD(r.defenseDrawnUsd)} on Strike and pay Coinbase down with it.`,
  },
  {
    kind: 'coldToStrike', field: 'strikeTopUpBtc', unit: 'btc',
    text: (r) => `Move ${fmtBtc3(r.strikeTopUpBtc)} ₿ from cold storage into Strike to hold its line.`,
  },
  {
    kind: 'defenseShort', field: 'defenseShortfallUsd', unit: 'usd',
    text: (r) => `The defense falls ${fmtUSD(r.defenseShortfallUsd)} short — Coinbase stays over its defense line.`,
  },
  {
    kind: 'cashCure', field: 'cashToCureUsd', unit: 'usd',
    text: (r) => `Pay ${fmtUSD(r.cashToCureUsd)} from your cash reserve to cure Strike's margin call.`,
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
export function rowActions(row: CyclingRow, liqMonth: number | null, seizure: SeizureRead = MONTH_END_SEIZURE): Action[] {
  const out: Action[] = [];
  for (const f of ACTION_FIELDS) {
    if (f.field === null) {
      if (liqMonth === null || row.m !== liqMonth) continue;
      if (seizure.onTheWayDown) {
        // The liquidation is ACTION_FIELDS' last entry, so every other action is already in `out`.
        const p = seizure.priceUsd;
        const at = p !== null && shownUsd(p) ? `, at ${fmtUSD(p)}` : '';
        out.unshift({ kind: f.kind, usd: null, btc: null, text: `Coinbase liquidates the loan on the way down${at}.` });
      } else {
        out.push({ kind: f.kind, usd: null, btc: null, text: f.text(row) });
      }
      continue;
    }
    const v = amountOf(row, f);
    if (f.unit === 'usd' ? !shownUsd(v) : !shownBtc(v)) continue;
    out.push({ kind: f.kind, usd: f.unit === 'usd' ? v : null, btc: f.unit === 'btc' ? v : null, text: f.text(row) });
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

export function planSchedule(sim: CyclingResult, plan: PlacementPlan): ScheduleRow[] {
  // ⚠ Today's move is the POLICY's: when the run did not apply it (off, or ignored), THE MOVE card names no move,
  // so neither does the Today row — and it shows no keep, as the policy-absent rows below it don't.
  const rows: ScheduleRow[] = [{
    m: 0,
    label: 'Today',
    actions: sim.policyApplied ? todayActions(plan) : [],
    keepAtSupportBtc: sim.policyApplied ? plan.strikeKeepBtc : null,
    zone: sim.policyApplied ? sim.rows[0]?.policyZone ?? null : null,
    crash: false,
  }];
  for (const row of sim.rows) {
    if (row.m === 0) continue;
    const actions = rowActions(row, sim.liqMonth, { onTheWayDown: sim.seizedOnTheWayDown, priceUsd: sim.seizurePriceUsd });
    rows.push({
      m: row.m,
      label: `Month ${row.m}`,
      actions,
      keepAtSupportBtc: row.strikeKeepBtc,
      zone: row.policyZone,
      crash: actions.some((a) => CRASH_KINDS.has(a.kind)),
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
    out.push(`${r.label}${r.zone !== null ? ` (${r.zone})` : ''}`);
    for (const a of r.actions) out.push(`  - ${a.text}`);
    if (r.crash) out.push(`  ! ${crashNote(consoleRuns)}`);
    out.push('');
  }
  out.push(disclaimer);
  return out.join('\n');
}

/**
 * D13 — a crash month points to the Emergency Console; it never restates it. `consoleRuns` is
 * `hasCbLoan && cbPaymentStrategy === 'ltvTriggered'` — the console only runs then, and only then does the face
 * add a tap-through to it.
 */
export function crashNote(consoleRuns: boolean): string {
  const head = "A crash month — these are the monthly model's estimates; on the day, work from the Emergency Console";
  return consoleRuns ? `${head}.` : `${head} (it runs when your Coinbase strategy is LTV-triggered).`;
}

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

/** G5 — the price history is still in flight. `[]` until it lands is NOT "didn't load". */
export const BREAKER_LOADING_LINE =
  "Loading price history — until it arrives, this run assumes the model isn't treated as broken.";

export const PLAN_OF_RECORD_LINE =
  'Your Monthly Playbook is your plan of record — it runs your Coinbase strategy. This card shows what the support '
  + 'policy would do this month.';

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
  policyApplied: boolean;
  policyEnabled: boolean;
  policyIgnoredReason: PolicyIgnoredReason | null;
  plan: PlacementPlan;
  /** Strike's 60-day hold, from the owner's LOGGED deposits (the face calls `strikeHoldFrom`). */
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
  /** The Coinbase strategy is LTV-triggered, so the Emergency Console runs. */
  ltvTriggered: boolean;
}

const pctInt = (x: number): string => `${Math.round(x * 100)}%`;
const line = (key: string, tone: MoveTone, text: string): MoveLine => ({ key, tone, text });

/**
 * THE MOVE, as data. Every sentence §7 specifies, in §7's order, each with a tone — so Run B renders and composes
 * nothing. A line only appears when it is TRUE of its inputs, and no figure under its dust floor is ever named.
 */
export function moveCard(ctx: MoveCardContext): MoveCardCopy {
  const lines: MoveLine[] = [line('planOfRecord', 'plain', PLAN_OF_RECORD_LINE)];
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
    if (shownBtc(plan.after.strikeCollateralBtc)) parts.push(`keep ${fmtBtc3(plan.after.strikeCollateralBtc)} ₿ on Strike`);
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
  lines.push(line('why', 'plain',
    `Strike keeps what your ${fmtUSD(ctx.runLineUsd)} line needs at support (${fmtUSD(ctx.support)}); ${cbClause}.`));

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
      lines.push(line('aligned', 'plain',
        'Nothing to move — Strike and Coinbase hold no more than they need at support.'));
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
      + 'income before it borrows again.'));
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

/**
 * Policy v2, Run B (B4) — does the Decision face's run start from THE MOVE? Only when the move is worth making AND the
 * engine will APPLY the support policy: `supportPolicyResolution` is the run's own answer, asked with the run's own
 * inputs, so the seed and the run can never disagree. Before it the gate asked only "is a policy supplied?", and at a
 * Strike liquidation LTV at or under its 70% call (the engine ignores the policy there — 'strikeLadder') the run
 * started from a move the card never named.
 */
export function seedsFromMove(seeded: boolean, ctx: PolicyRunContext): boolean {
  return seeded && supportPolicyResolution(ctx).policyApplied;
}

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
    return line('alert', 'warn',
      `Coinbase is at or past your ${t}% trigger at today's price — work from the Emergency Console`
      + `${ctx.ltvTriggered ? '' : ' (it runs when your Coinbase strategy is LTV-triggered)'}.`);
  }
  return null;
}

function consoleTail(ctx: MoveCardContext): string {
  return ctx.ltvTriggered
    ? ' On the day, work from the Emergency Console.'
    : ' On the day, work from the Emergency Console (it runs when your Coinbase strategy is LTV-triggered).';
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

function lineLines(ctx: MoveCardContext, hasLoan: boolean): MoveLine[] {
  const paydown = hasLoan
    ? ` and one Coinbase paydown (${Math.round(ctx.cbLtvTriggerPct)}% → ${Math.round(ctx.cbLtvTargetPct)}%)`
    : '';
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
  return ctx.ownerLineUsd >= ctx.suggestedLineUsd
    ? [line('line', 'good',
      `Your ${fmtUSD(ctx.ownerLineUsd)} line already covers ${LINE_MONTHS_WORD} months of bills${paydown}.`)]
    : [{
      ...line('line', 'plain',
        `A ${fmtUSD(ctx.suggestedLineUsd)} line would cover ${LINE_MONTHS_WORD} months of bills${paydown}, with 25% spare.`),
      action: { kind: 'tryLine', label: `Try ${fmtUSD(ctx.suggestedLineUsd)}`, lineUsd: ctx.suggestedLineUsd },
    }];
}

const LINE_MONTHS_WORD = 'two';

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
      sub: `all-in equity${basisClause}`,
      tone: verdict.kind === 'liquidated' ? 'bad' : verdict.wins ? 'good' : 'warn',
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
