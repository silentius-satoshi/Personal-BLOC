/**
 * Support-anchored policy — the pure leaf (spec v1.2, Run 1).
 *
 * THE DEFECT IT FIXES: every safety rule in the cycling engine was measured at TODAY'S price, so each one
 * loosened as the price rose — the draw test allowed debt up to `cap × collateral × price`, the cold sweep
 * kept less collateral, the migration freed more Strike collateral. The engine borrowed the most at the top.
 * The policy uses ONE stress price everywhere, `support(t)` — the power-law floor, which every recorded cycle
 * low has sat on — so each loan is sized to sit exactly at its stop when price is AT support, and that ceiling
 * does not move with today's price.
 *
 *   k = price / support      paused < 1 ≤ accumulate ≤ accumulateBelow < hold ≤ payDownAbove < payDown
 *   hard breaker             2 consecutive month-ends below 0.9 × support → 'broken', LATCHED for the run
 *
 * 🔴 Pure leaf: imports only the zero-import `./ltv`. Support arrives as a plain number — this module has never
 * heard of the power law (the §2 wall). Every function is guarded so it NEVER returns NaN: guards are
 * `Number.isFinite && > 0`, never `Math.max(0, x)` (which returns NaN for NaN). Junk fails SAFE: a zone reads
 * 'paused' (no new debt), a sweep keeps everything (+∞), a sale sells nothing.
 */
import { ltvOf } from './ltv';

export type PolicyZone = 'paused' | 'accumulate' | 'hold' | 'payDown';
export type PolicyState = PolicyZone | 'broken';

/** Float guard: a price computed ONTO the line must never read as below it. */
export const SUPPORT_EPS = 1e-9;
/** Hard breaker: "> 10% below support for > 30 days", proxied at month-ends. */
export const HARD_BREAKER_DEPTH = 0.10;
export const HARD_BREAKER_MONTHS = 2;

/** Below this a computed sale or cold move is float dust, not a decision (0.0001 sat). */
const DUST_BTC = 1e-12;

const allFinite = (...xs: number[]): boolean => xs.every((x) => Number.isFinite(x));

/** k = price / support. Junk (support ≤ 0 or non-finite, price or a threshold non-finite) → 'paused'. FAIL
 *  SAFE: no new debt. */
export function policyZone(price: number, support: number, accumulateBelow: number, payDownAbove: number): PolicyZone {
  if (!(support > 0) || !allFinite(price, support, accumulateBelow, payDownAbove)) return 'paused';
  const k = price / support;
  if (k < 1 - SUPPORT_EPS) return 'paused';
  if (k <= accumulateBelow) return 'accumulate';
  if (k <= payDownAbove) return 'hold';
  return 'payDown';
}

/** Room under the ceiling at support: `collBtc × support × stopLtv − debt`. MAY BE NEGATIVE (over the ceiling).
 *  Non-finite inputs, or a non-positive support / stop → 0 (no room, and nothing to restore). */
export function ceilingHeadroomUsd(debt: number, collBtc: number, support: number, stopLtv: number): number {
  if (!(support > 0) || !(stopLtv > 0) || !allFinite(debt, collBtc, support, stopLtv)) return 0;
  return collBtc * support * stopLtv - debt;
}

/** Coinbase collateral the sweep must leave: `(cbDebt + bufferUsd) / (support × stopLtv)`. After the sweep the
 *  Coinbase ceiling therefore has exactly `bufferUsd` of room — the buffer is kept as COLLATERAL, never as
 *  unpaid debt. Junk → +Infinity (keep everything: a sweep must fail safe). */
export function sweepKeepBtc(cbDebt: number, bufferUsd: number, support: number, stopLtv: number): number {
  if (!(support > 0) || !(stopLtv > 0) || !allFinite(cbDebt, bufferUsd, support, stopLtv)) {
    return Number.POSITIVE_INFINITY;
  }
  const debt = cbDebt > 0 ? cbDebt : 0;
  const buffer = bufferUsd > 0 ? bufferUsd : 0;
  return (debt + buffer) / (support * stopLtv);
}

/** BTC to sell so that `(bal − sold·P) / ((coll − sold)·P) = target`, i.e. `(bal − target·coll·P) /
 *  ((1 − target)·P)` — sale proceeds retire the balance 1:1. Clamped to [0, coll]. When the clamp binds, the
 *  debt left is a deficiency (full recourse). Junk → 0 (sell nothing). */
export function collateralToSellForLtv(bal: number, coll: number, price: number, targetLtv: number): number {
  if (!(price > 0) || !(targetLtv > 0) || !(targetLtv < 1) || !allFinite(bal, coll, price, targetLtv)) return 0;
  const c = coll > 0 ? coll : 0;
  const sell = (bal - targetLtv * c * price) / ((1 - targetLtv) * price);
  return sell > 0 ? Math.min(sell, c) : 0;
}

export interface StrikeCallInput {
  strikeBalance: number; strikeCollateralBtc: number; price: number;
  callLtv: number; cureLtv: number; partialLiqLtv: number;
  cashUsd: number; coldBtc: number;
}
export interface StrikeCallResult {
  state: 'none' | 'cured' | 'sold' | 'soldImmediate';
  cureCashUsd: number; cureColdBtc: number; soldBtc: number;
  balanceAfter: number; collateralAfter: number;
}

