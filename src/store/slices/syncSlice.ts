// syncSlice (Phase 1c) — session/auth + sync flags + the plan/prefs emit layer + the two whitelist appliers +
// applyPlanBackup. The remotePlanFoundResolved latch lives here (its only consumer). Phase 4e retired the settings:v1
// bridge's half of this slice (its publisher, dirty flag, sync clock, fallback stamp and hydrateSettings' guard class).
import type { StoreState, StoreSet, StoreGet } from '../types';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';
import type { PlanEvent, PlanField } from '../../lib/planEvents/types';
import { deriveCbCollateral, deriveStrikeCollateral } from '../../simulation/logUtils';
import { APPLY_FIELDS, PLAN_EVENT_FIELDS, PREFS_FIELDS, VIEWER_SETTINGS_FIELDS } from '../settingsFields';
import { nextPlanEventTs, makePlanEventId } from '../../lib/planEvents/genesis';
import { getDeviceTag } from '../../lib/nostr/deviceTag';
import { kickRecordsPublish } from '../bootstrap';

// Phase 4c — the highest ts in the plan log (0 when empty). emitPlanSets/applyPlanBackup stamp
// nextPlanEventTs(maxTs) so a single action's events share ONE ts (AsOf pairs never tear) + the log
// keeps a strict per-device monotonic order.
const maxPlanTs = (evs: PlanEvent[]) => evs.reduce((m, e) => (e.ts > m ? e.ts : m), 0);

// R2b-2 — the remotePlanFound SESSION LATCH. Module-scoped (resets on every boot). Its only consumer is
// recordRemotePlanFound below. See the interface doc for why a latch (a dismissed notice must not re-open).
let remotePlanFoundResolved = false;

type SyncSlice = Pick<StoreState,
  | 'isAuthenticated' | 'setIsAuthenticated' | 'nostrSigner' | 'setNostrSigner' | 'nostrSyncing'
  | 'setNostrSyncing' | 'initialSettingsPullDone' | 'setInitialSettingsPullDone' | 'remotePlanFound' | 'setRemotePlanFound'
  | 'recordRemotePlanFound' | 'backupNagDismissed' | 'dismissBackupNag' | 'nostrReconnectNeeded' | 'setNostrReconnectNeeded'
  | 'lastRecordsSyncAt' | 'setLastRecordsSyncAt' | 'recordsDirty'
  | 'setRecordsDirty' | 'deletedMonths' | 'setDeletedMonths' | 'deletedDayEvents'
  | 'setDeletedDayEvents' | 'hydratePrefs' | 'applyViewerSettings' | 'applyPlanBackup'
  | 'planEvents' | 'setPlanEvents' | 'planDirty' | 'setPlanDirty' | 'lastPlanEventsSyncAt' | 'setLastPlanEventsSyncAt'
  | 'prefsDirty' | 'setPrefsDirty' | 'lastPrefsSyncAt' | 'setLastPrefsSyncAt' | 'emitPlanSets' | 'applyPlanFold' | 'emitPrefs'
>;

