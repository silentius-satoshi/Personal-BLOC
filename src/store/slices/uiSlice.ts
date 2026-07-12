// uiSlice (Phase 1c) — app mode + display prefs + tabs + converter. Moved verbatim; getState()→get() the only change.
import type { StoreState, StoreSet, StoreGet } from '../types';
import { GATE_ONBOARDED_KEY, seedOnboardingComplete } from '../bootstrap';

type UiSlice = Pick<StoreState,
  | 'activeTab' | 'simpleMode' | 'onboardingComplete' | 'btcBuyingUnit' | 'devMode' | 'almanacLiveEnabled'
  | 'almanacLiveConsented' | 'expenseReanchorDismissedAt' | 'setExpenseReanchorDismissedAt' | 'setSimpleMode'
  | 'setOnboardingComplete' | 'setBtcBuyingUnit' | 'setDevMode' | 'setAlmanacLiveEnabled' | 'setAlmanacLiveConsented'
  | 'showPlanIncomeBar' | 'showPlanStrikeBar' | 'showPlanCbBar' | 'simpleView' | 'setActiveTab'
  | 'setShowPlanIncomeBar' | 'setShowPlanStrikeBar' | 'setShowPlanCbBar' | 'setSimpleView' | 'converterActiveField'
  | 'converterRawValue' | 'setConverterActiveField' | 'setConverterRawValue' | 'hiddenTabs' | 'tabOrder'
  | 'toolTabs' | 'previousTab' | 'toggleTabVisibility' | 'setHiddenTabs' | 'setTabOrder' | 'setToolTabs' | 'setPreviousTab'
>;

export const createUiSlice = (set: StoreSet, get: StoreGet): UiSlice => ({
  activeTab: 'living',
  simpleMode:         false,
  onboardingComplete: seedOnboardingComplete,   // 3a.4: standalone-seeded (false on fresh install = today's default)
  btcBuyingUnit:      'btc',
  devMode:            false,
  almanacLiveEnabled:   false,
  almanacLiveConsented: false,
  expenseReanchorDismissedAt: 0,
  setSimpleMode:         (v) => { set({ simpleMode: v }); get().syncSettingsToNostr(); },
  // 3a.4: write through to the standalone GATE_* key (outside the encrypted blob) so the unlock gate can bootstrap
  // on an encrypted cold start. Mirrors setWriterKeyWrapped.
  setOnboardingComplete: (v) => { try { v ? localStorage.setItem(GATE_ONBOARDED_KEY, '1') : localStorage.removeItem(GATE_ONBOARDED_KEY); } catch { /* noop */ } set({ onboardingComplete: v }); },
  setBtcBuyingUnit:      (v) => { set({ btcBuyingUnit: v }); get().syncSettingsToNostr(); },
  setDevMode:            (v) => set({ devMode: v }),
  setAlmanacLiveEnabled:   (v) => set({ almanacLiveEnabled: v }),    // device-local, unsynced — no syncSettingsToNostr
  setAlmanacLiveConsented: (v) => set({ almanacLiveConsented: v }),  // device-local, unsynced — no syncSettingsToNostr
  setExpenseReanchorDismissedAt: (v) => set({ expenseReanchorDismissedAt: v }),   // device-local, unsynced — no syncSettingsToNostr
  showPlanIncomeBar: true,
  showPlanStrikeBar: true,
  showPlanCbBar:     true,
  // Default to the Dashboard (owner IA — dashboard-first); the custom merge fills this for existing
  // users (migrate-default only — a persisted choice is preserved, no version bump).
  simpleView: 'dashboard',
  setActiveTab: (v) => set({ activeTab: v }),
  // Device-local display prefs — plain set, NO syncSettingsToNostr (like devMode)
  setShowPlanIncomeBar: (v) => set({ showPlanIncomeBar: v }),
  setShowPlanStrikeBar: (v) => set({ showPlanStrikeBar: v }),
  setShowPlanCbBar:     (v) => set({ showPlanCbBar: v }),
  setSimpleView:        (v) => set({ simpleView: v }),

  converterActiveField: 'sats',
  converterRawValue:    '0',
  setConverterActiveField: (v) => set({ converterActiveField: v }),
  setConverterRawValue:    (v) => set({ converterRawValue: v }),
  hiddenTabs:  [],
  tabOrder:    ['living', 'bloc', 'powerlaw', 'converter', 'mining', 'coinbase', 'advisor'],
  toolTabs:    ['powerlaw', 'converter', 'mining', 'liqsim', 'almanac'],
  previousTab: 'living',
  toggleTabVisibility: (tab) => set((s) => ({
    hiddenTabs: s.hiddenTabs.includes(tab)
      ? s.hiddenTabs.filter((t) => t !== tab)
      : [...s.hiddenTabs, tab],
  })),
  setHiddenTabs: (v) => { set({ hiddenTabs: v }); get().syncSettingsToNostr(); },
  setTabOrder:   (v) => { set({ tabOrder: v });   get().syncSettingsToNostr(); },
  setToolTabs: (tabs) => set({ toolTabs: tabs }),
  setPreviousTab: (tab) => set({ previousTab: tab }),
});
