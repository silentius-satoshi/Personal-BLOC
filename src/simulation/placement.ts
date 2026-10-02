import {
  policyZone, ceilingHeadroomUsd, strikeKeepCollateralBtc, cbKeepCollateralBtc, type PolicyZone,
} from './supportPolicy';
import { strikeReleasableBtc, defendCbLtv } from './cbDefense';
import { cbMetrics } from './cbMetrics';
import {
  STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV, STRIKE_LINE_MIN_USD, STRIKE_LINE_MAX_USD,
} from './strikeCredit';
// `marginLtv` is reporting-only inside defendCbLtv (this call carries no Strike position), but the house keeps ONE
// definition of Strike's call line and this reads it rather than inventing a stand-in.
import { STRIKE_MARGIN_CALL_LTV } from './emergencyModel';
import { CB_LLTV } from './runCoinbaseLoan';
import { ltvOf } from './ltv';

/**
 * THE MOVE — the support policy's collateral placement for THIS month, previewed at today's inputs.
 *
 * 🔴 IT IS THE ENGINE'S OWN STEPS 5 AND 9, not a second rule. Both keeps come from the SAME two functions
 * `runCyclingSim` calls (`strikeKeepCollateralBtc` at step 5, `cbKeepCollateralBtc` at step 9), so the card,
 * the run and the schedule can never disagree about where a coin belongs. Never re-derive either here.
 *
 * Why preview it at all, rather than read month 1 off the run: the engine's migration comes AFTER month 1's draw
 * test, so a run that has not yet moved the collateral borrows less in month 1. At the pre-v2 policy (the engine
 * fixtures') acting today is measured never worse, and better where the move unlocks a draw. At Policy v2's defaults it
 * is within 0.025 ₿ on the A5 paths × four positions (worse on 6 of 60): the 45% ceiling binds in year one, so the
 * earlier draw moves buying earlier rather than adding to it.
 *
 * DIRECT ROUTING. The engine puts the WHOLE Strike excess on Coinbase (step 5) and then sweeps whatever Coinbase
 * holds beyond its keep on to cold (step 9). This leaf reaches the same end state in one hop: Coinbase is filled
 * up to its keep, and the rest — plus any Coinbase surplus — goes straight to cold.
 *
 * 🔴 PURE LEAF. No power law, no cycle model, no store, no React, no `components/`. Support and the hold arrive
 * as plain values. It never names a test-only engine input.
 */

/** Today's moves must total at least this to be worth making (D16). The engine moves collateral as if moves were
 *  free — about 21 times a year on the default fixture, a third of them under this — but a real move costs fees and
 *  attention. Below it, the moves WAIT for next month's re-plan, which picks up whatever was deferred; deferring a
 *  placement move only leaves extra collateral where it is. ⚠ CRASH moves are never deferred — they are not
 *  placement moves and never reach this leaf. */
export const MOVE_THRESHOLD_BTC = 0.01;

/** The suggested line sizes two months of bills, or one Coinbase paydown, whichever is larger — plus a quarter. */
export const LINE_BILL_MONTHS = 2;
export const LINE_HEADROOM = 1.25;

export interface PlacementInput {
  /** The RUN's line: the what-if overlay when engaged, else the owner's own (decision 4). */
  creditLine: number;
  strikeBalance: number;
  strikeCollateralBtc: number;
  /** ACCRUED — the caller crosses the accrual boundary (`accruedCbBalance`), as every other live surface does. */
  cbDebt: number;
  cbCollateralBtc: number;
  coldBtc: number;
  /** Today's anchor price — the stress lens's held anchor, NEVER the raw store price. */
  price: number;
  /** S₀ = supportPath[0]. */
  support: number;
  /** The stops the RUN uses (already clamped to the defense lines by `effectivePolicyStops`). */
  skStop: number;
  cbStop: number;
  /** The face's Coinbase defense line as a fraction — the engine's `cap`. */
  cbDefenseLtv: number;
  /** The engine's `policy.bufferUsd` = bear-buffer months × bills. */
  bufferUsd: number;
  accumulateBelow: number;
  payDownAbove: number;
  /** Strike's 60-day hold, from the owner's LOGGED deposits. */
  inHold: boolean;
  /**
   * The breaker, from the SAME seed the run's `openingBreaker` gets (`breakerSeed?.state.broken ?? false`).
   * 🔴 THE MOVE must read it: a broken model is the engine's own zone and steps 5 and 9 never run there
   * (`cyclingSim.ts`: `state = breaker.broken ? 'broken' : policyZone(...)`). Without it the card told the owner
   * to release collateral in the same breath the policy card said the model was broken, and D10 would have
   * seeded the run from a move the engine refuses to make.
   */
  broken: boolean;
}

