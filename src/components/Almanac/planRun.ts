import {
  runCyclingSim, validOpeningBreaker, type CyclingInputs, type CyclingResult, type CyclingRow, type SupportPolicyInputs,
} from '../../simulation/cyclingSim';
import { DUST_USD } from '../../utils/format';
import { placementPlan, type PlacementInput, type PlacementPlan } from '../../simulation/placement';
import { STRIKE_MAX_DRAW_LTV } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import type { RearmableBreakerState } from '../../simulation/supportPolicy';
import { PLAN_CB_LTV_CAP_PCT, PLAN_STRIKE_CAP_PCT, PLAN_CLAMP } from './planClamp';
import {
  DEFAULT_SUPPORT_POLICY_SETTINGS, effectivePolicySettings, type EffectivePolicySettings, type SupportPolicySettings,
} from './supportPolicyView';
import { buildSupportPath, supportPolicyFor, holdMonthsFrom, type BreakerSeed } from './supportPolicyInputs';
import { seedsFromMove } from './decisionView';
import type { PlanPolicySettings } from '../../lib/planPolicy';
import { deriveCbCollateral } from '../../simulation/logUtils';
import type { DayEvent } from '../../simulation/types';

/**
 * The plan of record's ONE input builder (spec pbloc-spec-plan-of-record-v1, Run 2 — §4.3, invariant 2).
 *
 * THE MOVE and the engine's inputs are built HERE, by the same two functions, for every screen that shows the plan:
 * the Decision face (with its what-ifs) and THIS MONTH / Daily's plan card (with none). So the box and the card can
 * never disagree about the move — not by a test that compares two copies, but because there is one copy.
 *
 * 🔴 PURE. No store, no React, no clock: `todayISO`, the price and the policy's memory (the hold and the breaker)
 * arrive as values. The §2 crossing stays in `supportPolicyInputs` (the support path); the flat path is a plain fill.
 */

/** The five engine constants the run and its policy check share — ONE object, spread by `engineInputsOf` and handed
 *  to `seedsFromMove`, so the seeding gate asks the run's own question with the run's own inputs. (Was the Decision
 *  face's module constant.) */
export const PLAN_ENGINE_CONTEXT = {
  mode: 'cycle' as const, cbLtvCapPct: PLAN_CB_LTV_CAP_PCT, strikeLtvCapPct: PLAN_STRIKE_CAP_PCT,
  strikeMarginLtv: STRIKE_MARGIN_CALL_LTV, strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
} as const;
/** Used only if the policy is off — the plan has no off switch, so on a main screen never. */
export const PLAN_COLD_BUFFER_PCT = 30;
export const PLAN_CYCLE_MONTHS = 1;
/** D4 — this month and the year are one flat run at today's price, months 0..12. */
export const PLAN_RUN_MONTHS = 12;

// ── the position, as every plan screen reads it ─────────────────────────────────────────────────────────────────

/** D-R2-4 — Coinbase's collateral as every plan screen reads it (the four faces, THIS MONTH, Daily): the owner's only
 *  when the loan is switched on. Off, the plan starts with none — never the store's figures, which on a fresh install
 *  are the seed's $60,000 on 1.48 ₿ with the loan switched off. */
export function planCbCollateralOf(st: { hasCbLoan: boolean; dayLog: DayEvent[]; cbCollateralBtc: number }): number {
  return st.hasCbLoan ? deriveCbCollateral(st.dayLog, st.cbCollateralBtc) : 0;
}
/** D-R2-4 — Coinbase's balance (before accrual), the same way: 0 with the loan switched off. */
export function planCbLoanBalanceOf(st: { hasCbLoan: boolean; cbLoanBalance: number }): number {
  return st.hasCbLoan ? st.cbLoanBalance : 0;
}

// ── the two builders (the Decision face's memo bodies, verbatim) ─────────────────────────────────────────────────

export interface PlacementFacts {
  runLine: number;
  strikeBalance: number;
  strikeCollateralBtc: number;
  cbDebt: number;
  cbCollateralBtc: number;
  coldBtc: number;
  price: number;
  /** S₀ — `supportPath[0]`. */
  support: number;
  policySettings: EffectivePolicySettings;
  expenses: number;
  inHold: boolean;
  broken: boolean;
  /** BL32 — the owner's goal in net coins (already through `planGoalOf`), or null. REQUIRED, like `EngineFacts`' — THE MOVE
   *  stands down on it (at the goal with both loans repaid), so every plan reader passes the same goal to both builders. */
  goalNetBtc: number | null;
}

