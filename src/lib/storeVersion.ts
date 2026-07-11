// The ONE store-version constant. Zero imports — safe to pull from anywhere, including demoSeed.ts (whose
// IMPORT-ORDER CONSTRAINT forbids transitively importing useStore) and the pure plan-backup validator.
//
// Consumers: useStore's persist `version:`, exportPlan's `storeVersion:`, demoSeed's DEMO_SEED_STORE_VERSION,
// and validatePlanBackup's version gate. ⚠ e2e/helpers.ts keeps its OWN pinned literal — Playwright's config
// does not resolve `src/` imports.
//
// ⚠ BUMP DISCIPLINE: a useStore persist `version` bump = bump CURRENT_STORE_VERSION here (it cascades to
// persist/export/demoSeed/validator) + the standalone e2e/helpers.ts copy.
export const CURRENT_STORE_VERSION = 21;
