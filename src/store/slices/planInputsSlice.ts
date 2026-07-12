// planInputsSlice (Phase 1c) — shared/Smart-BLOC/Living inputs + the Smart BLOC what-if sandbox collateral.
import type { StoreState, StoreSet, StoreGet } from '../types';

type PlanInputsSlice = Pick<StoreState,
  | 'income' | 'expenses' | 'btcPrice' | 'btcPriceMode' | 'btcPriceUpdatedAt' | 'blocApr' | 'activeTier' | 'scenario'
  | 'scrubMonth' | 'creditLine' | 'btcHoldings' | 'annualBtcGrowth' | 'bearMarket' | 'bearPeriodYears' | 'annualDecline'
  | 'inflationRate' | 'ltvType' | 'timeHorizonYears' | 'sandboxCollateralBtc' | 'setSandboxCollateralBtc'
  | 'pinnedScenario' | 'setPinnedScenario' | 'setIncome'
  | 'setExpenses' | 'setBtcPrice' | 'setBtcPriceMode' | 'setBlocApr' | 'setActiveTier' | 'setScenario' | 'setScrubMonth'
  | 'setCreditLine' | 'setBtcHoldings' | 'setAnnualBtcGrowth' | 'setBearMarket' | 'setBearPeriodYears'
  | 'setAnnualDecline' | 'setInflationRate' | 'setLtvType' | 'setTimeHorizonYears'
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
  setIncome:   (v) => { set({ income: v });   get().syncSettingsToNostr(); },
  setExpenses: (v) => { set({ expenses: v }); get().syncSettingsToNostr(); set({ expenseReanchorDismissedAt: 0 }); },   // re-anchoring (or any expenses edit) clears the dismissal so a future drift can nudge again — single chokepoint for Update + manual edits
  setBtcPrice: (v) => set({ btcPrice: v, btcPriceUpdatedAt: Date.now() }),
  setBtcPriceMode: (v) => set({ btcPriceMode: v }),
  setBlocApr:  (v) => { set({ blocApr: v });  get().syncSettingsToNostr(); },

  setActiveTier: (v) => set({ activeTier: v }),
  setScenario: (v) => set({ scenario: v }),
  setScrubMonth: (v) => set({ scrubMonth: v }),
  setCreditLine: (v) => { set({ creditLine: v }); get().syncSettingsToNostr(); },
  setBtcHoldings: (v) => set({ btcHoldings: v }),
  setAnnualBtcGrowth: (v) => set({ annualBtcGrowth: v }),
  setBearMarket: (v) => set({ bearMarket: v }),
  setBearPeriodYears: (v) => set({ bearPeriodYears: v }),
  setAnnualDecline: (v) => set({ annualDecline: v }),
  setInflationRate: (v) => set({ inflationRate: v }),
  setLtvType: (v) => set({ ltvType: v }),
  setTimeHorizonYears: (v) => set({ timeHorizonYears: v }),
});
