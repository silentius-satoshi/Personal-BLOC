import { cbMetrics, accruedCbBalance, barLevel, cbBarLevel, worseLevel, type SafetyLevel } from './cbMetrics';
import { computeStrikeLtv, strikeAvailableCredit } from './strikeCredit';
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

/** The single SafetyLevel → CSS-var color map. Lifted here (was module-private in SafetyDashboard) so
 *  every level-colored surface — the owner SafetyDashboard bars AND the Almanac Ledger CB LTV cells —
 *  reads one map and can never drift. */
export const LEVEL_COLOR: Record<SafetyLevel, string> = {
  safe:  'var(--green)',
  watch: 'var(--amber)',
  act:   'var(--red)',
};

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
    cbLevel = cbBarLevel(cbLtv, cbLtvTriggerPct, cbLiqFrac);
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

// ── Viewer V2 — C-safe privacy: ratio/level-only projection + live price-scaler ──────────────────
/**
 * The ratio/level-only projection of SafetyView that the owner seals into a C-SAFE viewer snapshot.
 * ⚠ Privacy-load-bearing: it deliberately DROPS SafetyView's two $ absolutes (accruedBalance = CB debt,
 * cbLiqPrice = CB liq price). Every field here is a ratio (0..1+) or a level string from which NO
 * absolute is recoverable (2 unknowns, 1 equation) — so "no absolute exists by construction".
 */
export interface ViewerSafeSafety {
  capacityUsed: number;
  creditLevel: SafetyLevel;
  strikeLtv: number;
  strikeLevel: SafetyLevel;
  crashLtv: number;
  cbLtv: number;
  cbLevel: SafetyLevel;
  cbLiqFrac: number; // ratio (effective liquidation LTV) — safe to share
  overall: SafetyLevel;
}

/** Owner-side: reduce the full SafetyView to the safe ratio/level block (drops accruedBalance + cbLiqPrice). */
export function buildSafeSafety(view: SafetyView, hasCbLoan: boolean): ViewerSafeSafety {
  const { capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel, cbLiqFrac } = view;
  return {
    capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel, cbLiqFrac,
    overall: deriveViewerOverall(view, hasCbLoan),
  };
}

/** What the viewer stores from a C-safe snapshot (mirrors the payload's safe branch). */
export interface SafeSnapshot {
  safety: ViewerSafeSafety;
  thresholds: { strikeLiqLtv: number; cbLtvTriggerPct: number; cbLiqFrac: number };
  btcPriceAtSnapshot: number;
  hasCbLoan: boolean;
}

/**
 * Viewer-side: scale the at-snapshot safe block to the LIVE price so C-safe gauges track the market
 * without ever receiving an absolute. Exact between owner publishes — balance/holdings are constant
 * (owner actions republish), so the only drift is price, and LTV ∝ 1/price. (CB interest accrual over
 * days nudges the true CB LTV up slightly between publishes; negligible for a safety gauge.)
 * livePrice unavailable (offline / feed down) → factor 1 → returns the at-snapshot levels (fallback).
 */
export function scaleSafetyView(snap: SafeSnapshot, livePrice: number): ViewerSafeSafety & { strikeDropPct: number } {
  const f = livePrice > 0 && snap.btcPriceAtSnapshot > 0 ? snap.btcPriceAtSnapshot / livePrice : 1;
  const { strikeLiqLtv, cbLtvTriggerPct, cbLiqFrac } = snap.thresholds;
  const capacityUsed = snap.safety.capacityUsed; // price-free
  const strikeLtv = snap.safety.strikeLtv * f;
  const cbLtv = snap.safety.cbLtv * f;
  const crashLtv = strikeLtv * 5; // Strike LTV at price × 0.2 (an 80% crash) — 1/0.2 = 5
  const creditLevel = barLevel(capacityUsed, CREDIT_WARN_USED, CREDIT_ACT_USED);
  const strikeLevel = barLevel(strikeLtv, strikeLiqLtv * 0.76, strikeLiqLtv * 0.82);
  const cbLevel: SafetyLevel = snap.hasCbLoan ? cbBarLevel(cbLtv, cbLtvTriggerPct, cbLiqFrac) : 'safe';
  const base = worseLevel(creditLevel, strikeLevel);
  const overall = snap.hasCbLoan ? worseLevel(base, cbLevel) : base;
  const strikeDropPct = strikeLiqLtv > 0 ? Math.max(0, 1 - strikeLtv / strikeLiqLtv) : 0;
  return { capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel, cbLiqFrac, overall, strikeDropPct };
}

