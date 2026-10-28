// SyncEngine (Phase 1b) — the publish/orchestration layer, extracted VERBATIM from useStore.ts. Owns the
// records/plan-events/prefs/relay-list/viewer publish fns + their debounce timers.
// The store reaches these via DYNAMIC import ONLY (schedulePlanPublish / publishRecordsNow) — this module
// imports useStore statically, so the edge is one-directional at load (the syncNow precedent) → no static cycle.
// Phase 4e: the settings:v1 bridge (publishSettingsNow + its debounce + its seed sentinel) is RETIRED — the plan
// publish is the only plan channel, and it now chains the viewer fan-out + the revocation retry itself.
import { useStore } from '../../store/useStore';
import { buildViewerSnapshotPayload } from '../../store/payloads';
import { publishRecords, publishRelayListNip65, publishViewerSnapshot, publishEncrypted, PLAN_EVENTS_DTAG, PREFS_DTAG, RECORDS_DTAG, type ViewerSnapshot } from './publish';
import { importNip65RelayList, DEFAULT_RELAYS } from './relays';
import { foldPlanEvents } from '../planEvents/fold';
import { compactPlanEvents } from '../planEvents/compact';
import { PREFS_FIELDS } from '../../store/settingsFields';
import { nostrLog } from './log';
import { signerOpTimeout } from './timeout';
import { isBackupGateSatisfied } from '../backupGate';
import { PayloadTooLargeError, pruneBlocked, channelOf } from './syncGuard';
import { PLAIN_STEP_BYTES } from './payloadSize';
import {
  buildJournal, pagesToPublish, relayListing, manifestOf, fingerprint, normRecords, pageDTag, pageItemCount, utf8Bytes,
  v1Payload, v1BridgeTarget, V1_STUB, JOURNAL_MANIFEST_DTAG,
} from './journalPages';
import { journalKnown, inJournalLane, type JournalKnown } from './journalState';
import { planMissing } from './planLoad';
import type { NostrSigner } from '@nostrify/nostrify';
import type { RecordsState } from '../../simulation/mergeRecords';

let recordsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let planDebounceTimer: ReturnType<typeof setTimeout> | null = null;    // Phase 4c — plan-events channel debounce
let prefsDebounceTimer: ReturnType<typeof setTimeout> | null = null;   // Phase 4c — prefs channel debounce

