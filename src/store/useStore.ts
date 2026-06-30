import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry, DayEvent } from '../simulation/types';
import { upsertEntry, recomputeBtcHeld, deriveCurrentPosition, bucketEventToMonth, rollupMonth, deriveCbCollateral } from '../simulation/logUtils';
import { getCurrentStrategyMonth } from '../simulation/runAdvisor';   // pure, zero imports — no circular dep
import { signerOpTimeout } from '../lib/nostr/timeout';
import { nostrLog } from '../lib/nostr/log';
import { DEFAULT_RELAYS, importNip65RelayList } from '../lib/nostr/relays';   // single source for the default relay list (pure leaf — no cycle)
import { encryptedStorage } from '../lib/store/storeCrypto';   // 3a.2: at-rest encryption adapter (flag-gated)
import type { WrapMeta } from '../lib/nostr/keyVault';
import type { NostrSigner } from '@nostrify/nostrify';

export type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry };

// At-rest store encryption — standalone localStorage flag, read once at module load. Lives OUTSIDE the persisted
// store blob (you can't read a setting stored inside the thing it gates). Persist is FLAG-CONDITIONAL since 3a.2:
// flag on → the encrypted `encryptedStorage` adapter; flag off (default) → plain `window.localStorage` (see the
// `storage` config below). Manual flag only until the 3a.5 opt-in.
export const storeEncEnabled = (() => {
  try { return localStorage.getItem('personal-bloc-store-enc-enabled') === '1'; } catch { return false; }
})();

// The wrap credential (writerKeyWrapped/writerKeyWrapMeta) is the KEY THAT UNLOCKS the encrypted store blob, so it
// must persist OUTSIDE that blob (else it's locked inside the box it opens — the circular-dependency bug). Persist
// it in standalone localStorage keys; the store fields below are seeded from / written through to these.
const WK_WRAPPED_KEY = 'personal-bloc-writer-key-wrapped';
const WK_META_KEY    = 'personal-bloc-writer-key-meta';

// Seed from the standalone keys. ONE-TIME back-fill from the legacy in-blob location for existing users (their blob
// is plaintext — the bug blocked enabling encryption; an already-encrypted blob can't be read here, but then the
// standalone key would already exist). Runs at module init (before persist hydration), unconditionally — NOT in
// migrate(), which only runs on a version change and so would never fire for existing version-18 users.
const { wkWrapped: seedWriterKeyWrapped, wkMeta: seedWriterKeyWrapMeta } = (() => {
  let wrapped: string | null = null;
  let meta: WrapMeta | null = null;
  try {
    wrapped = localStorage.getItem(WK_WRAPPED_KEY);
    const ms = localStorage.getItem(WK_META_KEY);
    meta = ms ? (JSON.parse(ms) as WrapMeta) : null;
    if (wrapped == null && meta == null) {
      const raw = localStorage.getItem('personal-bloc-store');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.ct == null && o.iv == null) {   // plaintext blob ONLY
          const st = o.state ?? {};
          if (st.writerKeyWrapped) { wrapped = String(st.writerKeyWrapped); localStorage.setItem(WK_WRAPPED_KEY, wrapped); }
          if (st.writerKeyWrapMeta) { meta = st.writerKeyWrapMeta as WrapMeta; localStorage.setItem(WK_META_KEY, JSON.stringify(meta)); }
        }
      }
    }
  } catch { /* noop */ }
  return { wkWrapped: wrapped, wkMeta: meta };
})();

// Gate-condition fields needed to render the unlock gate on an ENCRYPTED cold start — they decide whether to show
// LocalUnlockGate, so (like the wrap credential above) they must live OUTSIDE the encrypted blob, else they're
// locked inside the box the gate would open (the 3a.4 cold-start deadlock: encrypted blob → getItem null → seeds →
// onboarding shows instead of the gate). Standalone localStorage; the store fields are seeded from / written through
// to these. KEPT in the blob too (redundant — serves the plaintext/flag-off path); the standalone copy bootstraps
// the gate on encrypted cold start.
const GATE_ONBOARDED_KEY = 'personal-bloc-onboarded';
const GATE_AUTH_KEY      = 'personal-bloc-nostr-auth';       // 'nostrAuthEnabled'
const GATE_METHOD_KEY    = 'personal-bloc-nostr-method';     // 'nostrSigningMethod'
const GATE_PUBKEY_KEY    = 'personal-bloc-nostr-pubkey';     // 'nostrPubkey'

const {
  gOnboarded: seedOnboardingComplete,
  gAuth:      seedNostrAuthEnabled,
  gMethod:    seedNostrSigningMethod,
  gPubkey:    seedNostrPubkey,
} = (() => {
  let onboarded = false;
  let method: 'nip07' | 'nip46' | 'local' | null = null;
  let pubkey: string | null = null;
  try {
    onboarded = localStorage.getItem(GATE_ONBOARDED_KEY) === '1';
    const m   = localStorage.getItem(GATE_METHOD_KEY);
    method    = (m === 'nip07' || m === 'nip46' || m === 'local') ? m : null;
    pubkey    = localStorage.getItem(GATE_PUBKEY_KEY);
    // ONE-TIME back-fill from a PLAINTEXT blob for existing users (same approach as the WK_* back-fill). An
    // already-encrypted blob can't be read here — but then these standalone keys were written on a prior run.
    if (!onboarded && method == null && pubkey == null) {
      const raw = localStorage.getItem('personal-bloc-store');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.ct == null && o.iv == null) {   // plaintext blob ONLY
          const st = o.state ?? {};
          if (st.onboardingComplete) { onboarded = true; localStorage.setItem(GATE_ONBOARDED_KEY, '1'); }
          if (st.nostrSigningMethod) { method = st.nostrSigningMethod; localStorage.setItem(GATE_METHOD_KEY, String(st.nostrSigningMethod)); }
          if (st.nostrPubkey)        { pubkey = String(st.nostrPubkey); localStorage.setItem(GATE_PUBKEY_KEY, pubkey); }
        }
      }
    }
    // B1: nostrAuthEnabled is DERIVED from pubkey presence — mirror GATE_AUTH_KEY to GATE_PUBKEY_KEY so the 3a.4
    // encrypted-cold-start gate still fires (GATE_AUTH_KEY present whenever GATE_PUBKEY_KEY is) AND any legacy
    // desync (the half-state: auth flag out of step with pubkey) self-heals on launch.
    if (pubkey) localStorage.setItem(GATE_AUTH_KEY, '1'); else localStorage.removeItem(GATE_AUTH_KEY);
  } catch { /* noop */ }
  return { gOnboarded: onboarded, gAuth: !!pubkey, gMethod: method, gPubkey: pubkey };
})();

