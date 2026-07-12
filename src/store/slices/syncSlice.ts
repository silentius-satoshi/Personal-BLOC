// syncSlice (Phase 1c) — session/auth + sync flags + syncSettingsToNostr + hydrateSettings + applyPlanBackup. The
// remotePlanFoundResolved latch moves here (its only consumer). getState()→get(); the two dynamic import paths deepened.
import type { StoreState, StoreSet, StoreGet, ViewerSlot } from '../types';
import type { DayEvent, MonthlyLogEntry } from '../../simulation/types';
import { deriveCbCollateral, deriveStrikeCollateral } from '../../simulation/logUtils';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import { DEFAULT_RELAYS } from '../../lib/nostr/relays';
import { SETTINGS_FIELDS, APPLY_FIELDS } from '../settingsFields';
import { kickRecordsPublish } from '../bootstrap';

// R2b-2 — the remotePlanFound SESSION LATCH. Module-scoped (resets on every boot). Its only consumer is
// recordRemotePlanFound below. See the interface doc for why a latch (a dismissed notice must not re-open).
let remotePlanFoundResolved = false;

type SyncSlice = Pick<StoreState,
  | 'isAuthenticated' | 'setIsAuthenticated' | 'nostrSigner' | 'setNostrSigner' | 'syncSettingsToNostr' | 'nostrSyncing'
  | 'setNostrSyncing' | 'initialSettingsPullDone' | 'setInitialSettingsPullDone' | 'remotePlanFound' | 'setRemotePlanFound'
  | 'recordRemotePlanFound' | 'backupNagDismissed' | 'dismissBackupNag' | 'nostrReconnectNeeded' | 'setNostrReconnectNeeded'
  | 'lastSettingsSyncAt' | 'setLastSettingsSyncAt' | 'lastRecordsSyncAt' | 'setLastRecordsSyncAt' | 'recordsDirty'
  | 'setRecordsDirty' | 'settingsDirty' | 'setSettingsDirty' | 'deletedMonths' | 'setDeletedMonths' | 'deletedDayEvents'
  | 'setDeletedDayEvents' | 'hydrateSettings' | 'applyPlanBackup'
>;

export const createSyncSlice = (set: StoreSet, get: StoreGet): SyncSlice => ({
  isAuthenticated:    false,
  setIsAuthenticated: (v) => set({ isAuthenticated: v }),

  nostrSigner:    null,
  setNostrSigner: (v) => set({ nostrSigner: v }),

  // Mark-dirty + debounce wrapper around publishSettingsNow. Dirty is set SYNCHRONOUSLY so an app
  // close mid-debounce still retries next launch (syncNow publishes-if-dirty). Accepted micro-race:
  // a setter firing DURING an in-flight publish re-marks dirty and re-schedules, so its change
  // publishes ~2s later; the only loss window is the app fully closing inside that ~2s — negligible.
  syncSettingsToNostr: () => {
    const s = get();
    if (!s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey || !isBackupGateSatisfied(s)) return;   // pre-login edits must NOT mark dirty (would block first hydrate); an unbacked-up generated key must not dirty either — setBackupVerifiedAt marks dirty itself when the gate opens
    if (!s.initialSettingsPullDone) return;   // don't dirty/publish before the first pull establishes a baseline (prevents a benign post-auth setter dirtying the seed store → seed-clobber)
    set({ settingsDirty: true });
    void import('../../lib/nostr/syncEngine').then((m) => m.scheduleSettingsPublish());
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
    // SETTINGS_FIELDS lifted to src/store/settingsFields.ts (single source — shared with Plan Import/Restore's validator)
    const update: Partial<StoreState> = {};
    for (const field of SETTINGS_FIELDS) {
      if (field in data && data[field] !== undefined) {
        (update as Record<string, unknown>)[field] = data[field];
      }
    }
    // C guard: a default-looking incoming relay list must never clobber a real local one. Skip ONLY the nostrRelays
    // field (the rest of `update` applies — skip-FIELD, not skip-all). Empty OR exactly-DEFAULT_RELAYS incoming + a
    // non-empty custom local list → drop the incoming relays; a genuine custom incoming list passes through. (The
    // creator closure is `(set) => …` with no `get`, so read local via get() — safe at call time.)
    if ('nostrRelays' in update) {
      const incoming = update.nostrRelays as string[] | undefined;
      const local = get().nostrRelays;
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
      const localRoster = get().viewers;
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
      if (incoming == null && get().backupVerifiedAt != null) {
        delete (update as Record<string, unknown>).backupVerifiedAt;
      }
    }
    set(update);
  },

  // Plan Import/Restore — ATOMIC replace of this device's plan with a validated backup. ONE set(), four things:
  //  (a) settings partition filtered to APPLY_FIELDS (transport fields + backupVerifiedAt untouched by construction;
  //      keyProvenance is never in the payload). ⚠ The stamp attests KEY custody, not plan data — a backup restores a
  //      plan onto whatever key the device holds; importing must NOT open the R2a-1 gate for an un-backed-up key.
  //  (b) records wholesale (the PlanBackup record names match the store field names 1:1; per-entry btcHeld is historical
  //      ledger, restored verbatim — current Strike collateral comes from (c)).
  //  (c) the cbCollateralBtc/strikeCollateralBtc derived caches folded in the SAME commit (the setDayLog discipline —
  //      dayLog ⇒ caches stays structural). The §5b deriveReadingAnchors seam is NOT run: the imported settings already
  //      carry the anchor scalars + asOf, and setting settings directly (not via addDayEvent) can't fire it anyway.
  //  (d) settingsDirty/recordsDirty + initialSettingsPullDone TRUE — the last is load-bearing twice: it stops sync.ts's
  //      first-pull exception from hydrating remote OVER the imported settings, and lets publish proceed.
  // The caller (validatePlanBackup) has fully validated `backup` before this runs.
  applyPlanBackup: (backup) => {
    const r = backup.plan.records;
    const dayLog = r.dayLog as DayEvent[];
    const cur = get();
    const update: Partial<StoreState> = {
      monthlyLog: r.monthlyLog as MonthlyLogEntry[],
      deletedMonths: r.deletedMonths,
      dayLog,
      deletedDayEvents: r.deletedDayEvents,
      cbCollateralBtc: deriveCbCollateral(dayLog, cur.cbCollateralBtc),
      strikeCollateralBtc: deriveStrikeCollateral(dayLog, cur.strikeCollateralBtc),
      settingsDirty: true,
      recordsDirty: true,
      initialSettingsPullDone: true,
    };
    for (const [k, v] of Object.entries(backup.plan.settings)) {
      if (APPLY_FIELDS.has(k) && v !== undefined) (update as Record<string, unknown>)[k] = v;
    }
    set(update);   // ONE atomic commit — no intermediate render between the old and new plan
    // Normal sync resumes: publish the imported plan promptly (both guarded → no-op for a gated/unauth/viewer key).
    get().syncSettingsToNostr();
    kickRecordsPublish();
  },
});
