import type { CrashPlaybookInput, CrashPlaybookResult } from '../../simulation/crashPlaybook';
import { ceilingLiquidationMultiple } from '../../simulation/cbDefense';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { effectivePolicyStops } from '../../simulation/cyclingSim';
import { cbMetrics } from '../../simulation/cbMetrics';
import { ltvOf } from '../../simulation/ltv';
import { SUPPORT_EPS } from '../../simulation/supportPolicy';
import type { DayEvent } from '../../simulation/types';
import { DEFAULT_SUPPORT_POLICY_SETTINGS, shownUsd, fmtPolicyPct } from '../Almanac/supportPolicyView';
import { fmtTurnDate } from '../Almanac/cyclingFaceView';
import { fmtColdBtc } from '../../lib/ledgerCsv';
import { fmtUSD, fmtLtvPct } from '../../utils/format';

/**
 * THE CRASH PLAYBOOK, LIVE — the one front-end that runs `crashPlaybook` on the owner's real position (crash playbook
 * Run 2). The Emergency Console uses it now and the Monthly Playbook's crash line (Run 3) imports it — never copy it:
 * the console and the engine must give ONE answer.
 *
 * Pure: plain numbers in, plain strings out. It imports nothing from the power law, the cycle model, the store or React
 * (a layering test pins it) — support arrives as a number, and the component keeps the power-law crossing.
 *
 *   strikeHoldFrom          Strike's 60-day hold, read from the Strike deposits you LOGGED
 *   playbookInputFromLive   the one builder of a live CrashPlaybookInput
 *   fmtStepBtc / fmtStepUsd step amounts, FLOORED to their printed precision
 *   fmtMultiplePair         the support multiple and the liquidation depth, widened until they differ
 *   waitingCard             Coinbase between its target and its trigger — the plan waits
 *   playbookCard            the crash-day card
 *
 * ⚠ THE DOOM WARNING READS THE AFTER-STATE (`after.cbLtv >= lltv`), NEVER `result.doomed`. `doomed` is read at the
 * open, from collateral alone (`possible < need`). So a doomed-at-open run can still be brought under 86% by the debt
 * shift — held or short, never doom — and an exact tie (e.g. zero needed at an exact-86% open with nothing movable) is
 * not doomed, yet ends AT 86% — doom, under whichever badge its order gives. The after-state is the only honest read.
 *
 * ⚠ STEP AMOUNTS ARE FLOORED to their printed precision. A binding Strike release is 0.5999999996 ₿: rounded to 5 dp it
 * prints 0.60000 — exactly the 50% Strike refuses — and a line-capped shift of $3,487.50 must print $3,487, never a
 * draw over the line.
 *
 * Every sentence must be TRUE of the run it describes (the supportPolicyView discipline).
 */

/** Strike releases nothing within this many days of a deposit into its collateral pool. */
export const STRIKE_HOLD_DAYS = 60;
/** One satoshi. A BTC figure under it is float residue, never a step. */
export const SAT_BTC = 1e-8;

const DAY_MS = 86_400_000;
/** The dayLog's date convention. Anything else is junk — V8 would read '2026-9-30' as LOCAL time, not UTC midnight. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Strike's 60-day hold ─────────────────────────────────────────────────────────────────────────────────────────

export interface StrikeHold { inHold: boolean; depositISO: string | null; throughISO: string | null }

/**
 * In hold iff a `deposit` with `target: 'strike'` is dated at most 60 days before `todayISO` — Strike releases collateral
 * only once the line is MORE than 60 days past its last collateral add. A future-dated deposit counts. Withdrawals,
 * `'cb'` / `'cold'` deposits and junk dates never do. Both dates are yyyy-mm-dd at UTC midnight (the calendarModel
 * convention), so the gap is whole days. The latest such deposit sets `depositISO`; `throughISO` is 60 days after it.
 * ⚠ The app sees only the deposits you LOGGED — a collateral increase entered only as a balance reading is invisible.
 */
export function strikeHoldFrom(dayLog: readonly DayEvent[], todayISO: string): StrikeHold {
  const free: StrikeHold = { inHold: false, depositISO: null, throughISO: null };
  if (!ISO_DATE.test(todayISO)) return free;
  const today = Date.parse(todayISO);
  if (!Number.isFinite(today)) return free;
  let latestISO: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const ev of dayLog) {
    if (ev.kind !== 'deposit' || ev.target !== 'strike' || !ISO_DATE.test(ev.date)) continue;
    const t = Date.parse(ev.date);
    if (!Number.isFinite(t) || (today - t) / DAY_MS > STRIKE_HOLD_DAYS) continue;
    if (t > latestMs) {
      latestMs = t;
      latestISO = ev.date;
    }
  }
  if (latestISO === null) return free;
  return {
    inHold: true,
    depositISO: latestISO,
    throughISO: new Date(latestMs + STRIKE_HOLD_DAYS * DAY_MS).toISOString().slice(0, 10),
  };
}