/**
 * Gate hydrated identity on the standalone GATE_PUBKEY_KEY — the SYNCHRONOUS source of truth that disconnect clears
 * before reload(). The persisted blob is racy: disconnect's setters clear it but the persist write may not land
 * before the synchronous reload, leaving a stale `nostrPubkey` that (under the B1 pin) resurrects auth. Gating the
 * hydrate on the GATE key makes sign-out authoritative. Applied in the persist `merge` so it runs on EVERY rehydrate
 * (unlike migrate(), which fires only on a version bump — useStore.ts module note above). Pure (gatePubkey passed in)
 * so it's unit-testable without localStorage. Only the 3 identity fields are touched; all other persisted data passes
 * through untouched. BOTH identity fields (pubkey AND method) are gated on the live GATE keys — the racy blob is
 * never authoritative for identity (a stale blob `nostrSigningMethod` would point at the wrong signer → timeouts).
 */
export function gateHydratedIdentity(persisted: any, gatePubkey: string | null, gateMethod: string | null) {
  if (!gatePubkey) {
    return { ...persisted, nostrPubkey: null, nostrSigningMethod: null, nostrAuthEnabled: false };
  }
  return {
    ...persisted,
    nostrPubkey: persisted?.nostrPubkey ?? gatePubkey,
    nostrSigningMethod: gateMethod ?? persisted?.nostrSigningMethod ?? null,   // LIVE GATE_METHOD_KEY authoritative; blob fallback (fixes local-login hydrating stale nip46)
    nostrAuthEnabled: true,   // pin: GATE affirms identity
  };
}

type Tier = 'min' | 'rec' | 'ideal' | 'custom';
type Scenario = 'conservative' | 'moderate' | 'historical';
type ActiveTab = 'living' | 'bloc' | 'powerlaw' | 'converter' | 'mining' | 'coinbase' | 'advisor' | 'liqsim' | 'almanac' | 'settings';
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

export interface StoreState {
  // Shared inputs
  income: number;
  expenses: number;
  btcPrice: number;
  btcPriceMode: 'live' | 'manual';
  btcPriceUpdatedAt: number | null;   // ms of last setBtcPrice; per-device, NOT synced (DevPanel staleness diagnostic)
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
  advisorActualBlocBalance: number;   // LIVE drawn BLOC balance right now (CURRENT box, Advisor, SafetyDashboard, NDP)
  advisorMonthStartBalance: number;   // BLOC balance at the START of the current month — projection base ONLY (deriveAdvisorStart month-1)
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
  confirmMonth:       (month: number) => void;   // Daily Mode P2a — mark a month's entry confirmed:true
  setShowMiningInLog: (v: boolean) => void;

  // Daily Mode P2a — granular daily journal (LOCAL-only this phase; records sync is P3) + the CB-LTV action pref
  dayLog:        DayEvent[];
  cbLtvAction:   'paydown' | 'addCollateral';
  addDayEvent:    (event: DayEvent) => void;
  updateDayEvent: (event: DayEvent) => void;
  deleteDayEvent: (id: string) => void;
  setDayLog:      (events: DayEvent[]) => void;   // P3 — raw write-back from records merge; folds the Seam-2 cbCollateralBtc derive
  setCbLtvAction: (v: 'paydown' | 'addCollateral') => void;

  // Simple Mode plan-card status bars — device-local display prefs (NOT synced, like devMode)
  showPlanIncomeBar:    boolean;
  showPlanStrikeBar:    boolean;
  showPlanCbBar:        boolean;
  setShowPlanIncomeBar: (v: boolean) => void;
  setShowPlanStrikeBar: (v: boolean) => void;
  setShowPlanCbBar:     (v: boolean) => void;