export const createSyncSlice = (set: StoreSet, get: StoreGet): SyncSlice => ({
  isAuthenticated:    false,
  setIsAuthenticated: (v) => set({ isAuthenticated: v }),

  nostrSigner:    null,
  setNostrSigner: (v) => set({ nostrSigner: v }),

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

  lastRecordsSyncAt: null,
  setLastRecordsSyncAt: (ts) => set({ lastRecordsSyncAt: ts }),
  recordsDirty: false,
  setRecordsDirty: (v) => set({ recordsDirty: v }),
  deletedMonths: {},
  setDeletedMonths: (v) => set({ deletedMonths: v }),
  deletedDayEvents: {},
  setDeletedDayEvents: (v) => set({ deletedDayEvents: v }),   // P3 — raw, non-emitting (mirrors setDeletedMonths)

  // Phase 4c — plan-events channel state + emit layer. All device-local persisted (ride ...rest).
  planEvents: [],
  setPlanEvents: (v) => set({ planEvents: v }),
  planDirty: false,
  setPlanDirty: (v) => set({ planDirty: v }),
  lastPlanEventsSyncAt: null,
  setLastPlanEventsSyncAt: (ts) => set({ lastPlanEventsSyncAt: ts }),
  prefsDirty: false,
  setPrefsDirty: (v) => set({ prefsDirty: v }),
  lastPrefsSyncAt: null,
  setLastPrefsSyncAt: (ts) => set({ lastPrefsSyncAt: ts }),

  // THE emit action — the sole writer of plan fields. ONE atomic set: the scalar field writes (parity with
  // the fold) + the appended events (all sharing ONE ts, so an AsOf pair can never tear) + planDirty. Then a
  // dynamic-import kick of the 2s debounce. Auth-UNGATED: a pre-auth
  // edit is legitimate local intent that just accumulates events; publishing is fully gated in the engine
  // (publishPlanEventsNow requires auth + backup gate + initialSettingsPullDone), so §6's structural
  // no-seed-clobber holds without a guard here.
  emitPlanSets: (pairs) => {
    const cur = get();
    const ts = nextPlanEventTs(maxPlanTs(cur.planEvents));
    const device = getDeviceTag();
    const fieldWrites: Record<string, unknown> = {};
    const newEvents: PlanEvent[] = [];
    for (const [field, value] of pairs) {
      fieldWrites[field] = value;
      newEvents.push({ id: makePlanEventId(field, ts), ts, device, kind: 'set', field, value });
    }
    set({ ...fieldWrites, planEvents: [...cur.planEvents, ...newEvents], planDirty: true });
    void import('../../lib/nostr/syncEngine').then((m) => m.schedulePlanPublish());
  },
  // Pull-side derived-scalar apply — raw set, NO event, NO dirty (the fold result lands in state).
  applyPlanFold: (folded) => set(folded),
  // Prefs channel (whole-object LWW, device-taste) — set + prefsDirty + kick the prefs debounce.
  emitPrefs: (patch) => {
    set({ ...patch, prefsDirty: true });
    void import('../../lib/nostr/syncEngine').then((m) => m.schedulePrefsPublish());
  },

  // Phase 4e — the retired hydrateSettings (SETTINGS_FIELDS whitelist + the whole-object-LWW skip-guards for relays,
  // the roster and the backupVerifiedAt latch) splits into two narrower appliers. The guards retire with the channel
  // they defended: on the plan channel absent-vs-empty-vs-set is first-class in the fold, the teardown clear of
  // backupVerifiedAt is RAW (no null event exists), and a seed device publishes nothing before its first pull.
  //
  // hydratePrefs — the prefs:v1 apply. PREFS_FIELDS only: a foreign key in a prefs object can never land a plan scalar
  // without its event (which would read as parity DIVERGED).
  hydratePrefs: (data) => {
    const update: Record<string, unknown> = {};
    for (const field of PREFS_FIELDS) {
      if (field in data && data[field] !== undefined) update[field] = data[field];
    }
    set(update as Partial<StoreState>);
  },
  // applyViewerSettings — a TRUSTED viewer snapshot's settings. VIEWER_SETTINGS_FIELDS only (SETTINGS_FIELDS minus the
  // five the owner strips), so a snapshot can never write the viewer's own relays, roster or gate stamp.
  applyViewerSettings: (data) => {
    const update: Record<string, unknown> = {};
    for (const field of VIEWER_SETTINGS_FIELDS) {
      if (field in data && data[field] !== undefined) update[field] = data[field];
    }
    set(update as Partial<StoreState>);
  },

  // Plan Import/Restore — ATOMIC replace of this device's plan with a validated backup. ONE set(), four things:
  //  (a) 4c: the APPLY_FIELDS settings partition becomes plan-field scalar writes + appended plan EVENTS in the
  //      SAME atomic commit (this mirrors emitPlanSets but stays FUSED for atomicity — a restore must not tear).
  //      Each APPLY_FIELDS key is written as a scalar (parity) and, if it's a PLAN_EVENT_FIELD, also emitted as a
  //      set-event; the 4 prefs keys are scalar-only and flip prefsDirty. Transport fields + backupVerifiedAt are
  //      APPLY_FIELDS-excluded by construction; keyProvenance is never in the payload. ⚠ The stamp attests KEY
  //      custody, not plan data — a backup restores a plan onto whatever key the device holds; importing must NOT
  //      open the R2a-1 gate for an un-backed-up key.
  //  (b) records wholesale (the PlanBackup record names match the store field names 1:1; per-entry btcHeld is historical
  //      ledger, restored verbatim — current Strike collateral comes from (c)).
  //  (c) the cbCollateralBtc/strikeCollateralBtc derived caches folded in the SAME commit (the setDayLog discipline —
  //      dayLog ⇒ caches stays structural). The §5b deriveReadingAnchors seam is NOT run: the imported settings already
  //      carry the anchor scalars + asOf, and setting settings directly (not via addDayEvent) can't fire it anyway.
  //  (d) planDirty + recordsDirty (+ prefsDirty when a prefs field was restored) + initialSettingsPullDone TRUE — it
  //      lets the publishes proceed at once (Phase 4e retired the settings:v1 first-pull exception it also blocked).
  // The caller (validatePlanBackup) has fully validated `backup` before this runs.
  applyPlanBackup: (backup) => {
    const r = backup.plan.records;
    const dayLog = r.dayLog as DayEvent[];
    const cur = get();
    const foldFields: Record<string, unknown> = {};
    const pairs: [PlanField, unknown][] = [];
    let anyPref = false;
    for (const [k, v] of Object.entries(backup.plan.settings)) {
      if (!APPLY_FIELDS.has(k) || v === undefined) continue;
      foldFields[k] = v;                                                       // scalar write (parity)
      if ((PLAN_EVENT_FIELDS as readonly string[]).includes(k)) pairs.push([k as PlanField, v]);
      else anyPref = true;                                                     // one of the 4 PREFS_FIELDS
    }
    const ts = nextPlanEventTs(maxPlanTs(cur.planEvents));
    const device = getDeviceTag();
    const newEvents: PlanEvent[] = pairs.map(([field, value]) => ({ id: makePlanEventId(field, ts), ts, device, kind: 'set', field, value }));
    const update: Partial<StoreState> = {
      monthlyLog: r.monthlyLog as MonthlyLogEntry[],
      deletedMonths: r.deletedMonths,
      dayLog,
      deletedDayEvents: r.deletedDayEvents,
      cbCollateralBtc: deriveCbCollateral(dayLog, cur.cbCollateralBtc),
      strikeCollateralBtc: deriveStrikeCollateral(dayLog, cur.strikeCollateralBtc),
      ...foldFields,
      planEvents: [...cur.planEvents, ...newEvents],
      planDirty: true,
      ...(anyPref ? { prefsDirty: true } : {}),
      recordsDirty: true,
      initialSettingsPullDone: true,
    };
    set(update);   // ONE atomic commit — no intermediate render between the old and new plan
    // Normal sync resumes: publish the imported plan promptly (the plan publish chains the viewer fan-out). Both
    // guarded → no-op for a gated/unauth/viewer key.
    void import('../../lib/nostr/syncEngine').then((m) => m.publishPlanEventsNow());
    kickRecordsPublish();
  },
});
