import {
  defendCbLtv, topUpToCbLtv, cbDoomedThisMonth, strikeReleasableBtc, ceilingLiquidationMultiple, SHIFT_DUST_USD,
  type CbTopUpResult,
} from './cbDefense';
import { ltvOf } from './ltv';
import { SUPPORT_EPS } from './supportPolicy';

/**
 * THE CRASH PLAYBOOK — the ONE crash-day answer (spec: crash playbook v1). Coinbase is over its defense line; what
 * moves, in what order?
 *
 *   TOP UP FIRST  when the support multiple k = price ÷ support sits in [ceilingLiquidationMultiple, 1) and Coinbase is
 *                 not doomed: cold first, then the Strike collateral Strike will RELEASE now, then shift only what is
 *                 left. A top-up that restores the line in full ends the playbook.
 *   SHIFT FIRST   everywhere else — below the depth, at or above support, or doomed: the debt shift (a Strike draw that
 *                 pays Coinbase down), then the fallback top-up (cold, then releasable Strike collateral) for the
 *                 shift's shortfall — skipped when Coinbase is doomed after the shift.
 *
 * WHY top up first above the depth: each $d the shift moves onto Strike cuts the collateral Strike can release by
 * d / (0.5 · P) but Coinbase's need at its liquidation line by only d / (0.86 · P), and past 40% Strike releases nothing
 * at all — so shifting first spends rescue capacity faster than it buys safety, and parks the debt at 13%. WHY shift
 * first below the depth: there a Coinbase at its support ceiling is already past 86%, and spending every coin leaves
 * nothing for a second leg.
 *
 * STRIKE'S RELEASE RULES (`strikeReleasableBtc`): collateral leaves Strike only at or under 40% LTV, only down to under
 * 50% after, and never within 60 days of a deposit. Doomed = cold plus releasable Strike collateral cannot bring
 * Coinbase under 86% (`cbDoomedThisMonth` given the releasable figure).
 *
 * ⚠ THE ENGINE RUNS THE SAME SEQUENCE INLINE (`runCyclingSim` under the support policy), because it adds the Strike
 * cap's reserve and survival guard — which the live app has no setting for. A parity test pins engine ≡ crashPlaybook
 * with the Strike cap off. Every move here is booked with the engine's exact arithmetic (`cbColl += t.topUpBtc`,
 * `cbDebt -= drawUsd`, …) — change one side and the parity test fails. Never fork the playbook.
 *
 * ⚠ THE DUST DROP (owner decision, 2026-09-28 — see SHIFT_DUST_USD): after a top-up-first step, a shift under half a
 * cent is float dust, never a step; its need stays the shortfall, so the fallback still runs.
 *
 * 🔴 Pure leaf: imports only `./cbDefense`, `./ltv` and `SUPPORT_EPS` (`./supportPolicy`). Support arrives as a plain
 * number, so no belief crosses in (the §2 wall). Clock-free. Junk → `'none'`, the input echoed in `after`.
 */

export interface CrashPlaybookInput {
  price: number;
  /** support(t) at the same moment — a plain number. */
  support: number;
  cbDebt: number;
  cbCollateralBtc: number;
  strikeBalance: number;
  strikeCollateralBtc: number;
  strikeCreditLine: number;
  coldBtc: number;
  /** The Coinbase defense line to restore, as a percentage (the engine's `cbLtvCapPct`). */
  targetCbLtvPct: number;
  /** The Coinbase stop AT SUPPORT the run uses, as a fraction (`effectivePolicyStops().cbStop`) — sets the depth gate. */
  cbStopAtSupport: number;
  /** Morpho's liquidation LTV (CB_LLTV). */
  lltv: number;
  /** STRIKE_MAX_DRAW_LTV — the shift's capacity line, and the release rule's "under this after". */
  maxDrawLtv: number;
  /** STRIKE_MARGIN_CALL_LTV — the top-up's margin bound and the shift's reporting. */
  marginLtv: number;
  /** STRIKE_RETRIEVE_MAX_LTV — the release rule's "at or under this before". */
  retrieveMaxLtv: number;
  /** Collateral went into Strike within the last 60 days — nothing leaves it. */
  strikeInHold: boolean;
}

export type CrashPlaybookOrder = 'none' | 'topUpFirst' | 'shiftFirst';

/** In execution order. Zero-size steps are omitted. */
export type CrashPlaybookStep =
  | { kind: 'coldToCoinbase'; btc: number }
  | { kind: 'strikeToCoinbase'; btc: number }
  | { kind: 'shiftToStrike'; usd: number };

export interface CrashPlaybookState {
  cbDebt: number;
  cbCollateralBtc: number;
  strikeBalance: number;
  strikeCollateralBtc: number;
  coldBtc: number;
  /** Both via `ltvOf` — ∞ for debt with no collateral; render with `fmtLtvPct`. */
  cbLtv: number;
  strikeLtv: number;
}

export interface CrashPlaybookResult {
  order: CrashPlaybookOrder;
  steps: CrashPlaybookStep[];
  after: CrashPlaybookState;
  /** BTC still needed to bring Coinbase back to its line after every step — 0 when the line held. */
  shortfallBtc: number;
  /** Measured on the OPENING state, before any step. */
  doomed: boolean;
}

