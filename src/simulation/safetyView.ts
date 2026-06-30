import { cbMetrics, accruedCbBalance, barLevel, worseLevel, type SafetyLevel } from './cbMetrics';
import { computeStrikeLtv } from './strikeCredit';
import { CB_LLTV } from './runCoinbaseLoan';

/**
 * Viewer Experience Revamp — V1.
 *
 * PURE single source of truth for the three safety dimensions the viewer home renders:
 * Strike BLOC credit (capacity utilization), Strike BLOC LTV, and Coinbase LTV. The level/value
 * formulas here MIRROR SafetyDashboard.tsx VERBATIM (lines 73-104) so the two surfaces can't drift.
 *
 * NOTE (tracked follow-up): SafetyDashboard.tsx still carries its OWN inline copy of this math —
 * V1 deliberately did NOT refactor it. The owner-side refactor (point SafetyDashboard at this
 * module, remove its inline copy — the cbMetrics.ts dedup discipline) is a separate follow-up.
 *
 * Reuses the already-shared primitives: cbMetrics/accruedCbBalance/barLevel/worseLevel (cbMetrics.ts),
 * computeStrikeLtv (strikeCredit.ts), CB_LLTV (runCoinbaseLoan.ts). No store/UI/price imports.
 *
 * The overall pill composition is left to each CONSUMER (one line) so the owner's `state` can stay
 * credit-excluded while the viewer's includes credit — see deriveViewerOverall below.
 */

export type { SafetyLevel } from './cbMetrics';
export { worseLevel };

/** NEW for V1 — the credit gauge gets a risk band the owner UI lacks (capacity is "room", not risk
 *  in the owner view, so its bar is always green there). green < 75% used, amber 75-90%, red >= 90%. */
export const CREDIT_WARN_USED = 0.75;
export const CREDIT_ACT_USED = 0.90;

export interface SafetyViewInputs {
  advisorActualBlocBalance: number;
  creditLine: number;
  currentBtcHeld: number;
  btcPrice: number;
  strikeLiquidationLtvPct: number;
  hasCbLoan: boolean;
  cbLoanBalance: number;
  cbAprPct: number;
  cbLoanBalanceAsOf: string | null;
  cbCollateralBtc: number;
  cbLtvTriggerPct: number;
  cbLiquidationPrice: number;
}

export interface SafetyView {
  capacityUsed: number; // advisorActualBlocBalance / creditLine (0..1+)
  creditLevel: SafetyLevel;
  strikeLtv: number; // 0..1+
  strikeLevel: SafetyLevel;
  crashLtv: number; // Strike LTV if BTC fell 80% (read-only stress)
  cbLtv: number; // 0..1+ (0 when !hasCbLoan / no collateral)
  cbLevel: SafetyLevel; // 'safe' when !hasCbLoan
}

export function deriveSafetyView(inputs: SafetyViewInputs): SafetyView {
  const {
    advisorActualBlocBalance,
    creditLine,
    currentBtcHeld,
    btcPrice,
    strikeLiquidationLtvPct,
    hasCbLoan,
    cbLoanBalance,
    cbAprPct,
    cbLoanBalanceAsOf,
    cbCollateralBtc,
    cbLtvTriggerPct,
    cbLiquidationPrice,
  } = inputs;

  // ── Strike credit (capacity utilization) ──
  const capacityUsed = creditLine > 0 ? advisorActualBlocBalance / creditLine : 0;
  const creditLevel = barLevel(capacityUsed, CREDIT_WARN_USED, CREDIT_ACT_USED);

  // ── Strike LTV (mirrors SafetyDashboard) ──
  const strikeLiqLtv = strikeLiquidationLtvPct / 100;
  const strikeLtv = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice);
  const crashLtv = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice * 0.2);
  const strikeLevel = barLevel(strikeLtv, strikeLiqLtv * 0.76, strikeLiqLtv * 0.82);

  // ── Coinbase LTV (mirrors SafetyDashboard; 'safe'/0 when no CB loan) ──
  let cbLtv = 0;
  let cbLevel: SafetyLevel = 'safe';
  if (hasCbLoan) {
    const accruedBalance = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
    const m = cbMetrics(accruedBalance, cbCollateralBtc, btcPrice, cbLtvTriggerPct);
    const activeLiqPrice = cbLiquidationPrice > 0 ? cbLiquidationPrice : m.liqPrice;
    cbLtv = m.ltv;
    const cbLiqFrac =
      activeLiqPrice > 0 && cbCollateralBtc > 0
        ? accruedBalance / (cbCollateralBtc * activeLiqPrice)
        : CB_LLTV;
    cbLevel = barLevel(cbLtv, cbLtvTriggerPct / 100, cbLiqFrac * 0.93);
  }

  return { capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel };
}

/** Viewer overall pill = worst of the gauges SHOWN (credit + strike, + cb when hasCbLoan).
 *  Intentionally INCLUDES credit (so no red card sits under a green overall) — differs from the
 *  owner's SafetyDashboard `state`, which excludes the always-green capacity. */
export function deriveViewerOverall(view: SafetyView, hasCbLoan: boolean): SafetyLevel {
  const base = worseLevel(view.creditLevel, view.strikeLevel);
  return hasCbLoan ? worseLevel(base, view.cbLevel) : base;
}
