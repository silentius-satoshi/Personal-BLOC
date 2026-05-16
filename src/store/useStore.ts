import { create } from 'zustand';

type Tier = 'min' | 'rec' | 'ideal';
type Scenario = 'conservative' | 'moderate' | 'historical';

interface StoreState {
  income: number;
  expenses: number;
  btcPrice: number;
  blocApr: number;
  foldRewardRate: number;

  showFoldCC: boolean;
  activeTier: Tier;
  scenario: Scenario;
  scrubMonth: number;

  setIncome: (v: number) => void;
  setExpenses: (v: number) => void;
  setBtcPrice: (v: number) => void;
  setBlocApr: (v: number) => void;
  setFoldRewardRate: (v: number) => void;
  setShowFoldCC: (v: boolean) => void;
  setActiveTier: (v: Tier) => void;
  setScenario: (v: Scenario) => void;
  setScrubMonth: (v: number) => void;
}

export const useStore = create<StoreState>((set) => ({
  income: 4000,
  expenses: 3500,
  btcPrice: 82000,
  blocApr: 13,
  foldRewardRate: 1.5,

  showFoldCC: true,
  activeTier: 'rec',
  scenario: 'moderate',
  scrubMonth: 30,

  setIncome: (v) => set({ income: v }),
  setExpenses: (v) => set({ expenses: v }),
  setBtcPrice: (v) => set({ btcPrice: v }),
  setBlocApr: (v) => set({ blocApr: v }),
  setFoldRewardRate: (v) => set({ foldRewardRate: v }),
  setShowFoldCC: (v) => set({ showFoldCC: v }),
  setActiveTier: (v) => set({ activeTier: v }),
  setScenario: (v) => set({ scenario: v }),
  setScrubMonth: (v) => set({ scrubMonth: v }),
}));