export function crashPlaybook(input: CrashPlaybookInput): CrashPlaybookResult {
  const {
    price, support, strikeCreditLine, targetCbLtvPct, cbStopAtSupport, lltv, maxDrawLtv, marginLtv, retrieveMaxLtv,
    strikeInHold,
  } = input;
  let cbDebt = input.cbDebt;
  let cbColl = input.cbCollateralBtc;
  let strikeBal = input.strikeBalance;
  let strikeColl = input.strikeCollateralBtc;
  let coldBtc = input.coldBtc;
  const state = (): CrashPlaybookState => ({
    cbDebt, cbCollateralBtc: cbColl, strikeBalance: strikeBal, strikeCollateralBtc: strikeColl, coldBtc,
    cbLtv: ltvOf(cbDebt, cbColl, price), strikeLtv: ltvOf(strikeBal, strikeColl, price),
  });
  const none = (): CrashPlaybookResult => ({ order: 'none', steps: [], after: state(), shortfallBtc: 0, doomed: false });

  const numbers = [
    price, support, cbDebt, cbColl, strikeBal, strikeColl, strikeCreditLine, coldBtc, targetCbLtvPct, cbStopAtSupport,
    lltv, maxDrawLtv, marginLtv, retrieveMaxLtv,
  ];
  if (!numbers.every((v) => Number.isFinite(v)) || !(price > 0) || !(support > 0) || !(targetCbLtvPct > 0)) return none();
  const target = targetCbLtvPct / 100;
  // 1 · at or under its line → nothing to do.
  if (!(ltvOf(cbDebt, cbColl, price) > target)) return none();

  // What Strike will release NOW, on the CURRENT state (re-measured after the shift for the fallback).
  const releasable = (): number => strikeReleasableBtc({
    strikeCollateralBtc: strikeColl, strikeBalance: strikeBal, price, retrieveMaxLtv, maxAfterLtv: maxDrawLtv,
    inHold: strikeInHold,
  });
  // The engine's `cbDoomedNow` under the release rules — the same inputs, the same order.
  const doomedNow = (): boolean => cbDoomedThisMonth({
    cbDebt, cbCollateralBtc: cbColl, price, lltv, coldBtc,
    strikeCollateralBtc: strikeColl, strikeBalance: strikeBal, marginLtv, strikeReleasableBtc: releasable(),
  });
  const steps: CrashPlaybookStep[] = [];
  // Booked EXACTLY as the engine books a top-up (both of its top-up sites).
  const applyTopUp = (t: CbTopUpResult): void => {
    if (t.topUpBtc > 0) {
      coldBtc -= t.fromColdBtc;
      strikeColl -= t.fromStrikeBtc;
      cbColl += t.topUpBtc;
    }
    if (t.fromColdBtc > 0) steps.push({ kind: 'coldToCoinbase', btc: t.fromColdBtc });
    if (t.fromStrikeBtc > 0) steps.push({ kind: 'strikeToCoinbase', btc: t.fromStrikeBtc });
  };
  const topUp = (): CbTopUpResult => topUpToCbLtv({
    cbDebt, cbCollateralBtc: cbColl, price, targetCbLtvPct, coldBtc,
    strikeCollateralBtc: strikeColl, strikeBalance: strikeBal, marginLtv, strikeReleaseCapBtc: releasable(),
  });
  const shortfall = (held: boolean): number =>
    held ? 0 : Math.max(0, cbDebt / (target * price) - cbColl);

  // 2 · doomed is asked of the opening state.
  const doomed = doomedNow();
  const k = price / support;
  const topUpFirst = !doomed && k >= ceilingLiquidationMultiple(cbStopAtSupport, lltv) && k < 1 - SUPPORT_EPS;
  const order: CrashPlaybookOrder = topUpFirst ? 'topUpFirst' : 'shiftFirst';

  // 3 · TOP UP FIRST — a full restore ends the playbook (the ulp lesson: never let the shift re-test the line).
  if (topUpFirst) {
    const t = topUp();
    applyTopUp(t);
    if (t.shortfallBtc <= 0) return { order, steps, after: state(), shortfallBtc: 0, doomed };
  }

  // 4 · THE SHIFT — within the Strike line's capacity. After a top-up-first step a sub-half-cent draw is dust (no step).
  let held = false;
  let shiftShortfallUsd = 0;
  if (ltvOf(cbDebt, cbColl, price) > target) {
    const d = defendCbLtv({
      cbDebt, cbCollateralBtc: cbColl, strikeCollateralBtc: strikeColl, strikeBalance: strikeBal, price,
      targetCbLtvPct, creditLine: strikeCreditLine, maxDrawLtv, marginLtv,
    });
    const dust = topUpFirst && d.drawUsd < SHIFT_DUST_USD;
    const drawUsd = dust ? 0 : d.drawUsd;
    shiftShortfallUsd = dust ? d.paydownNeededUsd : d.shortfallUsd;
    if (drawUsd > 0) {
      cbDebt -= drawUsd;
      strikeBal += drawUsd;
      steps.push({ kind: 'shiftToStrike', usd: drawUsd });
    }
    held = shiftShortfallUsd <= 0;
  } else {
    held = true;
  }

  // 5 · THE FALLBACK TOP-UP — only for the shift's shortfall, and never into a Coinbase doomed after the shift.
  if (shiftShortfallUsd > 0 && !doomedNow()) {
    const t = topUp();
    applyTopUp(t);
    held = t.shortfallBtc <= 0;
  }

  return { order, steps, after: state(), shortfallBtc: shortfall(held), doomed };
}
