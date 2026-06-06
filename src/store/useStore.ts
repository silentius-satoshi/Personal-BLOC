import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry } from '../simulation/types';
import { upsertEntry } from '../simulation/logUtils';
import type { NostrSigner } from '@nostrify/nostrify';

export type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry };

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
  btcPriceMode: 'live' | 'manual';
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
  cbLoanBalance:        number;
  cbCollateralBtc:      number;
  cbAprPct:             number;
  cbMonthlyPayment:     number;
  cbLiquidationPrice:   number;
  cbPaymentStrategy:    'monthly' | 'ltvTriggered';
  cbLtvTriggerPct:      number;
  cbLtvTargetPct:       number;

  // App mode
  simpleMode:            boolean;
  onboardingComplete:    boolean;
  btcBuyingUnit:         'btc' | 'sats';
  setSimpleMode:         (v: boolean) => void;
  setOnboardingComplete: (v: boolean) => void;
  setBtcBuyingUnit:      (v: 'btc' | 'sats') => void;

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
    ndpPayment:   boolean;
  };
  setAdvisorChecklist: (patch: Partial<{
    month: number; blocDraw: boolean; cbPayment: boolean;
    btcBuying: boolean; fiatCoverage: boolean; ndpPayment: boolean;
  }>) => void;

  // Monthly log
  monthlyLog:         MonthlyLogEntry[];
  showMiningInLog:    boolean;
  setMonthlyLog:      (entries: MonthlyLogEntry[]) => void;
  upsertLogEntry:     (entry: MonthlyLogEntry) => void;
  deleteLogEntry:     (month: number) => void;
  setShowMiningInLog: (v: boolean) => void;

  // Setters — shared
  setIncome: (v: number) => void;
  setExpenses: (v: number) => void;
  setBtcPrice: (v: number) => void;
  setBtcPriceMode: (v: 'live' | 'manual') => void;
  setBlocApr: (v: number) => void;
  setFoldRewardRate: (v: number) => void;

  // Setters — Smart BLOC tab
  setShowFoldCC: (v: boolean) => void;
  setActiveTier: (v: Tier) => void;
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

  // CB Loan toggle
  hasCbLoan:    boolean;
  setHasCbLoan: (v: boolean) => void;

  // Setters — CB Loan tab
  setCbLoanBalance:       (v: number) => void;
  setCbCollateralBtc:     (v: number) => void;
  setCbAprPct:            (v: number) => void;
  setCbMonthlyPayment:    (v: number) => void;
  setCbLiquidationPrice:  (v: number) => void;
  setCbPaymentStrategy:   (v: 'monthly' | 'ltvTriggered') => void;
  setCbLtvTriggerPct:     (v: number) => void;
  setCbLtvTargetPct:      (v: number) => void;

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
  toolTabs:             string[];
  previousTab:          Exclude<ActiveTab, 'settings'>;
  toggleTabVisibility:  (tab: string) => void;
  setHiddenTabs:        (v: string[]) => void;
  setTabOrder:          (order: string[]) => void;
  setToolTabs:          (tabs: string[]) => void;
  setPreviousTab:       (tab: Exclude<ActiveTab, 'settings'>) => void;

  // Mining tab state
  miningInputs: MiningInputs;
  setMiningInputs: (patch: Partial<MiningInputs>) => void;
  setMiningDevice: (index: number, patch: Partial<MiningDevice>) => void;
  setMiningCurrency: (currency: MiningCurrency) => void;
  setMiningStrategy: (strategy: MiningStrategy) => void;
  addMiningDevice: () => void;
  removeMiningDevice: (index: number) => void;

  // Strike API display fields (excluded from persist — always re-fetched)
  strikeUsdBalance:   number | null;
  strikeRate:         number | null;
  strikeApiConnected: boolean;
  strikeLastFetched:  number | null;
  setStrikeUsdBalance:   (v: number | null) => void;
  setStrikeRate:         (v: number | null) => void;
  setStrikeApiConnected: (v: boolean) => void;
  setStrikeLastFetched:  (v: number | null) => void;

  // Nostr identity (persisted)
  nostrAuthEnabled:   boolean;
  nostrPubkey:        string | null;
  nostrSigningMethod: 'nip07' | 'nip46' | null;
  nostrBunkerUri:     string | null;
  nostrRelays:        string[];
  setNostrAuthEnabled:   (v: boolean) => void;
  setNostrPubkey:        (v: string | null) => void;
  setNostrSigningMethod: (v: 'nip07' | 'nip46' | null) => void;
  setNostrBunkerUri:     (v: string | null) => void;
  setNostrRelays:        (v: string[]) => void;

  // Nostr session (excluded from persist — always re-auth on load)
  isAuthenticated:    boolean;
  setIsAuthenticated: (v: boolean) => void;

  // Nostr signer + sync state (excluded from persist — in-memory only)
  nostrSigner:         NostrSigner | null;
  setNostrSigner:      (v: NostrSigner | null) => void;
  syncSettingsToNostr: () => void;
  nostrSyncing:        boolean;
  setNostrSyncing:     (v: boolean) => void;

  // Nostr cross-device sync (persisted)
  lastSettingsSyncAt:    number | null;
  setLastSettingsSyncAt: (ts: number) => void;
  hydrateSettings:      (data: Record<string, unknown>) => void;
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recordsSyncTimer:  ReturnType<typeof setTimeout> | null = null;