export type PlacementState = 'ready' | 'paused' | 'broken' | 'cbPastLiquidation' | 'unavailable';
/** Why Strike's excess does or does not move: it moves, there is none, the hold blocks it, or its LTV does. */
export type StrikeLeg = 'moves' | 'nothing' | 'hold' | 'ltv';

export interface PlacementPlan {
  state: PlacementState;
  zone: PolicyZone;
  strikeLeg: StrikeLeg;
  /** Step 5's keep; null when not finite. */
  strikeKeepBtc: number | null;
  /** Strike holds LESS than its line needs at support. */
  strikeShortBtc: number;
  /** Room under Strike's own ceiling at support (never negative here). */
  strikeRoomUsd: number;
  /** What Strike will RELEASE today, under its own rules. */
  releasableBtc: number;
  /** Step 9's keep; null when not finite. */
  cbKeepBtc: number | null;
  strikeToCbBtc: number;
  strikeToColdBtc: number;
  cbToColdBtc: number;
  /** The end state the engine's steps 5 and 9 reach — the I3 contract. ⚠ It is NOT what the owner ends up
   *  holding when the move is deferred; that is `opening`. */
  after: { strikeCollateralBtc: number; cbCollateralBtc: number; coldBtc: number };
  /**
   * The position the owner ACTUALLY holds once today's move is made or deferred: `after` when `seeded`, today's
   * holdings otherwise (and in every inert state). 🔴 This is what the run seeds from (D10) and what the cliff
   * and `cbOverCeilingUsd` read. A sub-threshold move reaches `after` but never happens, so reading `after`
   * there described a position that will not exist.
   */
  opening: { strikeCollateralBtc: number; cbCollateralBtc: number; coldBtc: number };
  /** How far Coinbase is OVER its limit at support, at `opening`. A fact about the position, not a move — the
   *  policy repays it from spare income before it borrows again (step 4's restore). Computed in every state but
   *  `'unavailable'`. */
  cbOverCeilingUsd: number;
  worthMoving: boolean;
  /** Something worth moving moves today, so the run starts from `after` (D10). */
  seeded: boolean;
}

const fin = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));

/** A plan that moves nothing — every non-`'ready'` state, and the shape `'unavailable'` returns. */
function inert(
  state: PlacementState, zone: PolicyZone, input: PlacementInput,
  extra: Partial<PlacementPlan> = {},
): PlacementPlan {
  return {
    state,
    zone,
    strikeLeg: 'nothing',
    strikeKeepBtc: null,
    strikeShortBtc: 0,
    strikeRoomUsd: 0,
    releasableBtc: 0,
    cbKeepBtc: null,
    strikeToCbBtc: 0,
    strikeToColdBtc: 0,
    cbToColdBtc: 0,
    after: {
      strikeCollateralBtc: input.strikeCollateralBtc,
      cbCollateralBtc: input.cbCollateralBtc,
      coldBtc: input.coldBtc,
    },
    opening: {
      strikeCollateralBtc: input.strikeCollateralBtc,
      cbCollateralBtc: input.cbCollateralBtc,
      coldBtc: input.coldBtc,
    },
    cbOverCeilingUsd: 0,
    worthMoving: false,
    seeded: false,
    ...extra,
  };
}

