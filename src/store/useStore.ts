import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry, DayEvent } from '../simulation/types';
import { upsertEntry, recomputeBtcHeld, bucketEventToMonth, rollupMonth, deriveCbCollateral, deriveStrikeCollateral, deriveReadingAnchors, priorStocksForMonth, strikeCollateralDelta, sameRollupFields, legacyBucketEventToMonth, type ReadingMutationCtx } from '../simulation/logUtils';
import { computeStrikeLtv } from '../simulation/strikeCredit';
import { accruedCbBalance, cbMetrics } from '../simulation/cbMetrics';
import { deriveSafetyView, selectSafetyViewInputs, buildSafeSafety, type SafeSnapshot } from '../simulation/safetyView';   // Viewer V2 — pure (safetyView has no runtime dep on this store; type-only StoreState import) → cycle-free
import { signerOpTimeout } from '../lib/nostr/timeout';
import { nostrLog } from '../lib/nostr/log';
import { todayLocalISO } from '../utils/format';
import { DEFAULT_RELAYS, importNip65RelayList } from '../lib/nostr/relays';   // single source for the default relay list (pure leaf — no cycle)
import { encryptedStorage } from '../lib/store/storeCrypto';   // 3a.2: at-rest encryption adapter (flag-gated)
import { isBackupGateSatisfied, type KeyProvenance } from '../lib/backupGate';   // pure leaf, zero imports → no cycle
import type { WrapMeta } from '../lib/nostr/keyVault';
import type { NostrParam } from '../lib/nostr/session';   // type-only — the runtime syncNow import is dynamic (cycle-safe)
import type { NostrSigner } from '@nostrify/nostrify';

export type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry, KeyProvenance };

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
const GATE_PROVENANCE_KEY = 'personal-bloc-provenance';      // 'keyProvenance' — standalone so it survives the escape hatch (bypass 1)

const {
  gOnboarded: seedOnboardingComplete,
  gAuth:      seedNostrAuthEnabled,
  gMethod:    seedNostrSigningMethod,
  gPubkey:    seedNostrPubkey,
  gProvenance: seedKeyProvenance,
} = (() => {
  let onboarded = false;
  let method: 'nip07' | 'nip46' | 'local' | null = null;
  let pubkey: string | null = null;
  let provenance: 'generated' | 'imported' | 'external' | null = null;
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
    // R2c-6-final (bypass 1): keyProvenance must survive the escape hatch (which nukes the blob but keeps GATE
    // keys), so it gets its own standalone key. ⚠ Its back-fill is gated on PROVENANCE ALONE — the combined
    // all-absent gate above is skipped on every post-3a.4 install (GATE keys present), which is exactly the
    // population the escape-hatch bypass threatens.
    const p = localStorage.getItem(GATE_PROVENANCE_KEY);
    provenance = (p === 'generated' || p === 'imported' || p === 'external') ? p : null;
    if (provenance == null) {
      const raw = localStorage.getItem('personal-bloc-store');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.ct == null && o.iv == null) {   // plaintext blob ONLY
          const kp = (o.state ?? {}).keyProvenance;
          if (kp === 'generated' || kp === 'imported' || kp === 'external') {
            provenance = kp;
            localStorage.setItem(GATE_PROVENANCE_KEY, kp);
          }
        }
      }
    }
    // B1: nostrAuthEnabled is DERIVED from pubkey presence — mirror GATE_AUTH_KEY to GATE_PUBKEY_KEY so the 3a.4
    // encrypted-cold-start gate still fires (GATE_AUTH_KEY present whenever GATE_PUBKEY_KEY is) AND any legacy
    // desync (the half-state: auth flag out of step with pubkey) self-heals on launch.
    if (pubkey) localStorage.setItem(GATE_AUTH_KEY, '1'); else localStorage.removeItem(GATE_AUTH_KEY);
  } catch { /* noop */ }
  return { gOnboarded: onboarded, gAuth: !!pubkey, gMethod: method, gPubkey: pubkey, gProvenance: provenance };
})();

/**
 * Gate hydrated identity on the standalone GATE_PUBKEY_KEY — the SYNCHRONOUS source of truth that disconnect clears
 * before reload(). The persisted blob is racy: disconnect's setters clear it but the persist write may not land
 * before the synchronous reload, leaving a stale `nostrPubkey` that (under the B1 pin) resurrects auth. Gating the
 * hydrate on the GATE key makes sign-out authoritative. Applied in the persist `merge` so it runs on EVERY rehydrate
 * (unlike migrate(), which fires only on a version bump — useStore.ts module note above). Pure (gatePubkey passed in)
 * so it's unit-testable without localStorage. Only the identity fields are touched; all other persisted data passes
 * through untouched. BOTH identity fields (pubkey AND method) are gated on the live GATE keys — the racy blob is
 * never authoritative for identity (a stale blob `nostrSigningMethod` would point at the wrong signer → timeouts).
 * R2a-1: the backup-gate fields are identity-scoped too, so the signed-out branch nulls them for the same reason —
 * disconnect clears them, but its blob write may not land, and a stale 'generated' + null would re-gate a device
 * that has since imported a key (setKeyProvenance is write-once).
 * R2c-6-final (bypass 1): keyProvenance is gated on its own live GATE_PROVENANCE_KEY (standalone-authoritative),
 * because the escape hatch nukes the blob but keeps the GATE keys — without this, a reset would refill provenance
 * to null (= legacy grandfather = satisfied) and a generated-unverified key would ungate itself. ⚠ ASYMMETRY:
 * backupVerifiedAt needs NO standalone key — it's a SYNCED plan field, so a VERIFIED key re-hydrates it from the
 * relay on the post-reset pull; an unverified key's null (empty relay) is correct. It passes through ...persisted.
 */
