// The synced-settings field list — the SINGLE source of truth, zero imports (so the pure plan-backup validator can
// pull it without dragging in useStore). Lifted verbatim out of hydrateSettings' closure.
//
// SETTINGS_FIELDS = every field that rides the settings:v1 channel (the hydrate whitelist + buildSettingsPayload keys).
// Two derived subsets serve Plan Import/Restore:
//   VALIDATE_WHITELIST = SETTINGS_FIELDS − transport (viewers/nextViewerIndex/nostrRelays). A backup-file settings key
//     outside this set is a tamper/foreign tripwire → reject. `backupVerifiedAt` stays IN it (every export carries it).
//   APPLY_FIELDS = VALIDATE_WHITELIST − backupVerifiedAt. The restore apply NEVER writes backupVerifiedAt — the stamp
//     attests KEY custody, not plan data; a backup restores a plan onto whatever key the device holds. (Mirrors the
//     4-key strip at useStore.ts buildViewerSnapshotPayload.)
export const SETTINGS_FIELDS = [
  'income', 'expenses', 'blocApr', 'creditLine',
  'advisorStartDate', 'advisorActualBlocBalance', 'advisorActualBlocBalanceAsOf', 'advisorMonthStartBalance', 'advisorActualBtcHeld',
  'cbLoanBalance', 'cbAprPct', 'hasCbLoan',   // cbCollateralBtc excluded (local derived cache, converges via the dayLog on records:v1)
  'ndpLastPaidDate', 'tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit',
  'cbLiquidationPrice', 'cbMonthlyPayment', 'cbPaymentStrategy',
  'cbLtvTriggerPct', 'cbLtvTargetPct', 'cbRotateBackPct', 'cbEmergencyCeilingPct',
  'cbLoanBalanceAsOf', 'cbLiquidationPriceAsOf', 'strikeLiquidationLtvPct',
  'blocMinPaymentSource', 'blocStatementMinimum', 'blocMinPaymentDueDay',
  'advisorSkipBlocDraw', 'advisorSkipCbPayment', 'advisorSkipBtcBuying',
  'nostrRelays',                       // C: synced relay list (transport — guarded in hydrateSettings)
  'backupVerifiedAt',                  // Backup gate (R2a-1) — synced; one-way latch in hydrateSettings
  'viewers', 'nextViewerIndex',        // Multi-viewer roster (M1) — synced; empty-incoming guarded in hydrateSettings
] as const;

// Transport / relationship config — re-establishable, device-specific. A restore must NEVER touch these (rewriting a
// live viewer roster or relay list would brick a viewer / change transport), so a file carrying one is rejected.
export const TRANSPORT_FIELDS = ['viewers', 'nextViewerIndex', 'nostrRelays'] as const;

export const VALIDATE_WHITELIST: ReadonlySet<string> = new Set(
  SETTINGS_FIELDS.filter((f) => !(TRANSPORT_FIELDS as readonly string[]).includes(f)),
);

export const APPLY_FIELDS: ReadonlySet<string> = new Set(
  [...VALIDATE_WHITELIST].filter((f) => f !== 'backupVerifiedAt'),
);

// ── Phase 4b — plan-events partition ─────────────────────────────────────────────────────────────────
// Splits SETTINGS_FIELDS into the event-sourced PLAN partition and the whole-object-LWW PREFS partition.
// PREFS = device-taste cosmetics (D1): a stale clobber is harmless + self-corrects, so they stay LWW on
// prefs:v1 rather than becoming a plan event log. PLAN = everything else (33 fields). backupVerifiedAt is a
// PLAN field (R2a-1; it joined SETTINGS_FIELDS after the 4a design lock was written — Exclude keeps it in).
export const PREFS_FIELDS = ['tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit'] as const;

type SettingsField = (typeof SETTINGS_FIELDS)[number];
export type PrefsField = (typeof PREFS_FIELDS)[number];
export type PlanField = Exclude<SettingsField, PrefsField>;

// A type-guard predicate so .filter() narrows to readonly PlanField[] (NOT string[] / the wide 37-union) —
// the correct realization of the lock's `(typeof PLAN_EVENT_FIELDS)[number]`; a naive filter widens the type.
export const PLAN_EVENT_FIELDS = SETTINGS_FIELDS.filter(
  (f): f is PlanField => !(PREFS_FIELDS as readonly string[]).includes(f),
) as readonly PlanField[];
