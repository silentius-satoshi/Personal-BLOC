// Store type surface (Phase 1c) — the StoreState interface + ViewerSlot + local aliases, moved verbatim out of
// useStore.ts so slice files can type against it WITHOUT importing the store (the cycle rule). Type-only imports →
// no runtime edge. StoreSet/StoreGet are the zustand handles each slice creator receives.
import type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry, DayEvent } from '../simulation/types';
import type { WrapMeta } from '../lib/nostr/keyVault';
import type { KeyProvenance } from '../lib/backupGate';
import type { SafeSnapshot } from '../simulation/safetyView';
import type { PinnedScenario } from '../simulation/scenarioDiff';
import type { NostrParam } from '../lib/nostr/session';
import type { PlanBackup } from '../lib/backup/exportPlan';
import type { NostrSigner } from '@nostrify/nostrify';

// Multi-viewer roster (M1) — one provisioned viewer. `index` is stable + monotonic (never reused after
// removal); `pubkeyHex` is the derived viewer pubkey the snapshot encrypts to; `tier`/`keyVersion` are
// per-viewer (M2 rotation bumps a single slot). SYNCED in the owner's settings, STRIPPED from viewer payloads.
export interface ViewerSlot {
  index:      number;
  pubkeyHex:  string;
  npub:       string;
  label:      string;
  tier:       'safe' | 'trusted';
  keyVersion: number;
}