export function placementInputOf(f: PlacementFacts): PlacementInput {
  return {
    creditLine: f.runLine,
    strikeBalance: f.strikeBalance,
    strikeCollateralBtc: f.strikeCollateralBtc,
    cbDebt: f.cbDebt,
    cbCollateralBtc: f.cbCollateralBtc,
    coldBtc: f.coldBtc,
    price: f.price,
    support: f.support,
    skStop: f.policySettings.skStopEffPct / 100,
    cbStop: f.policySettings.cbStopEffPct / 100,
    cbDefenseLtv: PLAN_CB_LTV_CAP_PCT / 100,
    bufferUsd: f.policySettings.bearBufferMonths * f.expenses,
    accumulateBelow: f.policySettings.accumulateBelow,
    payDownAbove: f.policySettings.payDownAbove,
    inHold: f.inHold,
    broken: f.broken,
    goalNetBtc: f.goalNetBtc,
  };
}

export interface EngineFacts {
  startDate: Date;
  seedFromMove: boolean;
  placement: PlacementPlan;
  strikeCollateralBtc: number;
  strikeBalance: number;
  runLine: number;
  cbCollateralBtc: number;
  cbDebt: number;
  coldBtc: number;
  income: number;
  expenses: number;
  blocApr: number;
  cbAprPct: number;
  supportPolicy: SupportPolicyInputs | undefined;
  openingBreaker: RearmableBreakerState | undefined;
  holdMonths: number;
  /** D-R2-7 — the owner pays Strike's minimum from income (`blocMinPaymentSource === 'income'`). */
  strikeMinFromIncome: boolean;
  /** BL14 — the owner's goal in net coins (already through `planGoalOf`), or null. REQUIRED, so every plan reader —
   *  THIS MONTH, Daily and the Decision face — passes the saved goal and the two can't drift. */
  goalNetBtc: number | null;
}

/** The engine's inputs, minus the price path — every caller supplies its own (the face's chosen path; THIS MONTH's
 *  flat one). `defendCbLtv` is automatic. The run starts from the move only when it is MADE (D10). */
export function engineInputsOf(f: EngineFacts): Omit<CyclingInputs, 'pricePath'> {
  return {
    ...PLAN_ENGINE_CONTEXT,
    startYear: f.startDate.getUTCFullYear(),
    strikeCollateralBtc: f.seedFromMove ? f.placement.opening.strikeCollateralBtc : f.strikeCollateralBtc,
    strikeBalance: f.strikeBalance,
    strikeCreditLine: f.runLine,
    cbCollateralBtc: f.seedFromMove ? f.placement.opening.cbCollateralBtc : f.cbCollateralBtc,
    cbDebt: f.cbDebt,
    openingColdBtc: f.seedFromMove ? f.placement.opening.coldBtc : f.coldBtc,
    income: f.income,
    expenses: f.expenses,
    strikeAprPct: f.blocApr,
    cbAprPct: f.cbAprPct,
    cycleMonths: PLAN_CYCLE_MONTHS,
    coldStoreBufferPct: PLAN_COLD_BUFFER_PCT,
    defendCbLtv: true,
    supportPolicy: f.supportPolicy,
    openingBreaker: f.openingBreaker,
    openingStrikeHoldMonths: f.holdMonths,
    strikeMinFromIncome: f.strikeMinFromIncome,
    goalNetBtc: f.goalNetBtc,
  };
}

// ── the plan of record's month (THIS MONTH, Daily's plan card) ──────────────────────────────────────────────────

/** Everything the plan's run reads, as plain values — the hook gathers them from the store. */
export interface PlanMonthFacts {
  /** The LOCAL day, `yyyy-mm-dd` (the repo's date-only convention). */
  todayISO: string;
  /** Today's price — what the owner will actually trade at (D4). */
  price: number;
  /** The owner's saved plan (the six, already through the read clamp). */
  plan: PlanPolicySettings;
  income: number;
  expenses: number;
  blocApr: number;
  cbAprPct: number;
  creditLine: number;
  strikeBalance: number;
  strikeCollateralBtc: number;
  cbCollateralBtc: number;
  coldBtc: number;
  /** ACCRUED — the caller crosses the accrual boundary. */
  cbDebt: number;
  strikeLiquidationLtvPct: number;
  /** Strike's 60-day hold, from logged deposits (or the trusted snapshot's pre-derived copy). */
  hold: { inHold: boolean; throughISO: string | null };
  /** The breaker, folded from month-end prices — or the device's cache of it; `null` when neither exists. */
  breakerSeed: BreakerSeed | null;
  /** D-R2-7 — the owner pays Strike's minimum from income. */
  strikeMinFromIncome: boolean;
  /** BL14 — the owner's goal in net coins (already through `planGoalOf`), or null for none. */
  goalNetBtc: number | null;
}

export interface PlanMonthRun {
  startDate: Date;
  policySettings: EffectivePolicySettings;
  supportPath: number[];
  supportPolicy: SupportPolicyInputs | undefined;
  placementInput: PlacementInput;
  placement: PlacementPlan;
  seedFromMove: boolean;
  holdMonths: number;
  engineInputs: Omit<CyclingInputs, 'pricePath'>;
  pricePath: number[];
  sim: CyclingResult;
}