export function gateHydratedIdentity(persisted: any, gatePubkey: string | null, gateMethod: string | null, gateProvenance: string | null) {
  if (!gatePubkey) {
    return { ...persisted, nostrPubkey: null, nostrSigningMethod: null, nostrAuthEnabled: false, keyProvenance: null, backupVerifiedAt: null };
  }
  return {
    ...persisted,
    nostrPubkey: persisted?.nostrPubkey ?? gatePubkey,
    nostrSigningMethod: gateMethod ?? persisted?.nostrSigningMethod ?? null,   // LIVE GATE_METHOD_KEY authoritative; blob fallback (fixes local-login hydrating stale nip46)
    keyProvenance: gateProvenance ?? persisted?.keyProvenance ?? null,          // LIVE GATE_PROVENANCE_KEY authoritative — survives the escape hatch (bypass 1)
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
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recordsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// R2b-2 — the remotePlanFound SESSION LATCH. Module-scoped (like the timers above), so it resets on every boot.
// ⚠ Why a latch and not just `remotePlanFound === null`: Dismiss writes null, so a bare null-check would let the
// NEXT foreground syncNow re-write `false` and resurrect the notice. The latch makes "syncNow sets it exactly
// once per session" and "the notice is one-time" true simultaneously — on the first pull the field IS null, so
// both conditions agree; afterwards only the latch holds.
let remotePlanFoundResolved = false;

// Trailing debounce (~400ms) over the records publish. EventSheet saves a flow+reading as two back-to-back
// addDayEvent calls, each firing this; coalescing them into ONE publish prevents two publishes of the same
// replaceable records d-tag with an identical second-granularity created_at → NIP-01 tie-break randomly
// keeping the first (incomplete) payload. recordsDirty stays true until the debounced publish succeeds, so
// an app kill mid-debounce self-heals on the next pull (syncNow publishes-if-dirty). State is snapshotted at
// FIRE time (getState() lives inside publishRecordsNowImmediate). Callers ignore the return; syncNow, the
// sync-repair path, and the gate test call publishRecordsNowImmediate directly for the awaited boolean.
export function publishRecordsNow(): void {
  if (recordsDebounceTimer) clearTimeout(recordsDebounceTimer);
  recordsDebounceTimer = setTimeout(() => { void publishRecordsNowImmediate(); }, 400);
}

export async function publishRecordsNowImmediate(): Promise<boolean> {
  if (recordsDebounceTimer) { clearTimeout(recordsDebounceTimer); recordsDebounceTimer = null; }   // an immediate publish supersedes any pending debounce — avoids a redundant signer op (NIP-46 round-trip)
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || state.viewerMode || !isBackupGateSatisfied(state)) return false;   // publish didn't happen (incl. read-only viewer — relay-side backstop; and an unbacked-up generated key)
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
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || !isBackupGateSatisfied(state)) return false;   // publish didn't happen (incl. an unbacked-up generated key)
  // Backstop (closes parked backlog #6): never publish the UNTOUCHED SEED over real relay data before this
  // session has pulled a baseline. Cheap sentinel check — enough to catch the fresh-install seed store.
  if (!state.initialSettingsPullDone
      && state.income === 4000 && state.expenses === 3500 && state.creditLine === 10000 && !state.advisorActualBtcHeld) {
    nostrLog('warn', 'refused to publish seed-default settings before initial pull');
    return false;
  }
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
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || !isBackupGateSatisfied(state)) return false;
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
// viewer snapshot so the two can never drift. The owner's viewer roster (viewers/nextViewerIndex) IS carried
// here (syncs across the owner's devices) but is STRIPPED from the viewer snapshot below.
export function buildSettingsPayload(s: StoreState): Record<string, unknown> {
  return {
    income:                   s.income,
    expenses:                 s.expenses,
    blocApr:                  s.blocApr,
    creditLine:               s.creditLine,
    advisorStartDate:         s.advisorStartDate,
    advisorActualBlocBalance: s.advisorActualBlocBalance,
    advisorActualBlocBalanceAsOf: s.advisorActualBlocBalanceAsOf,   // §5b — freshness travels with the balance (like cbLoanBalanceAsOf)
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
    cbEmergencyCeilingPct:    s.cbEmergencyCeilingPct,
    cbLoanBalanceAsOf:        s.cbLoanBalanceAsOf,
    cbLiquidationPriceAsOf:   s.cbLiquidationPriceAsOf,
    strikeLiquidationLtvPct:  s.strikeLiquidationLtvPct,
    blocMinPaymentSource:     s.blocMinPaymentSource,
    blocStatementMinimum:     s.blocStatementMinimum,
    blocMinPaymentDueDay:     s.blocMinPaymentDueDay,
    advisorSkipBlocDraw:      s.advisorSkipBlocDraw,
    advisorSkipCbPayment:     s.advisorSkipCbPayment,
    advisorSkipBtcBuying:     s.advisorSkipBtcBuying,
    nostrRelays:              s.nostrRelays,   // C: relay list syncs across the owner's devices (guarded on hydrate; stripped from the viewer snapshot)
    // Backup gate (R2a-1) — verifying on ONE owner device un-gates the owner's others. One-way latch (guarded on
    // hydrate); STRIPPED from the trusted viewer snapshot below. keyProvenance is device-local → NOT here.
    backupVerifiedAt:         s.backupVerifiedAt,
    // Multi-viewer roster (M1) — synced in the OWNER's settings:v1 only; STRIPPED from every viewer snapshot below.
    viewers:                  s.viewers,
    nextViewerIndex:          s.nextViewerIndex,
  };
}

// Viewer snapshot — MODE-SHAPED (Viewer V2). Default C-SAFE: a tiny payload of health ratios + config
// ratios + public price. NO absolute exists in it BY CONSTRUCTION (the privacy audit is Object.keys — no
// settings/records/strike/cbCollateralBtc keys). C-TRUSTED (opt-in): today's full payload. See safetyView.ts.
export function buildViewerSnapshotPayload(s: StoreState, tier: 'safe' | 'trusted'): import('../lib/nostr/publish').ViewerSnapshot {
  const asOf = Date.now();
  if (tier !== 'trusted') {   // M2: tier is an explicit param (the slot-0 read moved into the fan-out loop) — built once per tier.
    // C-SAFE — the owner runs the dashboard's EXACT inputs (deriveSafetyView ∘ selectSafetyViewInputs), then
    // ships only the ratio/level block (buildSafeSafety drops the two $ absolutes) + config ratios + price.
    const view = deriveSafetyView(selectSafetyViewInputs(s));
    return {
      snapshotVersion: 2,
      privacyMode: 'safe',
      asOf,
      hasCbLoan: s.hasCbLoan,
      btcPriceAtSnapshot: s.btcPrice,   // public market data
      thresholds: {
        strikeLiqLtv:    s.strikeLiquidationLtvPct / 100,
        cbLtvTriggerPct: s.cbLtvTriggerPct,
        cbLiqFrac:       view.cbLiqFrac,
      },
      safety: buildSafeSafety(view, s.hasCbLoan),
    };
  }
  // C-TRUSTED (Option B): today's full payload. STRIP the owner's sharing/transport config (the viewers roster
  // + nextViewerIndex + nostrRelays) — the viewer must never see who else the owner shares with, their tiers/key
  // versions, nor the owner's relay set — AND backupVerifiedAt (R2a-1: the owner's key-custody state is none of
  // the viewer's business; it also gates nothing viewer-side).
  return {
    snapshotVersion: 2,
    privacyMode: 'trusted',
    asOf,
    settings: (() => { const { viewers: _vs, nextViewerIndex: _ni, nostrRelays: _r, backupVerifiedAt: _bv, ...rest } = buildSettingsPayload(s); return rest; })(),
    records:  { entries: s.monthlyLog, deletions: s.deletedMonths },   // the viewer gets the rolled-up months, NOT the raw dayLog journal
    strike:   { usd: s.strikeUsdBalance, btcAvail: s.strikeBtcAvailable, rate: s.strikeRate },
    cbCollateralBtc: deriveCbCollateral(s.dayLog, s.cbCollateralBtc),   // P3 (BUG2) — the derived scalar; the viewer raw-sets it (applyViewerEvent), never via setCbCollateralBtc
    strikeCollateralBtc: deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc),   // C-P4 — the reading-anchored Strike scalar; viewer raw-sets it (dayLog stays []). SAFE branch must NOT carry it
  };
}

