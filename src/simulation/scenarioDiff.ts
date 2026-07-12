import {
  deriveSafetyView,
  deriveViewerOverall,
  worseLevel,
  type SafetyViewInputs,
  type SafetyLevel,
} from './safetyView';

/**
 * Phase 3a — Scenario Diff/Pin (PURE model; UI is 3b).
 *
 * Pin the current plan's safety posture, overlay a hypothetical assumption set, and diff the three
 * safety dimensions (Strike credit / Strike LTV / Coinbase LTV). Every number flows through the app's
 * REAL risk math (deriveSafetyView / deriveViewerOverall from safetyView.ts) so a scenario preview can
 * never drift from what the owner's own SafetyDashboard shows. No band/threshold is reimplemented here.
 *
 * 🔴 §2/§7 isolation walls — imports NOTHING from the cycle / power-law / emergency risk models or the
 * store. safetyView types/fns only; SafetyViewInputs arrives as an argument (the caller does the
 * store→inputs mapping via selectSafetyViewInputs), keeping this a pure leaf.
 */

/** A snapshot of the pinned posture, plus a label + when it was pinned. */
export interface PinnedScenario {
  label: string;
  pinnedAt: number;
  btcPrice: number;          // BTC price at pin-time (display/reference)
  inputs: SafetyViewInputs;  // full snapshot of the pinned safety inputs
}

/**
 * Optional hypothetical levers. Each key maps 1:1 onto an EXISTING SafetyViewInputs member (same name)
 * — absent = keep the base value. Substitution ONLY: no unit conversion, no derived math here
 * (deriveSafetyView owns all math).
 */
export interface ScenarioOverlay {
  btcPrice?: number;                  // BTC price
  advisorActualBlocBalance?: number;  // Strike debt input
  currentBtcHeld?: number;            // Strike collateral input
  creditLine?: number;                // credit line
  cbLoanBalance?: number;             // CB balance input
  cbCollateralBtc?: number;           // CB collateral input
}

/** Pure spread-substitution → a new SafetyViewInputs. A present-but-undefined key must NOT clobber base. */
export function applyOverlay(base: SafetyViewInputs, o: ScenarioOverlay): SafetyViewInputs {
  const out = { ...base };
  (Object.keys(o) as (keyof ScenarioOverlay)[]).forEach((k) => {
    const v = o[k];
    if (v !== undefined) out[k] = v;
  });
  return out;
}

export interface DimensionDiff {
  from: number;
  to: number;
  delta: number;           // to − from
  fromLevel: SafetyLevel;
  toLevel: SafetyLevel;
  worsened: boolean;       // level got more severe from → to
}

export interface ScenarioDiff {
  capacityUsed: DimensionDiff;
  strikeLtv: DimensionDiff;
  cbLtv: DimensionDiff;
  crashLtv: { from: number; to: number };   // secondary — value the views already carry
  cbLiqFrac: { from: number; to: number };   // secondary
  overallFrom: SafetyLevel;
  overallTo: SafetyLevel;
  worsenedCount: 0 | 1 | 2 | 3;
}

/** A level "worsened" iff it changed AND the worse of the two is the new one (reuses worseLevel — no rank map). */
function isWorse(from: SafetyLevel, to: SafetyLevel): boolean {
  return from !== to && worseLevel(from, to) === to;
}

/**
 * Diff two safety-input sets by running BOTH through deriveSafetyView and comparing the three dimensions.
 * Levels come straight off the returned views — never re-derive a band/threshold. worsenedCount counts the
 * CB dimension only when the base says hasCbLoan (an overlay lever can't toggle hasCbLoan, so a.hasCbLoan ===
 * b.hasCbLoan in practice; guarding on the base keeps a no-CB plan from counting a spurious CB worsening).
 */
export function diffScenarios(a: SafetyViewInputs, b: SafetyViewInputs): ScenarioDiff {
  const va = deriveSafetyView(a);
  const vb = deriveSafetyView(b);

  const capacityUsed: DimensionDiff = {
    from: va.capacityUsed,
    to: vb.capacityUsed,
    delta: vb.capacityUsed - va.capacityUsed,
    fromLevel: va.creditLevel,
    toLevel: vb.creditLevel,
    worsened: isWorse(va.creditLevel, vb.creditLevel),
  };
  const strikeLtv: DimensionDiff = {
    from: va.strikeLtv,
    to: vb.strikeLtv,
    delta: vb.strikeLtv - va.strikeLtv,
    fromLevel: va.strikeLevel,
    toLevel: vb.strikeLevel,
    worsened: isWorse(va.strikeLevel, vb.strikeLevel),
  };
  const cbLtv: DimensionDiff = {
    from: va.cbLtv,
    to: vb.cbLtv,
    delta: vb.cbLtv - va.cbLtv,
    fromLevel: va.cbLevel,
    toLevel: vb.cbLevel,
    worsened: isWorse(va.cbLevel, vb.cbLevel),
  };

  const cbCounts = a.hasCbLoan;
  const worsenedCount = (Number(capacityUsed.worsened) +
    Number(strikeLtv.worsened) +
    Number(cbCounts && cbLtv.worsened)) as 0 | 1 | 2 | 3;

  return {
    capacityUsed,
    strikeLtv,
    cbLtv,
    crashLtv: { from: va.crashLtv, to: vb.crashLtv },
    cbLiqFrac: { from: va.cbLiqFrac, to: vb.cbLiqFrac },
    overallFrom: deriveViewerOverall(va, a.hasCbLoan),
    overallTo: deriveViewerOverall(vb, b.hasCbLoan),
    worsenedCount,
  };
}