// ── The render-ready viewer-safety shape + the one seam that unifies C-safe vs C-trusted ──────────
/** Render shape consumed by ViewerHomeView — C-safe (scaled from a snapshot) OR C-trusted (live-derived). */
export interface ViewerSafetyResult {
  mode: 'safe' | 'trusted';
  capacityUsed: number; creditLevel: SafetyLevel;
  strikeLtv: number;    strikeLevel: SafetyLevel;
  cbLtv: number;        cbLevel: SafetyLevel;
  hasCbLoan: boolean;   overall: SafetyLevel;
  strikeDropPct: number;
  figures: null | {
    credit: { used: number; total: number; avail: number };
    strike: { liqPrice: number; balance: number };
    cb:     { liqPrice: number; balance: number };
  };
}

/**
 * PURE core of ViewerHomeView's useViewerSafety (extracted for node-testability — the hook is just the store
 * reads + this). `safeSnap` present → C-safe path (scaleSafetyView, figures:null — no absolutes exist);
 * null → C-trusted live-derive from `inputs` (deriveSafetyView + real $ figures).
 */
export function computeViewerSafety(
  safeSnap: SafeSnapshot | null,
  livePrice: number,
  inputs: SafetyViewInputs,
): ViewerSafetyResult {
  if (safeSnap) {
    const v = scaleSafetyView(safeSnap, livePrice);
    return {
      mode: 'safe',
      capacityUsed: v.capacityUsed, creditLevel: v.creditLevel,
      strikeLtv: v.strikeLtv, strikeLevel: v.strikeLevel,
      cbLtv: v.cbLtv, cbLevel: v.cbLevel,
      hasCbLoan: safeSnap.hasCbLoan, overall: v.overall,
      strikeDropPct: v.strikeDropPct, figures: null,
    };
  }
  const view = deriveSafetyView(inputs);
  const overall = deriveViewerOverall(view, inputs.hasCbLoan);
  const strikeLiqLtv = inputs.strikeLiquidationLtvPct / 100;
  const strikeDropPct = strikeLiqLtv > 0 ? Math.max(0, 1 - view.strikeLtv / strikeLiqLtv) : 0;
  // Strike available credit — the LTV-capped truth (min(creditLine, collateral·price·50%) − drawn),
  // NOT the naive creditLine − drawn (which overstated drawable credit by the LTV gap). total = binding limit.
  const cap = strikeAvailableCredit(inputs.creditLine, inputs.currentBtcHeld, inputs.btcPrice, inputs.advisorActualBlocBalance);
  const strikeLiqPrice = inputs.currentBtcHeld > 0
    ? inputs.advisorActualBlocBalance / (inputs.currentBtcHeld * strikeLiqLtv)   // bloc / (btcHeld × liqLtv)
    : 0;
  return {
    mode: 'trusted',
    capacityUsed: view.capacityUsed, creditLevel: view.creditLevel,
    strikeLtv: view.strikeLtv, strikeLevel: view.strikeLevel,
    cbLtv: view.cbLtv, cbLevel: view.cbLevel,
    hasCbLoan: inputs.hasCbLoan, overall, strikeDropPct,
    figures: {
      credit: { used: inputs.advisorActualBlocBalance, total: cap.limit, avail: cap.available },
      strike: { liqPrice: strikeLiqPrice, balance: inputs.advisorActualBlocBalance },
      cb:     { liqPrice: view.cbLiqPrice, balance: view.accruedBalance },
    },
  };
}

/**
 * Owner-side "Preview as viewer": turn a real buildViewerSnapshotPayload into the SafeSnapshot the safe path
 * renders (mirrors viewerSync.ts's construction exactly, incl. hasCbLoan ?? false). Non-safe payload → null
 * (the trusted preview uses the live-derive path instead). Structural param type → no ViewerSnapshot import.
 */
export function previewSafeSnapFromPayload(payload: {
  privacyMode?: string;
  safety?: ViewerSafeSafety;
  thresholds?: SafeSnapshot['thresholds'];
  btcPriceAtSnapshot?: number;
  hasCbLoan?: boolean;
}): SafeSnapshot | null {
  if (payload.privacyMode !== 'safe') return null;
  return {
    safety:             payload.safety!,
    thresholds:         payload.thresholds!,
    btcPriceAtSnapshot: payload.btcPriceAtSnapshot!,
    hasCbLoan:          payload.hasCbLoan ?? false,
  };
}