function syncRecordsToNostr() {
  if (recordsSyncTimer) clearTimeout(recordsSyncTimer);
  recordsSyncTimer = setTimeout(async () => {
    const state = useStore.getState();
    if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey) return;
    useStore.getState().setNostrSyncing(true);
    try {
      const { publishRecords } = await import('../lib/nostr/publish');
      await publishRecords(
        state.nostrSigner,
        state.nostrPubkey,
        state.monthlyLog,
        state.nostrRelays.length ? state.nostrRelays : undefined,
      );
    } catch (e) {
      console.warn('[Nostr] publish records failed:', e);
    } finally {
      useStore.getState().setNostrSyncing(false);
    }
  }, 3000);
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
  income: 4000,
  expenses: 3500,
  btcPrice: 82000,
  btcPriceMode: 'live' as const,
  blocApr: 13,
  foldRewardRate: 1.5,

  showFoldCC: true,
  activeTier: 'rec',
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

  hasCbLoan:    false,
  setHasCbLoan: (v) => { set({ hasCbLoan: v }); useStore.getState().syncSettingsToNostr(); },

  cbLoanBalance:       60000,
  cbCollateralBtc:     1.48,
  cbAprPct:            4.77,
  cbMonthlyPayment:    0,
  cbLiquidationPrice:  0,
  cbPaymentStrategy:   'monthly' as const,
  cbLtvTriggerPct:     75,
  cbLtvTargetPct:      65,

  simpleMode:         false,
  onboardingComplete: false,
  btcBuyingUnit:      'btc',
  setSimpleMode:         (v) => { set({ simpleMode: v }); useStore.getState().syncSettingsToNostr(); },
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setBtcBuyingUnit:      (v) => { set({ btcBuyingUnit: v }); useStore.getState().syncSettingsToNostr(); },

  advisorStartDate:         new Date().toISOString().split('T')[0],
  advisorActualBlocBalance: 0,
  advisorActualBtcHeld:     0,
  ndpLastPaidDate:          null,
  advisorChecklist: { month: 0, blocDraw: false, cbPayment: false, btcBuying: false, fiatCoverage: false, ndpPayment: false },

  advisorSkipBlocDraw:  false,
  advisorSkipCbPayment: false,
  advisorSkipBtcBuying: false,

  monthlyLog:      [],
  showMiningInLog: false,

  setIncome:   (v) => { set({ income: v });   useStore.getState().syncSettingsToNostr(); },
  setExpenses: (v) => { set({ expenses: v }); useStore.getState().syncSettingsToNostr(); },
  setBtcPrice: (v) => set({ btcPrice: v }),
  setBtcPriceMode: (v) => set({ btcPriceMode: v }),
  setBlocApr:  (v) => { set({ blocApr: v });  useStore.getState().syncSettingsToNostr(); },
  setFoldRewardRate: (v) => set({ foldRewardRate: v }),

  setShowFoldCC: (v) => set({ showFoldCC: v }),
  setActiveTier: (v) => set({ activeTier: v }),
  setScenario: (v) => set({ scenario: v }),
  setScrubMonth: (v) => set({ scrubMonth: v }),
  setCreditLine: (v) => { set({ creditLine: v }); useStore.getState().syncSettingsToNostr(); },

  setActiveTab: (v) => set({ activeTab: v }),
  setBtcHoldings: (v) => set({ btcHoldings: v }),
  setAnnualBtcGrowth: (v) => set({ annualBtcGrowth: v }),
  setBearMarket: (v) => set({ bearMarket: v }),
  setBearPeriodYears: (v) => set({ bearPeriodYears: v }),
  setAnnualDecline: (v) => set({ annualDecline: v }),
  setInflationRate: (v) => set({ inflationRate: v }),
  setLtvType: (v) => set({ ltvType: v }),
  setTimeHorizonYears: (v) => set({ timeHorizonYears: v }),

  setCbLoanBalance:    (v) => { set({ cbLoanBalance: v });    useStore.getState().syncSettingsToNostr(); },
  setCbCollateralBtc:  (v) => { set({ cbCollateralBtc: v });  useStore.getState().syncSettingsToNostr(); },
  setCbAprPct:         (v) => { set({ cbAprPct: v });         useStore.getState().syncSettingsToNostr(); },
  setCbMonthlyPayment:   (v) => set({ cbMonthlyPayment: v }),
  setCbLiquidationPrice: (v) => set({ cbLiquidationPrice: v }),
  setCbPaymentStrategy:  (v) => set({ cbPaymentStrategy: v }),
  setCbLtvTriggerPct:    (v) => set({ cbLtvTriggerPct: v }),
  setCbLtvTargetPct:     (v) => set({ cbLtvTargetPct: v }),

  setAdvisorStartDate:         (v) => { set({ advisorStartDate: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorActualBlocBalance: (v) => { set({ advisorActualBlocBalance: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorActualBtcHeld:     (v) => { set({ advisorActualBtcHeld: v });    useStore.getState().syncSettingsToNostr(); },
  setNdpLastPaidDate:          (v) => { set({ ndpLastPaidDate: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorChecklist: (patch) => set((s) => ({
    advisorChecklist: { ...s.advisorChecklist, ...patch }
  })),

  setAdvisorSkipBlocDraw:  (v) => set({ advisorSkipBlocDraw: v }),
  setAdvisorSkipCbPayment: (v) => set({ advisorSkipCbPayment: v }),
  setAdvisorSkipBtcBuying: (v) => set({ advisorSkipBtcBuying: v }),

  setMonthlyLog:  (entries) => set({ monthlyLog: entries }),
  upsertLogEntry: (entry) => {
    set((state) => ({ monthlyLog: upsertEntry(state.monthlyLog, entry) }));
    syncRecordsToNostr();
  },
  deleteLogEntry: (month) => {
    set((state) => ({ monthlyLog: state.monthlyLog.filter((e) => e.month !== month) }));
    syncRecordsToNostr();
  },
  setShowMiningInLog: (v) => set({ showMiningInLog: v }),

  converterActiveField: 'sats',
  converterRawValue:    '0',
  setConverterActiveField: (v) => set({ converterActiveField: v }),
  setConverterRawValue:    (v) => set({ converterRawValue: v }),

  hiddenTabs:  [],
  tabOrder:    ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor'],
  toolTabs:    ['powerlaw', 'converter', 'mining', 'liqsim'],
  previousTab: 'living',
  toggleTabVisibility: (tab) => set((s) => ({
    hiddenTabs: s.hiddenTabs.includes(tab)
      ? s.hiddenTabs.filter((t) => t !== tab)
      : [...s.hiddenTabs, tab],
  })),
  setHiddenTabs: (v) => { set({ hiddenTabs: v }); useStore.getState().syncSettingsToNostr(); },
  setTabOrder:   (v) => { set({ tabOrder: v });   useStore.getState().syncSettingsToNostr(); },
  setToolTabs: (tabs) => set({ toolTabs: tabs }),
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

  strikeUsdBalance:   null,
  strikeRate:         null,
  strikeApiConnected: false,
  strikeLastFetched:  null,
  setStrikeUsdBalance:   (v) => set({ strikeUsdBalance: v }),
  setStrikeRate:         (v) => set({ strikeRate: v }),
  setStrikeApiConnected: (v) => set({ strikeApiConnected: v }),
  setStrikeLastFetched:  (v) => set({ strikeLastFetched: v }),

  nostrAuthEnabled:   false,
  nostrPubkey:        null,
  nostrSigningMethod: null,
  nostrBunkerUri:     null,
  nostrRelays:        ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol', 'wss://relay.nostr.band'],
  setNostrAuthEnabled:   (v) => set({ nostrAuthEnabled: v }),
  setNostrPubkey:        (v) => set({ nostrPubkey: v }),
  setNostrSigningMethod: (v) => set({ nostrSigningMethod: v }),
  setNostrBunkerUri:     (v) => set({ nostrBunkerUri: v }),
  setNostrRelays:        (v) => set({ nostrRelays: v }),

  isAuthenticated:    false,
  setIsAuthenticated: (v) => set({ isAuthenticated: v }),

  nostrSigner:    null,
  setNostrSigner: (v) => set({ nostrSigner: v }),

  syncSettingsToNostr: () => {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      const s = useStore.getState();
      if (!s.nostrSigner || !s.nostrPubkey) return;
      const settings = {
        income:                   s.income,
        expenses:                 s.expenses,
        blocApr:                  s.blocApr,
        creditLine:               s.creditLine,
        advisorStartDate:         s.advisorStartDate,
        advisorActualBlocBalance: s.advisorActualBlocBalance,
        advisorActualBtcHeld:     s.advisorActualBtcHeld,
        cbLoanBalance:            s.cbLoanBalance,
        cbCollateralBtc:          s.cbCollateralBtc,
        cbAprPct:                 s.cbAprPct,
        hasCbLoan:                s.hasCbLoan,
        ndpLastPaidDate:          s.ndpLastPaidDate,
        tabOrder:                 s.tabOrder,
        hiddenTabs:               s.hiddenTabs,
        simpleMode:               s.simpleMode,
        btcBuyingUnit:            s.btcBuyingUnit,
      };
      s.setNostrSyncing(true);
      import('../lib/nostr/publish').then(({ publishSettings }) =>
        publishSettings(s.nostrSigner!, s.nostrPubkey!, s.nostrRelays, settings)
          .catch((e) => console.warn('[Nostr] publish settings failed:', e))
          .finally(() => useStore.getState().setNostrSyncing(false))
      );
    }, 2000);
  },

  nostrSyncing:    false,
  setNostrSyncing: (v) => set({ nostrSyncing: v }),

  lastSettingsSyncAt: null,
  setLastSettingsSyncAt: (ts) => set({ lastSettingsSyncAt: ts }),

  hydrateSettings: (data) => {
    const SETTINGS_FIELDS = [
      'income', 'expenses', 'blocApr', 'creditLine',
      'advisorStartDate', 'advisorActualBlocBalance', 'advisorActualBtcHeld',
      'cbLoanBalance', 'cbCollateralBtc', 'cbAprPct', 'hasCbLoan',
      'ndpLastPaidDate', 'tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit',
    ] as const;
    const update: Partial<StoreState> = {};
    for (const field of SETTINGS_FIELDS) {
      if (field in data && data[field] !== undefined) {
        (update as Record<string, unknown>)[field] = data[field];
      }
    }
    set(update);
  },
    }),
    {
      name: 'personal-bloc-store',
      version: 8,
      partialize: (state) => {
        const { strikeUsdBalance, strikeRate, strikeApiConnected, strikeLastFetched, isAuthenticated, nostrSigner, nostrSyncing, ...rest } = state;
        return rest;
      },
      migrate: (persistedState: any) => {
        const { customCollateral, ...rest } = persistedState;
        return {
          ...rest,
          advisorActualBtcHeld: persistedState.advisorActualBtcHeld ?? customCollateral ?? 0,
          cbPaymentStrategy:    persistedState.cbPaymentStrategy    ?? 'monthly',
          cbLtvTriggerPct:      persistedState.cbLtvTriggerPct      ?? 75,
          cbLtvTargetPct:       persistedState.cbLtvTargetPct       ?? 65,
          btcPriceMode:         persistedState.btcPriceMode         ?? 'live',
        };
      },
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