type Tier = 'min' | 'rec' | 'ideal' | 'custom';
type Scenario = 'conservative' | 'moderate' | 'historical';
type ActiveTab = 'living' | 'bloc' | 'powerlaw' | 'converter' | 'mining' | 'coinbase' | 'advisor' | 'liqsim' | 'almanac' | 'settings';
type LtvType = 'target' | 'current' | 'high' | 'hyper';

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
  cbCollateralBtc:      number;   // derived cache (deriveCbCollateral over dayLog); NOT synced
  strikeCollateralBtc:  number;   // Collateral-Truth v20 — derived cache (deriveStrikeCollateral over dayLog); reading-anchored; NOT synced (rides ...rest)
  cbAprPct:             number;
  cbMonthlyPayment:     number;
  cbLiquidationPrice:   number;
  cbPaymentStrategy:    'monthly' | 'ltvTriggered';
  cbLtvTriggerPct:      number;
  cbLtvTargetPct:       number;
  cbRotateBackPct:      number;
  cbEmergencyCeilingPct: number;           // Emergency Console — target Strike LTV for crash-day collateral top-ups (clamp 20–50)
  cbLoanBalanceAsOf:      string | null;   // ISO date — when cbLoanBalance was last re-anchored (interest accrues daily from here)
  cbLiquidationPriceAsOf: string | null;   // ISO date — when cbLiquidationPrice was last re-entered (drifts up as interest accrues)
  strikeLiquidationLtvPct: number;         // Strike partial-liquidation LTV (published terms: 85%)
  blocMinPaymentSource:  'income' | 'roll';  // how the monthly BLOC minimum (interest) is paid: 'roll' (capitalize, default) or 'income'
  blocStatementMinimum:  number | null;      // this month's Strike statement minimum (user-entered); null → fall back to the computed estimate
  blocMinPaymentDueDay:  number;             // day-of-month the Strike minimum is due (default 15, bounds 1–28)
  setBlocMinPaymentSource: (v: 'income' | 'roll') => void;
  setBlocStatementMinimum: (v: number | null) => void;
  setBlocMinPaymentDueDay: (v: number) => void;

  // App mode
  simpleMode:            boolean;
  onboardingComplete:    boolean;
  btcBuyingUnit:         'btc' | 'sats';
  devMode:               boolean;   // persisted, DEVICE-LOCAL — never synced (not in SETTINGS_FIELDS/payload)
  almanacLiveEnabled:    boolean;   // persisted, DEVICE-LOCAL — never synced (Almanac live block height opt-in; mirrors devMode)
  almanacLiveConsented:  boolean;   // persisted, DEVICE-LOCAL — never synced (one-time consent for the explorer fetch)
  expenseReanchorDismissedAt: number;   // avg dismissed against (0 = not dismissed); persisted, DEVICE-LOCAL, NEVER synced (mirrors devMode)
  setExpenseReanchorDismissedAt: (v: number) => void;
  monthBucketReconcileDone: boolean;   // one-shot calendar-bucket reconcile ran; persisted, DEVICE-LOCAL, NEVER synced (mirrors devMode)
  setSimpleMode:         (v: boolean) => void;
  setOnboardingComplete: (v: boolean) => void;
  setBtcBuyingUnit:      (v: 'btc' | 'sats') => void;
  setDevMode:            (v: boolean) => void;
  setAlmanacLiveEnabled:   (v: boolean) => void;
  setAlmanacLiveConsented: (v: boolean) => void;

  // Advisor tab inputs
  advisorStartDate:         string;
  advisorActualBlocBalance: number;   // LIVE drawn BLOC balance right now (CURRENT box, Advisor, SafetyDashboard, NDP)
  advisorActualBlocBalanceAsOf: string | null;   // §5b — ISO date the Strike balance was last set (manual=today, reading=reading.date); the deriveReadingAnchors freshness guard
  advisorMonthStartBalance: number;   // BLOC balance at the START of the current month — projection base ONLY (deriveAdvisorStart month-1)
  advisorActualBtcHeld:     number;   // TRUE month-0 baseline — never back-solved; feeds recomputeBtcHeld's historical chain + migrate fallback (NOT current position)
  sandboxCollateralBtc:     number | null;   // Smart BLOC what-if collateral — in-memory ONLY (not persisted/synced); null = tracks current
  setSandboxCollateralBtc:  (v: number | null) => void;
  // Phase 3a — Scenario Diff/Pin: the pinned safety posture (null = nothing pinned). DEVICE-LOCAL PERSISTED
  // (rides partializeState's ...rest — a pin must survive reload), NEVER synced (absent from
  // buildSettingsPayload/SETTINGS_FIELDS). Only ever written by setPinnedScenario (READ-ONLY feature).
  pinnedScenario:           PinnedScenario | null;
  setPinnedScenario:        (v: PinnedScenario | null) => void;
  getCurrentBtcHeld:        () => number;   // deriveStrikeCollateral(dayLog, strikeCollateralBtc) — reading-anchored current Strike collateral
  ndpLastPaidDate:          string | null;
  setNdpLastPaidDate:       (date: string | null) => void;
  // Monthly log
  monthlyLog:         MonthlyLogEntry[];
  showMiningInLog:    boolean;
  setMonthlyLog:      (entries: MonthlyLogEntry[]) => void;
  upsertLogEntry:     (entry: MonthlyLogEntry) => void;
  deleteLogEntry:     (month: number) => void;
  confirmMonth:       (month: number, extras?: { expensesActual?: number; ndpPaid?: number; strikeMinPaid?: number; strikeMinSource?: 'income' | 'roll' }) => void;   // §2 — sign-off absorbs the confirm (atomic)
  unconfirmMonth:     (month: number) => void;   // §4 — flip confirmed→false, entry + rollup preserved (daily un-sign-off)
  reconcileMonthBuckets: () => void;   // one-shot: re-roll entries stored under the pre-fix bucketing (diff-guarded)
  setShowMiningInLog: (v: boolean) => void;

  // Daily Mode P2a — granular daily journal (LOCAL-only this phase; records sync is P3) + the CB-LTV action pref
  dayLog:        DayEvent[];
  cbLtvAction:   'paydown' | 'addCollateral';
  addDayEvent:    (event: DayEvent) => void;
  updateDayEvent: (event: DayEvent) => void;
  deleteDayEvent: (id: string) => void;
  undoDayEventDeletion: (event: DayEvent) => void;   // P2 — restore a just-deleted event (Snackbar undo)
  setDayLog:      (events: DayEvent[]) => void;   // P3 — raw write-back from records merge; folds the Seam-2 cbCollateralBtc derive
  setCbLtvAction: (v: 'paydown' | 'addCollateral') => void;

  // Simple Mode plan-card status bars — device-local display prefs (NOT synced, like devMode)
  showPlanIncomeBar:    boolean;
  showPlanStrikeBar:    boolean;
  showPlanCbBar:        boolean;
  setShowPlanIncomeBar: (v: boolean) => void;
  setShowPlanStrikeBar: (v: boolean) => void;
  setShowPlanCbBar:     (v: boolean) => void;

  // Consumer-shell view (Dashboard / Daily journal / Monthly Playbook) — device-local UI pref (NOT synced, like devMode)
  simpleView:    'dashboard' | 'monthly' | 'daily';
  setSimpleView: (v: 'dashboard' | 'monthly' | 'daily') => void;

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
  setCbEmergencyCeilingPct: (v: number) => void;
  setCbLoanBalanceAsOf:      (v: string | null) => void;
  setCbLiquidationPriceAsOf: (v: string | null) => void;
  setStrikeLiquidationLtvPct: (v: number) => void;

  // Setters — Advisor tab
  setAdvisorStartDate:         (date: string) => void;
  setAdvisorActualBlocBalance: (v: number)    => void;
  setAdvisorActualBlocBalanceAsOf: (v: string | null) => void;
  setAdvisorMonthStartBalance: (v: number)    => void;
  setAdvisorActualBtcHeld:     (v: number)    => void;
  emitBalanceReading: (overrides: { strikeBal?: number; strikeCollateral?: number; cbBal?: number; cbLiqPrice?: number }) => void;   // §5b — SafetyDashboard/position-modal emit a full reading (un-edited half synthesized) → the seam re-anchors. v20: strikeCollateral override → collateral anchor (LTV from the NEW collateral)

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
  // Backup gate (R2a-1) — see src/lib/backupGate.ts + CLAUDE.md § Backup Gate.
  // keyProvenance: how this device's identity was established. DEVICE-LOCAL PERSISTED, NEVER synced
  //   (rides partializeState's ...rest; absent from buildSettingsPayload → and thus from both snapshot
  //   branches + the plan backup, all of which derive from that allowlist). WRITE-ONCE (a null write is
  //   the explicit identity-teardown clear). null = LEGACY (pre-R2 plan) = gate satisfied, structurally.
  // backupVerifiedAt: ms timestamp the user proved they saved the recovery key. PERSISTED **and** SYNCED
  //   (in buildSettingsPayload + SETTINGS_FIELDS) so the attestation travels with the plan and an
  //   imported/external peer device sees it. ⚠ It does NOT "un-gate" a gated peer: a gated device runs no
  //   sync at all (not even a pull), so it can never RECEIVE this field — and it needn't, because only the
  //   sole GENERATING device is ever gated, and no other device can hold 'generated' for the same key.
  //   STRIPPED from the trusted viewer snapshot. A ONE-WAY LATCH — see hydrateSettings' skip-guard.
  keyProvenance:      KeyProvenance | null;
  backupVerifiedAt:   number | null;
  // Multi-viewer roster (M1) — REPLACES the old single-viewer scalars (viewerNpub/viewerPubkey/viewerLabel/
  // viewerPrivacyTrusted/viewerKeyVersion). Each ViewerSlot is one provisioned viewer: derived pubkey (the
  // NIP-44 encrypt target), display npub, owner nickname, per-viewer tier + keyVersion. SYNCED in the OWNER's
  // settings:v1 (roster + removals propagate across the owner's devices) but STRIPPED from every viewer
  // snapshot (a viewer must NEVER learn who else the owner shares with, their tiers, or key versions).
  // nextViewerIndex is a monotonic counter — an index is NEVER reused after removal.
  viewers:            ViewerSlot[];
  nextViewerIndex:    number;
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
  // Viewer V3 — the viewer's own display name ("Good morning, Dad"). DEVICE-LOCAL PERSISTED, NEVER synced
  // (the almanacLiveEnabled pattern: rides partializeState's ...rest, absent from SETTINGS_FIELDS /
  // buildSettingsPayload / both snapshot branches). null = nameless greeting. Cleared on sign-out.
  viewerDisplayName:   string | null;
  setNostrAuthEnabled:   (v: boolean) => void;
  setNostrPubkey:        (v: string | null) => void;
  setNostrSigningMethod: (v: 'nip07' | 'nip46' | 'local' | null) => void;
  setNostrBunkerUri:     (v: string | null) => void;
  setNostrRelays:        (v: string[]) => void;
  setNostrRelaysAndSync: (v: string[]) => void;   // user-edit path: set + mark dirty + publish
  setNostrLogin:         (v: string | null) => void;
  setWriterKeyWrapped:   (v: string | null) => void;
  setWriterKeyWrapMeta:  (v: WrapMeta | null) => void;
  setKeyProvenance:      (v: KeyProvenance | null) => void;
  setBackupVerifiedAt:   (v: number | null, nostr?: NostrParam) => void;
  addViewerSlot:         (slot: Omit<ViewerSlot, 'index'>) => void;
  updateViewerSlot:      (index: number, patch: Partial<ViewerSlot>) => void;
  removeViewerSlot:      (index: number) => void;
  setViewerMode:         (v: boolean) => void;
  setViewerWriterPubkey: (v: string | null) => void;
  setViewerSecretKey:    (v: string | null) => void;
  setViewerKeyWrapped:   (v: string | null) => void;
  setViewerKeyWrapMeta:  (v: WrapMeta | null) => void;
  setViewerDisplayName:  (v: string | null) => void;
  // Transient (NOT persisted) — true once viewerSync's in-memory key holder is populated (post-unlock /
  // post-provision). AppShell gates the unlock screen on this (it can't read viewerSync's module var).
  viewerUnlocked:        boolean;
  setViewerUnlocked:     (v: boolean) => void;
  // Transient (NOT persisted) — true only after a VALID viewer snapshot decrypt+hydrate. AppShell gates the
  // viewer render on this so stale persisted data never shows for a key that can't decrypt the snapshot.
  viewerDataLoaded:      boolean;
  setViewerDataLoaded:   (v: boolean) => void;
  // Transient (NOT persisted) — ms of the last VALID viewer snapshot hydrate. Drives the viewer home's
  // "updated Nm ago" freshness pill. Set in applyViewerEvent on a good decrypt. Viewer Revamp V1.
  viewerLastSyncAt:      number | null;
  setViewerLastSyncAt:   (v: number | null) => void;
  // Transient (NOT persisted) — Viewer V2. The last C-safe snapshot (ratios/config/at-snapshot price) the
  // viewer received; null in C-trusted mode (the store is fully hydrated instead). ViewerHomeView scales it
  // to the live price. Set in applyViewerEvent on a safe-mode decrypt; cleared on trusted/revoke.
  viewerSafeSnapshot:    SafeSnapshot | null;
  setViewerSafeSnapshot: (v: SafeSnapshot | null) => void;
  viewerPreview:         boolean;   // owner-only "Preview as viewer" — transient, NEVER persisted (must not boot into preview)
  setViewerPreview:      (v: boolean) => void;
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
  // Transient (NOT persisted/synced) — true once this session's FIRST settings pull query has resolved.
  // Gates the first settings publish + relaxes the first-pull hydrate guard + gates syncSettingsToNostr's
  // dirty-trigger, so a seed-default store can never clobber real relay data on fresh-install→login.
  initialSettingsPullDone:    boolean;
  setInitialSettingsPullDone: (v: boolean) => void;
  // R2b-2 — did this session's FIRST owner pull find a plan on the relays? Transient (NOT persisted/synced;
  // in partializeState's omit list). null = not yet determined, OR the notice was dismissed. Signing in with a
  // key that has no plan must SAY SO rather than silently rendering a seed-default dashboard.
  //   recordRemotePlanFound — syncNow's write. Latched: exactly once per session (see the module-level flag).
  //   setRemotePlanFound    — the notice's Dismiss (→ null). Does NOT unlatch, so the next foreground sync
  //                           cannot re-open a dismissed notice.
  remotePlanFound:       boolean | null;
  setRemotePlanFound:    (v: boolean | null) => void;
  recordRemotePlanFound: (v: boolean) => void;
  // R2c-2 — has the owner dismissed the dashboard backup-nag THIS session? Session-transient (NOT persisted/
  // synced; in partializeState's omit list, absent from buildSettingsPayload/SETTINGS_FIELDS). Simpler than
  // remotePlanFound — NO module latch: a single writer (the Dismiss button) sets it, nothing re-writes it
  // mid-session, so it stays dismissed until the next boot resets it. That per-session reappearance IS the
  // escalation ladder (the nag returns each launch while the gate is unsatisfied and the plan has data).
  backupNagDismissed:    boolean;
  dismissBackupNag:      () => void;
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
  applyPlanBackup:      (backup: PlanBackup) => void;   // Plan Import/Restore — atomic replace of this device's plan
}

// zustand's own set/get handles, passed to every slice creator (so slices never import the store).
export type StoreSet = (partial: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>)) => void;
export type StoreGet = () => StoreState;