/**
 * Strike's margin call, as its terms state it: at or over `callLtv` (70%) the owner has 72 hours to bring the
 * LTV back to `cureLtv` (65%), else collateral is sold down to 65%; at or over `partialLiqLtv` (85%) the sale
 * is immediate. 0% liquidation fee, so a sold coin retires its full value of debt.
 *
 * A monthly engine cannot see the 72 hours, so a call is treated as UNCURED at month-end and resolved here:
 *   1. LTV < callLtv → 'none', nothing changes.
 *   2. LTV ≥ partialLiqLtv → 'soldImmediate': sold down to cureLtv; there is no cure window, so cash and cold
 *      are NOT touched.
 *   3. otherwise: CASH first (repay up to `bal − cureLtv·coll·P`), THEN COLD (move up to `bal/(cureLtv·P) −
 *      coll` into the Strike pool), THEN a sale of whatever is still above cureLtv ('sold'; else 'cured').
 *
 * ⚠ WHY A PARTIAL CURE IS STILL WORTH SPENDING. Each cold coin moved in saves `cureLtv / (1 − cureLtv)` =
 * 1.857 coins from the sale (at 65%), because a sold coin also retires debt while a moved coin only adds
 * collateral. So moving the cold that exists is strictly better than keeping it and letting more be sold.
 *
 * Cash or cold that is NaN / non-finite / negative reads as empty. Never NaN.
 */
export function resolveStrikeCall(input: StrikeCallInput): StrikeCallResult {
  const { strikeBalance: bal, strikeCollateralBtc: coll, price, callLtv, cureLtv, partialLiqLtv } = input;
  const cash = Number.isFinite(input.cashUsd) && input.cashUsd > 0 ? input.cashUsd : 0;
  const cold = Number.isFinite(input.coldBtc) && input.coldBtc > 0 ? input.coldBtc : 0;
  const none: StrikeCallResult = {
    state: 'none', cureCashUsd: 0, cureColdBtc: 0, soldBtc: 0, balanceAfter: bal, collateralAfter: coll,
  };
  if (!(price > 0) || !(callLtv > 0) || !(cureLtv > 0) || !(cureLtv < 1)
    || !allFinite(bal, coll, price, callLtv, cureLtv, partialLiqLtv)) return none;

  const ltv = ltvOf(bal, coll, price);
  if (!(ltv >= callLtv)) return none;

  if (ltv >= partialLiqLtv) {
    const sold = collateralToSellForLtv(bal, coll, price, cureLtv);
    return {
      state: 'soldImmediate', cureCashUsd: 0, cureColdBtc: 0, soldBtc: sold,
      balanceAfter: bal - sold * price, collateralAfter: coll - sold,
    };
  }

  // Uncured at month-end: cash, then cold, then a sale. `stillAbove` carries a relative float tolerance so a
  // position cured EXACTLY onto the line never produces a dust cold move or a dust sale.
  const stillAbove = (b: number, c: number): boolean => ltvOf(b, c, price) > cureLtv * (1 + 1e-12);
  let b = bal;
  let c = coll;
  const cureCashUsd = Math.min(cash, Math.max(0, b - cureLtv * (c > 0 ? c : 0) * price));
  b -= cureCashUsd;
  let cureColdBtc = 0;
  if (stillAbove(b, c)) {
    const need = b / (cureLtv * price) - (c > 0 ? c : 0);
    cureColdBtc = need > DUST_BTC ? Math.min(cold, need) : 0;
    c += cureColdBtc;
  }
  let soldBtc = 0;
  if (stillAbove(b, c)) {
    const s = collateralToSellForLtv(b, c, price, cureLtv);
    soldBtc = s > DUST_BTC ? s : 0;
  }
  b -= soldBtc * price;
  c -= soldBtc;
  return { state: soldBtc > 0 ? 'sold' : 'cured', cureCashUsd, cureColdBtc, soldBtc, balanceAfter: b, collateralAfter: c };
}

export interface BreakerState { monthsBelow: number; broken: boolean; brokenMonth: number | null; }
export const BREAKER_START: BreakerState = Object.freeze({ monthsBelow: 0, broken: false, brokenMonth: null });

/**
 * Latches: once broken, it stays broken — the simulation cannot re-decide for the owner. `monthsBelow` counts
 * CONSECUTIVE month-ends below `(1 − HARD_BREAKER_DEPTH) × support`, with the same float guard as 'paused'
 * (a price computed onto 0.9 × support is not below it). Junk (non-finite price, bad support) carries the
 * previous state unchanged — no information, and never NaN.
 */
export function nextBreakerState(prev: BreakerState, price: number, support: number, month: number): BreakerState {
  if (prev.broken) return prev;
  if (!(support > 0) || !allFinite(price, support)) return prev;
  const below = price / support < 1 - HARD_BREAKER_DEPTH - SUPPORT_EPS;
  const monthsBelow = below ? prev.monthsBelow + 1 : 0;
  if (monthsBelow >= HARD_BREAKER_MONTHS) return { monthsBelow, broken: true, brokenMonth: month };
  return { monthsBelow, broken: false, brokenMonth: null };
}

/** Surplus → Strike first (13%), then Coinbase. Returns the amounts; the engine applies them together with the
 *  existing 0.005 residual sweep (the clearStrike/clearBoth precedent — never "correct" it to 1e-9). Junk and
 *  negatives → 0. */
export function allocatePayDown(surplusUsd: number, strikeBal: number, cbDebt: number):
  { toStrikeUsd: number; toCbUsd: number; leftUsd: number } {
  const s = Number.isFinite(surplusUsd) && surplusUsd > 0 ? surplusUsd : 0;
  const sk = Number.isFinite(strikeBal) && strikeBal > 0 ? strikeBal : 0;
  const cb = Number.isFinite(cbDebt) && cbDebt > 0 ? cbDebt : 0;
  const toStrikeUsd = Math.min(s, sk);
  const toCbUsd = Math.min(s - toStrikeUsd, cb);
  return { toStrikeUsd, toCbUsd, leftUsd: s - toStrikeUsd - toCbUsd };
}