// Fire-and-forget viewer snapshot — M2 FAN-OUT: one NIP-44 publish per roster slot, each sealed to that
// viewer's pubkey on its own d-tag (viewerDTag). Gated on the roster being non-empty; log-only on failure.
// MUST NOT touch recordsDirty/settingsDirty/nostrReconnectNeeded/nostrSyncing — the owner's own sync result
// is independent. The payload is built ONCE PER DISTINCT TIER (at most 2 builds), encrypted N times.
export async function publishViewerSnapshotNow(): Promise<void> {
  const s = useStore.getState();
  if (!s.viewers.length || !s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey || !isBackupGateSatisfied(s)) return;
  const signer = s.nostrSigner;
  const relays = s.nostrRelays.length ? s.nostrRelays : undefined;
  const timeout = signerOpTimeout(s.nostrSigningMethod);
  try {
    const { publishViewerSnapshot } = await import('../lib/nostr/publish');
    const byTier = new Map<'safe' | 'trusted', import('../lib/nostr/publish').ViewerSnapshot>();
    const payloadFor = (tier: 'safe' | 'trusted') => {
      if (!byTier.has(tier)) byTier.set(tier, buildViewerSnapshotPayload(s, tier));   // build once per tier
      return byTier.get(tier)!;
    };
    // FAILURE ISOLATION — allSettled so one slot's relay failure never aborts the rest. Each publish records
    // its OWN PublishReport (labeled by viewerDTag(pubkeyHex)) via the shared publish tail.
    const results = await Promise.allSettled(
      s.viewers.map((slot) => publishViewerSnapshot(signer, slot.pubkeyHex, payloadFor(slot.tier), relays, timeout)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    nostrLog('info', `viewer fan-out: ${ok} ok / ${results.length - ok} failed (${results.length} viewers)`);
  } catch (e) {
    nostrLog('warn', 'viewer fan-out failed', e);
  }
}

// Real-time revocation (M2 — PER-SLOT): seal a TOMBSTONE (empty payload + revoked:true) to ONE viewer's d-tag
// so their next live event / reconnect wipes the hydrated data and drops them to ViewerWaitingGate. The caller
// passes the target pubkey (captured BEFORE removeViewerSlot). Fire-and-forget, log-only.
export async function publishViewerRevocationNow(viewerPubkeyHex: string): Promise<void> {
  const s = useStore.getState();
  if (!viewerPubkeyHex || !s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey || !isBackupGateSatisfied(s)) return;
  try {
    const { publishViewerSnapshot } = await import('../lib/nostr/publish');
    await publishViewerSnapshot(
      s.nostrSigner,
      viewerPubkeyHex,
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

// ISO first-day of a strategy month (month 1 = advisorStartDate's month). advisorStartDate is a
// date-only 'yyyy-mm-dd' string → new Date(...) parses it at UTC MIDNIGHT (JS spec). The output feeds
// bucketEventToMonth/calendarModel's UTC-string calendar-date convention, so this stays UTC-consistent
// throughout (UTC accessors, not local) — mixing local getMonth/setMonth with a UTC-parsed input was the
// bug (an off-by-one near month boundaries in behind-UTC zones).
function strategyMonthDate(advisorStartDate: string, month: number): string {
  const d = new Date(advisorStartDate);
  d.setUTCMonth(d.getUTCMonth() + (month - 1));
  return d.toISOString().split('T')[0];
}

// Seam 2 clock: refresh the derived cbCollateralBtc cache from the current dayLog (cheap, idempotent).
function refreshCbCollateralCache(): void {
  const s = useStore.getState();
  useStore.setState({ cbCollateralBtc: deriveCbCollateral(s.dayLog, s.cbCollateralBtc) });
}

// Collateral-Truth v20 — the Strike-collateral equivalent: refresh the derived strikeCollateralBtc cache
// (reading-anchored) from the current dayLog. Mirrors refreshCbCollateralCache; called beside it in the mutators.
function refreshStrikeCollateralCache(): void {
  const s = useStore.getState();
  useStore.setState({ strikeCollateralBtc: deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc) });
}

// §5b Readings-Unification seam — couple the live safety anchors (advisorActualBlocBalance / cbLoanBalance /
// cbLiquidationPrice) to the DATE-latest balanceReading. Runs on LOCAL dayLog actions ONLY (add/update/delete),
// NEVER in setDayLog — a sync/merge must not jolt this device's SafetyDashboard; the anchor travels cross-device
// via the SETTINGS channel (syncSettingsToNostr) instead, like a manual re-anchor. Distinct from cbCollateralBtc's
// continuous derive (that IS refreshed in setDayLog — a sum over ordered events, not a synced scalar). `removed` =
// the pre-mutation reading (deleted / date-moved) for the delete-fallback source proxy (nuance 5). Idempotent
// (deriveReadingAnchors returns an empty patch when nothing changed) → no redundant settings publish.
function refreshBalanceAnchors(removed?: ReadingMutationCtx): void {
  const s = useStore.getState();
  const patch = deriveReadingAnchors(s.dayLog, {
    advisorActualBlocBalance: s.advisorActualBlocBalance, advisorActualBlocBalanceAsOf: s.advisorActualBlocBalanceAsOf,
    cbLoanBalance:            s.cbLoanBalance,            cbLoanBalanceAsOf:            s.cbLoanBalanceAsOf,
    cbLiquidationPrice:       s.cbLiquidationPrice,       cbLiquidationPriceAsOf:       s.cbLiquidationPriceAsOf,
  }, removed);
  if (Object.keys(patch).length === 0) return;
  useStore.setState(patch);
  useStore.getState().syncSettingsToNostr();
}

// The pre-mutation reading context for the delete-fallback proxy — only a balanceReading can be an anchor source.
function readingCtx(ev: DayEvent | undefined): ReadingMutationCtx | undefined {
  if (!ev || ev.kind !== 'balanceReading') return undefined;
  return { oldDate: ev.date, strikeBal: ev.reading.strikeBal, cbBal: ev.reading.cbBal, cbLiqPrice: ev.reading.cbLiqPrice };
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

  // priorStocks = the prior strategy-month's LAST balanceReading by ts (shared with the reconcile — no drift).
  const priorStocks = priorStocksForMonth(s.dayLog, start, month);

  const { entry: rollupEntry } = rollupMonth(s.dayLog, month, start, priorStocks);   // collateralDelta retired (v20) — Strike collateral is reading-anchored, not chained from rollup

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
  // Seam-1 retired (Collateral-Truth v20): target:'strike' moves feed getCurrentBtcHeld via deriveStrikeCollateral
  // (reading-anchored), not a pending adjustment. The mutators refresh strikeCollateralBtc directly.
}

// The strategy month a monthly-meaningful event affects (clock-only / journal-only events → null, no re-roll).
function monthOf(ev: DayEvent | undefined): number | null {
  if (!ev || !isMonthlyMeaningful(ev)) return null;
  return bucketEventToMonth(ev.date, useStore.getState().advisorStartDate);
}

// Persist partialize — exported so it's unit-testable (the persist API isn't available under Node where persistence
// self-disables). In-memory + transient fields are omitted; everything else (incl. dayLog/cbLtvAction) persists.
export function partializeState(state: StoreState) {
  const { strikeUsdBalance, strikeBtcAvailable, strikeRate, strikeApiConnected, strikeLastFetched, isAuthenticated, nostrSigner, nostrSyncing, initialSettingsPullDone, remotePlanFound, backupNagDismissed, nostrReconnectNeeded, sandboxCollateralBtc, viewerUnlocked, viewerDataLoaded, viewerLastSyncAt, viewerSafeSnapshot, viewerPreview, storeUnlocked, writerKeyWrapped, writerKeyWrapMeta, activeTab, ...rest } = state;
  return rest;
}

// Persist migrate — exported so it's unit-testable (same reason as partializeState).
export function migrateState(persistedState: any): any {
  // v20 (Collateral-Truth): strip pendingCollateralAdjustment so it can't ride ...rest; seed strikeCollateralBtc.
  // v21 (Multi-viewer M1): strip the 5 old single-viewer scalars so a stale value can't ride ...rest — the roster
  // starts EMPTY (clean-cut, no back-compat; the owner re-adds viewers fresh).
  const {
    customCollateral, pendingCollateralAdjustment: _pendingDrop,
    viewerNpub: _vn, viewerPubkey: _vp, viewerLabel: _vl, viewerPrivacyTrusted: _vt, viewerKeyVersion: _vk,
    ...rest
  } = persistedState;
  const sorted = [...(persistedState.monthlyLog ?? [])]
    .sort((a: any, b: any) => a.month - b.month);
  // Seed = faithful old getCurrentBtcHeld from the RAW blob (last entry's btcHeld, else the baseline) + pending,
  // computed BEFORE the back-solve loops below touch anything. A degenerate entry lacking btcHeld → baseline.
  const rawLast = sorted.at(-1);
  const seedStrikeCollateral =
    (rawLast?.btcHeld ?? persistedState.advisorActualBtcHeld ?? 0)
    + (persistedState.pendingCollateralAdjustment ?? 0);
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
      date: todayLocalISO(),
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
    cbEmergencyCeilingPct: persistedState.cbEmergencyCeilingPct ?? 30,
    cbLoanBalanceAsOf:      persistedState.cbLoanBalanceAsOf      ?? null,
    cbLiquidationPriceAsOf: persistedState.cbLiquidationPriceAsOf ?? null,
    strikeLiquidationLtvPct: persistedState.strikeLiquidationLtvPct ?? 85,
    blocMinPaymentSource:  persistedState.blocMinPaymentSource ?? 'roll',
    blocStatementMinimum:  persistedState.blocStatementMinimum ?? null,
    blocMinPaymentDueDay:  persistedState.blocMinPaymentDueDay ?? 15,
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
    // Multi-viewer roster (M1, store v21) — the 5 old single-viewer scalars are DROPPED (stripped above);
    // the roster starts EMPTY. Clean-cut: the owner re-adds viewers fresh (the only existing viewer was a test key).
    viewers:              [],
    nextViewerIndex:      0,
    // Viewer access (Phase 2, viewer-side) — v17, device-local, never synced.
    viewerMode:           persistedState.viewerMode          ?? false,
    viewerWriterPubkey:   persistedState.viewerWriterPubkey  ?? null,
    // v17 migrant: LEAVE any plaintext viewerSecretKey in place (wrapping needs a Face ID gesture,
    // impossible here; the one-time wrap-setup screen clears it later).
    viewerSecretKey:      persistedState.viewerSecretKey     ?? null,
    viewerDisplayName:    persistedState.viewerDisplayName   ?? null,   // Viewer V3 — additive default, no bump
    // Viewer access (Phase 3) — v18, wrapped-at-rest key. Device-local, never synced.
    viewerKeyWrapped:     persistedState.viewerKeyWrapped    ?? null,
    viewerKeyWrapMeta:    persistedState.viewerKeyWrapMeta   ?? null,
    // v16 — mid-month installs seed start-of-month from the current live balance; fresh = 0
    advisorMonthStartBalance: persistedState.advisorMonthStartBalance ?? persistedState.advisorActualBlocBalance ?? 0,
    // §5b — Strike balance freshness stamp; additive default, no bump (merge-default pattern)
    advisorActualBlocBalanceAsOf: persistedState.advisorActualBlocBalanceAsOf ?? null,
    // calendar-bucket reconcile flag; default false so the one-shot reconcile runs once for existing installs
    monthBucketReconcileDone: persistedState.monthBucketReconcileDone ?? false,
    // v19 — Daily Mode P2a: dayLog (LOCAL-only) + cbLtvAction; cbCollateralBtc becomes a derived cache.
    dayLog:               migratedDayLog,
    cbLtvAction:          persistedState.cbLtvAction ?? 'paydown',
    cbCollateralBtc:      deriveCbCollateral(migratedDayLog as DayEvent[], persistedState.cbCollateralBtc),
    // v20 (Collateral-Truth) — reading-anchored Strike collateral. CACHE-SEED ONLY (no synthetic dayLog event —
    // clean journals). No legacy reading carries strikeCollateral → deriveStrikeCollateral returns this fallback
    // → getCurrentBtcHeld is byte-identical pre/post migration.
    strikeCollateralBtc:  persistedState.strikeCollateralBtc ?? seedStrikeCollateral,
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
  strikeCollateralBtc: 0,   // Collateral-Truth v20 — reading-anchored derived cache; fresh install = deriveStrikeCollateral([], 0) = 0
  cbAprPct:            4.77,
  cbMonthlyPayment:    0,
  cbLiquidationPrice:  0,
  cbPaymentStrategy:   'monthly' as const,
  cbLtvTriggerPct:     75,
  cbLtvTargetPct:      65,
  cbRotateBackPct:     55,
  cbEmergencyCeilingPct: 30,
  cbLoanBalanceAsOf:      null,
  cbLiquidationPriceAsOf: null,
  strikeLiquidationLtvPct: 85,
  blocMinPaymentSource:  'roll' as const,
  blocStatementMinimum:  null,
  blocMinPaymentDueDay:  15,

  simpleMode:         false,
  onboardingComplete: seedOnboardingComplete,   // 3a.4: standalone-seeded (false on fresh install = today's default)
  btcBuyingUnit:      'btc',
  devMode:            false,
  almanacLiveEnabled:   false,
  almanacLiveConsented: false,
  expenseReanchorDismissedAt: 0,
  monthBucketReconcileDone: false,   // rides ...rest (persisted, not synced); false → the one-shot reconcile runs once
  setSimpleMode:         (v) => { set({ simpleMode: v }); useStore.getState().syncSettingsToNostr(); },
  // 3a.4: write through to the standalone GATE_* key (outside the encrypted blob) so the unlock gate can bootstrap
  // on an encrypted cold start. Mirrors setWriterKeyWrapped.
  setOnboardingComplete: (v) => { try { v ? localStorage.setItem(GATE_ONBOARDED_KEY, '1') : localStorage.removeItem(GATE_ONBOARDED_KEY); } catch { /* noop */ } set({ onboardingComplete: v }); },
  setBtcBuyingUnit:      (v) => { set({ btcBuyingUnit: v }); useStore.getState().syncSettingsToNostr(); },
  setDevMode:            (v) => set({ devMode: v }),
  setAlmanacLiveEnabled:   (v) => set({ almanacLiveEnabled: v }),    // device-local, unsynced — no syncSettingsToNostr
  setAlmanacLiveConsented: (v) => set({ almanacLiveConsented: v }),  // device-local, unsynced — no syncSettingsToNostr
  setExpenseReanchorDismissedAt: (v) => set({ expenseReanchorDismissedAt: v }),   // device-local, unsynced — no syncSettingsToNostr

  advisorStartDate:         todayLocalISO(),
  advisorActualBlocBalance: 0,
  advisorActualBlocBalanceAsOf: null,   // §5b — never anchored yet (null → the reading guard always applies first time)
  advisorMonthStartBalance: 0,
  advisorActualBtcHeld:     0,
  sandboxCollateralBtc:     null,
  setSandboxCollateralBtc:  (v) => set({ sandboxCollateralBtc: v }),
  getCurrentBtcHeld: (): number => {
    const s: StoreState = useStore.getState();
    return deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc);   // Collateral-Truth v20 — reading-anchored
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

  // Default to the Dashboard (owner IA — dashboard-first); the custom merge fills this for existing
  // users (migrate-default only — a persisted choice is preserved, no version bump).
  simpleView: 'dashboard',

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
    useStore.getState().addDayEvent({ id, date: todayLocalISO(), ts: Date.now(), kind: 'cbCollateralReading', cbCollateral: v });
    set({ cbCollateralBtc: v });
  },
  setCbAprPct:         (v) => { set({ cbAprPct: v });         useStore.getState().syncSettingsToNostr(); },
  setCbMonthlyPayment:   (v) => { set({ cbMonthlyPayment: v });   useStore.getState().syncSettingsToNostr(); },
  setCbLiquidationPrice: (v) => { set({ cbLiquidationPrice: v }); useStore.getState().syncSettingsToNostr(); },
  setCbPaymentStrategy:  (v) => { set({ cbPaymentStrategy: v });  useStore.getState().syncSettingsToNostr(); },
  setCbLtvTriggerPct:    (v) => { set({ cbLtvTriggerPct: v });    useStore.getState().syncSettingsToNostr(); },
  setCbLtvTargetPct:     (v) => { set({ cbLtvTargetPct: v });     useStore.getState().syncSettingsToNostr(); },
  setCbRotateBackPct:    (v) => { set({ cbRotateBackPct: v });    useStore.getState().syncSettingsToNostr(); },
  setCbEmergencyCeilingPct: (v) => { set({ cbEmergencyCeilingPct: Math.max(20, Math.min(50, v)) }); useStore.getState().syncSettingsToNostr(); },
  setCbLoanBalanceAsOf:      (v) => { set({ cbLoanBalanceAsOf: v });      useStore.getState().syncSettingsToNostr(); },
  setCbLiquidationPriceAsOf: (v) => { set({ cbLiquidationPriceAsOf: v }); useStore.getState().syncSettingsToNostr(); },
  setStrikeLiquidationLtvPct: (v) => { set({ strikeLiquidationLtvPct: v }); useStore.getState().syncSettingsToNostr(); },
  setBlocMinPaymentSource: (v) => { set({ blocMinPaymentSource: v }); useStore.getState().syncSettingsToNostr(); },
  setBlocStatementMinimum: (v) => { set({ blocStatementMinimum: v }); useStore.getState().syncSettingsToNostr(); },
  setBlocMinPaymentDueDay: (v) => { set({ blocMinPaymentDueDay: Math.max(1, Math.min(28, Math.round(v))) }); useStore.getState().syncSettingsToNostr(); },

  setAdvisorStartDate:         (v) => { set({ advisorStartDate: v }); useStore.getState().syncSettingsToNostr(); },
  // §5b — a manual/knob write stamps asOf=today (freshness), so a stale reading can't clobber it (deriveReadingAnchors guard).
  setAdvisorActualBlocBalance: (v) => { set({ advisorActualBlocBalance: v, advisorActualBlocBalanceAsOf: todayLocalISO() }); useStore.getState().syncSettingsToNostr(); },
  setAdvisorActualBlocBalanceAsOf: (v) => { set({ advisorActualBlocBalanceAsOf: v }); useStore.getState().syncSettingsToNostr(); },
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
    set((state) => {
      // Collateral-Truth v20 — graduation retired. collateralAdjustment is NEVER written again; existing
      // stored values stay (historical ledger — never "fix" the data). recomputeBtcHeld still runs for the
      // historical btcHeld chain (display + sync-norm stability). Strike collateral is now reading-anchored
      // (deriveStrikeCollateral over dayLog), independent of this entry.
      const existingAdj = state.monthlyLog.find((e) => e.month === entry.month)?.collateralAdjustment ?? 0;
      const stamped = { ...entry, updatedAt: Date.now(), collateralAdjustment: existingAdj };
      const { [entry.month]: _gone, ...restDel } = state.deletedMonths;   // re-log clears the tombstone
      return {
        monthlyLog: recomputeBtcHeld(upsertEntry(state.monthlyLog, stamped), state.advisorActualBtcHeld),
        deletedMonths: restDel,
        recordsDirty: true,
      };
    });
    publishRecordsNow();
  },
  deleteLogEntry: (month) => {
    set((state) => {
      // Collateral-Truth v20 — restore-on-delete retired (no pending). recomputeBtcHeld fixes the surviving
      // historical chain (stale-btcHeld gap); current Strike collateral is reading-anchored, unaffected.
      return {
        monthlyLog: recomputeBtcHeld(state.monthlyLog.filter((e) => e.month !== month), state.advisorActualBtcHeld),
        deletedMonths: { ...state.deletedMonths, [month]: Date.now() },
        recordsDirty: true,
      };
    });
    publishRecordsNow();
  },
  setShowMiningInLog: (v) => set({ showMiningInLog: v }),

  // Logging Consolidation §2 — the Sign-off absorbs the confirm in ONE atomic write. extras (from the
  // ReviewSheet's SIGN-OFF DETAILS group) land together with confirmed:true → single publish, no
  // half-signed window. The spread keeps source:'daily' so the M2 guard passes. Zero-arg callers unchanged.
  confirmMonth: (month, extras) => {
    const e = useStore.getState().monthlyLog.find((m) => m.month === month);
    if (e) useStore.getState().upsertLogEntry({ ...e, ...extras, confirmed: true });
  },

  // §4 — the honest "signed off too early" flow for a daily-owned month: flip confirmed→false, entry +
  // rollup preserved (spread keeps source:'daily' → M2 guard passes). Replaces the delete-based Undo/Unlog
  // for daily months (DELETE tombstones the month; un-confirm keeps it so the Ledger's events keep rolling).
  unconfirmMonth: (month) => {
    const e = useStore.getState().monthlyLog.find((m) => m.month === month);
    if (e) useStore.getState().upsertLogEntry({ ...e, confirmed: false });
  },

  // One-shot reconcile after the calendar-anniversary bucketing fix — re-roll stored monthlyLog entries that were
  // rolled under the OLD 30.4375 buckets. Diff-guarded: a month re-rolls ONLY when its fresh rollup fields differ
  // OR a boundary strike-collateral move changed its attribution (the entry's collateralAdjustment can't be
  // equality-tested — collateralDelta is separate + folds graduated pending — so compare the delta under the new
  // vs. the legacy bucket). Ascending so month m−1 (priorStocks source) reconciles first. Idempotent (a re-run
  // finds no diffs). Only CHANGED months publish (via rerollMonth→upsertLogEntry); rerollMonth's reopen-on-edit
  // correctly reopens a changed confirmed month.
  reconcileMonthBuckets: () => {
    const start = useStore.getState().advisorStartDate;
    for (let m = 1; m <= 12; m++) {
      const s = useStore.getState();
      const events   = s.dayLog.filter((e) => isMonthlyMeaningful(e) && bucketEventToMonth(e.date, start) === m);
      const existing = s.monthlyLog.find((e) => e.month === m);
      const { entry: fresh } = rollupMonth(s.dayLog, m, start, priorStocksForMonth(s.dayLog, start, m));
      const emptiedDaily    = events.length === 0 && existing?.source === 'daily';
      const collateralMoved = strikeCollateralDelta(s.dayLog, start, m, bucketEventToMonth)
                            !== strikeCollateralDelta(s.dayLog, start, m, legacyBucketEventToMonth);
      if (emptiedDaily || collateralMoved || (events.length > 0 && !sameRollupFields(existing, fresh))) rerollMonth(m);
    }
    set({ monthBucketReconcileDone: true });
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
    refreshStrikeCollateralCache();   // Collateral-Truth v20 — reading-anchored Strike collateral cache
    refreshBalanceAnchors();   // §5b — a new reading re-anchors the live safety gauges (no removed source on add)
    const m = monthOf(event);
    if (m !== null) rerollMonth(m);
    publishRecordsNow();
  },
  updateDayEvent: (event) => {
    // ts is the MERGE VERSION CLOCK — every edit must bump it or the edit ties with (and loses to) the
    // stale copy on other devices; date carries occurrence.
    const bumped = { ...event, ts: Date.now() };
    const before = useStore.getState().dayLog.find((e) => e.id === event.id);
    set((s) => ({ dayLog: s.dayLog.map((e) => (e.id === event.id ? bumped : e)), recordsDirty: true }));
    refreshCbCollateralCache();
    refreshStrikeCollateralCache();   // Collateral-Truth v20 — reading-anchored Strike collateral cache
    refreshBalanceAnchors(readingCtx(before));   // §5b — editing a reading re-anchors; a moved/changed source falls back via the ctx proxy
    const months = new Set<number>();
    const mb = monthOf(before); if (mb !== null) months.add(mb);   // re-roll the OLD month (date may have crossed a boundary)
    const ma = monthOf(bumped); if (ma !== null) months.add(ma);   // and the NEW month
    for (const m of months) rerollMonth(m);
    publishRecordsNow();
  },
  deleteDayEvent: (id) => {
    const before = useStore.getState().dayLog.find((e) => e.id === id);
    if (!before) return;
    set((s) => ({ dayLog: s.dayLog.filter((e) => e.id !== id), deletedDayEvents: { ...s.deletedDayEvents, [id]: Date.now() }, recordsDirty: true }));
    refreshCbCollateralCache();
    refreshStrikeCollateralCache();   // Collateral-Truth v20 — reading-anchored Strike collateral cache
    refreshBalanceAnchors(readingCtx(before));   // §5b — deleting the anchor-source reading falls back to the date-latest survivor
    const m = monthOf(before);
    if (m !== null) rerollMonth(m);
    publishRecordsNow();
  },
  // P2 undo (Snackbar) — restore a just-deleted event. The store discarded the object on delete, so the CALLER
  // passes the retained DayEvent. Re-add with a FRESH ts (Date.now()) + strip the tombstone — the canonical
  // edit-after-delete revive (mergeRecords: an event survives iff tombstone.ts is NOT strictly > event.ts, so a
  // bumped-ts restore beats any tombstone already published within the 5s window on every device). Mirrors the
  // add/delete mutators' cache/reroll/publish tail.
  undoDayEventDeletion: (event) => {
    const restored = { ...event, ts: Date.now() };
    set((s) => {
      const rest = { ...s.deletedDayEvents };
      delete rest[event.id];
      return {
        dayLog: [...s.dayLog.filter((e) => e.id !== event.id), restored],   // filter guards a double-undo
        deletedDayEvents: rest,
        recordsDirty: true,
      };
    });
    refreshCbCollateralCache();
    refreshStrikeCollateralCache();
    refreshBalanceAnchors(readingCtx(restored));
    const m = monthOf(restored);
    if (m !== null) rerollMonth(m);
    publishRecordsNow();
  },
  // P3 — raw write-back from the records merge (sync.ts). FOLDS the Seam-2 derive: set dayLog AND recompute
  // cbCollateralBtc ONCE from the merged array. NO rollup / per-event derive — keeps the sync apply path actions-only.
  setDayLog: (events) => set((s) => ({ dayLog: events, cbCollateralBtc: deriveCbCollateral(events, s.cbCollateralBtc), strikeCollateralBtc: deriveStrikeCollateral(events, s.strikeCollateralBtc) })),
  setCbLtvAction: (v) => set({ cbLtvAction: v }),

  // §5b — the emit-conversion for the SafetyDashboard inline editors + the Quick-Setup position modal: a manual
  // re-anchor becomes a journaled balanceReading (one write path). Synthesizes the UN-edited half from current
  // derived state — the CB balance defaults to accruedCbBalance (re-basing accrued interest to today, restoring the
  // R2 confirm-sheet auto-accrual), the Strike LTV to computeStrikeLtv, LTVs as fractions. addDayEvent → the seam
  // re-anchors from it. Today-dated → "last action wins" (a manual re-anchor is the newest assertion).
  emitBalanceReading: (overrides) => {
    const s = useStore.getState();
    const price = s.btcPrice;
    const btcHeld = s.getCurrentBtcHeld();
    // v20 — a strikeCollateral override makes this a COLLATERAL anchor: the reading carries it and the LTV is
    // computed against the NEW collateral (not getCurrentBtcHeld). Absent → byte-identical to today (debt re-anchor).
    const collateral = overrides.strikeCollateral ?? btcHeld;
    const strikeBal = overrides.strikeBal ?? s.advisorActualBlocBalance;
    const reading: Extract<DayEvent, { kind: 'balanceReading' }>['reading'] = {
      strikeBal,
      strikeLtv: computeStrikeLtv(strikeBal, collateral, price),   // fraction — from the NEW collateral when overridden
      price,
      ...(overrides.strikeCollateral !== undefined ? { strikeCollateral: overrides.strikeCollateral } : {}),
    };
    // CB half only when a CB field is genuinely asserted (CB box) — a Strike-only re-anchor (Strike box /
    // Quick Setup) emits a Strike-only reading so it never re-bases the CB balance or fake-freshens the CB
    // freshness label. The FAB "Set balance" path is separate (buildEventsFromSheet) and requires both.
    if (s.hasCbLoan && (overrides.cbBal !== undefined || overrides.cbLiqPrice !== undefined)) {
      const cbBal = overrides.cbBal ?? accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf);
      reading.cbBal = cbBal;
      reading.cbLtv = cbMetrics(cbBal, s.cbCollateralBtc, price, s.cbLtvTriggerPct).ltv;   // fraction
      reading.cbCollateral = s.cbCollateralBtc;
      const liq = overrides.cbLiqPrice ?? (s.cbLiquidationPrice > 0 ? s.cbLiquidationPrice : undefined);
      if (liq !== undefined) reading.cbLiqPrice = liq;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `read-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    useStore.getState().addDayEvent({ id, date: todayLocalISO(), ts: Date.now(), kind: 'balanceReading', reading });
  },

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
  // Backup gate (R2a-1). Null on a fresh install AND — via the custom persist `merge`, which fills absent keys
  // from `current` — for every plan established before R2. That is the STRUCTURAL grandfathering: a legacy owner
  // has keyProvenance null → isBackupGateSatisfied() → true → never gated. Deliberately NO migration.
  // R2c-6-final: standalone-seeded from GATE_PROVENANCE_KEY (survives the escape hatch — bypass 1); the `merge`
  // still overrides authoritatively on rehydrate.
  keyProvenance:      seedKeyProvenance,
  backupVerifiedAt:   null,
  viewers:            [],   // Multi-viewer roster (M1) — empty on fresh install; the owner adds viewers via Sharing
  nextViewerIndex:    0,
  viewerMode:          false,
  viewerWriterPubkey:  null,
  viewerSecretKey:     null,
  viewerDisplayName:   null,   // Viewer V3 — device-local persisted, never synced
  viewerKeyWrapped:    null,
  viewerKeyWrapMeta:   null,
  viewerUnlocked:      false,
  viewerDataLoaded:    false,
  viewerLastSyncAt:    null,
  viewerSafeSnapshot:  null,
  viewerPreview:       false,
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

  // Backup gate (R2a-1). WRITE-ONCE: provenance is a property of the identity, stamped once at establishment
  // (always BEFORE the establishing syncNow, or a generated key's first sync publishes ungated). A null write
  // is the explicit identity-teardown CLEAR (disconnectNostr / "Remove local key"); resetAndResync RETAINS the
  // identity and must NOT clear. Overwriting one non-null with a different non-null is a bug → warn + ignore
  // (otherwise generate→disconnect→import would leave 'generated' frozen with no verification UI to un-gate it).
  setKeyProvenance: (v) => {
    const cur = useStore.getState().keyProvenance;
    if (v !== null && cur !== null) {
      if (cur !== v) console.warn(`keyProvenance already set (${cur}) — ignoring ${v}`);
      return;
    }
    // R2c-6-final: write through to the standalone GATE_PROVENANCE_KEY (outside the blob) so provenance survives
    // the escape hatch. AFTER the write-once guard so an ignored write never touches storage. The null clear-branch
    // (disconnectNostr / "Remove local key") removeItem's it — provenance dies with the identity.
    try { v == null ? localStorage.removeItem(GATE_PROVENANCE_KEY) : localStorage.setItem(GATE_PROVENANCE_KEY, v); } catch { /* noop */ }
    set({ keyProvenance: v });
  },
  // Stamping verification OPENS the gate, so it must also WAKE the engine. It (a) sets the field, (b) marks
  // settingsDirty DIRECTLY — syncSettingsToNostr early-returns on !initialSettingsPullDone, which is still
  // false precisely because the gate held syncNow off all session — and (c) runs the SAME initial-pull-then-
  // publish sequence a fresh authentication runs: syncNow (cf. establishOwner.ts). No second wake mechanism.
  // ⚠ ORDER: set() FIRST, so the gate reads satisfied inside doSyncNow's guards + the publish guards.
  // `nostr` is optional (tests assert state without a signer; OwnerKeySetup relies on establishLocalOwner's
  // own internal syncNow as the wake). v === null is the teardown clear: no dirty, no wake.
  // syncNow is DYNAMIC-imported to avoid the useStore ↔ syncNow cycle (same as publish.ts below).
  //
  // ⚠ THE PRE-AUTH GUARD IS LOAD-BEARING (seed-clobber, Fix C). `settingsDirty` is PERSISTED (it rides
  // partializeState's ...rest) and doSyncNow flips initialSettingsPullDone(true) BEFORE its publish-if-dirty
  // step — so Fix D's seed-guard is structurally unreachable from inside syncNow, and Fix C (nothing may
  // dirty pre-pull) is the ONLY thing protecting the first sync. The K2 bridge calls this on an
  // unauthenticated, untouched-SEED store; dirtying there would (a) publish the seed as the owner's first
  // settings event before the numbers wizard runs, and (b) if the establish then THROWS (Face ID cancelled),
  // leave settingsDirty:true persisted into a later real login → a seed payload published over the owner's
  // real relay settings under whole-object LWW. So: pre-auth, only the field is set. It rides the wizard's
  // first genuine settings publish (it's in buildSettingsPayload), exactly as Phase 1.5 documents.
  setBackupVerifiedAt: (v, nostr) => {
    if (v == null) { set({ backupVerifiedAt: null }); return; }
    set({ backupVerifiedAt: v });
    const s = useStore.getState();
    if (!s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey) return;   // pre-auth stamp (K2 bridge) — never dirty a seed store
    set({ settingsDirty: true });
    if (nostr) void import('../lib/nostr/syncNow').then((m) => m.syncNow(nostr)).catch((e) => nostrLog('warn', 'backup-verify wake failed', e));
  },

  // Multi-viewer roster (M1) — SYNCS in the owner's settings:v1 (cross-device) but stripped from the viewer snapshot.
  // addViewerSlot assigns index = nextViewerIndex then increments it (monotonic — an index is NEVER reused).
  addViewerSlot: (slot) => {
    const { viewers, nextViewerIndex } = useStore.getState();
    set({ viewers: [...viewers, { ...slot, index: nextViewerIndex }], nextViewerIndex: nextViewerIndex + 1 });
    useStore.getState().syncSettingsToNostr();
  },
  updateViewerSlot: (index, patch) => {
    const { viewers } = useStore.getState();
    set({ viewers: viewers.map((v) => (v.index === index ? { ...v, ...patch } : v)) });
    useStore.getState().syncSettingsToNostr();
  },
  removeViewerSlot: (index) => {
    const { viewers } = useStore.getState();
    set({ viewers: viewers.filter((v) => v.index !== index) });   // index NOT reused (nextViewerIndex never regresses)
    useStore.getState().syncSettingsToNostr();
  },
  setViewerMode:         (v) => set({ viewerMode: v }),          // viewer-side, device-local — never syncs
  setViewerWriterPubkey: (v) => set({ viewerWriterPubkey: v }),
  setViewerSecretKey:    (v) => set({ viewerSecretKey: v }),
  setViewerDisplayName:  (v) => set({ viewerDisplayName: v }),   // device-local — no syncSettingsToNostr
  setViewerKeyWrapped:   (v) => set({ viewerKeyWrapped: v }),    // Phase 3 — device-local, never syncs
  setViewerKeyWrapMeta:  (v) => set({ viewerKeyWrapMeta: v }),
  setViewerUnlocked:     (v) => set({ viewerUnlocked: v }),      // transient (not persisted)
  setViewerDataLoaded:   (v) => set({ viewerDataLoaded: v }),    // transient (not persisted)
  setViewerLastSyncAt:   (v) => set({ viewerLastSyncAt: v }),    // transient (not persisted)
  setViewerSafeSnapshot: (v) => set({ viewerSafeSnapshot: v }),  // transient (not persisted) — Viewer V2
  setViewerPreview: (v) => set({ viewerPreview: v }),  // transient (not persisted) — owner preview toggle
  setStoreUnlocked:      (v) => set({ storeUnlocked: v }),       // transient (not persisted)
  // Data-remanence fix: reset every viewer-hydrated financial/records/strike field to its seed so decrypted data
  // never outlives the authorizing key. Layout prefs (tabOrder/hiddenTabs/simpleMode/btcBuyingUnit) intentionally
  // LEFT (not sensitive; clearing simpleMode would yank the viewer's UI). VIEWER paths ONLY — no syncSettingsToNostr.
  clearViewerData: () => set({
    income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000,
    advisorStartDate: todayLocalISO(),
    advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null, advisorMonthStartBalance: 0, advisorActualBtcHeld: 0,
    cbLoanBalance: 60000, cbCollateralBtc: 1.48, strikeCollateralBtc: 0, cbAprPct: 4.77, hasCbLoan: false,
    ndpLastPaidDate: null, cbLiquidationPrice: 0, cbMonthlyPayment: 0, cbPaymentStrategy: 'monthly',
    cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55, cbEmergencyCeilingPct: 30,
    cbLoanBalanceAsOf: null, cbLiquidationPriceAsOf: null, strikeLiquidationLtvPct: 85,
    blocMinPaymentSource: 'roll', blocStatementMinimum: null, blocMinPaymentDueDay: 15,
    advisorSkipBlocDraw: false, advisorSkipCbPayment: false, advisorSkipBtcBuying: false,
    monthlyLog: [], deletedMonths: {},
    strikeUsdBalance: null, strikeBtcAvailable: null, strikeRate: null,
    viewers: [], nextViewerIndex: 0,   // Multi-viewer roster (M1) — reset the owner-config roster to seed
    viewerDataLoaded: false,
    viewerSafeSnapshot: null,   // Viewer V2 — drop the C-safe snapshot too (data-remanence)
    initialSettingsPullDone: false,   // re-arm the seed-clobber guard after resetting to seed defaults
  }),

  // Owner-recovery reset (escape hatch). Mirrors clearViewerData's financial/records/strike seed-reset but for the
  // OWNER. Pure local set — NO syncSettingsToNostr / NO publish (resetAndResync controls when/whether the pull runs).
  // Deliberately PRESERVES: writerKeyWrapped/Meta (standalone — needed to re-auth), nostr identity/relays, device
  // prefs, and the viewers roster (re-hydrate from the pull). Reachable ONLY from the escape hatch.
  resetPlanToSeeds: () => set({
    income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000,
    advisorStartDate: todayLocalISO(),
    advisorActualBlocBalance: 0, advisorActualBlocBalanceAsOf: null, advisorMonthStartBalance: 0, advisorActualBtcHeld: 0,
    cbLoanBalance: 60000, cbCollateralBtc: 1.48, strikeCollateralBtc: 0, cbAprPct: 4.77, hasCbLoan: false,
    ndpLastPaidDate: null, cbLiquidationPrice: 0, cbMonthlyPayment: 0, cbPaymentStrategy: 'monthly',
    cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55, cbEmergencyCeilingPct: 30,
    cbLoanBalanceAsOf: null, cbLiquidationPriceAsOf: null, strikeLiquidationLtvPct: 85,
    blocMinPaymentSource: 'roll', blocStatementMinimum: null, blocMinPaymentDueDay: 15,
    advisorSkipBlocDraw: false, advisorSkipCbPayment: false, advisorSkipBtcBuying: false,
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
    if (!s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey || !isBackupGateSatisfied(s)) return;   // pre-login edits must NOT mark dirty (would block first hydrate); an unbacked-up generated key must not dirty either — setBackupVerifiedAt marks dirty itself when the gate opens
    if (!s.initialSettingsPullDone) return;   // don't dirty/publish before the first pull establishes a baseline (prevents a benign post-auth setter dirtying the seed store → seed-clobber)
    set({ settingsDirty: true });
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => { publishSettingsNow(); }, 2000);
  },

  nostrSyncing:    false,
  setNostrSyncing: (v) => set({ nostrSyncing: v }),
  initialSettingsPullDone:    false,   // session-transient — reset each boot (never persisted/synced)
  setInitialSettingsPullDone: (v) => set({ initialSettingsPullDone: v }),
  // R2b-2 — see the interface doc + the remotePlanFoundResolved latch above.
  remotePlanFound:    null,   // session-transient — not yet determined
  setRemotePlanFound: (v) => set({ remotePlanFound: v }),   // Dismiss (→ null); deliberately does NOT unlatch
  recordRemotePlanFound: (v) => {
    if (remotePlanFoundResolved) return;   // exactly once per session — a dismissed notice can't be re-opened
    remotePlanFoundResolved = true;
    set({ remotePlanFound: v });
  },
  // R2c-2 — session-transient nag dismissal (no latch needed — single writer; see the interface doc).
  backupNagDismissed: false,
  dismissBackupNag:   () => set({ backupNagDismissed: true }),
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
      'advisorStartDate', 'advisorActualBlocBalance', 'advisorActualBlocBalanceAsOf', 'advisorMonthStartBalance', 'advisorActualBtcHeld',
      'cbLoanBalance', 'cbAprPct', 'hasCbLoan',   // cbCollateralBtc removed (P2a Seam 2 — local derived cache; cross-device sync suspended P2a→P3)
      'ndpLastPaidDate', 'tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit',
      'cbLiquidationPrice', 'cbMonthlyPayment', 'cbPaymentStrategy',
      'cbLtvTriggerPct', 'cbLtvTargetPct', 'cbRotateBackPct', 'cbEmergencyCeilingPct',
      'cbLoanBalanceAsOf', 'cbLiquidationPriceAsOf', 'strikeLiquidationLtvPct',
      'blocMinPaymentSource', 'blocStatementMinimum', 'blocMinPaymentDueDay',
      'advisorSkipBlocDraw', 'advisorSkipCbPayment', 'advisorSkipBtcBuying',
      // pendingCollateralAdjustment RETIRED (Collateral-Truth v20) — Strike collateral is reading-anchored (records channel); a stale value in an old remote payload is ignored by omission
      'nostrRelays',                       // C: synced relay list (guarded below — replace-on-hydrate)
      'backupVerifiedAt',                  // Backup gate (R2a-1) — synced; null-incoming guarded below (one-way latch)
      'viewers', 'nextViewerIndex',        // Multi-viewer roster (M1) — synced; empty-incoming guarded below
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
    // Roster guard (M1, mirrors the relay guard): an EMPTY incoming viewers roster (a fresh/un-established session)
    // must never clobber a populated local roster. Skip the roster FIELDS (viewers + nextViewerIndex together, so
    // the monotonic counter never regresses); a genuinely populated incoming roster still hydrates.
    if ('viewers' in update) {
      const incoming = update.viewers as ViewerSlot[] | undefined;
      const localRoster = useStore.getState().viewers;
      const incomingEmpty = !Array.isArray(incoming) || incoming.length === 0;
      if (incomingEmpty && localRoster.length > 0) {
        delete (update as Record<string, unknown>).viewers;
        delete (update as Record<string, unknown>).nextViewerIndex;
      }
    }
    // Verification is a ONE-WAY LATCH: an incoming null must never un-verify a device that already latched.
    // Who publishes an explicit null: a NEW-BUNDLE peer that is legacy (provenance null) or not-yet-verified —
    // a stale pre-R2 bundle omits the field entirely (undefined → whitelist skips it) and is already safe.
    // Third member of the whole-object-LWW skip-guard class (nostrRelays, viewers, this) — the entire class is
    // scheduled for structural deletion at Phase 4e when settings move to plan-events (absent vs null vs set
    // become first-class in the fold).
    if ('backupVerifiedAt' in update) {
      const incoming = update.backupVerifiedAt as number | null | undefined;
      if (incoming == null && useStore.getState().backupVerifiedAt != null) {
        delete (update as Record<string, unknown>).backupVerifiedAt;
      }
    }
    set(update);
  },
    }),
    {
      name: 'personal-bloc-store',
      version: 21,
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
        const gatePubkey     = (() => { try { return localStorage.getItem(GATE_PUBKEY_KEY); } catch { return null; } })();
        const gateMethod     = (() => { try { return localStorage.getItem(GATE_METHOD_KEY); } catch { return null; } })();
        const gateProvenance = (() => { try { return localStorage.getItem(GATE_PROVENANCE_KEY); } catch { return null; } })();
        return { ...current, ...gateHydratedIdentity(persisted, gatePubkey, gateMethod, gateProvenance) } as typeof current;
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
          state.strikeCollateralBtc = deriveStrikeCollateral(state.dayLog ?? [], state.strikeCollateralBtc);   // Collateral-Truth v20
        }
      },
    }
  )
);
