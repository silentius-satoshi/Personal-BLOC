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
import { STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../../simulation/strikeCredit';
import { STRIKE_HOLD_DAYS } from '../Tools/crashPlaybookView';
import { DISPLAY_DUST_BTC, policyIgnoredNote, shownBtc, shownUsd } from './supportPolicyView';
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

/** Every action a MONTH ≥ 1 performs, read verbatim from its row. An amount under its floor is left out — a
 *  schedule never prints "$0" or "0.000 ₿". */
export function rowActions(row: CyclingRow, liqMonth: number | null): Action[] {
  const out: Action[] = [];
  for (const f of ACTION_FIELDS) {
    if (f.field === null) {
      if (liqMonth !== null && row.m === liqMonth) out.push({ kind: f.kind, usd: null, btc: null, text: f.text(row) });
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
  const rows: ScheduleRow[] = [{
    m: 0,
    label: 'Today',
    actions: todayActions(plan),
    keepAtSupportBtc: plan.strikeKeepBtc,
    zone: sim.policyApplied ? sim.rows[0]?.policyZone ?? null : null,
    crash: false,
  }];
  for (const row of sim.rows) {
    if (row.m === 0) continue;
    const actions = rowActions(row, sim.liqMonth);
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
  // moves nothing today, and the line said "collateral moves to Coinbase today".
  const movesToday = plan.state === 'ready' && plan.worthMoving && shownBtc(plan.strikeToCbBtc);
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

/** The print artifact — the schedule as plain text, carrying THE MOVE and the disclaimer with it. */
export function scheduleToText(
  rows: ScheduleRow[], header: string, answer: string, disclaimer: string,
): string {
  const out: string[] = [header, '', answer, ''];
  for (const r of rows) {
    if (r.actions.length === 0) continue;
    out.push(`${r.label}${r.zone !== null ? ` (${r.zone})` : ''}`);
    for (const a of r.actions) out.push(`  - ${a.text}`);
    if (r.crash) out.push('  ! A crash month — work from the Emergency Console on the day.');
    out.push('');
  }
  out.push(disclaimer);
  return out.join('\n');
}

// ── THE MOVE's copy (v1.3) ───────────────────────────────────────────────────────────────────────────────────

export type MoveTone = 'plain' | 'good' | 'warn' | 'bad';
export interface MoveLine { key: string; tone: MoveTone; text: string }
export interface MoveCardCopy { title: string; lines: MoveLine[] }

export const MOVE_CARD_TITLE = "The support policy's move this month";
/** N3 — what the card says when the plan could not be worked out at all. */
export const UNAVAILABLE_LINE =
  "The move can't be worked out right now — today's price, the support line or a balance isn't available.";

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
  breaker: BreakerReading | null;
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
  // Only when the move is actually MADE (N5): under the threshold nothing moves, and the batch line is the
  // answer — listing legs there described a position that will not exist.
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
  if (hasLoan) {
    const m = cbMetrics(ctx.cbDebt, plan.opening.cbCollateralBtc, ctx.price, ctx.cbLtvTriggerPct);
    if (m.liqPrice > 0 && m.liqPrice < ctx.price) {
      lines.push(line('cliff', 'warn',
        `Coinbase seizes this loan at ${fmtUSD(m.liqPrice)} — ${pctInt(Math.abs(m.pctToLiq))} below today.`));
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
  return { title: MOVE_CARD_TITLE, lines };
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
    const out = [line('line', 'plain', `Modeling a ${fmtUSD(ctx.runLineUsd)} line.`)];
    if (ctx.runLineUsd > ctx.ownerLineUsd) {
      out.push(line('lineHold', 'warn',
        `Raising your line restarts Strike's ${STRIKE_HOLD_DAYS}-day hold — move the coins first.`));
    }
    return out;
  }
  return ctx.ownerLineUsd >= ctx.suggestedLineUsd
    ? [line('line', 'good',
      `Your ${fmtUSD(ctx.ownerLineUsd)} line already covers ${LINE_MONTHS_WORD} months of bills${paydown}.`)]
    : [line('line', 'plain',
      `A ${fmtUSD(ctx.suggestedLineUsd)} line would cover ${LINE_MONTHS_WORD} months of bills${paydown}, with 25% spare.`)];
}

const LINE_MONTHS_WORD = 'two';