export function placementPlan(input: PlacementInput): PlacementPlan {
  const {
    creditLine, strikeBalance, strikeCollateralBtc, cbDebt, cbCollateralBtc, coldBtc,
    price, support, skStop, cbStop, cbDefenseLtv, bufferUsd, accumulateBelow, payDownAbove, inHold, broken,
  } = input;

  // 'unavailable' FIRST — no NaN or ∞ ever leaves this leaf, and an unusable input can't be read as "aligned".
  if (!fin(creditLine, strikeBalance, strikeCollateralBtc, cbDebt, cbCollateralBtc, coldBtc, price, support,
    skStop, cbStop, cbDefenseLtv, bufferUsd, accumulateBelow, payDownAbove)
    || !(price > 0) || !(support > 0)) {
    return inert('unavailable', 'paused', {
      ...input,
      strikeCollateralBtc: Number.isFinite(strikeCollateralBtc) ? strikeCollateralBtc : 0,
      cbCollateralBtc: Number.isFinite(cbCollateralBtc) ? cbCollateralBtc : 0,
      coldBtc: Number.isFinite(coldBtc) ? coldBtc : 0,
    });
  }

  const zone = policyZone(price, support, accumulateBelow, payDownAbove);
  // How far Coinbase sits over its limit at support. A FACT about the position, so it is reported in every state
  // except 'unavailable' — including paused and past-liquidation, where nothing moves but the debt is still over.
  const overAt = (coll: number): number =>
    Math.max(0, -ceilingHeadroomUsd(cbDebt, coll, support, cbStop));

  // 🔴 THE ORDER IS THE DESIGN: 'unavailable' → 'cbPastLiquidation' → 'broken' → 'paused' → 'ready'.
  // A seizure is the most urgent fact and BELOW support it is the likeliest, so a pause must never hide it —
  // the card would otherwise never mention the 86% line or the Emergency Console.
  // The engine's `liqMonth` would already be 0 — there is nothing to place.
  if (cbDebt > 0 && ltvOf(cbDebt, cbCollateralBtc, price) >= CB_LLTV) {
    return inert('cbPastLiquidation', zone, input, { cbOverCeilingUsd: overAt(cbCollateralBtc) });
  }
  // A broken model is the engine's own zone: it overrides the price zone, and steps 5 and 9 never run.
  if (broken) {
    return inert('broken', zone, input, { cbOverCeilingUsd: overAt(cbCollateralBtc) });
  }
  // Below support the collateral is needed where it is: steps 5 and 9 never run.
  if (zone === 'paused') {
    return inert('paused', zone, input, { cbOverCeilingUsd: overAt(cbCollateralBtc) });
  }

  // ── step 5, previewed ──────────────────────────────────────────────────────────────────────────────────────
  const keep = strikeKeepCollateralBtc(creditLine, strikeBalance, skStop, support);
  const strikeKeepBtc = Number.isFinite(keep) ? keep : null;
  const excess = Math.max(0, strikeCollateralBtc - keep);
  const releasableBtc = strikeReleasableBtc({
    strikeCollateralBtc, strikeBalance, price,
    retrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV, maxAfterLtv: STRIKE_MAX_DRAW_LTV, inHold,
  });
  // ALL-OR-NOTHING, like step 5: Strike either releases the whole excess or none of it.
  const strikeLeg: StrikeLeg = excess <= 0 ? 'nothing'
    : inHold ? 'hold'
      : excess <= releasableBtc ? 'moves' : 'ltv';
  const moved = strikeLeg === 'moves' ? excess : 0;

  // ── step 9, previewed ──────────────────────────────────────────────────────────────────────────────────────
  const cbKeep = cbKeepCollateralBtc(cbDebt, bufferUsd, support, cbStop, cbDefenseLtv, price);
  const cbKeepBtc = Number.isFinite(cbKeep) ? cbKeep : null;
  const strikeToCbBtc = Math.min(moved, Math.max(0, cbKeep - cbCollateralBtc));
  const strikeToColdBtc = moved - strikeToCbBtc;
  const cbToColdBtc = Math.max(0, cbCollateralBtc - cbKeep);

  const after = {
    strikeCollateralBtc: strikeCollateralBtc - moved,
    cbCollateralBtc: cbCollateralBtc + strikeToCbBtc - cbToColdBtc,
    coldBtc: coldBtc + strikeToColdBtc + cbToColdBtc,
  };
  // ⚠ ORDER MATTERS: worthMoving decides `seeded`, `seeded` decides `opening`, and `opening` is what
  // `cbOverCeilingUsd` measures.
  const worthMoving = moved + cbToColdBtc >= MOVE_THRESHOLD_BTC;
  const opening = worthMoving
    ? after
    : { strikeCollateralBtc, cbCollateralBtc, coldBtc };

  return {
    state: 'ready',
    zone,
    strikeLeg,
    strikeKeepBtc,
    strikeShortBtc: strikeKeepBtc === null ? 0 : Math.max(0, keep - strikeCollateralBtc),
    strikeRoomUsd: Math.max(0, ceilingHeadroomUsd(strikeBalance, strikeCollateralBtc, support, skStop)),
    releasableBtc,
    cbKeepBtc,
    strikeToCbBtc,
    strikeToColdBtc,
    cbToColdBtc,
    after,
    opening,
    cbOverCeilingUsd: overAt(opening.cbCollateralBtc),
    worthMoving,
    seeded: worthMoving,
  };
}

