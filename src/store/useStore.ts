import { create } from 'zustand';

type Tier = 'min' | 'rec' | 'ideal' | 'custom';
type Scenario = 'conservative' | 'moderate' | 'historical';
type ActiveTab = 'living' | 'bloc' | 'powerlaw' | 'converter';
type LtvType = 'target' | 'current' | 'high' | 'hyper';

interface StoreState {
  // Shared inputs
  income: number;
  expenses: number;
  btcPrice: number;
  blocApr: number;
  foldRewardRate: number;

  // Smart BLOC tab state
  showFoldCC: boolean;
  activeTier: Tier;
  scenario: Scenario;
  scrubMonth: number;

  // Tab navigation
  activeTab: ActiveTab;

  // Living on Bitcoin tab inputs
  btcHoldings: number;
  annualBtcGrowth: number;
  bearMarket: boolean;
  bearPeriodYears: number;
  annualDecline: number;
  inflationRate: number;
  ltvType: LtvType;
  timeHorizonYears: number;

  // Setters — shared
  setIncome: (v: number) => void;
  setExpenses: (v: number) => void;
  setBtcPrice: (v: number) => void;
  setBlocApr: (v: number) => void;
  setFoldRewardRate: (v: number) => void;

  customCollateral: number;

  // Setters — Smart BLOC tab
  setShowFoldCC: (v: boolean) => void;
  setActiveTier: (v: Tier) => void;
  setCustomCollateral: (v: number) => void;
  setScenario: (v: Scenario) => void;
  setScrubMonth: (v: number) => void;

  // Setters — tab + Living tab
  setActiveTab: (v: ActiveTab) => void;
  setBtcHoldings: (v: number) => void;
  setAnnualBtcGrowth: (v: number) => void;
  setBearMarket: (v: boolean) => void;
  setBearPeriodYears: (v: number) => void;
  setAnnualDecline: (v: number) => void;
  setInflationRate: (v: number) => void;
  setLtvType: (v: LtvType) => void;
  setTimeHorizonYears: (v: number) => void;
}

export const useStore = create<StoreState>((set) => ({
  income: 4000,
  expenses: 3500,
  btcPrice: 82000,
  blocApr: 13,
  foldRewardRate: 1.5,

  showFoldCC: true,
  activeTier: 'rec',
  customCollateral: 1.0,
  scenario: 'moderate',
  scrubMonth: 30,

  activeTab: 'living',

  btcHoldings: 0.7,
  annualBtcGrowth: 50,
  bearMarket: false,
  bearPeriodYears: 2,
  annualDecline: -50,
  inflationRate: 2,
  ltvType: 'target',
  timeHorizonYears: 1,

  setIncome: (v) => set({ income: v }),
  setExpenses: (v) => set({ expenses: v }),
  setBtcPrice: (v) => set({ btcPrice: v }),
  setBlocApr: (v) => set({ blocApr: v }),
  setFoldRewardRate: (v) => set({ foldRewardRate: v }),

  setShowFoldCC: (v) => set({ showFoldCC: v }),
  setActiveTier: (v) => set({ activeTier: v }),
  setCustomCollateral: (v) => set({ customCollateral: v }),
  setScenario: (v) => set({ scenario: v }),
  setScrubMonth: (v) => set({ scrubMonth: v }),

  setActiveTab: (v) => set({ activeTab: v }),
  setBtcHoldings: (v) => set({ btcHoldings: v }),
  setAnnualBtcGrowth: (v) => set({ annualBtcGrowth: v }),
  setBearMarket: (v) => set({ bearMarket: v }),
  setBearPeriodYears: (v) => set({ bearPeriodYears: v }),
  setAnnualDecline: (v) => set({ annualDecline: v }),
  setInflationRate: (v) => set({ inflationRate: v }),
  setLtvType: (v) => set({ ltvType: v }),
  setTimeHorizonYears: (v) => set({ timeHorizonYears: v }),
}));
