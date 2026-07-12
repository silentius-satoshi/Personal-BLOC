// Persist config (Phase 1c) — partializeState + migrateState + the persist OPTIONS, moved verbatim out of the store
// module. Imports bootstrap (seeds/consts/gate) + leaves; does NOT import the composed store. persistOptions carries
// an explicit type so its standalone merge/onRehydrateStorage callbacks keep their param types (no implicit any).
import { createJSONStorage, type PersistOptions } from 'zustand/middleware';
import type { StoreState } from './types';
import type { DayEvent } from '../simulation/types';
import { deriveCbCollateral, deriveStrikeCollateral } from '../simulation/logUtils';
import { todayLocalISO } from '../utils/format';
import { CURRENT_STORE_VERSION } from '../lib/storeVersion';
import { encryptedStorage } from '../lib/store/storeCrypto';
import {
  storeEncEnabled, gateHydratedIdentity,
  GATE_PUBKEY_KEY, GATE_METHOD_KEY, GATE_PROVENANCE_KEY,
  seedWriterKeyWrapped, seedWriterKeyWrapMeta,
  seedOnboardingComplete, seedNostrPubkey, seedNostrSigningMethod,
} from './bootstrap';

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

export const persistOptions: PersistOptions<StoreState, ReturnType<typeof partializeState>> = {
      name: 'personal-bloc-store',
      version: CURRENT_STORE_VERSION,
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
};