/** The saved plan as every plan reader runs it: C1 under it, range-clamped, its stops held to the plan's defense lines
 *  (`PLAN_CLAMP`). ONE rule — the run below and the Advisor tab's sidebar (Run 4) read it; Safety's limit at support,
 *  `planCbLimitOf` (lib/planPolicy — the store can't import a component), is pinned equal to it. */
export function planPolicySettingsOf(plan: PlanPolicySettings): EffectivePolicySettings {
  const raw: SupportPolicySettings = { ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...plan };
  return effectivePolicySettings(raw, PLAN_CLAMP);
}

/** The plan of record, run: THE MOVE at today's price and support, then months 0..12 on a flat path at today's price
 *  (D4), from the saved plan — no what-if. The Decision face builds the same objects through the same two builders. */
export function planMonthRun(f: PlanMonthFacts): PlanMonthRun {
  const startDate = new Date(f.todayISO);
  const policySettings = planPolicySettingsOf(f.plan);
  const supportPath = buildSupportPath(startDate, PLAN_RUN_MONTHS);
  const supportPolicy = supportPolicyFor(policySettings, supportPath, f.expenses, f.strikeLiquidationLtvPct, 'cycle');
  const holdMonths = holdMonthsFrom(f.hold.throughISO, startDate);
  const placementInput = placementInputOf({
    runLine: f.creditLine,
    strikeBalance: f.strikeBalance,
    strikeCollateralBtc: f.strikeCollateralBtc,
    cbDebt: f.cbDebt,
    cbCollateralBtc: f.cbCollateralBtc,
    coldBtc: f.coldBtc,
    price: f.price,
    support: supportPath[0],
    policySettings,
    expenses: f.expenses,
    inHold: f.hold.inHold,
    broken: f.breakerSeed?.state.broken ?? false,
    goalNetBtc: f.goalNetBtc,
  });
  const placement = placementPlan(placementInput);
  const pricePath = Array.from({ length: PLAN_RUN_MONTHS + 1 }, () => f.price);
  const seedFromMove = seedsFromMove(placement.seeded, {
    ...PLAN_ENGINE_CONTEXT, supportPolicy, pricePath, expenses: f.expenses,
  });
  const engineInputs = engineInputsOf({
    startDate, seedFromMove, placement,
    strikeCollateralBtc: f.strikeCollateralBtc,
    strikeBalance: f.strikeBalance,
    runLine: f.creditLine,
    cbCollateralBtc: f.cbCollateralBtc,
    cbDebt: f.cbDebt,
    coldBtc: f.coldBtc,
    income: f.income,
    expenses: f.expenses,
    blocApr: f.blocApr,
    cbAprPct: f.cbAprPct,
    supportPolicy,
    openingBreaker: f.breakerSeed?.state,
    holdMonths,
    strikeMinFromIncome: f.strikeMinFromIncome,
    goalNetBtc: f.goalNetBtc,
  });
  const sim = runCyclingSim({ ...engineInputs, pricePath });
  return {
    startDate, policySettings, supportPath, supportPolicy, placementInput, placement, seedFromMove, holdMonths,
    engineInputs, pricePath, sim,
  };
}

/** D-R2-6 — this device's breaker cache, as every reader takes it: the stored object ITSELF (never a copy, so a store
 *  selector stays stable under `useShallow`) when its state passes the engine's own rule (`validOpeningBreaker`) and it
 *  is dated `yyyy-mm-dd`; else null. A damaged or out-of-shape cache reads as none, and the next fresh fold rewrites it. */
export function planBreakerCacheOf(raw: unknown): BreakerSeed | null {
  if (raw === null || typeof raw !== 'object') return null;
  const c = raw as { state?: unknown; lastMonthEndISO?: unknown };
  if (typeof c.lastMonthEndISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.lastMonthEndISO)) return null;
  return validOpeningBreaker(c.state as RearmableBreakerState | undefined) !== null ? (raw as BreakerSeed) : null;
}

/** THE one rule for "over Coinbase's limit at month-end": the engine's own headroom at that month's support, past the
 *  dust floor (a restore lands exactly on the limit; a capped refinance can leave ~1e-10 over it). The switch month,
 *  the status of every month after this one, the track and the after-box read it. This month's status reads TODAY's
 *  fact instead (THE MOVE's `cbOverCeilingUsd` at S₀), so month 1's status and its band can differ — the band is the
 *  run's month-end. */
export function cbOverLimitAtMonthEnd(r: Pick<CyclingRow, 'cbCeilingHeadroomUsd'>): boolean {
  return r.cbCeilingHeadroomUsd !== null && r.cbCeilingHeadroomUsd <= -DUST_USD;
}

/** §4.5 — the switch month's time: the first month whose Coinbase leg is back within its limit at support on the
 *  plan's own run; `null` when it never is within the run (or there is no row to read). */
export function firstMonthUnderLimit(sim: CyclingResult): number | null {
  for (const r of sim.rows) {
    if (r.m === 0) continue;
    if (r.cbCeilingHeadroomUsd !== null && !cbOverLimitAtMonthEnd(r)) return r.m;
  }
  return null;
}
