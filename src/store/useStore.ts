import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry } from '../simulation/types';
import { upsertEntry, recomputeBtcHeld, deriveCurrentPosition } from '../simulation/logUtils';
import { getCurrentStrategyMonth } from '../simulation/runAdvisor';   // pure, zero imports — no circular dep
import { signerOpTimeout } from '../lib/nostr/timeout';
import { nostrLog } from '../lib/nostr/log';
import type { WrapMeta } from '../lib/nostr/keyVault';
import type { NostrSigner } from '@nostrify/nostrify';

export type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry };

type Tier = 'min' | 'rec' | 'ideal' | 'custom';
type Scenario = 'conservative' | 'moderate' | 'historical';
type ActiveTab = 'living' | 'bloc' | 'powerlaw' | 'converter' | 'mining' | 'coinbase' | 'advisor' | 'liqsim' | 'settings';
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

  // Smart BLOC tab state
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
  cbRotateBackPct:      number;
  cbLoanBalanceAsOf:      string | null;   // ISO date — when cbLoanBalance was last re-anchored (interest accrues daily from here)
  cbLiquidationPriceAsOf: string | null;   // ISO date — when cbLiquidationPrice was last re-entered (drifts up as interest accrues)
  strikeLiquidationLtvPct: number;         // Strike partial-liquidation LTV (published terms: 85%)

  // App mode
  simpleMode:            boolean;
  onboardingComplete:    boolean;
  btcBuyingUnit:         'btc' | 'sats';
  devMode:               boolean;   // persisted, DEVICE-LOCAL — never synced (not in SETTINGS_FIELDS/payload)
  expenseReanchorDismissedAt: number;   // avg dismissed against (0 = not dismissed); persisted, DEVICE-LOCAL, NEVER synced (mirrors devMode)
  setExpenseReanchorDismissedAt: (v: number) => void;
  setSimpleMode:         (v: boolean) => void;
  setOnboardingComplete: (v: boolean) => void;
  setBtcBuyingUnit:      (v: 'btc' | 'sats') => void;
  setDevMode:            (v: boolean) => void;

  // Advisor tab inputs
  advisorStartDate:         string;
  advisorActualBlocBalance: number;
  advisorActualBtcHeld:     number;   // TRUE month-0 baseline — never back-solved; current holdings derive from the log + pending
  pendingCollateralAdjustment: number;   // un-graduated collateral delta (deposit/withdrawal); SYNCED via settings; folds into the current month's entry on log
  sandboxCollateralBtc:     number | null;   // Smart BLOC what-if collateral — in-memory ONLY (not persisted/synced); null = tracks current
  setSandboxCollateralBtc:  (v: number | null) => void;
  getCurrentBtcHeld:        () => number;   // (last.btcHeld ?? baseline) + pending — THE reality read
  adjustCurrentCollateral:  (targetTotal: number) => void;   // dated-adjustment write: delta lands in pending
  ndpLastPaidDate:          string | null;
  setNdpLastPaidDate:       (date: string | null) => void;
  // Monthly log
  monthlyLog:         MonthlyLogEntry[];
  showMiningInLog:    boolean;
  setMonthlyLog:      (entries: MonthlyLogEntry[]) => void;
  upsertLogEntry:     (entry: MonthlyLogEntry) => void;
  deleteLogEntry:     (month: number) => void;
  setShowMiningInLog: (v: boolean) => void;

  // Simple Mode plan-card status bars — device-local display prefs (NOT synced, like devMode)
  showPlanIncomeBar:    boolean;
  showPlanStrikeBar:    boolean;
  showPlanCbBar:        boolean;
  setShowPlanIncomeBar: (v: boolean) => void;
  setShowPlanStrikeBar: (v: boolean) => void;
  setShowPlanCbBar:     (v: boolean) => void;

  // Setters — shared
  setIncome: (v: number) => void;
  setExpenses: (v: number) => void;
  setBtcPrice: (v: number) => void;
  setBtcPriceMode: (v: 'live' | 'manual') => void;
  setBlocApr: (v: number) => void;

  // Setters — Smart BLOC tab
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
  setCbRotateBackPct:     (v: number) => void;
  setCbLoanBalanceAsOf:      (v: string | null) => void;
  setCbLiquidationPriceAsOf: (v: string | null) => void;
  setStrikeLiquidationLtvPct: (v: number) => void;

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
  strikeBtcAvailable: number | null;
  strikeRate:         number | null;
  strikeApiConnected: boolean;
  strikeLastFetched:  number | null;
  setStrikeUsdBalance:   (v: number | null) => void;
  setStrikeBtcAvailable: (v: number | null) => void;
  setStrikeRate:         (v: number | null) => void;
  setStrikeApiConnected: (v: boolean) => void;
  setStrikeLastFetched:  (v: number | null) => void;

  // Nostr identity (persisted)
  nostrAuthEnabled:   boolean;
  nostrPubkey:        string | null;
  nostrSigningMethod: 'nip07' | 'nip46' | 'local' | null;
  nostrBunkerUri:     string | null;
  nostrRelays:        string[];
  nostrLogin:         string | null;
  // Writer local-key (iOS Face-ID signer) — device-local, NEVER synced (excluded from any relay payload).
  writerKeyWrapped:   string | null;      // AES-GCM ciphertext (base64) of the writer nsec
  writerKeyWrapMeta:  WrapMeta | null;    // { iv, scheme, credentialId?, salt }
  setNostrAuthEnabled:   (v: boolean) => void;
  setNostrPubkey:        (v: string | null) => void;
  setNostrSigningMethod: (v: 'nip07' | 'nip46' | 'local' | null) => void;
  setNostrBunkerUri:     (v: string | null) => void;
  setNostrRelays:        (v: string[]) => void;
  setNostrLogin:         (v: string | null) => void;
  setWriterKeyWrapped:   (v: string | null) => void;
  setWriterKeyWrapMeta:  (v: WrapMeta | null) => void;

  // Nostr session (excluded from persist — always re-auth on load)
  isAuthenticated:    boolean;
  setIsAuthenticated: (v: boolean) => void;

  // Nostr signer + sync state (excluded from persist — in-memory only)
  nostrSigner:         NostrSigner | null;
  setNostrSigner:      (v: NostrSigner | null) => void;
  syncSettingsToNostr: () => void;
  nostrSyncing:        boolean;
  setNostrSyncing:     (v: boolean) => void;
  nostrReconnectNeeded:    boolean;
  setNostrReconnectNeeded: (v: boolean) => void;

  // Nostr cross-device sync (persisted)
  lastSettingsSyncAt:    number | null;
  setLastSettingsSyncAt: (ts: number) => void;
  lastRecordsSyncAt:     number | null;
  setLastRecordsSyncAt:  (ts: number) => void;
  recordsDirty:          boolean;
  setRecordsDirty:       (v: boolean) => void;
  settingsDirty:         boolean;   // per-device publish state — persisted, never synced (not in SETTINGS_FIELDS/payload)
  setSettingsDirty:      (v: boolean) => void;
  deletedMonths:         Record<number, number>;   // month → deletedAt (Unix ms); tombstones for synced deletes
  setDeletedMonths:      (v: Record<number, number>) => void;
  hydrateSettings:      (data: Record<string, unknown>) => void;
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function publishRecordsNow(): Promise<boolean> {
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey) return false;   // publish didn't happen
  useStore.getState().setNostrSyncing(true);
  try {
    const { publishRecords } = await import('../lib/nostr/publish');
    const createdAt = await publishRecords(
      state.nostrSigner,
      state.nostrPubkey,
      { entries: state.monthlyLog, deletions: state.deletedMonths },
      state.nostrRelays.length ? state.nostrRelays : undefined,
      signerOpTimeout(state.nostrSigningMethod),
    );
    useStore.getState().setLastRecordsSyncAt(createdAt);
    useStore.getState().setRecordsDirty(false);
    useStore.getState().setNostrReconnectNeeded(false);
    nostrLog('info', 'records published');
    return true;
  } catch (e) {
    nostrLog('error', 'records publish failed', e);
    useStore.getState().setNostrReconnectNeeded(true);   // dirty stays true
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

export async function publishSettingsNow(): Promise<boolean> {
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey) return false;   // publish didn't happen
  useStore.getState().setNostrSyncing(true);
  try {
    const s = useStore.getState();
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
      cbLiquidationPrice:       s.cbLiquidationPrice,
      cbMonthlyPayment:         s.cbMonthlyPayment,
      cbPaymentStrategy:        s.cbPaymentStrategy,
      cbLtvTriggerPct:          s.cbLtvTriggerPct,
      cbLtvTargetPct:           s.cbLtvTargetPct,
      cbRotateBackPct:          s.cbRotateBackPct,
      cbLoanBalanceAsOf:        s.cbLoanBalanceAsOf,
      cbLiquidationPriceAsOf:   s.cbLiquidationPriceAsOf,
      strikeLiquidationLtvPct:  s.strikeLiquidationLtvPct,
      advisorSkipBlocDraw:      s.advisorSkipBlocDraw,
      advisorSkipCbPayment:     s.advisorSkipCbPayment,
      advisorSkipBtcBuying:     s.advisorSkipBtcBuying,
      pendingCollateralAdjustment: s.pendingCollateralAdjustment,
    };
    const { publishSettings } = await import('../lib/nostr/publish');
    const createdAt = await publishSettings(
      state.nostrSigner,
      state.nostrPubkey,
      state.nostrRelays,
      settings,
      signerOpTimeout(state.nostrSigningMethod),
    );
    useStore.getState().setLastSettingsSyncAt(createdAt);
    useStore.getState().setSettingsDirty(false);
    useStore.getState().setNostrReconnectNeeded(false);
    nostrLog('info', 'settings published');
    return true;
  } catch (e) {
    nostrLog('error', 'settings publish failed', e);   // dirty stays true → retried by syncNow
    useStore.getState().setNostrReconnectNeeded(true);
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
  income: 4000,
  expenses: 3500,
  btcPrice: 82000,
  btcPriceMode: 'live' as const,
  blocApr: 13,

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
  cbRotateBackPct:     55,
  cbLoanBalanceAsOf:      null,
  cbLiquidationPriceAsOf: null,
  strikeLiquidationLtvPct: 85,

  simpleMode:         false,
  onboardingComplete: false,
  btcBuyingUnit:      'btc',
  devMode:            false,
  expenseReanchorDismissedAt: 0,
  setSimpleMode:         (v) => { set({ simpleMode: v }); useStore.getState().syncSettingsToNostr(); },
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),
  setBtcBuyingUnit:      (v) => { set({ btcBuyingUnit: v }); useStore.getState().syncSettingsToNostr(); },
  setDevMode:            (v) => set({ devMode: v }),
  setExpenseReanchorDismissedAt: (v) => set({ expenseReanchorDismissedAt: v }),   // device-local, unsynced — no syncSettingsToNostr

  advisorStartDate:         new Date().toISOString().split('T')[0],
  advisorActualBlocBalance: 0,
  advisorActualBtcHeld:     0,
  pendingCollateralAdjustment: 0,   // default via shallow merge — no migration, store stays v11
  sandboxCollateralBtc:     null,
  setSandboxCollateralBtc:  (v) => set({ sandboxCollateralBtc: v }),
  getCurrentBtcHeld: (): number => {
    const s: StoreState = useStore.getState();
    return deriveCurrentPosition(s.monthlyLog, s.advisorActualBtcHeld, s.advisorActualBlocBalance, s.pendingCollateralAdjustment).btcHeld;
  },
  adjustCurrentCollateral: (targetTotal: number): void => {
    const delta = targetTotal - useStore.getState().getCurrentBtcHeld();
    if (delta === 0) return;
    // No recompute needed — pending is additive in the derives, so current/LTV/liq are instantly right.
    set((s) => ({ pendingCollateralAdjustment: s.pendingCollateralAdjustment + delta }));
    nostrLog('info', 'collateral adjustment recorded');   // NO amounts — the LOG ring must stay paste-safe
    useStore.getState().syncSettingsToNostr();   // pending is SYNCED state — must publish
  },
  ndpLastPaidDate:          null,

  advisorSkipBlocDraw:  false,
  advisorSkipCbPayment: false,
  advisorSkipBtcBuying: false,

  monthlyLog:      [],
  showMiningInLog: false,

  showPlanIncomeBar: true,
  showPlanStrikeBar: true,
  showPlanCbBar:     true,

  setIncome:   (v) => { set({ income: v });   useStore.getState().syncSettingsToNostr(); },
  setExpenses: (v) => { set({ expenses: v }); useStore.getState().syncSettingsToNostr(); set({ expenseReanchorDismissedAt: 0 }); },   // re-anchoring (or any expenses edit) clears the dismissal so a future drift can nudge again — single chokepoint for Update + manual edits
  setBtcPrice: (v) => set({ btcPrice: v }),
  setBtcPriceMode: (v) => set({ btcPriceMode: v }),
  setBlocApr:  (v) => { set({ blocApr: v });  useStore.getState().syncSettingsToNostr(); },

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
  setCbMonthlyPayment:   (v) => { set({ cbMonthlyPayment: v });   useStore.getState().syncSettingsToNostr(); },
  setCbLiquidationPrice: (v) => { set({ cbLiquidationPrice: v }); useStore.getState().syncSettingsToNostr(); },
  setCbPaymentStrategy:  (v) => { set({ cbPaymentStrategy: v });  useStore.getState().syncSettingsToNostr(); },
  setCbLtvTriggerPct:    (v) => { set({ cbLtvTriggerPct: v });    useStore.getState().syncSettingsToNostr(); },
  setCbLtvTargetPct:     (v) => { set({ cbLtvTargetPct: v });     useStore.getState().syncSettingsToNostr(); },
  setCbRotateBackPct:    (v) => { set({ cbRotateBackPct: v });    useStore.getState().syncSettingsToNostr(); },
  setCbLoanBalanceAsOf:      (v) => { set({ cbLoanBalanceAsOf: v });      useStore.getState().syncSettingsToNostr(); },
  setCbLiquidationPriceAsOf: (v) => { set({ cbLiquidationPriceAsOf: v }); useStore.getState().syncSettingsToNostr(); },
  setStrikeLiquidationLtvPct: (v) => { set({ strikeLiquidationLtvPct: v }); useStore.getState().syncSettingsToNostr(); },

  setAdvisorStartDate:         (v) => { set({ advisorStartDate: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorActualBlocBalance: (v) => { set({ advisorActualBlocBalance: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorActualBtcHeld:     (v) => { set({ advisorActualBtcHeld: v });    useStore.getState().syncSettingsToNostr(); },
  setNdpLastPaidDate:          (v) => { set({ ndpLastPaidDate: v }); useStore.getState().syncSettingsToNostr(); },

  setAdvisorSkipBlocDraw:  (v) => { set({ advisorSkipBlocDraw: v });  useStore.getState().syncSettingsToNostr(); },
  setAdvisorSkipCbPayment: (v) => { set({ advisorSkipCbPayment: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorSkipBtcBuying: (v) => { set({ advisorSkipBtcBuying: v }); useStore.getState().syncSettingsToNostr(); },

  setMonthlyLog:  (entries) => set({ monthlyLog: entries }),
  upsertLogEntry: (entry) => {
    let graduated = false;
    set((state) => {
      // Graduation: fold pending into the CURRENT month's entry only. Past-month edits preserve the
      // stored adjustment and never graduate. Re-editing a logged current month with pending=0 reads
      // existingAdj off the LOGGED entry — never wipes a graduated deposit. Both commit paths
      // (Simple Mode confirm + Advisor inline) land here.
      const isCurrent   = entry.month === getCurrentStrategyMonth(state.advisorStartDate);
      const existingAdj = state.monthlyLog.find((e) => e.month === entry.month)?.collateralAdjustment ?? 0;
      const collateralAdjustment = isCurrent ? existingAdj + state.pendingCollateralAdjustment : existingAdj;
      graduated = isCurrent && state.pendingCollateralAdjustment !== 0;
      const stamped = { ...entry, updatedAt: Date.now(), collateralAdjustment };
      const { [entry.month]: _gone, ...restDel } = state.deletedMonths;   // re-log clears the tombstone
      return {
        monthlyLog: recomputeBtcHeld(upsertEntry(state.monthlyLog, stamped), state.advisorActualBtcHeld),
        deletedMonths: restDel,
        recordsDirty: true,
        pendingCollateralAdjustment: isCurrent ? 0 : state.pendingCollateralAdjustment,
      };
    });
    publishRecordsNow();
    if (graduated) useStore.getState().syncSettingsToNostr();   // pending→0 must reach the relay or the other device shows inflated current
  },
  deleteLogEntry: (month) => {
    let restoredAdj = 0;
    set((state) => {
      // Un-logging the CURRENT month must NOT erase a real deposit — its adjustment returns to
      // pending and re-graduates on the next log. Past-month deletes do NOT restore (the dated
      // record is gone — consistent). Recompute fixes the surviving chain (stale-btcHeld gap).
      const isCurrent = month === getCurrentStrategyMonth(state.advisorStartDate);
      restoredAdj = isCurrent ? (state.monthlyLog.find((e) => e.month === month)?.collateralAdjustment ?? 0) : 0;
      return {
        monthlyLog: recomputeBtcHeld(state.monthlyLog.filter((e) => e.month !== month), state.advisorActualBtcHeld),
        deletedMonths: { ...state.deletedMonths, [month]: Date.now() },
        recordsDirty: true,
        pendingCollateralAdjustment: state.pendingCollateralAdjustment + restoredAdj,
      };
    });
    publishRecordsNow();
    if (restoredAdj !== 0) useStore.getState().syncSettingsToNostr();
  },
  setShowMiningInLog: (v) => set({ showMiningInLog: v }),

  // Device-local display prefs — plain set, NO syncSettingsToNostr (like devMode)
  setShowPlanIncomeBar: (v) => set({ showPlanIncomeBar: v }),
  setShowPlanStrikeBar: (v) => set({ showPlanStrikeBar: v }),
  setShowPlanCbBar:     (v) => set({ showPlanCbBar: v }),

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
  strikeBtcAvailable: null,
  strikeRate:         null,
  strikeApiConnected: false,
  strikeLastFetched:  null,
  setStrikeUsdBalance:   (v) => set({ strikeUsdBalance: v }),
  setStrikeBtcAvailable: (v) => set({ strikeBtcAvailable: v }),
  setStrikeRate:         (v) => set({ strikeRate: v }),
  setStrikeApiConnected: (v) => set({ strikeApiConnected: v }),
  setStrikeLastFetched:  (v) => set({ strikeLastFetched: v }),

  nostrAuthEnabled:   false,
  nostrPubkey:        null,
  nostrSigningMethod: null,
  nostrBunkerUri:     null,
  nostrRelays:        ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol', 'wss://relay.nostr.band'],
  nostrLogin:         null,
  writerKeyWrapped:   null,
  writerKeyWrapMeta:  null,
  setNostrAuthEnabled:   (v) => set({ nostrAuthEnabled: v }),
  setNostrPubkey:        (v) => set({ nostrPubkey: v }),
  setNostrSigningMethod: (v) => set({ nostrSigningMethod: v }),
  setNostrBunkerUri:     (v) => set({ nostrBunkerUri: v }),
  setNostrRelays:        (v) => set({ nostrRelays: v }),
  setNostrLogin:         (v) => set({ nostrLogin: v }),
  setWriterKeyWrapped:   (v) => set({ writerKeyWrapped: v }),
  setWriterKeyWrapMeta:  (v) => set({ writerKeyWrapMeta: v }),

  isAuthenticated:    false,
  setIsAuthenticated: (v) => set({ isAuthenticated: v }),

  nostrSigner:    null,
  setNostrSigner: (v) => set({ nostrSigner: v }),

  // Mark-dirty + debounce wrapper around publishSettingsNow. Dirty is set SYNCHRONOUSLY so an app
  // close mid-debounce still retries next launch (syncNow publishes-if-dirty). Accepted micro-race:
  // a setter firing DURING an in-flight publish re-marks dirty and re-schedules, so its change
  // publishes ~2s later; the only loss window is the app fully closing inside that ~2s — negligible.
  syncSettingsToNostr: () => {
    const s = useStore.getState();
    if (!s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey) return;   // pre-login edits must NOT mark dirty (would block first hydrate)
    set({ settingsDirty: true });
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => { publishSettingsNow(); }, 2000);
  },

  nostrSyncing:    false,
  setNostrSyncing: (v) => set({ nostrSyncing: v }),
  nostrReconnectNeeded:    false,
  setNostrReconnectNeeded: (v) => set({ nostrReconnectNeeded: v }),

  lastSettingsSyncAt: null,
  setLastSettingsSyncAt: (ts) => set({ lastSettingsSyncAt: ts }),
  lastRecordsSyncAt: null,
  setLastRecordsSyncAt: (ts) => set({ lastRecordsSyncAt: ts }),
  recordsDirty: false,
  setRecordsDirty: (v) => set({ recordsDirty: v }),
  settingsDirty: false,
  setSettingsDirty: (v) => set({ settingsDirty: v }),
  deletedMonths: {},
  setDeletedMonths: (v) => set({ deletedMonths: v }),

  hydrateSettings: (data) => {
    const SETTINGS_FIELDS = [
      'income', 'expenses', 'blocApr', 'creditLine',
      'advisorStartDate', 'advisorActualBlocBalance', 'advisorActualBtcHeld',
      'cbLoanBalance', 'cbCollateralBtc', 'cbAprPct', 'hasCbLoan',
      'ndpLastPaidDate', 'tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit',
      'cbLiquidationPrice', 'cbMonthlyPayment', 'cbPaymentStrategy',
      'cbLtvTriggerPct', 'cbLtvTargetPct', 'cbRotateBackPct',
      'cbLoanBalanceAsOf', 'cbLiquidationPriceAsOf', 'strikeLiquidationLtvPct',
      'advisorSkipBlocDraw', 'advisorSkipCbPayment', 'advisorSkipBtcBuying',
      'pendingCollateralAdjustment',
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
      version: 15,
      partialize: (state) => {
        const { strikeUsdBalance, strikeBtcAvailable, strikeRate, strikeApiConnected, strikeLastFetched, isAuthenticated, nostrSigner, nostrSyncing, nostrReconnectNeeded, sandboxCollateralBtc, ...rest } = state;
        return rest;
      },
      migrate: (persistedState: any) => {
        const { customCollateral, ...rest } = persistedState;
        const sorted = [...(persistedState.monthlyLog ?? [])]
          .sort((a: any, b: any) => a.month - b.month);
        const cumBought = sorted.reduce((s: number, e: any) => s + (e.btcBought ?? 0), 0);
        const month0Baseline = (persistedState.advisorActualBtcHeld ?? customCollateral ?? 0) - cumBought;
        let running = month0Baseline;
        for (const e of sorted) {
          running += (e.btcBought ?? 0);
          if (e.btcHeld == null) e.btcHeld = running;
        }
        for (const e of sorted) {
          if (e.expensesActual == null) e.expensesActual = persistedState.expenses ?? 0;
        }
        return {
          ...rest,
          advisorActualBtcHeld: month0Baseline,
          monthlyLog:           sorted,
          cbPaymentStrategy:    persistedState.cbPaymentStrategy ?? 'monthly',
          cbLtvTriggerPct:      persistedState.cbLtvTriggerPct  ?? 75,
          cbLtvTargetPct:       persistedState.cbLtvTargetPct   ?? 65,
          cbRotateBackPct:      persistedState.cbRotateBackPct  ?? 55,
          cbLoanBalanceAsOf:      persistedState.cbLoanBalanceAsOf      ?? null,
          cbLiquidationPriceAsOf: persistedState.cbLiquidationPriceAsOf ?? null,
          strikeLiquidationLtvPct: persistedState.strikeLiquidationLtvPct ?? 85,
          btcPriceMode:         persistedState.btcPriceMode     ?? 'live',
          lastRecordsSyncAt:    persistedState.lastRecordsSyncAt  ?? null,
          nostrLogin:           persistedState.nostrLogin         ?? null,
          showPlanIncomeBar:    persistedState.showPlanIncomeBar ?? true,
          showPlanStrikeBar:    persistedState.showPlanStrikeBar ?? true,
          showPlanCbBar:        persistedState.showPlanCbBar     ?? true,
          writerKeyWrapped:     persistedState.writerKeyWrapped  ?? null,   // v15 — device-local, never synced
          writerKeyWrapMeta:    persistedState.writerKeyWrapMeta ?? null,   // v15
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.miningInputs?.devices) {
          state.miningInputs.devices = state.miningInputs.devices.map((d) => ({
            ...d,
            poolName:   d.poolName   ?? '',
            poolFee:    d.poolFee     ?? 2.0,
            soloMining: d.soloMining ?? false,
          }));
        }
      },
    }
  )
);