// ── the suggested line ───────────────────────────────────────────────────────────────────────────────────────

export interface SuggestedLineInput {
  expenses: number;
  cbDebt: number;
  cbCollateralBtc: number;
  price: number;
  /** The STORE's thresholds (the Emergency Console's, 75 → 65 by default) — the basis the copy names. The RUN
   *  defends the face's own line; this sizes a line, and is not the run. */
  cbLtvTriggerPct: number;
  cbLtvTargetPct: number;
}

/**
 * A Strike line big enough to cover two months of bills OR one Coinbase paydown (trigger → target), whichever is
 * larger, with a quarter spare — rounded up to $500 and clamped to what Strike actually lends.
 *
 * ⚠ It is the "suggested line", never a "recommended minimum": `InputsPanel`'s recommendation is a DIFFERENT
 * strategy's figure (the year-one BLOC model's peak balance × 1.10). The two are not unified.
 * ⚠ It never becomes the run's line on its own (decision 4) — the face offers it as a what-if.
 */
export function suggestedLineUsd(input: SuggestedLineInput): number {
  const { expenses, cbDebt, cbCollateralBtc, price, cbLtvTriggerPct, cbLtvTargetPct } = input;
  if (!fin(expenses, cbDebt, cbCollateralBtc, price, cbLtvTriggerPct, cbLtvTargetPct)) return STRIKE_LINE_MIN_USD;
  const bills = LINE_BILL_MONTHS * Math.max(0, expenses);
  // The paydown the owner's OWN thresholds would call for — through the one defense function, not a second formula.
  const defense = cbDebt > 0 && cbCollateralBtc > 0 && price > 0
    ? defendCbLtv({
      cbDebt,
      cbCollateralBtc,
      strikeCollateralBtc: 0,
      strikeBalance: 0,
      price: cbMetrics(cbDebt, cbCollateralBtc, price, cbLtvTriggerPct).triggerPrice,
      targetCbLtvPct: cbLtvTargetPct,
      creditLine: Number.POSITIVE_INFINITY,
      maxDrawLtv: STRIKE_MAX_DRAW_LTV,
      marginLtv: STRIKE_MARGIN_CALL_LTV,
    }).paydownNeededUsd
    : 0;
  const raw = Math.max(bills, Number.isFinite(defense) ? defense : 0) * LINE_HEADROOM;
  const rounded = Math.ceil(raw / 500) * 500;
  return Math.min(STRIKE_LINE_MAX_USD, Math.max(STRIKE_LINE_MIN_USD, rounded));
}
