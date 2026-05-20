import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy } from '../simulation/types';

export type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy };

type Tier = 'min' | 'rec' | 'ideal' | 'custom';
type Scenario = 'conservative' | 'moderate' | 'historical';
type ActiveTab = 'living' | 'bloc' | 'powerlaw' | 'converter' | 'mining';
type LtvType = 'target' | 'current' | 'high' | 'hyper';

const defaultMiningInputs: MiningInputs = {
  devices: [
    { name: 'Gamma 601', hashrateTH: 1.07, powerW: 22.3, efficiencyJTH: 20.23, enabled: true, soloMining: true,  poolName: '', poolFee: 0.5 },
    { name: 'Gamma 602', hashrateTH: 1.20, powerW: 18.0, efficiencyJTH: 15.0,  enabled: true, soloMining: false, poolName: '', poolFee: 2.0 },
  ],
  electricityRateCents: 12,
  btcPriceOverride: null,
  networkHashrateEH: 1000,
  selectedStrategy: 'split',
  currency: 'usd',
  projectionYears: 5,
  btcPriceScenarios: [76000, 150000, 300000, 1000000],
};

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

  // Converter tab state
  converterActiveField: 'sats' | 'btc' | 'usd';
  converterRawValue:    string;
  setConverterActiveField: (v: 'sats' | 'btc' | 'usd') => void;
  setConverterRawValue:    (v: string) => void;

  // Mining tab state
  miningInputs: MiningInputs;
  setMiningInputs: (patch: Partial<MiningInputs>) => void;
  setMiningDevice: (index: number, patch: Partial<MiningDevice>) => void;
  setMiningCurrency: (currency: MiningCurrency) => void;
  setMiningStrategy: (strategy: MiningStrategy) => void;
  addMiningDevice: () => void;
  removeMiningDevice: (index: number) => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
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

  converterActiveField: 'sats',
  converterRawValue:    '0',
  setConverterActiveField: (v) => set({ converterActiveField: v }),
  setConverterRawValue:    (v) => set({ converterRawValue: v }),

  miningInputs: defaultMiningInputs,
  setMiningInputs: (patch) => set((s) => ({ miningInputs: { ...s.miningInputs, ...patch } })),
  setMiningDevice: (index, patch) => set((s) => {
    const devices = s.miningInputs.devices.map((d, i) => i === index ? { ...d, ...patch } : d);
    return { miningInputs: { ...s.miningInputs, devices } };
  }),
  setMiningCurrency: (currency) => set((s) => ({ miningInputs: { ...s.miningInputs, currency } })),
  setMiningStrategy: (strategy) => set((s) => ({ miningInputs: { ...s.miningInputs, selectedStrategy: strategy } })),
  addMiningDevice: () => set((s) => ({
    miningInputs: {
      ...s.miningInputs,
      devices: [
        ...s.miningInputs.devices,
        { name: 'New Miner', hashrateTH: 1.0, powerW: 20, efficiencyJTH: 20, enabled: true, soloMining: false, poolName: '', poolFee: 2.0 },
      ],
    },
  })),
  removeMiningDevice: (index) => set((s) => ({
    miningInputs: {
      ...s.miningInputs,
      devices: s.miningInputs.devices.filter((_, i) => i !== index),
    },
  })),
    }),
    {
      name: 'personal-bloc-store',
      onRehydrateStorage: () => (state) => {
        if (state?.miningInputs?.devices) {
          state.miningInputs.devices = state.miningInputs.devices.map((d) => ({
            poolName: '',
            poolFee: 2.0,
            soloMining: false,
            ...d,
          }));
        }
      },
    }
  )
);
