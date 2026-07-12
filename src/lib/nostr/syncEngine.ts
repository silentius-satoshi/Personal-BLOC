// SyncEngine (Phase 1b) — the publish/orchestration layer, extracted VERBATIM from useStore.ts. Owns the
// records/settings/relay-list/viewer publish fns + the two debounce timers. MOVE-ONLY: zero behavior change.
// The store reaches these via DYNAMIC import ONLY (scheduleSettingsPublish / publishRecordsNow) — this module
// imports useStore statically, so the edge is one-directional at load (the syncNow precedent) → no static cycle.
import { useStore } from '../../store/useStore';
import { buildSettingsPayload, buildViewerSnapshotPayload } from '../../store/payloads';
import { publishRecords, publishSettings, publishRelayListNip65, publishViewerSnapshot, type ViewerSnapshot } from './publish';
import { importNip65RelayList, DEFAULT_RELAYS } from './relays';
import { nostrLog } from './log';
import { signerOpTimeout } from './timeout';
import { isBackupGateSatisfied } from '../backupGate';

let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recordsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// The debounced settings publish arm — extracted from syncSettingsToNostr's tail (which keeps its
// synchronous gates + dirty-mark and delegates here via dynamic import).
export function scheduleSettingsPublish(): void {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => { publishSettingsNow(); }, 2000);
}

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
    const byTier = new Map<'safe' | 'trusted', ViewerSnapshot>();
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