// ── the one live builder ─────────────────────────────────────────────────────────────────────────────────────────

export interface LivePlaybookFigures {
  price: number;               // the console's effective price — simulated while simulating
  support: number;             // support(t), a plain number
  cbDebt: number;              // ALREADY accrued (accruedCbBalance) — the accrual boundary stays in the component
  cbCollateralBtc: number;
  strikeBalance: number;       // advisorActualBlocBalance — the LIVE balance, never the last logged month's
  strikeCollateralBtc: number; // getCurrentBtcHeld()
  creditLine: number;
  coldBtc: number;             // getCurrentColdBtc()
  cbLtvTargetPct: number;
  dayLog: readonly DayEvent[];
  todayISO: string;            // todayLocalISO()
}

/**
 * THE one builder of a live `CrashPlaybookInput` — the console uses it and Run 3 imports it; never copy it. The live
 * figures pass through untouched, with:
 *  - cold under a satoshi (or not finite) → 0: netted cold moves leave ~1e-17 of residue, and without this the playbook
 *    would "move 0.00000000 ₿";
 *  - the Coinbase stop AT SUPPORT through `effectivePolicyStops` on the support policy's DEFAULTS — the one stop clamp,
 *    never a copy of it here. The console has no policy settings; persisting them is its own spec;
 *  - the lender facts (Morpho's 86% and Strike's three lines) and Strike's 60-day hold.
 */
export function playbookInputFromLive(live: LivePlaybookFigures): CrashPlaybookInput {
  const D = DEFAULT_SUPPORT_POLICY_SETTINGS;
  return {
    price: live.price,
    support: live.support,
    cbDebt: live.cbDebt,
    cbCollateralBtc: live.cbCollateralBtc,
    strikeBalance: live.strikeBalance,
    strikeCollateralBtc: live.strikeCollateralBtc,
    strikeCreditLine: live.creditLine,
    coldBtc: Number.isFinite(live.coldBtc) && live.coldBtc >= SAT_BTC ? live.coldBtc : 0,
    targetCbLtvPct: live.cbLtvTargetPct,
    cbStopAtSupport: effectivePolicyStops(D.cbStopAtSupportPct, D.strikeStopAtSupportPct, live.cbLtvTargetPct, 0).cbStop,
    lltv: CB_LLTV,
    maxDrawLtv: STRIKE_MAX_DRAW_LTV,
    marginLtv: STRIKE_MARGIN_CALL_LTV,
    retrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV,
    strikeInHold: strikeHoldFrom(live.dayLog, live.todayISO).inHold,
  };
}

// ── formatting ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Float-noise guard for the floors: 0.3 − 0.25 is 0.04999999999999999, and must still print 0.05000. */
const FLOOR_GUARD = 1e-7;

/** A step's BTC, FLOORED to its printed precision: 5 dp; when that is 0, 8 dp; under one satoshi → null (not a step).
 *  Non-finite or ≤ 0 → null. */
export function fmtStepBtc(btc: number): string | null {
  if (!Number.isFinite(btc) || !(btc > 0)) return null;
  const five = Math.floor(btc * 1e5 + FLOOR_GUARD) / 1e5;
  if (five > 0) return five.toFixed(5);
  const eight = Math.floor(btc * 1e8 + FLOOR_GUARD) / 1e8;
  return eight > 0 ? eight.toFixed(8) : null;
}

/** A step's dollars, FLOORED to whole dollars (the same guard), then fmtUSD; under $1 → null (not a step). */
export function fmtStepUsd(usd: number): string | null {
  if (!Number.isFinite(usd)) return null;
  const whole = Math.floor(usd + FLOOR_GUARD);
  return whole >= 1 ? fmtUSD(whole) : null;
}

/** The support multiple and the liquidation depth, printed to the fewest decimals (2 → 6) that tell them apart — at a
 *  round 0.70× support both read "0.70" at 2 dp. Still equal at 6 dp → `equal: true`, and the copy says "at" / "just
 *  below". */
export function fmtMultiplePair(k: number, depth: number): { k: string; depth: string; equal: boolean } {
  for (let dp = 2; dp <= 6; dp++) {
    const a = k.toFixed(dp);
    const b = depth.toFixed(dp);
    if (a !== b) return { k: a, depth: b, equal: false };
  }
  return { k: k.toFixed(6), depth: depth.toFixed(6), equal: true };
}

// ── the cards ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PlaybookCard {
  badge: 'Top up first' | 'Shift first' | 'No action' | 'Check figures';
  depth: string;
  pastLiquidation: string | null;
  steps: string[];
  gap: string | null;
  strikeNote: string | null;
  after: string | null;
  outcome: { kind: 'held' | 'short' | 'doom'; text: string } | null;
}

