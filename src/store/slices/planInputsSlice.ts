// planInputsSlice (Phase 1c) — shared/Smart-BLOC/Living inputs + the Smart BLOC what-if sandbox collateral.
import type { StoreState, StoreSet, StoreGet } from '../types';
import type { PlanField } from '../settingsFields';
import { PLAN_POLICY_DEFAULTS, PLAN_POLICY_FIELD, PLAN_POLICY_KEYS, clampPlanPolicy } from '../../lib/planPolicy';

type PlanInputsSlice = Pick<StoreState,
  | 'income' | 'expenses' | 'btcPrice' | 'btcPriceMode' | 'btcPriceUpdatedAt' | 'blocApr' | 'activeTier' | 'scenario'
  | 'scrubMonth' | 'creditLine' | 'btcHoldings' | 'annualBtcGrowth' | 'bearMarket' | 'bearPeriodYears' | 'annualDecline'
  | 'inflationRate' | 'ltvType' | 'timeHorizonYears' | 'sandboxCollateralBtc' | 'setSandboxCollateralBtc'
  | 'pinnedScenario' | 'setPinnedScenario' | 'setIncome'
  | 'setExpenses' | 'setBtcPrice' | 'setBtcPriceMode' | 'setBlocApr' | 'setActiveTier' | 'setScenario' | 'setScrubMonth'
  | 'setCreditLine' | 'setBtcHoldings' | 'setAnnualBtcGrowth' | 'setBearMarket' | 'setBearPeriodYears'
  | 'setAnnualDecline' | 'setInflationRate' | 'setLtvType' | 'setTimeHorizonYears'
  | 'policyCbStopAtSupportPct' | 'policyStrikeStopAtSupportPct' | 'policyAccumulateBelow' | 'policyPayDownAbove'
  | 'policyBearBufferMonths' | 'policyCashReserveMonths' | 'setPlanPolicy' | 'resetPlanPolicy'
>;

export const createPlanInputsSlice = (set: StoreSet, get: StoreGet): PlanInputsSlice => ({
  income: 4000,
  expenses: 3500,
  btcPrice: 82000,
  btcPriceMode: 'live' as const,
  btcPriceUpdatedAt: null,
  blocApr: 13,

  activeTier: 'rec',
  scenario: 'moderate',
  scrubMonth: 30,
  creditLine: 10000,
  btcHoldings: 0.7,
  annualBtcGrowth: 50,
  bearMarket: false,
  bearPeriodYears: 2,
  annualDecline: -50,
  inflationRate: 2,
  ltvType: 'target',
  timeHorizonYears: 1,
  sandboxCollateralBtc:     null,
  setSandboxCollateralBtc:  (v) => set({ sandboxCollateralBtc: v }),
  pinnedScenario:           null,   // Phase 3a — device-local persisted pin; plain set, NO sync
  setPinnedScenario:        (v) => set({ pinnedScenario: v }),
  setIncome:   (v) => get().emitPlanSets([['income', v]]),                                                              // 4c: emit a plan event (was syncSettingsToNostr)
  setExpenses: (v) => { get().emitPlanSets([['expenses', v]]); set({ expenseReanchorDismissedAt: 0 }); },              // emit + keep the extra device-local clear in its own set — re-anchoring (or any edit) clears the dismissal so a future drift can nudge again
  setBtcPrice: (v) => set({ btcPrice: v, btcPriceUpdatedAt: Date.now() }),
  setBtcPriceMode: (v) => set({ btcPriceMode: v }),
  setBlocApr:  (v) => get().emitPlanSets([['blocApr', v]]),

  setActiveTier: (v) => set({ activeTier: v }),
  setScenario: (v) => set({ scenario: v }),
  setScrubMonth: (v) => set({ scrubMonth: v }),
  setCreditLine: (v) => get().emitPlanSets([['creditLine', v]]),
  setBtcHoldings: (v) => set({ btcHoldings: v }),
  setAnnualBtcGrowth: (v) => set({ annualBtcGrowth: v }),
  setBearMarket: (v) => set({ bearMarket: v }),
  setBearPeriodYears: (v) => set({ bearPeriodYears: v }),
  setAnnualDecline: (v) => set({ annualDecline: v }),
  setInflationRate: (v) => set({ inflationRate: v }),
  setLtvType: (v) => set({ ltvType: v }),
  setTimeHorizonYears: (v) => set({ timeHorizonYears: v }),

  // The plan of record (Run 1, D1) — the owner's saved support policy, C1 by default. Plan events like any plan field:
  // Settings' "Your plan" is the only editor (D2); a face's sliders are a what-if over it and never write here.
  policyCbStopAtSupportPct:     PLAN_POLICY_DEFAULTS.cbStopAtSupportPct,
  policyStrikeStopAtSupportPct: PLAN_POLICY_DEFAULTS.strikeStopAtSupportPct,
  policyAccumulateBelow:        PLAN_POLICY_DEFAULTS.accumulateBelow,
  policyPayDownAbove:           PLAN_POLICY_DEFAULTS.payDownAbove,
  policyBearBufferMonths:       PLAN_POLICY_DEFAULTS.bearBufferMonths,
  policyCashReserveMonths:      PLAN_POLICY_DEFAULTS.cashReserveMonths,
  setPlanPolicy: (patch) => {
    const cur = get() as unknown as Record<string, unknown>;
    const pairs: [PlanField, unknown][] = [];
    for (const k of PLAN_POLICY_KEYS) {
      if (!(k in patch)) continue;
      const v = clampPlanPolicy(k, patch[k]);
      if (cur[PLAN_POLICY_FIELD[k]] !== v) pairs.push([PLAN_POLICY_FIELD[k], v]);
    }
    if (pairs.length > 0) get().emitPlanSets(pairs);   // one ts for the whole patch
  },
  resetPlanPolicy: () => get().emitPlanSets(PLAN_POLICY_KEYS.map((k) => [PLAN_POLICY_FIELD[k], PLAN_POLICY_DEFAULTS[k]])),
});
