// Zustand store (Phase 1c) — COMPOSITION ONLY. The state/actions live in domain slice files (src/store/slices/*),
// the module-init plumbing in bootstrap.ts, the daily-routing helpers in dailyRouting.ts, and the persist config +
// partialize/migrate in persistConfig.ts. Slice files never import THIS module (the cycle rule); they receive
// zustand's set/get. The re-exports below keep every external import path working unchanged (bootstrap/persistConfig/
// types are leaves that don't import this file → re-exports are cycle-safe, unlike Phase 1b's engine).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StoreState } from './types';
import { persistOptions } from './persistConfig';
import { createUiSlice } from './slices/uiSlice';
import { createPlanInputsSlice } from './slices/planInputsSlice';
import { createMiningSlice } from './slices/miningSlice';
import { createCbLoanSlice } from './slices/cbLoanSlice';
import { createAdvisorJournalSlice } from './slices/advisorJournalSlice';
import { createDayLogSlice } from './slices/dayLogSlice';
import { createIdentitySlice } from './slices/identitySlice';
import { createViewerSlice } from './slices/viewerSlice';
import { createSyncSlice } from './slices/syncSlice';

// Import-compat re-exports (verified surface): storeEncEnabled (DevPanel, session.ts) · partializeState/migrateState/
// gateHydratedIdentity (tests) · StoreState/ViewerSlot (safetyView, exportPlan, SharingPage, tests) · the sim types +
// KeyProvenance (MiningMain; the full line kept for escapeHatch.test.ts's `import * as`).
export type { StoreState, ViewerSlot } from './types';
export type { MiningDevice, MiningInputs, MiningCurrency, MiningStrategy, MonthlyLogEntry } from '../simulation/types';
export type { KeyProvenance } from '../lib/backupGate';
export { storeEncEnabled, gateHydratedIdentity } from './bootstrap';
export { partializeState, migrateState } from './persistConfig';

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...createUiSlice(set, get),
      ...createPlanInputsSlice(set, get),
      ...createMiningSlice(set, get),
      ...createCbLoanSlice(set, get),
      ...createAdvisorJournalSlice(set, get),
      ...createDayLogSlice(set, get),
      ...createIdentitySlice(set, get),
      ...createViewerSlice(set, get),
      ...createSyncSlice(set, get),
    }),
    persistOptions,
  ),
);