/** A card that is only a badge and one sentence. */
const onlyText = (badge: PlaybookCard['badge'], depth: string): PlaybookCard => ({
  badge, depth, pastLiquidation: null, steps: [], gap: null, strikeNote: null, after: null, outcome: null,
});

/** ` (~$X)` for a PRINTED BTC figure at price P — only when the dollars clear the $0.50 dust floor. */
const usdAside = (printedBtc: string, price: number): string => {
  const usd = Number(printedBtc) * price;
  return shownUsd(usd) ? ` (~${fmtUSD(usd)})` : '';
};

/** A lender line as a whole percentage — 0.86 → 86. */
const pct = (fraction: number): number => Math.round(fraction * 100);

/**
 * The plan WAITS between the target and the trigger (A0): in `ltvTriggered` mode the defense fires at the trigger (the
 * Advisor's cbLtvTriggered and Simple Mode's cbTriggered both read `>= cbLtvTriggerPct`) and restores the target. A
 * card only when target < LTV < trigger and LTV < the liquidation line; otherwise null, and the playbook runs — at or
 * under the target it reads "nothing to do", at or over the trigger (or past 86%) it acts.
 */
export function waitingCard(input: CrashPlaybookInput, triggerPct: number): PlaybookCard | null {
  const open = ltvOf(input.cbDebt, input.cbCollateralBtc, input.price);
  if (!(open > input.targetCbLtvPct / 100 && open < triggerPct / 100 && open < input.lltv)) return null;
  const t = fmtPolicyPct(input.targetCbLtvPct);
  return onlyText('No action',
    `Coinbase is at ${fmtLtvPct(open, 1)} — between your ${t}% target and your ${fmtPolicyPct(triggerPct)}% trigger, `
    + `where your plan waits. At the trigger the playbook brings it back to ${t}%.`);
}

const GAP_NO_ROOM = 'No step is available — the Strike line has no room.';
const GAP_NOTHING =
  'No step is available — no cold, no Strike collateral Strike will release, and no room on the Strike line.';
const GAP_NO_SHIFT = 'The Strike line has no room to shift debt, so collateral goes in instead.';
const GAP_NO_TOP_UP =
  'Nothing can top up first — no cold, and no Strike collateral Strike will release now — so the debt shifts.';

/**
 * The crash-day card for a playbook result. Shapes: `'none'` → "nothing to do" (or "Check figures" on junk); otherwise
 * the depth sentence (why this order), the past-liquidation note (opening ≥ 86%), the steps in the playbook's order
 * (floored; a step that floors to nothing is not listed), a gap note read on the LISTED steps, the Strike note (the
 * hold with its dates, else Strike's release rules when a release is named), the after line, and the outcome —
 * doom from the after-state (see the docblock), else short or held.
 */
