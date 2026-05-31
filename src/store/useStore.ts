import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy } from '../simulation/types';

export type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy };

type Tier = 'min' | 'rec' | 'ideal' | 'custom';
type Scenario = 'conservative' | 'moderate' | 'historical';
type ActiveTab = 'living' | 'bloc' | 'powerlaw' | 'converter' | 'mining' | 'coinbase' | 'advisor' | 'settings';
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
  creditLine: number;

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

  // CB Loan tab inputs
  cbLoanBalance:    number;
  cbCollateralBtc:  number;
  cbAprPct:         number;
  cbMonthlyPayment: number;

  // Advisor tab inputs
  advisorStartDate:         string;
  advisorActualBlocBalance: number;
  advisorActualBtcHeld:     number;
  ndpLastPaidDate:          string | null;
  setNdpLastPaidDate:       (date: string | null) => void;
  advisorChecklist: {
    month:        number;
    blocDraw:     boolean;
    cbPayment:    boolean;
    btcBuying:    boolean;
    fiatCoverage: boolean;
  };
  setAdvisorChecklist: (patch: Partial<{
    month: number; blocDraw: boolean; cbPayment: boolean;
    btcBuying: boolean; fiatCoverage: boolean;
  }>) => void;

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
  setCreditLine: (v: number) => void;

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

  // Setters — CB Loan tab
  setCbLoanBalance:    (v: number) => void;
  setCbCollateralBtc:  (v: number) => void;
  setCbAprPct:         (v: number) => void;
  setCbMonthlyPayment: (v: number) => void;

  // Setters — Advisor tab
  setAdvisorStartDate:         (date: string) => void;
  setAdvisorActualBlocBalance: (v: number)    => void;
  setAdvisorActualBtcHeld:     (v: number)    => void;

  advisorSkipBlocDraw:  boolean;
  advisorSkipCbPayment: boolean;
  advisorSkipBtcBuying: boolean;
  setAdvisorSkipBlocDraw:  (v: boolean) => void;
  setAdvisorSkipCbPayment: (v: boolean) => void;
  setAdvisorSkipBtcBuying: (v: boolean) => void;

  // Converter tab state
  converterActiveField: 'sats' | 'btc' | 'usd';
  converterRawValue:    string;
  setConverterActiveField: (v: 'sats' | 'btc' | 'usd') => void;
  setConverterRawValue:    (v: string) => void;

  // Settings
  hiddenTabs:           string[];
  tabOrder:             string[];
  previousTab:          Exclude<ActiveTab, 'settings'>;
  toggleTabVisibility:  (tab: string) => void;
  setTabOrder:          (order: string[]) => void;
  setPreviousTab:       (tab: Exclude<ActiveTab, 'settings'>) => void;

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
  creditLine: 10000,

  activeTab: 'living',

  btcHoldings: 0.7,
  annualBtcGrowth: 50,
  bearMarket: false,
  bearPeriodYears: 2,
  annualDecline: -50,
  inflationRate: 2,
  ltvType: 'target',
  timeHorizonYears: 1,

  cbLoanBalance:    60000,
  cbCollateralBtc:  1.48,
  cbAprPct:         4.77,
  cbMonthlyPayment: 0,

  advisorStartDate:         new Date().toISOString().split('T')[0],
  advisorActualBlocBalance: 0,
  advisorActualBtcHeld:     0,
  ndpLastPaidDate:          null,
  advisorChecklist: { month: 0, blocDraw: false, cbPayment: false, btcBuying: false, fiatCoverage: false },

  advisorSkipBlocDraw:  false,
  advisorSkipCbPayment: false,
  advisorSkipBtcBuying: false,

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
  setCreditLine: (v) => set({ creditLine: v }),

  setActiveTab: (v) => set({ activeTab: v }),
  setBtcHoldings: (v) => set({ btcHoldings: v }),
  setAnnualBtcGrowth: (v) => set({ annualBtcGrowth: v }),
  setBearMarket: (v) => set({ bearMarket: v }),
  setBearPeriodYears: (v) => set({ bearPeriodYears: v }),
  setAnnualDecline: (v) => set({ annualDecline: v }),
  setInflationRate: (v) => set({ inflationRate: v }),
  setLtvType: (v) => set({ ltvType: v }),
  setTimeHorizonYears: (v) => set({ timeHorizonYears: v }),

  setCbLoanBalance:    (v) => set({ cbLoanBalance: v }),
  setCbCollateralBtc:  (v) => set({ cbCollateralBtc: v }),
  setCbAprPct:         (v) => set({ cbAprPct: v }),
  setCbMonthlyPayment: (v) => set({ cbMonthlyPayment: v }),

  setAdvisorStartDate:         (date) => set({ advisorStartDate: date }),
  setAdvisorActualBlocBalance: (v)    => set({ advisorActualBlocBalance: v }),
  setAdvisorActualBtcHeld:     (v)    => set({ advisorActualBtcHeld: v }),
  setNdpLastPaidDate:          (date) => set({ ndpLastPaidDate: date }),
  setAdvisorChecklist: (patch) => set((s) => ({
    advisorChecklist: { ...s.advisorChecklist, ...patch }
  })),

  setAdvisorSkipBlocDraw:  (v) => set({ advisorSkipBlocDraw: v }),
  setAdvisorSkipCbPayment: (v) => set({ advisorSkipCbPayment: v }),
  setAdvisorSkipBtcBuying: (v) => set({ advisorSkipBtcBuying: v }),

  converterActiveField: 'sats',
  converterRawValue:    '0',
  setConverterActiveField: (v) => set({ converterActiveField: v }),
  setConverterRawValue:    (v) => set({ converterRawValue: v }),

  hiddenTabs:  ['coinbase', 'advisor'],
  tabOrder:    ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor'],
  previousTab: 'living',
  toggleTabVisibility: (tab) => set((s) => ({
    hiddenTabs: s.hiddenTabs.includes(tab)
      ? s.hiddenTabs.filter((t) => t !== tab)
      : [...s.hiddenTabs, tab],
  })),
  setTabOrder: (order) => set({ tabOrder: order }),
  setPreviousTab: (tab) => set({ previousTab: tab }),

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
