// viewerSlice (Phase 1c) — the owner's viewer roster + viewer-side (read-client) fields + clearViewerData/resetPlanToSeeds.
import type { StoreState, StoreSet, StoreGet } from '../types';
import { todayLocalISO } from '../../utils/format';

type ViewerSlice = Pick<StoreState,
  | 'viewers' | 'nextViewerIndex' | 'viewerMode' | 'viewerWriterPubkey' | 'viewerSecretKey' | 'viewerDisplayName'
  | 'viewerKeyWrapped' | 'viewerKeyWrapMeta' | 'viewerUnlocked' | 'viewerDataLoaded' | 'viewerLastSyncAt'
  | 'viewerSafeSnapshot' | 'viewerPreview' | 'storeUnlocked' | 'addViewerSlot' | 'updateViewerSlot' | 'removeViewerSlot'
  | 'setViewerMode' | 'setViewerWriterPubkey' | 'setViewerSecretKey' | 'setViewerDisplayName' | 'setViewerKeyWrapped'
  | 'setViewerKeyWrapMeta' | 'setViewerUnlocked' | 'setViewerDataLoaded' | 'setViewerLastSyncAt' | 'setViewerSafeSnapshot'
  | 'setViewerPreview' | 'setStoreUnlocked' | 'clearViewerData' | 'resetPlanToSeeds'
>;

export const createViewerSlice = (set: StoreSet, get: StoreGet): ViewerSlice => ({
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
  // Multi-viewer roster (M1) — a whole-array plan field (4c: op-events are the documented D2 multi-writer upgrade
  // path, NOT built). SYNCS via the plan-events log; stripped from the viewer snapshot. addViewerSlot assigns
  // index = nextViewerIndex then increments it (monotonic — an index is NEVER reused); both fields ride ONE emit
  // (one shared ts) so viewers + nextViewerIndex can never fold apart.
  addViewerSlot: (slot) => {
    const { viewers, nextViewerIndex } = get();
    get().emitPlanSets([['viewers', [...viewers, { ...slot, index: nextViewerIndex }]], ['nextViewerIndex', nextViewerIndex + 1]]);
  },
  updateViewerSlot: (index, patch) => {
    const { viewers } = get();
    get().emitPlanSets([['viewers', viewers.map((v) => (v.index === index ? { ...v, ...patch } : v))]]);
  },
  removeViewerSlot: (index) => {
    const { viewers } = get();
    get().emitPlanSets([['viewers', viewers.filter((v) => v.index !== index)]]);   // index NOT reused (nextViewerIndex never regresses)
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
});