export function playbookCard(result: CrashPlaybookResult, input: CrashPlaybookInput, hold: StrikeHold): PlaybookCard {
  const t = fmtPolicyPct(input.targetCbLtvPct);
  const L = pct(input.lltv);
  const P = input.price;
  const k = P / input.support;
  const depth = ceilingLiquidationMultiple(input.cbStopAtSupport, input.lltv);
  const open = ltvOf(input.cbDebt, input.cbCollateralBtc, P);
  const a = result.after;

  // 1 · 'none' — at or under the target, or figures the playbook can't read (crashPlaybook returns 'none' on junk).
  if (result.order === 'none') {
    return P > 0 && input.support > 0 && Number.isFinite(open) && open <= input.targetCbLtvPct / 100
      ? onlyText('No action', `Coinbase is at or under your ${t}% target — nothing to do.`)
      : onlyText('Check figures', `The playbook can't read these figures — check your loan details.`);
  }

  // 2 · the depth sentence — why this order.
  const m = fmtMultiplePair(k, depth);
  let depthText: string;
  if (result.order === 'topUpFirst') {
    depthText = `Price is ${m.k}× support — ${m.equal ? 'at' : 'above'} the ${m.depth}× liquidation depth, `
      + `so top up first.`;
  } else if (k >= 1 - SUPPORT_EPS) {
    depthText = `Price is ${k.toFixed(2)}× support — at or above support, so shift debt first.`;
  } else if (k < depth) {
    depthText = `Price is ${m.k}× support — ${m.equal ? 'just below' : 'below'} the ${m.depth}× liquidation depth, `
      + `so shift debt first.`;
  } else {
    // In the band yet shift-first ⇒ doomed at the open.
    depthText = `Price is ${m.k}× support — ${m.equal ? 'at' : 'above'} the ${m.depth}× liquidation depth, `
      + `but the collateral you can move can't clear ${L}%, so shift debt first.`;
  }

  // 3 · already past the line at this price.
  const pastLiquidation = open >= input.lltv
    ? `At this price Coinbase is at ${fmtLtvPct(open, 1)} — past its ${L}% liquidation line. Morpho liquidates `
      + `instantly, so in a real crash you would have to act before the price fell this far.`
    : null;

  // 4 · the steps, in the playbook's order.
  const steps: string[] = [];
  let listedShift = false;
  let listedCollateral = false;
  let listedRelease = false;
  for (const step of result.steps) {
    if (step.kind === 'shiftToStrike') {
      const usd = fmtStepUsd(step.usd);
      if (usd === null) continue;
      steps.push(`Draw ${usd} on Strike and pay Coinbase down with it.`);
      listedShift = true;
      continue;
    }
    const btc = fmtStepBtc(step.btc);
    if (btc === null) continue;
    listedCollateral = true;
    if (step.kind === 'coldToCoinbase') {
      steps.push(`Move ${btc} ₿${usdAside(btc, P)} from cold storage into Coinbase.`);
    } else {
      listedRelease = true;
      steps.push(`Release ${btc} ₿${usdAside(btc, P)} of Strike collateral into Coinbase.`);
    }
  }

  // 5 · the gap — read on the LISTED steps.
  let gap: string | null = null;
  if (steps.length === 0) gap = a.cbLtv >= input.lltv ? GAP_NO_ROOM : GAP_NOTHING;
  else if (result.order === 'shiftFirst' && !listedShift) gap = GAP_NO_SHIFT;
  else if (result.order === 'topUpFirst' && !listedCollateral) gap = GAP_NO_TOP_UP;

  // 6 · the Strike note — the hold with its dates; else the release rules, when a release is listed or the gap names
  //     Strike's releases and there is Strike collateral to speak of.
  let strikeNote: string | null = null;
  if (hold.inHold && hold.throughISO !== null && hold.depositISO !== null) {
    strikeNote = `Strike's collateral is on hold through ${fmtTurnDate(new Date(hold.throughISO))} — you logged a `
      + `Strike deposit on ${fmtTurnDate(new Date(hold.depositISO))}, and Strike releases nothing within `
      + `${STRIKE_HOLD_DAYS} days of one.`;
  } else if (listedRelease || ((gap === GAP_NOTHING || gap === GAP_NO_TOP_UP) && input.strikeCollateralBtc > 0)) {
    strikeNote = `Strike releases collateral only at or under ${pct(STRIKE_RETRIEVE_MAX_LTV)}% LTV, only down to under `
      + `${pct(STRIKE_MAX_DRAW_LTV)}%, and only on a line more than ${STRIKE_HOLD_DAYS} days old — the app assumes `
      + `yours is.`;
  }

  // 7 · the after-state — only when a step is listed.
  let after: string | null = null;
  if (steps.length > 0) {
    const cbLiq = a.cbCollateralBtc > 0
      ? `, liquidation at ${fmtUSD(cbMetrics(a.cbDebt, a.cbCollateralBtc, P, input.targetCbLtvPct).liqPrice)}`
      : '';
    const marginCall = a.strikeCollateralBtc > 0
      ? `, margin call at ${fmtUSD(a.strikeBalance / (a.strikeCollateralBtc * input.marginLtv))}`
      : '';
    const strike = shownUsd(a.strikeBalance) ? `Strike ${fmtLtvPct(a.strikeLtv, 1)} LTV${marginCall}` : 'no Strike balance';
    after = `After: Coinbase ${fmtLtvPct(a.cbLtv, 1)} LTV${cbLiq} · ${strike}.`;
  }

  // 8 · the outcome — doom reads the AFTER-state, never result.doomed (the docblock says why).
  let outcome: PlaybookCard['outcome'];
  if (a.cbLtv >= input.lltv) {
    outcome = {
      kind: 'doom',
      text: `Coinbase can't clear ${L}% even with every coin the rules allow — only the last resorts below remain.`,
    };
  } else if (result.shortfallBtc >= SAT_BTC) {
    const sf = fmtColdBtc(result.shortfallBtc);
    outcome = {
      kind: 'short',
      text: `Still ${sf} ₿${usdAside(sf, P)} short of your ${t}% target — Coinbase ends at ${fmtLtvPct(a.cbLtv, 1)}, `
        + `under its ${L}% liquidation line.`,
    };
  } else {
    outcome = { kind: 'held', text: `Coinbase is back at your ${t}% target.` };
  }

  return {
    badge: result.order === 'topUpFirst' ? 'Top up first' : 'Shift first',
    depth: depthText, pastLiquidation, steps, gap, strikeNote, after, outcome,
  };
}
