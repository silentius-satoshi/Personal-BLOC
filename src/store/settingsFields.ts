// The synced-settings field list — the SINGLE source of truth, zero imports (so the pure plan-backup validator can
// pull it without dragging in useStore). Lifted out of the retired hydrateSettings' closure (Phase 4e retired it).
//
// SETTINGS_FIELDS = buildSettingsPayload's keys = PLAN_EVENT_FIELDS ∪ PREFS_FIELDS (the plan backup + the trusted
// viewer snapshot's source; settings:v1, the channel it was named for, is retired).
// Two derived subsets serve Plan Import/Restore:
//   VALIDATE_WHITELIST = SETTINGS_FIELDS − transport (viewers/nextViewerIndex/nostrRelays). A backup-file settings key
//     outside this set is a tamper/foreign tripwire → reject. `backupVerifiedAt` stays IN it (every export carries it).
//   APPLY_FIELDS = VALIDATE_WHITELIST − backupVerifiedAt. The restore apply NEVER writes backupVerifiedAt — the stamp
//     attests KEY custody, not plan data; a backup restores a plan onto whatever key the device holds. (The same
//     four keys VIEWER_SNAPSHOT_STRIP removes; that strip also drops coldStorageBtcAsOf.)
export const SETTINGS_FIELDS = [
  'income', 'expenses', 'blocApr', 'creditLine',
  'advisorStartDate', 'advisorActualBlocBalance', 'advisorActualBlocBalanceAsOf', 'advisorMonthStartBalance', 'advisorActualBtcHeld',
  'cbLoanBalance', 'cbAprPct', 'hasCbLoan',   // cbCollateralBtc excluded (local derived cache, converges via the dayLog on records:v1)
  'ndpLastPaidDate', 'tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit',
  'cbLiquidationPrice', 'cbMonthlyPayment', 'cbPaymentStrategy',
  'cbLtvTriggerPct', 'cbLtvTargetPct', 'cbRotateBackPct', 'cbEmergencyCeilingPct',
  'cbLoanBalanceAsOf', 'cbLiquidationPriceAsOf', 'strikeLiquidationLtvPct',
  'blocMinPaymentSource', 'blocStatementMinimum', 'blocMinPaymentDueDay',
  'coldStorageBtc',   // a real owner-entered balance, so it syncs like any other plan setting
  'coldStorageBtcAsOf',   // epoch ms the cold anchor was entered — travels atomically with it (paired emit)
  'advisorSkipBlocDraw', 'advisorSkipCbPayment', 'advisorSkipBtcBuying',
  // The plan of record (Run 1, D1) — the owner's SAVED support policy (lib/planPolicy). No off switch: policy-off is a
  // face what-if only. Plan events like any plan field; in the backup; EXPOSED to a trusted viewer (D9).
  'policyCbStopAtSupportPct', 'policyStrikeStopAtSupportPct', 'policyAccumulateBelow', 'policyPayDownAbove',
  'policyBearBufferMonths', 'policyCashReserveMonths',
  'nostrRelays',                       // C: synced relay list (transport — a plan event only on a user edit)
  'backupVerifiedAt',                  // Backup gate (R2a-1) — synced; a one-way latch (no null event exists)
  'viewers', 'nextViewerIndex',        // Multi-viewer roster (M1) — synced as plan events
] as const;

// Phase 4e — what a TRUSTED viewer snapshot's settings carry: SETTINGS_FIELDS minus the five keys the owner strips
// (buildViewerSnapshotPayload: the roster + its counter, the relay set, the key-custody stamp, and the cold anchor's
// stamp — cold arrives pre-derived). applyViewerSettings whitelists to exactly this set, so a snapshot can never write
// a viewer's own transport config or gate stamp. A test pins it equal to the builder's trusted key set.
export const VIEWER_SNAPSHOT_STRIP = ['viewers', 'nextViewerIndex', 'nostrRelays', 'backupVerifiedAt', 'coldStorageBtcAsOf'] as const;
export const VIEWER_SETTINGS_FIELDS: readonly string[] =
  SETTINGS_FIELDS.filter((f) => !(VIEWER_SNAPSHOT_STRIP as readonly string[]).includes(f));

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
// prefs:v1 rather than becoming a plan event log. PLAN = everything else (41 fields — the plan of record added 6). backupVerifiedAt is a
// PLAN field (R2a-1; it joined SETTINGS_FIELDS after the 4a design lock was written — Exclude keeps it in).
export const PREFS_FIELDS = ['tabOrder', 'hiddenTabs', 'simpleMode', 'btcBuyingUnit'] as const;

type SettingsField = (typeof SETTINGS_FIELDS)[number];
export type PrefsField = (typeof PREFS_FIELDS)[number];
export type PlanField = Exclude<SettingsField, PrefsField>;

// A type-guard predicate so .filter() narrows to readonly PlanField[] (NOT string[] / the wide 45-union) —
// the correct realization of the lock's `(typeof PLAN_EVENT_FIELDS)[number]`; a naive filter widens the type.
export const PLAN_EVENT_FIELDS = SETTINGS_FIELDS.filter(
  (f): f is PlanField => !(PREFS_FIELDS as readonly string[]).includes(f),
) as readonly PlanField[];