  // Consumer-shell view (Monthly Playbook vs Daily journal) — device-local UI pref (NOT synced, like devMode)
  simpleView:    'monthly' | 'daily';
  setSimpleView: (v: 'monthly' | 'daily') => void;

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
  setAdvisorMonthStartBalance: (v: number)    => void;
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
  // Viewer access (Phase 1, writer-side) — the provisioned viewer's npub/hex pubkey + the owner's nickname for
  // them. SYNCED in the OWNER's own settings:v1 (so viewer config + removal propagate across the owner's devices)
  // but STRIPPED from the viewer snapshot (the viewer must never learn who else the owner shares with, nor the
  // owner's private nickname for them). Public npubs — no secret leak. Gates publishViewerSnapshotNow.
  viewerNpub:         string | null;
  viewerPubkey:       string | null;      // hex — NIP-44 encrypt target for the viewer snapshot
  viewerLabel:        string | null;      // owner-assigned nickname for the viewer (e.g. "Dad's iPhone")
  // Viewer access (Phase 2, viewer-side / READ-ONLY) — device-local, NEVER synced. This install is a read-only
  // viewer of the writer at viewerWriterPubkey, decrypting the viewer:v1 snapshot with viewerSecretKey.
  // ⚠ Phase 2 stores viewerSecretKey as PLAINTEXT hex — Phase 3 will passkey/keyVault-wrap it.
  viewerMode:          boolean;
  viewerWriterPubkey:  string | null;     // hex — the OWNER/writer whose snapshot this viewer follows
  viewerSecretKey:     string | null;     // hex — this viewer's own nsec. PLAINTEXT only as a v17-migrant holder
                                          // (Phase 2); Phase 3 wraps it at rest (viewerKeyWrapped) and clears this.
  // Viewer access (Phase 3) — the viewer key WRAPPED at rest (keyVault AES-GCM, Face-ID-PRF / PIN). Device-local,
  // NEVER synced. The unwrapped bytes live ONLY in viewerSync's in-memory holder — never in serializable state.
  viewerKeyWrapped:    string | null;     // AES-GCM ciphertext (base64) of the viewer nsec
  viewerKeyWrapMeta:   WrapMeta | null;   // { iv, scheme, credentialId?, salt }
  setNostrAuthEnabled:   (v: boolean) => void;
  setNostrPubkey:        (v: string | null) => void;
  setNostrSigningMethod: (v: 'nip07' | 'nip46' | 'local' | null) => void;
  setNostrBunkerUri:     (v: string | null) => void;
  setNostrRelays:        (v: string[]) => void;
  setNostrRelaysAndSync: (v: string[]) => void;   // user-edit path: set + mark dirty + publish
  setNostrLogin:         (v: string | null) => void;
  setWriterKeyWrapped:   (v: string | null) => void;
  setWriterKeyWrapMeta:  (v: WrapMeta | null) => void;
  setViewerNpub:         (v: string | null) => void;
  setViewerPubkey:       (v: string | null) => void;
  setViewerLabel:        (v: string | null) => void;
  setViewerMode:         (v: boolean) => void;
  setViewerWriterPubkey: (v: string | null) => void;
  setViewerSecretKey:    (v: string | null) => void;
  setViewerKeyWrapped:   (v: string | null) => void;
  setViewerKeyWrapMeta:  (v: WrapMeta | null) => void;
  // Transient (NOT persisted) — true once viewerSync's in-memory key holder is populated (post-unlock /
  // post-provision). AppShell gates the unlock screen on this (it can't read viewerSync's module var).
  viewerUnlocked:        boolean;
  setViewerUnlocked:     (v: boolean) => void;
  // Transient (NOT persisted) — true only after a VALID viewer snapshot decrypt+hydrate. AppShell gates the
  // viewer render on this so stale persisted data never shows for a key that can't decrypt the snapshot.
  viewerDataLoaded:      boolean;
  setViewerDataLoaded:   (v: boolean) => void;
  // Transient (NOT persisted) — true once the in-memory store-encryption key holder (storeCrypto) is populated.
  // AppShell gates AppUnlockGate on this. Mirrors viewerUnlocked.
  storeUnlocked:         boolean;
  setStoreUnlocked:      (v: boolean) => void;
  // Wipe every viewer-hydrated financial field back to its seed (data-remanence fix). VIEWER paths ONLY —
  // never the owner's Remove or any owner edit (it would destroy the owner's real data). Pure local set (no sync).
  clearViewerData:       () => void;
  // Escape-hatch recovery: reset the OWNER's plan/records/strike fields to seeds (pure local set, NO publish).
  // Reachable ONLY from resetAndResync (escapeHatch.ts), which immediately pulls from relays to repopulate.
  resetPlanToSeeds:      () => void;

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
  deletedDayEvents:      Record<string, number>;   // P3 — event id → deletedAt (Unix ms); tombstones for synced dayLog deletes (persisted-not-synced, like deletedMonths; 90-day GC in merge)
  setDeletedDayEvents:   (v: Record<string, number>) => void;
  hydrateSettings:      (data: Record<string, unknown>) => void;
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function publishRecordsNow(): Promise<boolean> {
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || state.viewerMode) return false;   // publish didn't happen (incl. read-only viewer — relay-side backstop)
  useStore.getState().setNostrSyncing(true);
  try {
    const { publishRecords } = await import('../lib/nostr/publish');
    const createdAt = await publishRecords(
      state.nostrSigner,
      state.nostrPubkey,
      { entries: state.monthlyLog, deletions: state.deletedMonths, dayLog: state.dayLog, dayLogDeletions: state.deletedDayEvents },
      state.nostrRelays.length ? state.nostrRelays : undefined,
      signerOpTimeout(state.nostrSigningMethod),
    );
    useStore.getState().setLastRecordsSyncAt(createdAt);
    useStore.getState().setRecordsDirty(false);
    useStore.getState().setNostrReconnectNeeded(false);
    nostrLog('info', 'records published');
    void publishViewerSnapshotNow();   // fire-and-forget; never affects the owner's own sync result
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
    const settings = buildSettingsPayload(useStore.getState());
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
    void publishViewerSnapshotNow();   // fire-and-forget; never affects the owner's own sync result
    return true;
  } catch (e) {
    nostrLog('error', 'settings publish failed', e);   // dirty stays true → retried by syncNow
    useStore.getState().setNostrReconnectNeeded(true);
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

// Network subpage P2 — NIP-65 relay-list sync. Import READS the user's kind-10002 and replaces the local relay list
// ONLY when a real list is found (the discriminated {found} result keeps an absent/empty list from clobbering the
// current one). Publish WRITES the local list as a PLAIN kind-10002 (never encrypted). Both are out-of-band one-offs:
// they don't touch settingsDirty/recordsDirty/nostrReconnectNeeded — only nostrSyncing for the loading dot.
export async function importRelaysFromNip65(): Promise<{ found: boolean; count: number; empty: boolean }> {
  const state = useStore.getState();
  if (!state.nostrPubkey) return { found: false, count: 0, empty: false };
  try {
    const res = await importNip65RelayList(state.nostrPubkey);
    if (res.found && res.relays.length) {
      useStore.getState().setNostrRelaysAndSync(res.relays);   // deliberate user import → publish (receiver guard protects a defaults-y list)
      return { found: true, count: res.relays.length, empty: false };
    }
    if (res.found) return { found: true, count: 0, empty: true };   // empty → do NOT touch relays
    return { found: false, count: 0, empty: false };                // not-found → do NOT touch relays
  } catch (e) {
    nostrLog('error', 'relay import failed', e);
    return { found: false, count: 0, empty: false };
  }
}

export async function publishRelayListToNip65(): Promise<boolean> {
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey) return false;
  useStore.getState().setNostrSyncing(true);
  try {
    const { publishRelayListNip65 } = await import('../lib/nostr/publish');
    await publishRelayListNip65(
      state.nostrSigner,
      state.nostrPubkey,
      state.nostrRelays,
      [...new Set([...state.nostrRelays, ...DEFAULT_RELAYS])],   // reach well-known relays too
      signerOpTimeout(state.nostrSigningMethod),
    );
    nostrLog('info', 'relay list published (nip-65)');
    return true;
  } catch (e) {
    nostrLog('error', 'relay list publish failed', e);
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

// THE settings payload — single source built from current state, consumed by BOTH publishSettingsNow AND the
// viewer snapshot so the two can never drift. The owner's writer-side viewer config (viewerNpub/viewerPubkey/
// viewerLabel) IS carried here (syncs across the owner's devices) but is STRIPPED from the viewer snapshot below.
export function buildSettingsPayload(s: StoreState): Record<string, unknown> {
  return {
    income:                   s.income,
    expenses:                 s.expenses,
    blocApr:                  s.blocApr,
    creditLine:               s.creditLine,
    advisorStartDate:         s.advisorStartDate,
    advisorActualBlocBalance: s.advisorActualBlocBalance,
    advisorMonthStartBalance: s.advisorMonthStartBalance,
    advisorActualBtcHeld:     s.advisorActualBtcHeld,
    cbLoanBalance:            s.cbLoanBalance,
    // cbCollateralBtc REMOVED from settings sync (Daily Mode P2a, Seam 2) — it's now a LOCAL derived cache
    // (deriveCbCollateral over dayLog). Cross-device sync is intentionally SUSPENDED P2a→P3 (re-established when
    // dayLog rides the records event in P3).
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
    nostrRelays:              s.nostrRelays,   // C: relay list syncs across the owner's devices (guarded on hydrate; stripped from the viewer snapshot)
    // Writer-side viewer config — synced in the OWNER's settings:v1 only; STRIPPED from the viewer snapshot below.
    viewerNpub:               s.viewerNpub,
    viewerPubkey:             s.viewerPubkey,
    viewerLabel:              s.viewerLabel,
  };
}

// Combined viewer snapshot (Option B): the same settings payload + records + live Strike balances.
export function buildViewerSnapshotPayload(s: StoreState): import('../lib/nostr/publish').ViewerSnapshot {
  return {
    // STRIP the owner's sharing config (viewerNpub/viewerPubkey/viewerLabel) — the viewer must never see who else
    // the owner shares with, nor the owner's nickname for them. buildSettingsPayload stays the single owner source.
    settings: (() => { const { viewerNpub: _n, viewerPubkey: _p, viewerLabel: _l, nostrRelays: _r, ...rest } = buildSettingsPayload(s); return rest; })(),   // also strip nostrRelays — the owner's transport config, not for viewers
    records:  { entries: s.monthlyLog, deletions: s.deletedMonths },   // the viewer gets the rolled-up months, NOT the raw dayLog journal
    strike:   { usd: s.strikeUsdBalance, btcAvail: s.strikeBtcAvailable, rate: s.strikeRate },
    cbCollateralBtc: deriveCbCollateral(s.dayLog, s.cbCollateralBtc),   // P3 (BUG2) — the derived scalar; the viewer raw-sets it (applyViewerEvent), never via setCbCollateralBtc
  };
}

// Fire-and-forget viewer snapshot — gated on a viewer being set; log-only on failure. MUST NOT touch
// recordsDirty/settingsDirty/nostrReconnectNeeded/nostrSyncing — the owner's own sync result is independent.
export async function publishViewerSnapshotNow(): Promise<void> {
  const s = useStore.getState();
  if (!s.viewerPubkey || !s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey) return;
  try {
    const { publishViewerSnapshot } = await import('../lib/nostr/publish');
    await publishViewerSnapshot(
      s.nostrSigner,
      s.viewerPubkey,
      buildViewerSnapshotPayload(s),
      s.nostrRelays.length ? s.nostrRelays : undefined,
      signerOpTimeout(s.nostrSigningMethod),
    );
    nostrLog('info', 'viewer snapshot published');
  } catch (e) {
    nostrLog('warn', 'viewer snapshot failed', e);
  }
}

// Real-time revocation: seal a TOMBSTONE (empty payload + revoked:true) to the current viewer so their next
// live event / reconnect wipes the hydrated data and drops them to ViewerWaitingGate. Call BEFORE clearing
// viewerPubkey — the gate reads getState().viewerPubkey synchronously at call start. Fire-and-forget, log-only.
export async function publishViewerRevocationNow(): Promise<void> {
  const s = useStore.getState();
  if (!s.viewerPubkey || !s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey) return;
  try {
    const { publishViewerSnapshot } = await import('../lib/nostr/publish');
    await publishViewerSnapshot(
      s.nostrSigner,
      s.viewerPubkey,
      { settings: {}, records: { entries: [], deletions: {} }, strike: { usd: null, btcAvail: null, rate: null }, revoked: true },
      s.nostrRelays.length ? s.nostrRelays : undefined,
      signerOpTimeout(s.nostrSigningMethod),
    );
    nostrLog('info', 'viewer revocation published');
  } catch (e) {
    nostrLog('warn', 'viewer revocation failed', e);
  }
}

// --- Daily Mode P2a routing helpers (module-level; use useStore.getState()/setState like the publish* fns) ---

// ISO first-day of a strategy month (month 1 = advisorStartDate's month).
function strategyMonthDate(advisorStartDate: string, month: number): string {
  const d = new Date(advisorStartDate);
  d.setMonth(d.getMonth() + (month - 1));
  return d.toISOString().split('T')[0];
}

// Seam 2 clock: refresh the derived cbCollateralBtc cache from the current dayLog (cheap, idempotent).
function refreshCbCollateralCache(): void {
  const s = useStore.getState();
  useStore.setState({ cbCollateralBtc: deriveCbCollateral(s.dayLog, s.cbCollateralBtc) });
}

// A day event is "monthly-meaningful" if it can affect a monthlyLog entry. cbCollateralReading is clock-only, and a
// deposit/withdraw with target:'cb' is journal-only (CB collateral comes from the reading) — neither triggers a re-roll
// or keeps a month alive. Shared by monthOf + rerollMonth so the two can't drift (BUG1 class — a cb-only event must
// never flip a month to source:'daily').
function isMonthlyMeaningful(ev: DayEvent): boolean {
  if (ev.kind === 'cbCollateralReading') return false;
  if ((ev.kind === 'deposit' || ev.kind === 'withdraw') && ev.target === 'cb') return false;
  return true;
}

// Re-roll ONE strategy month from the current dayLog → Partial→Full bridge → upsertLogEntry → Seam 1 collateral.
// Only monthly-meaningful events count (cbCollateralReading + target:'cb' moves are journal-only — never create/flip).
function rerollMonth(month: number): void {
  const s = useStore.getState();
  const start = s.advisorStartDate;
  const monthlyEvents = s.dayLog.filter((e) => isMonthlyMeaningful(e) && bucketEventToMonth(e.date, start) === month);
  const existing = s.monthlyLog.find((e) => e.month === month);

  if (monthlyEvents.length === 0) {
    // Emptied daily month → remove the stale rolled-up entry (only if it was daily-owned).
    if (existing && existing.source === 'daily') useStore.getState().deleteLogEntry(month);
    return;
  }

  // priorStocks = the prior strategy-month's LAST balanceReading by ts.
  const priorReadings = s.dayLog
    .filter((e): e is Extract<DayEvent, { kind: 'balanceReading' }> =>
      e.kind === 'balanceReading' && bucketEventToMonth(e.date, start) === month - 1)
    .sort((a, b) => a.ts - b.ts);
  const pr = priorReadings.length ? priorReadings[priorReadings.length - 1].reading : undefined;
  const priorStocks = pr
    ? { strikeBal: pr.strikeBal, strikeLtv: pr.strikeLtv, cbBal: pr.cbBal, cbLtv: pr.cbLtv, cbCollateral: pr.cbCollateral }
    : undefined;

  const { entry: rollupEntry, collateralDelta } = rollupMonth(s.dayLog, month, start, priorStocks);

  // Partial→Full bridge: spread the rollup onto the EXISTING month (preserve miningSats/ndpPaid/loggedAt), or onto a
  // full numeric seed for a NEW month (NEVER onto {} — would leave required fields undefined). recomputeBtcHeld (inside
  // upsertLogEntry) fixes the btcHeld:0 placeholder.
  const base: MonthlyLogEntry = existing ?? {
    month,
    date:           strategyMonthDate(start, month),
    btcBought:      0,
    income:         0,
    paydown:        0,
    strikeBal:      0,
    strikeLtv:      0,
    loggedAt:       monthlyEvents.reduce((mx, e) => Math.max(mx, e.ts), 0) || Date.now(),
    btcHeld:        0,
    expensesActual: 0,
  };
  const confirmed = base.confirmed === true ? false : (base.confirmed ?? false);   // reopen-on-edit (LD4); new = false
  useStore.getState().upsertLogEntry({ ...base, ...rollupEntry, source: 'daily', confirmed });

  // SEAM 1 — AFTER upsert (which graduated any prior pending into this month's collateralAdjustment). Feed the WHOLE
  // month's net target:'strike' BTC as an absolute target, subtracting the already-graduated existingAdj so earlier
  // same-month deposits aren't counted twice. Only when there's a target:'strike' move (collateralDelta !== 0).
  if (collateralDelta !== 0) {
    const existingAdj = useStore.getState().monthlyLog.find((e) => e.month === month)?.collateralAdjustment ?? 0;
    useStore.getState().adjustCurrentCollateral(useStore.getState().getCurrentBtcHeld() - existingAdj + collateralDelta);
  }
}

// The strategy month a monthly-meaningful event affects (clock-only / journal-only events → null, no re-roll).
function monthOf(ev: DayEvent | undefined): number | null {
  if (!ev || !isMonthlyMeaningful(ev)) return null;
  return bucketEventToMonth(ev.date, useStore.getState().advisorStartDate);
}

// Persist partialize — exported so it's unit-testable (the persist API isn't available under Node where persistence
// self-disables). In-memory + transient fields are omitted; everything else (incl. dayLog/cbLtvAction) persists.
export function partializeState(state: StoreState) {
  const { strikeUsdBalance, strikeBtcAvailable, strikeRate, strikeApiConnected, strikeLastFetched, isAuthenticated, nostrSigner, nostrSyncing, nostrReconnectNeeded, sandboxCollateralBtc, viewerUnlocked, viewerDataLoaded, storeUnlocked, writerKeyWrapped, writerKeyWrapMeta, activeTab, ...rest } = state;
  return rest;
}

// Persist migrate — exported so it's unit-testable (same reason as partializeState).
export function migrateState(persistedState: any): any {
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
  // v19 (Daily Mode P2a): backfill source/confirmed on legacy entries (undefined → manual/confirmed).
  for (const e of sorted) {
    if (e.source == null)    e.source = 'manual';
    if (e.confirmed == null) e.confirmed = true;
  }
  // v19: dayLog (LOCAL-only) + cbLtvAction. C2 seed — a hasCbLoan user with a cbCollateralBtc gets ONE
  // cbCollateralReading so deriveCbCollateral reproduces the pre-migration value (else the derive starts empty).
  const migratedDayLog: any[] = persistedState.dayLog ?? [];
  if (migratedDayLog.length === 0 && persistedState.hasCbLoan && persistedState.cbCollateralBtc != null) {
    migratedDayLog.push({
      id: `cbcoll-migrate-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      ts: Date.now(),
      kind: 'cbCollateralReading',
      cbCollateral: persistedState.cbCollateralBtc,
    });
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
    // Now standalone-backed (excluded from the blob). Legacy in-blob value wins for back-compat, else the
    // standalone seed — NEVER null-clobber a future migration where the field is absent from the blob.
    writerKeyWrapped:     persistedState.writerKeyWrapped  ?? seedWriterKeyWrapped,
    writerKeyWrapMeta:    persistedState.writerKeyWrapMeta ?? seedWriterKeyWrapMeta,
    // 3a.4: gate-condition fields — kept in the blob, but fall back to the standalone seed so a version bump
    // never loses them (booleans use ?? so a stored `false` is preserved).
    onboardingComplete:   persistedState.onboardingComplete   ?? seedOnboardingComplete,
    // B1 + disconnect-signout: gate identity on the GATE key (seedNostrPubkey) here too — belt-and-suspenders
    // for an ACTUAL version bump (the persist `merge` above is the real fix for same-version reloads).
    nostrAuthEnabled:     !!seedNostrPubkey,   // pin: derived; gated by the GATE key
    nostrSigningMethod:   seedNostrPubkey ? (seedNostrSigningMethod ?? persistedState.nostrSigningMethod) : null,   // GATE-first (consistent with merge); blob fallback
    nostrPubkey:          seedNostrPubkey ? (persistedState.nostrPubkey ?? seedNostrPubkey) : null,
    // Viewer access (Phase 1, writer-side) — SYNCED in the owner's settings:v1 (stripped from the viewer
    // snapshot). Additive nullable defaults, no version bump.
    viewerNpub:           persistedState.viewerNpub   ?? null,
    viewerPubkey:         persistedState.viewerPubkey ?? null,
    viewerLabel:          persistedState.viewerLabel  ?? null,
    // Viewer access (Phase 2, viewer-side) — v17, device-local, never synced.
    viewerMode:           persistedState.viewerMode          ?? false,
    viewerWriterPubkey:   persistedState.viewerWriterPubkey  ?? null,
    // v17 migrant: LEAVE any plaintext viewerSecretKey in place (wrapping needs a Face ID gesture,
    // impossible here; the one-time wrap-setup screen clears it later).
    viewerSecretKey:      persistedState.viewerSecretKey     ?? null,
    // Viewer access (Phase 3) — v18, wrapped-at-rest key. Device-local, never synced.
    viewerKeyWrapped:     persistedState.viewerKeyWrapped    ?? null,
    viewerKeyWrapMeta:    persistedState.viewerKeyWrapMeta   ?? null,
    // v16 — mid-month installs seed start-of-month from the current live balance; fresh = 0
    advisorMonthStartBalance: persistedState.advisorMonthStartBalance ?? persistedState.advisorActualBlocBalance ?? 0,
    // v19 — Daily Mode P2a: dayLog (LOCAL-only) + cbLtvAction; cbCollateralBtc becomes a derived cache.
    dayLog:               migratedDayLog,
    cbLtvAction:          persistedState.cbLtvAction ?? 'paydown',
    cbCollateralBtc:      deriveCbCollateral(migratedDayLog as DayEvent[], persistedState.cbCollateralBtc),
  };
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
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
  onboardingComplete: seedOnboardingComplete,   // 3a.4: standalone-seeded (false on fresh install = today's default)
  btcBuyingUnit:      'btc',
  devMode:            false,
  expenseReanchorDismissedAt: 0,
  setSimpleMode:         (v) => { set({ simpleMode: v }); useStore.getState().syncSettingsToNostr(); },
  // 3a.4: write through to the standalone GATE_* key (outside the encrypted blob) so the unlock gate can bootstrap
  // on an encrypted cold start. Mirrors setWriterKeyWrapped.
  setOnboardingComplete: (v) => { try { v ? localStorage.setItem(GATE_ONBOARDED_KEY, '1') : localStorage.removeItem(GATE_ONBOARDED_KEY); } catch { /* noop */ } set({ onboardingComplete: v }); },
  setBtcBuyingUnit:      (v) => { set({ btcBuyingUnit: v }); useStore.getState().syncSettingsToNostr(); },
  setDevMode:            (v) => set({ devMode: v }),
  setExpenseReanchorDismissedAt: (v) => set({ expenseReanchorDismissedAt: v }),   // device-local, unsynced — no syncSettingsToNostr

  advisorStartDate:         new Date().toISOString().split('T')[0],
  advisorActualBlocBalance: 0,
  advisorMonthStartBalance: 0,
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

  // Daily Mode P2a
  dayLog:      [],
  cbLtvAction: 'paydown',

  showPlanIncomeBar: true,
  showPlanStrikeBar: true,
  showPlanCbBar:     true,

  // Default to the Daily view; the custom merge fills this for existing users (no version bump).
  simpleView: 'daily',

  setIncome:   (v) => { set({ income: v });   useStore.getState().syncSettingsToNostr(); },
  setExpenses: (v) => { set({ expenses: v }); useStore.getState().syncSettingsToNostr(); set({ expenseReanchorDismissedAt: 0 }); },   // re-anchoring (or any expenses edit) clears the dismissal so a future drift can nudge again — single chokepoint for Update + manual edits
  setBtcPrice: (v) => set({ btcPrice: v, btcPriceUpdatedAt: Date.now() }),
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
  setCbCollateralBtc:  (v) => {
    // Daily Mode P2a Seam 2: emit a cbCollateralReading (clock-only — feeds the derived cache via deriveCbCollateral)
    // instead of syncing the field. NO syncSettingsToNostr — cross-device sync rides the RECORDS event now (P3): the
    // cbCollateralReading is part of dayLog, and addDayEvent (Change 3) publishes records. addDayEvent's clock refresh
    // sets cbCollateralBtc to v (latest-ts event); set explicitly too.
    const id = globalThis.crypto?.randomUUID?.() ?? `cbcoll-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    useStore.getState().addDayEvent({ id, date: new Date().toISOString().split('T')[0], ts: Date.now(), kind: 'cbCollateralReading', cbCollateral: v });
    set({ cbCollateralBtc: v });
  },
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
  setAdvisorMonthStartBalance: (v) => { set({ advisorMonthStartBalance: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorActualBtcHeld:     (v) => { set({ advisorActualBtcHeld: v });    useStore.getState().syncSettingsToNostr(); },
  setNdpLastPaidDate:          (v) => { set({ ndpLastPaidDate: v }); useStore.getState().syncSettingsToNostr(); },

  setAdvisorSkipBlocDraw:  (v) => { set({ advisorSkipBlocDraw: v });  useStore.getState().syncSettingsToNostr(); },
  setAdvisorSkipCbPayment: (v) => { set({ advisorSkipCbPayment: v }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorSkipBtcBuying: (v) => { set({ advisorSkipBtcBuying: v }); useStore.getState().syncSettingsToNostr(); },

  setMonthlyLog:  (entries) => set({ monthlyLog: entries }),
  upsertLogEntry: (entry) => {
    // M2 guard (centralized — all Monthly UI write paths funnel here): a daily-owned month must not be clobbered by a
    // non-daily (manual/monthly) write. The daily routing stamps source:'daily' (passes); confirmMonth preserves it
    // (passes); legacy/manual months (source undefined) are unaffected.
    const existingForGuard = useStore.getState().monthlyLog.find((e) => e.month === entry.month);
    if (existingForGuard?.source === 'daily' && entry.source !== 'daily') {
      nostrLog('warn', 'monthly write blocked — month is daily-owned');
      return;
    }
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

  confirmMonth: (month) => {
    const e = useStore.getState().monthlyLog.find((m) => m.month === month);
    if (e) useStore.getState().upsertLogEntry({ ...e, confirmed: true });   // spreads source through → M2 guard passes
  },

  // Daily Mode P2a/P3 — dayLog mutators. Each mutates dayLog, refreshes the cbCollateralBtc clock, then re-rolls any
  // affected strategy month(s). cbCollateralReading is clock-only (Route 1) — it never re-rolls / touches monthlyLog.
  // P3 — EVERY mutator marks recordsDirty + publishes explicitly: journal-only events (cbCollateralReading, target:'cb')
  // have monthOf===null → no rerollMonth → no publish, and rerollMonth's delete-to-empty branch returns without one.
  // recordsDirty is set BEFORE publishing so a failed immediate publish is retried by syncNow (mirrors upsertLogEntry).
  // Monthly-meaningful events publish twice (here + via rerollMonth→upsertLogEntry) — harmless (replaceable + idempotent merge).
  addDayEvent: (event) => {
    set((s) => ({ dayLog: [...s.dayLog, event], recordsDirty: true }));
    refreshCbCollateralCache();
    const m = monthOf(event);
    if (m !== null) rerollMonth(m);
    publishRecordsNow();
  },
  updateDayEvent: (event) => {
    const before = useStore.getState().dayLog.find((e) => e.id === event.id);
    set((s) => ({ dayLog: s.dayLog.map((e) => (e.id === event.id ? event : e)), recordsDirty: true }));
    refreshCbCollateralCache();
    const months = new Set<number>();
    const mb = monthOf(before); if (mb !== null) months.add(mb);   // re-roll the OLD month (date may have crossed a boundary)
    const ma = monthOf(event);  if (ma !== null) months.add(ma);   // and the NEW month
    for (const m of months) rerollMonth(m);
    publishRecordsNow();
  },
  deleteDayEvent: (id) => {
    const before = useStore.getState().dayLog.find((e) => e.id === id);
    if (!before) return;
    set((s) => ({ dayLog: s.dayLog.filter((e) => e.id !== id), deletedDayEvents: { ...s.deletedDayEvents, [id]: Date.now() }, recordsDirty: true }));
    refreshCbCollateralCache();
    const m = monthOf(before);
    if (m !== null) rerollMonth(m);
    publishRecordsNow();
  },
  // P3 — raw write-back from the records merge (sync.ts). FOLDS the Seam-2 derive: set dayLog AND recompute
  // cbCollateralBtc ONCE from the merged array. NO rollup / per-event derive — keeps the sync apply path actions-only.
  setDayLog: (events) => set((s) => ({ dayLog: events, cbCollateralBtc: deriveCbCollateral(events, s.cbCollateralBtc) })),
  setCbLtvAction: (v) => set({ cbLtvAction: v }),

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

  nostrAuthEnabled:   seedNostrAuthEnabled,      // 3a.4: standalone-seeded (false/null on fresh install = today's default)
  nostrPubkey:        seedNostrPubkey,
  nostrSigningMethod: seedNostrSigningMethod,
  nostrBunkerUri:     null,
  nostrRelays:        [...DEFAULT_RELAYS],
  nostrLogin:         null,
  writerKeyWrapped:   seedWriterKeyWrapped,
  writerKeyWrapMeta:  seedWriterKeyWrapMeta,
  viewerNpub:         null,
  viewerPubkey:       null,
  viewerLabel:        null,
  viewerMode:          false,
  viewerWriterPubkey:  null,
  viewerSecretKey:     null,
  viewerKeyWrapped:    null,
  viewerKeyWrapMeta:   null,
  viewerUnlocked:      false,
  viewerDataLoaded:    false,
  storeUnlocked:       false,
  // 3a.4: write through to the standalone GATE_* keys (outside the encrypted blob) — every mutation of these gate
  // fields keeps the cold-start bootstrap copy in sync; logout/disconnect call these with false/null → removeItem.
  setNostrAuthEnabled:   (v) => { try { v ? localStorage.setItem(GATE_AUTH_KEY, '1') : localStorage.removeItem(GATE_AUTH_KEY); } catch { /* noop */ } set({ nostrAuthEnabled: v }); },
  // B1: nostrAuthEnabled is DERIVED from pubkey presence (signed-in) — set in LOCKSTEP here + mirror GATE_AUTH_KEY
  // to GATE_PUBKEY_KEY so the two can never desync (that desync was the unlock half-state bug). Auth is active iff
  // signed in; the local key always Face-ID-gates on launch.
  setNostrPubkey:        (v) => { try { if (v == null) { localStorage.removeItem(GATE_PUBKEY_KEY); localStorage.removeItem(GATE_AUTH_KEY); } else { localStorage.setItem(GATE_PUBKEY_KEY, v); localStorage.setItem(GATE_AUTH_KEY, '1'); } } catch { /* noop */ } set({ nostrPubkey: v, nostrAuthEnabled: !!v }); },
  setNostrSigningMethod: (v) => { try { v == null ? localStorage.removeItem(GATE_METHOD_KEY) : localStorage.setItem(GATE_METHOD_KEY, v); } catch { /* noop */ } set({ nostrSigningMethod: v }); },
  setNostrBunkerUri:     (v) => set({ nostrBunkerUri: v }),
  setNostrRelays:        (v) => set({ nostrRelays: v }),                                                  // bootstrap/internal: NO publish (syncNow's fetchUserRelays discovery uses this)
  setNostrRelaysAndSync: (v) => { set({ nostrRelays: v }); useStore.getState().syncSettingsToNostr(); },  // user edit → mark dirty → publish on its own
  setNostrLogin:         (v) => set({ nostrLogin: v }),
  // Write through to the standalone localStorage keys (persisted OUTSIDE the encrypted blob — see WK_*_KEY).
  setWriterKeyWrapped:   (v) => { try { v == null ? localStorage.removeItem(WK_WRAPPED_KEY) : localStorage.setItem(WK_WRAPPED_KEY, v); } catch { /* noop */ } set({ writerKeyWrapped: v }); },
  setWriterKeyWrapMeta:  (v) => { try { v == null ? localStorage.removeItem(WK_META_KEY) : localStorage.setItem(WK_META_KEY, JSON.stringify(v)); } catch { /* noop */ } set({ writerKeyWrapMeta: v }); },
  // Writer-side viewer config — SYNCS in the owner's settings:v1 (cross-device) but stripped from the viewer snapshot.
  setViewerNpub:         (v) => { set({ viewerNpub: v });   useStore.getState().syncSettingsToNostr(); },
  setViewerPubkey:       (v) => { set({ viewerPubkey: v }); useStore.getState().syncSettingsToNostr(); },
  setViewerLabel:        (v) => { set({ viewerLabel: v });  useStore.getState().syncSettingsToNostr(); },
  setViewerMode:         (v) => set({ viewerMode: v }),          // viewer-side, device-local — never syncs
  setViewerWriterPubkey: (v) => set({ viewerWriterPubkey: v }),
  setViewerSecretKey:    (v) => set({ viewerSecretKey: v }),
  setViewerKeyWrapped:   (v) => set({ viewerKeyWrapped: v }),    // Phase 3 — device-local, never syncs
  setViewerKeyWrapMeta:  (v) => set({ viewerKeyWrapMeta: v }),
  setViewerUnlocked:     (v) => set({ viewerUnlocked: v }),      // transient (not persisted)
  setViewerDataLoaded:   (v) => set({ viewerDataLoaded: v }),    // transient (not persisted)
  setStoreUnlocked:      (v) => set({ storeUnlocked: v }),       // transient (not persisted)
  // Data-remanence fix: reset every viewer-hydrated financial/records/strike field to its seed so decrypted data
  // never outlives the authorizing key. Layout prefs (tabOrder/hiddenTabs/simpleMode/btcBuyingUnit) intentionally
  // LEFT (not sensitive; clearing simpleMode would yank the viewer's UI). VIEWER paths ONLY — no syncSettingsToNostr.
  clearViewerData: () => set({
    income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000,
    advisorStartDate: new Date().toISOString().split('T')[0],
    advisorActualBlocBalance: 0, advisorMonthStartBalance: 0, advisorActualBtcHeld: 0,
    cbLoanBalance: 60000, cbCollateralBtc: 1.48, cbAprPct: 4.77, hasCbLoan: false,
    ndpLastPaidDate: null, cbLiquidationPrice: 0, cbMonthlyPayment: 0, cbPaymentStrategy: 'monthly',
    cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
    cbLoanBalanceAsOf: null, cbLiquidationPriceAsOf: null, strikeLiquidationLtvPct: 85,
    advisorSkipBlocDraw: false, advisorSkipCbPayment: false, advisorSkipBtcBuying: false,
    pendingCollateralAdjustment: 0,
    monthlyLog: [], deletedMonths: {},
    strikeUsdBalance: null, strikeBtcAvailable: null, strikeRate: null,
    viewerNpub: null, viewerPubkey: null, viewerLabel: null,
    viewerDataLoaded: false,
  }),

  // Owner-recovery reset (escape hatch). Mirrors clearViewerData's financial/records/strike seed-reset but for the
  // OWNER. Pure local set — NO syncSettingsToNostr / NO publish (resetAndResync controls when/whether the pull runs).
  // Deliberately PRESERVES: writerKeyWrapped/Meta (standalone — needed to re-auth), nostr identity/relays, device
  // prefs, and viewerNpub/Pubkey/Label (re-hydrate from the pull). Reachable ONLY from the escape hatch.
  resetPlanToSeeds: () => set({
    income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000,
    advisorStartDate: new Date().toISOString().split('T')[0],
    advisorActualBlocBalance: 0, advisorMonthStartBalance: 0, advisorActualBtcHeld: 0,
    cbLoanBalance: 60000, cbCollateralBtc: 1.48, cbAprPct: 4.77, hasCbLoan: false,
    ndpLastPaidDate: null, cbLiquidationPrice: 0, cbMonthlyPayment: 0, cbPaymentStrategy: 'monthly',
    cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
    cbLoanBalanceAsOf: null, cbLiquidationPriceAsOf: null, strikeLiquidationLtvPct: 85,
    advisorSkipBlocDraw: false, advisorSkipCbPayment: false, advisorSkipBtcBuying: false,
    pendingCollateralAdjustment: 0,
    monthlyLog: [], deletedMonths: {},
    strikeUsdBalance: null, strikeBtcAvailable: null, strikeRate: null,
  }),

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
  deletedDayEvents: {},
  setDeletedDayEvents: (v) => set({ deletedDayEvents: v }),   // P3 — raw, non-emitting (mirrors setDeletedMonths)

  hydrateSettings: (data) => {
    const SETTINGS_FIELDS = [
      'income', 'expenses', 'blocApr', 'creditLine',
      'advisorStartDate', 'advisorActualBlocBalance', 'advisorMonthStartBalance', 'advisorActualBtcHeld',
      'cbLoanBalance', 'cbAprPct', 'hasCbLoan',   // cbCollateralBtc removed (P2a Seam 2 — local derived cache; cross-device sync suspended P2a→P3)
      'ndpLastPaidDate', 'tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit',
      'cbLiquidationPrice', 'cbMonthlyPayment', 'cbPaymentStrategy',
      'cbLtvTriggerPct', 'cbLtvTargetPct', 'cbRotateBackPct',
      'cbLoanBalanceAsOf', 'cbLiquidationPriceAsOf', 'strikeLiquidationLtvPct',
      'advisorSkipBlocDraw', 'advisorSkipCbPayment', 'advisorSkipBtcBuying',
      'pendingCollateralAdjustment',
      'nostrRelays',                       // C: synced relay list (guarded below — replace-on-hydrate)
      'viewerNpub', 'viewerPubkey', 'viewerLabel',
    ] as const;
    const update: Partial<StoreState> = {};
    for (const field of SETTINGS_FIELDS) {
      if (field in data && data[field] !== undefined) {
        (update as Record<string, unknown>)[field] = data[field];
      }
    }
    // C guard: a default-looking incoming relay list must never clobber a real local one. Skip ONLY the nostrRelays
    // field (the rest of `update` applies — skip-FIELD, not skip-all). Empty OR exactly-DEFAULT_RELAYS incoming + a
    // non-empty custom local list → drop the incoming relays; a genuine custom incoming list passes through. (The
    // creator closure is `(set) => …` with no `get`, so read local via useStore.getState() — safe at call time.)
    if ('nostrRelays' in update) {
      const incoming = update.nostrRelays as string[] | undefined;
      const local = useStore.getState().nostrRelays;
      const sortedJoin = (a: string[]) => [...a].sort().join(',');
      const isEmpty = !Array.isArray(incoming) || incoming.length === 0;
      const isJustDefaults = Array.isArray(incoming) && incoming.length === DEFAULT_RELAYS.length
        && sortedJoin(incoming) === sortedJoin(DEFAULT_RELAYS);
      const localIsRealCustom = local.length > 0
        && !(local.length === DEFAULT_RELAYS.length && sortedJoin(local) === sortedJoin(DEFAULT_RELAYS));
      if ((isEmpty || isJustDefaults) && localIsRealCustom) {
        delete (update as Record<string, unknown>).nostrRelays;   // keep the local list
      }
    }
    set(update);
  },
    }),
    {
      name: 'personal-bloc-store',
      version: 19,
      // Zustand v5: storage MUST be explicit — `undefined` DISABLES persistence (it does NOT default to
      // localStorage; that was older-Zustand behavior). Plain `window.localStorage` (zustand's own default form):
      // in the browser it's the real store; under Node (tests, no `window`) the getter throws → createJSONStorage
      // returns undefined → persist cleanly disables, instead of building a broken adapter that throws on write.
      // 3a.2: flag ON → persist through the encrypted adapter (AES-GCM, nsec-derived key held in storeCrypto); OFF →
      // plain localStorage (today's default, BYTE-IDENTICAL). The adapter NEVER writes plaintext when locked (drops
      // the write) and hydrates empty until the key arrives at unlock (then session.ts calls persist.rehydrate()).
      storage: storeEncEnabled
        ? createJSONStorage(() => encryptedStorage)
        : createJSONStorage(() => window.localStorage),
      partialize: partializeState,
      // Custom merge (replaces zustand's default shallow `{...current, ...persisted}`) so identity restoration is
      // gated on the SYNCHRONOUS GATE_PUBKEY_KEY — a stale, un-flushed blob `nostrPubkey` can't resurrect a
      // signed-out session after disconnect (which removes the GATE key synchronously before reload). Runs on EVERY
      // rehydrate (same-version included); migrate only fires on a version bump, so it can't cover this path. All
      // non-identity persisted fields pass through unchanged.
      merge: (persisted, current) => {
        const gatePubkey = (() => { try { return localStorage.getItem(GATE_PUBKEY_KEY); } catch { return null; } })();
        const gateMethod = (() => { try { return localStorage.getItem(GATE_METHOD_KEY); } catch { return null; } })();
        return { ...current, ...gateHydratedIdentity(persisted, gatePubkey, gateMethod) } as typeof current;
      },
      migrate: migrateState,
      onRehydrateStorage: () => (state) => {
        if (state?.miningInputs?.devices) {
          state.miningInputs.devices = state.miningInputs.devices.map((d) => ({
            ...d,
            poolName:   d.poolName   ?? '',
            poolFee:    d.poolFee     ?? 2.0,
            soloMining: d.soloMining ?? false,
          }));
        }
        // Daily Mode P2a Seam 2: keep the cbCollateralBtc cache coherent on every rehydrate (covers same-version
        // reloads, not just the version bump) — derive from the rehydrated dayLog, falling back to the stored cache.
        if (state) {
          state.cbCollateralBtc = deriveCbCollateral(state.dayLog ?? [], state.cbCollateralBtc);
        }
      },
    }
  )
);
