import { cbMetrics, accruedCbBalance, barLevel, worseLevel, type SafetyLevel } from './cbMetrics';
import { computeStrikeLtv } from './strikeCredit';
import { CB_LLTV } from './runCoinbaseLoan';
import type { StoreState } from '../store/useStore'; // TYPE-only → erased at compile → no runtime cycle

/**
 * Viewer Experience Revamp — V1.
 *
 * PURE single source of truth for the three safety dimensions BOTH the viewer home AND the owner's
 * SafetyDashboard render: Strike BLOC credit (capacity utilization), Strike BLOC LTV, and Coinbase LTV.
 * The owner-side dedup is DONE — SafetyDashboard.tsx now consumes deriveSafetyView (its inline copy is
 * gone), so the two surfaces cannot drift. `selectSafetyViewInputs` (below) is the single store→inputs
 * mapping shared by both call sites (and Viewer V2's safe-snapshot builder next).
 *
 * Reuses the already-shared primitives: cbMetrics/accruedCbBalance/barLevel/worseLevel (cbMetrics.ts),
 * computeStrikeLtv (strikeCredit.ts), CB_LLTV (runCoinbaseLoan.ts). No store/UI/price VALUE imports
 * (the StoreState import is type-only — the selector takes state as an argument, keeping this pure).
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
  // CB display intermediates — additive for the owner dashboard (the viewer ignores them).
  accruedBalance: number; // accrued CB debt (0 when !hasCbLoan)
  cbLiqPrice: number; // effective liquidation price: entered cbLiquidationPrice, else computed m.liqPrice (0 when !hasCbLoan)
  cbLiqFrac: number; // effective liquidation LTV fraction (CB_LLTV when !hasCbLoan)
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
  // Intermediates hoisted with no-CB defaults so the return always carries them; when !hasCbLoan the
  // dashboard shows the CB setup card (never these values), so the defaults are value-inert.
  let cbLtv = 0;
  let cbLevel: SafetyLevel = 'safe';
  let accruedBalance = 0;
  let cbLiqPrice = 0;
  let cbLiqFrac = CB_LLTV;
  if (hasCbLoan) {
    accruedBalance = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
    const m = cbMetrics(accruedBalance, cbCollateralBtc, btcPrice, cbLtvTriggerPct);
    cbLiqPrice = cbLiquidationPrice > 0 ? cbLiquidationPrice : m.liqPrice;
    cbLtv = m.ltv;
    cbLiqFrac =
      cbLiqPrice > 0 && cbCollateralBtc > 0
        ? accruedBalance / (cbCollateralBtc * cbLiqPrice)
        : CB_LLTV;
    cbLevel = barLevel(cbLtv, cbLtvTriggerPct / 100, cbLiqFrac * 0.93);
  }

  return {
    capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel,
    accruedBalance, cbLiqPrice, cbLiqFrac,
  };
}

/**
 * The SINGLE store→inputs mapping. Pure: takes StoreState as an argument (type-only import, no cycle)
 * so every consumer feeds deriveSafetyView the same numbers. Consumers: SafetyDashboard (owner),
 * ViewerHomeView (viewer home), and Viewer V2's safe-snapshot builder (next).
 */
export function selectSafetyViewInputs(s: StoreState): SafetyViewInputs {
  return {
    advisorActualBlocBalance: s.advisorActualBlocBalance,
    creditLine: s.creditLine,
    currentBtcHeld: s.getCurrentBtcHeld(),
    btcPrice: s.btcPrice,
    strikeLiquidationLtvPct: s.strikeLiquidationLtvPct,
    hasCbLoan: s.hasCbLoan,
    cbLoanBalance: s.cbLoanBalance,
    cbAprPct: s.cbAprPct,
    cbLoanBalanceAsOf: s.cbLoanBalanceAsOf,
    cbCollateralBtc: s.cbCollateralBtc,
    cbLtvTriggerPct: s.cbLtvTriggerPct,
    cbLiquidationPrice: s.cbLiquidationPrice,
  };
}

/** Viewer overall pill = worst of the gauges SHOWN (credit + strike, + cb when hasCbLoan).
 *  Intentionally INCLUDES credit (so no red card sits under a green overall) — differs from the
 *  owner's SafetyDashboard `state`, which excludes the always-green capacity. */
export function deriveViewerOverall(view: SafetyView, hasCbLoan: boolean): SafetyLevel {
  const base = worseLevel(view.creditLevel, view.strikeLevel);
  return hasCbLoan ? worseLevel(base, view.cbLevel) : base;
}