// Phase 4c — plan-events / prefs debounce arms (2s). emitPlanSets/emitPrefs mark dirty synchronously then kick
// these via dynamic import; the gates live in the publish fns below.
export function schedulePlanPublish(): void {
  if (planDebounceTimer) clearTimeout(planDebounceTimer);
  planDebounceTimer = setTimeout(() => { void publishPlanEventsNow(); }, 2000);
}
export function schedulePrefsPublish(): void {
  if (prefsDebounceTimer) clearTimeout(prefsDebounceTimer);
  prefsDebounceTimer = setTimeout(() => { void publishPrefsNow(); }, 2000);
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

// 5b — why each channel's last publish returned false: 'size' — the guard refused a payload past NIP-44's 40,960 B step,
// and the same payload would be refused again, so Reconnect can't help (the app names what is too large instead) — or
// 'failed' (a gate, the signer, the relays). 5c adds 'held' — this device hasn't loaded the plan (planLoad.planMissing),
// so it publishes no plan, journal or viewer snapshot; not a signer problem either. Cleared at the start of every
// attempt; syncNow reads it.
type PublishChannel = 'records' | 'plan' | 'prefs';
const lastRefusal: Partial<Record<PublishChannel, 'size' | 'failed' | 'held'>> = {};
export function refusedForSize(channel: PublishChannel): boolean { return lastRefusal[channel] === 'size'; }
export function heldWithoutPlan(channel: PublishChannel): boolean { return lastRefusal[channel] === 'held'; }

// 5b — the journal publishes in the journal lane (journalState.ts): never interleaved with a pull or another publish.
export function publishRecordsNowImmediate(): Promise<boolean> {
  if (recordsDebounceTimer) { clearTimeout(recordsDebounceTimer); recordsDebounceTimer = null; }   // an immediate publish supersedes any pending debounce — avoids a redundant signer op (NIP-46 round-trip)
  return inJournalLane(publishRecordsOnce);
}

async function publishRecordsOnce(): Promise<boolean> {
  delete lastRefusal.records;
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || state.viewerMode || !isBackupGateSatisfied(state)) {   // publish didn't happen (incl. read-only viewer — relay-side backstop; and an unbacked-up generated key)
    lastRefusal.records = 'failed';
    return false;
  }
  // 5c — a device without the plan sends no journal: what it holds came from the relays, or was written against a seed
  // plan before 5c. recordsDirty stays set, so the publish after the plan loads sends it.
  if (planMissing(state)) {
    lastRefusal.records = 'held';
    nostrLog('info', 'journal publish held — this device hasn\'t loaded the plan');
    return false;
  }
  useStore.getState().setNostrSyncing(true);
  const signer = state.nostrSigner;
  const pubkey = state.nostrPubkey;
  const relays = state.nostrRelays.length ? state.nostrRelays : undefined;
  const timeout = signerOpTimeout(state.nostrSigningMethod);
  const journal: RecordsState = { entries: state.monthlyLog, deletions: state.deletedMonths, dayLog: state.dayLog, dayLogDeletions: state.deletedDayEvents };
  const known = journalKnown(pubkey);
  try {
    if (!state.initialSettingsPullDone || !known.pulled) {
      // Before this session's journal pull: records:v1 only, as before 5b — a merging reader loses nothing from it. The
      // pages and the manifest wait for the pull (the manifest lists every page the relays hold, so it needs their
      // listing first), and recordsDirty STAYS SET so the publish after the pull writes them. A journal too large for
      // records:v1 waits for the pull too.
      const payload = v1Payload(journal);
      if (utf8Bytes(JSON.stringify(payload)) > PLAIN_STEP_BYTES) { lastRefusal.records = 'failed'; return false; }
      const createdAt = await publishRecords(signer, pubkey, payload, relays, timeout, known.seenAt + 1);
      known.seenAt = Math.max(known.seenAt, createdAt);
      useStore.getState().setLastRecordsSyncAt(createdAt);
      useStore.getState().setNostrReconnectNeeded(false);
      nostrLog('info', 'records published (records:v1 — before the journal pull)');
      known.v1 = await fingerprint(normRecords(journal));   // the bridge's content, as a pull would fingerprint it
      void publishViewerSnapshotNow();   // fire-and-forget; never affects the owner's own sync result
      void flushViewerRevocations();     // durable owner-side revocations share the normal retry path
      return true;
    }
    const r = await publishJournal(signer, pubkey, journal, relays, timeout, known);
    if (r.lastAt) useStore.getState().setLastRecordsSyncAt(r.lastAt);
    // Clear recordsDirty only if what was published is still the journal: a write made while the pages went out keeps
    // it set (the store replaces a collection on every write, so "unchanged" is a reference test). A size refusal clears
    // it too: the same page would be refused again — the next change, or the next pull's repair, tries again.
    const after = useStore.getState();
    if (after.monthlyLog === journal.entries && after.deletedMonths === journal.deletions && after.dayLog === journal.dayLog
      && after.deletedDayEvents === journal.dayLogDeletions) useStore.getState().setRecordsDirty(false);
    useStore.getState().setNostrReconnectNeeded(false);
    void publishViewerSnapshotNow();   // fire-and-forget; never affects the owner's own sync result
    void flushViewerRevocations();     // durable owner-side revocations share the normal retry path
    if (r.refused.length) {
      lastRefusal.records = 'size';
      nostrLog('warn', `journal too large to sync: ${r.refused.join(', ')} (past ${PLAIN_STEP_BYTES} B plain) — the rest published`);
      return false;
    }
    nostrLog('info', `journal published (${r.pages} page${r.pages === 1 ? '' : 's'}${r.manifest ? ', manifest' : ''}${r.v1 ? `, records:v1 ${r.v1}` : ''})`);
    return true;
  } catch (e) {
    nostrLog('error', 'records publish failed', e);
    lastRefusal.records = 'failed';
    useStore.getState().setNostrReconnectNeeded(true);   // dirty stays true
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

interface JournalPublishResult { pages: number; manifest: boolean; v1: 'full' | 'stub' | null; refused: string[]; lastAt: number }

/**
 * 5b — publish the journal as v2: the pages that differ from the copies the relays hold, ONE AT A TIME, then — only if
 * every page attempt ended (published, or refused for its size) — the manifest, if it changed; then the records:v1
 * bridge, best-effort. A relay or signer failure throws out of the loop before the manifest, so the manifest (the
 * commit marker) never lists a page the relays don't hold. The manifest lists the relays' copies, not this device's:
 * a refused page keeps the copy the relays already have, and a listed page this device couldn't read stays listed.
 * Every event goes out newer than every journal event this device has seen (known.seenAt): a relay keeps the newer of
 * two copies by created_at, so a device whose clock is behind would otherwise publish into the void.
 */
async function publishJournal(
  signer: NostrSigner, pubkey: string, journal: RecordsState, relays: string[] | undefined, timeout: number, known: JournalKnown,
): Promise<JournalPublishResult> {
  const built = await buildJournal(journal);
  const live = new Set([...built.pages.map((p) => pageDTag(p.page.key)), JOURNAL_MANIFEST_DTAG, RECORDS_DTAG]);
  pruneBlocked((dTag) => channelOf(dTag) !== 'journal' || live.has(dTag));   // a refused page whose month emptied stops warning
  const refused: string[] = [];
  let pages = 0;
  let lastAt = 0;
  for (const p of pagesToPublish(built, known.pages)) {
    try {
      lastAt = await publishEncrypted(signer, pubkey, pageDTag(p.page.key), p.page, relays, timeout, known.seenAt + 1);
      known.seenAt = Math.max(known.seenAt, lastAt);
      known.pages.set(p.page.key, { n: pageItemCount(p.page), h: p.h });
      known.unreadable.delete(p.page.key);
      pages++;
    } catch (e) {
      if (!(e instanceof PayloadTooLargeError)) throw e;
      refused.push(p.page.key);
    }
  }
  const manifest = manifestOf(relayListing(built, known.pages, known.unreadable), journal);
  const manifestH = await fingerprint(manifest);
  let manifestOut = false;
  if (manifestH !== known.manifestH) {
    try {
      lastAt = await publishEncrypted(signer, pubkey, JOURNAL_MANIFEST_DTAG, manifest, relays, timeout, known.seenAt + 1);   // newer than its pages
      known.seenAt = Math.max(known.seenAt, lastAt);
      known.manifestH = manifestH;
      manifestOut = true;
    } catch (e) {
      if (!(e instanceof PayloadTooLargeError)) throw e;
      refused.push('manifest');
    }
  }
  // The records:v1 bridge — a pre-5b app reads only records:v1. The whole journal while it fits under the step; past
  // it, the stub. Best-effort: its failure never fails the journal's publish — the next pull finds it behind and repairs.
  let v1: JournalPublishResult['v1'] = null;
  try {
    const target = await v1BridgeTarget(journal, PLAIN_STEP_BYTES);
    if (target !== known.v1) {
      const at = target === 'stub'
        ? await publishEncrypted(signer, pubkey, RECORDS_DTAG, V1_STUB, relays, timeout, known.seenAt + 1)
        : await publishRecords(signer, pubkey, v1Payload(journal), relays, timeout, known.seenAt + 1);
      known.seenAt = Math.max(known.seenAt, at);
      lastAt = Math.max(lastAt, at);
      known.v1 = target;
      v1 = target === 'stub' ? 'stub' : 'full';
    }
  } catch (e) {
    nostrLog('warn', 'records:v1 bridge publish failed (best-effort)', e);
  }
  return { pages, manifest: manifestOut, v1, refused, lastAt };
}

// Phase 4c — publish the append-only plan-events log (compacted) to plan-events:v1. Gate mirrors
// publishRecordsNowImmediate (+ viewerMode backstop) + Fix A (initialSettingsPullDone — the seed-clobber
// discipline outlives the retired guard class). planDirty stays true on failure → retried by syncNow.
// Phase 4e: success chains the viewer fan-out + the revocation retry DIRECTLY (both rode the retired
// settings:v1 bridge until 4e). Fire-and-forget — neither affects the plan result.
export async function publishPlanEventsNow(): Promise<boolean> {
  delete lastRefusal.plan;
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || state.viewerMode || !isBackupGateSatisfied(state)) return false;
  if (!state.initialSettingsPullDone) return false;   // never publish before the baseline pull (mirrors Fix A)
  // 5c — a device that hasn't loaded the plan never publishes one: its log isn't the owner's plan, and as the newest
  // replaceable event it would stand in for the relays' plan. planDirty stays set; what it holds goes out, unioned with
  // the relays' plan, once that loads.
  if (planMissing(state)) {
    lastRefusal.plan = 'held';
    nostrLog('info', 'plan publish held — this device hasn\'t loaded the plan');
    return false;
  }
  if (planDebounceTimer) { clearTimeout(planDebounceTimer); planDebounceTimer = null; }
  useStore.getState().setNostrSyncing(true);
  try {
    const compacted = compactPlanEvents(state.planEvents, Date.now());
    useStore.getState().setPlanEvents(compacted);   // persist the GC'd log
    const createdAt = await publishEncrypted(
      state.nostrSigner,
      state.nostrPubkey,
      PLAN_EVENTS_DTAG,
      { events: compacted },
      state.nostrRelays.length ? state.nostrRelays : undefined,   // ⚠ .length ? … : undefined — a bare [] would publish to zero relays
      signerOpTimeout(state.nostrSigningMethod),
    );
    useStore.getState().setLastPlanEventsSyncAt(createdAt);
    useStore.getState().setPlanDirty(false);
    useStore.getState().setNostrReconnectNeeded(false);
    nostrLog('info', 'plan events published');
    void publishViewerSnapshotNow();   // fire-and-forget; never affects the owner's own sync result
    void flushViewerRevocations();     // durable owner-side revocations share the normal retry path
    checkPlanParity();
    return true;
  } catch (e) {
    nostrLog('error', 'plan events publish failed', e);
    if (e instanceof PayloadTooLargeError) {   // 5b — not a signer problem: no Reconnect, no retry of the same payload
      lastRefusal.plan = 'size';
      useStore.getState().setPlanDirty(false);   // the next plan change, or the next pull's repair, tries again
      return false;
    }
    lastRefusal.plan = 'failed';
    useStore.getState().setNostrReconnectNeeded(true);   // planDirty stays true → retried by syncNow
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

// Phase 4c — the tiny whole-object prefs channel (tabOrder/hiddenTabs/simpleMode/btcBuyingUnit; BL15's venueColors —
// undefined until a device chooses, so JSON drops it and a device that never chose sends none). Whole-object
// LWW: a seed-default publish before the first pull would clobber the real prefs → gate on initialSettingsPullDone
// (Fix A). NIP-44 self-encrypted.
export async function publishPrefsNow(): Promise<boolean> {
  delete lastRefusal.prefs;
  const state = useStore.getState();
  if (!state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || state.viewerMode || !isBackupGateSatisfied(state)) return false;
  if (!state.initialSettingsPullDone) return false;
  if (prefsDebounceTimer) { clearTimeout(prefsDebounceTimer); prefsDebounceTimer = null; }
  useStore.getState().setNostrSyncing(true);
  try {
    const s = useStore.getState();
    const prefs = Object.fromEntries(PREFS_FIELDS.map((f) => [f, (s as unknown as Record<string, unknown>)[f]]));
    const createdAt = await publishEncrypted(
      state.nostrSigner,
      state.nostrPubkey,
      PREFS_DTAG,
      prefs,
      s.nostrRelays.length ? s.nostrRelays : undefined,
      signerOpTimeout(s.nostrSigningMethod),
    );
    useStore.getState().setLastPrefsSyncAt(createdAt);
    useStore.getState().setPrefsDirty(false);
    useStore.getState().setNostrReconnectNeeded(false);
    nostrLog('info', 'prefs published');
    return true;
  } catch (e) {
    nostrLog('error', 'prefs publish failed', e);
    if (e instanceof PayloadTooLargeError) {   // 5b — as the plan's
      lastRefusal.prefs = 'size';
      useStore.getState().setPrefsDirty(false);
      return false;
    }
    lastRefusal.prefs = 'failed';
    useStore.getState().setNostrReconnectNeeded(true);
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

// Phase 4c — parity telemetry, KEPT at 4e as the emit layer's runtime tripwire (fold vs live scalars). Compares
// FOLD-PRESENT KEYS ONLY: keys absent from the fold are asserted-by-omission (seed/local default — §6) and are
// NOT divergence. Names only, never values (Copy-Diagnostics safe).
export interface PlanParity { ok: boolean; diverged: string[]; }
let lastPlanParity: PlanParity | null = null;
export function getPlanParity(): PlanParity | null { return lastPlanParity; }
export function checkPlanParity(): PlanParity {
  const s = useStore.getState() as unknown as Record<string, unknown>;
  const folded = foldPlanEvents(useStore.getState().planEvents);
  const diverged: string[] = [];
  for (const [k, v] of Object.entries(folded)) {
    if (JSON.stringify(v) !== JSON.stringify(s[k])) diverged.push(k);
  }
  lastPlanParity = { ok: diverged.length === 0, diverged };
  if (diverged.length) nostrLog('warn', `plan parity DIVERGED: ${diverged.join(', ')}`);
  return lastPlanParity;
}

// Network subpage P2 — NIP-65 relay-list sync. Import READS the user's kind-10002 and replaces the local relay list
// ONLY when a real list is found (the discriminated {found} result keeps an absent/empty list from clobbering the
// current one). Publish WRITES the local list as a PLAIN kind-10002 (never encrypted). Both are out-of-band one-offs:
// they don't touch the dirty flags or nostrReconnectNeeded — only nostrSyncing for the loading dot.
export async function importRelaysFromNip65(): Promise<{ found: boolean; count: number; empty: boolean }> {
  const state = useStore.getState();
  if (!state.nostrPubkey) return { found: false, count: 0, empty: false };
  try {
    const res = await importNip65RelayList(state.nostrPubkey);
    if (res.found && res.relays.length) {
      useStore.getState().setNostrRelaysAndSync(res.relays);   // deliberate user import → a plan event (4e: no receiver guard — a folded list always applies)
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
  if (state.viewerMode || !state.isAuthenticated || !state.nostrSigner || !state.nostrPubkey || !isBackupGateSatisfied(state)) return false;
  // 5c — this device's relay list isn't the plan's until the plan loads (a seed default, or an edit kept here to find it);
  // published as the key's public list, it would send every new device to the wrong relays.
  if (planMissing(state)) { nostrLog('info', 'relay list publish held — this device hasn\'t loaded the plan'); return false; }
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
// MUST NOT touch the dirty flags/nostrReconnectNeeded/nostrSyncing — the owner's own sync result
// is independent. The payload is built ONCE PER DISTINCT TIER (at most 2 builds), encrypted N times.
export async function publishViewerSnapshotNow(): Promise<void> {
  const s = useStore.getState();
  if (s.viewerMode || !s.viewers.length || !s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey || !isBackupGateSatisfied(s)) return;
  if (planMissing(s)) return;   // 5c — never a snapshot of the seed plan (a roster added here, before the plan loaded)
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

/** Retry durable revocation tombstones after any successful owner sync. */
export async function flushViewerRevocations(): Promise<boolean> {
  const state = useStore.getState();
  if (!state.pendingViewerRevocations.length) return true;
  if (state.viewerMode) return false;
  let ok = true;
  for (const pubkeyHex of [...state.pendingViewerRevocations]) {
    if (!(await publishViewerRevocationNow(pubkeyHex))) ok = false;
  }
  return ok;
}

// Real-time revocation (M2 — PER-SLOT): seal a TOMBSTONE (empty payload + revoked:true) to ONE viewer's d-tag
// so their next live event / reconnect wipes the hydrated data and drops them to ViewerWaitingGate. The caller
// passes the target pubkey (captured BEFORE removeViewerSlot). Fire-and-forget, log-only.
export async function publishViewerRevocationNow(viewerPubkeyHex: string): Promise<boolean> {
  const s = useStore.getState();
  if (!viewerPubkeyHex) return false;
  if (s.viewerMode || !s.isAuthenticated || !s.nostrSigner || !s.nostrPubkey || !isBackupGateSatisfied(s)) {
    if (!s.viewerMode) s.queueViewerRevocation(viewerPubkeyHex);
    return false;
  }
  try {
    await publishViewerSnapshot(
      s.nostrSigner,
      viewerPubkeyHex,
      { settings: {}, records: { entries: [], deletions: {} }, strike: { usd: null, btcAvail: null, rate: null }, revoked: true },
      s.nostrRelays.length ? s.nostrRelays : undefined,
      signerOpTimeout(s.nostrSigningMethod),
    );
    useStore.getState().clearViewerRevocation(viewerPubkeyHex);
    nostrLog('info', 'viewer revocation published');
    return true;
  } catch (e) {
    useStore.getState().queueViewerRevocation(viewerPubkeyHex);
    nostrLog('warn', 'viewer revocation failed', e);
    return false;
  }
}
