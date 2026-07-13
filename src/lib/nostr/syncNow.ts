import { restoreSigner, type NostrParam } from './session';
import { fetchAndSync } from './sync';
import { nostrLog } from './log';
import { useStore } from '../../store/useStore';
import { publishRecordsNowImmediate, publishSettingsNow, publishPlanEventsNow, publishPrefsNow } from './syncEngine';
import { isBackupGateSatisfied } from '../backupGate';
import { synthesizeGenesisEvents, nextPlanEventTs } from '../planEvents/genesis';
import { getDeviceTag } from './deviceTag';
import { PLAN_EVENT_FIELDS } from '../../store/settingsFields';
import { DEFAULT_RELAYS } from './relays';
import type { StoreState } from '../../store/types';
import type { PlanState } from '../planEvents/types';

let lastReconnectAt = 0;   // NIP-46 signer-rebuild throttle (moved here from useNostrSync)

/** Stamp the rebuild throttle so syncNow doesn't immediately rebuild a signer that was just created (e.g. by the auth gate). */
export function markSignerFresh(): void { lastReconnectAt = Date.now(); }

// Phase 4c — the plan partition for genesis, with the three hydrateSettings skip-guards replicated at the
// genesis boundary (the fold has NO equivalent latch/roster/relay guard). A null backupVerifiedAt / empty
// viewers / default-looking nostrRelays must stay ABSENT so genesis never emits a fold-winning event that
// clobbers a peer (e.g. a null backupVerifiedAt would un-verify a verified peer). Absent → seed-default (§6).
// Exported for the genesis-matrix test.
export function pickPlanFields(s: StoreState): Partial<PlanState> {
  const out: Record<string, unknown> = {};
  for (const f of PLAN_EVENT_FIELDS) out[f] = (s as unknown as Record<string, unknown>)[f];
  if (out.backupVerifiedAt == null) delete out.backupVerifiedAt;                                  // one-way latch — never un-verify a peer
  if (!Array.isArray(out.viewers) || (out.viewers as unknown[]).length === 0) {                   // roster guard — skip viewers + nextViewerIndex together
    delete out.viewers; delete out.nextViewerIndex;
  }
  const relays = out.nostrRelays as string[] | undefined;
  const sortedJoin = (a: string[]) => [...a].sort().join(',');
  const relaysDefaultLooking = !Array.isArray(relays) || relays.length === 0
    || (relays.length === DEFAULT_RELAYS.length && sortedJoin(relays) === sortedJoin(DEFAULT_RELAYS));
  if (relaysDefaultLooking) delete out.nostrRelays;                                               // relay guard
  return out as Partial<PlanState>;
}

async function doSyncNow(nostr: NostrParam): Promise<boolean> {
  const { nostrPubkey, nostrSigningMethod, keyProvenance, backupVerifiedAt } = useStore.getState();
  // Backup gate: a generated-but-unverified key runs NO sync at all — not even a pull (a pull sets
  // initialSettingsPullDone, which would re-arm publishing). Consulted at the same layer as the pubkey check.
  if (!nostrPubkey || !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })) return false;
  let signer = useStore.getState().nostrSigner;
  if (!signer || (nostrSigningMethod === 'nip46' && Date.now() - lastReconnectAt > 20000)) {
    const fresh = await restoreSigner(nostr);
    if (fresh) { signer = fresh; lastReconnectAt = Date.now(); }
  }
  if (!signer) { useStore.getState().setNostrReconnectNeeded(true); return false; }
  useStore.getState().setNostrSyncing(true);
  try {
    if (!useStore.getState().nostrRelays.length) {
      const { fetchUserRelays } = await import('./relays');
      const relays = await fetchUserRelays(nostrPubkey);
      useStore.getState().setNostrRelays(relays);
    }
    const { ok: pullOk, planFound, sawPlanEvents, sawSettingsV1 } = await fetchAndSync(signer, nostrPubkey, useStore.getState().nostrRelays);
    // R2b-2: record whether this key has a plan on the relays — set EXACTLY ONCE per session (the store action
    // holds a module-level latch), so the notice's Dismiss (which writes null) can never be re-opened by the
    // next foreground sync. Viewer installs never reach doSyncNow, and a backup-gated key returns above.
    useStore.getState().recordRemotePlanFound(planFound);
    // The settings pull query has now resolved this session (whether it hydrated real data or the relay was
    // empty). Set regardless of pullOk — a decrypt failure must not permanently block publishing; a brand-new
    // owner with an empty relay must still be able to publish. Set only in this normal-completion path (a THROW
    // from fetchAndSync is caught below and leaves the flag false). This flag now permits settings publishing +
    // re-arms syncSettingsToNostr's dirty-trigger, closing the fresh-install seed-clobber race.
    useStore.getState().setInitialSettingsPullDone(true);
    // GENESIS — the one-time migration from settings:v1 to the plan-events log. Strictly AFTER the pull + the
    // flag (so it seeds from the just-hydrated state). Runs ONLY when this device has no plan events, the relay
    // has none, and a real settings:v1 plan exists → planDirty makes the push block below publish it. A fresh
    // key (no settings:v1) gets NO genesis; its log accrues organically from the first real edit. Idempotent
    // (a second run finds planEvents.length > 0 → skips).
    {
      const st = useStore.getState();
      if (st.planEvents.length === 0 && !sawPlanEvents && sawSettingsV1) {
        const events = synthesizeGenesisEvents(pickPlanFields(st), nextPlanEventTs(0), getDeviceTag());
        if (events.length) { st.setPlanEvents(events); st.setPlanDirty(true); }
      }
    }
    let recOk = true, setOk = true, planOk = true, prefsOk = true;
    let recLabel = 'skipped', setLabel = 'skipped', planLabel = 'skipped', prefsLabel = 'skipped';   // not dirty → no push attempted
    if (useStore.getState().recordsDirty)  { recOk = await publishRecordsNowImmediate();  recLabel = recOk ? 'ok' : 'FAILED'; }
    // settings push line stays but is now inert — nothing sets settingsDirty:true post-4c; the bridge (inside
    // publishPlanEventsNow) is the sole settings:v1 publisher → no double-publish.
    if (useStore.getState().settingsDirty && useStore.getState().initialSettingsPullDone) { setOk = await publishSettingsNow(); setLabel = setOk ? 'ok' : 'FAILED'; }
    if (useStore.getState().planDirty && useStore.getState().initialSettingsPullDone) { planOk = await publishPlanEventsNow(); planLabel = planOk ? 'ok' : 'FAILED'; }
    if (useStore.getState().prefsDirty && useStore.getState().initialSettingsPullDone) { prefsOk = await publishPrefsNow(); prefsLabel = prefsOk ? 'ok' : 'FAILED'; }
    const ok = pullOk && recOk && setOk && planOk && prefsOk;
    if (ok) {
      useStore.getState().setNostrReconnectNeeded(false);
      nostrLog('info', 'sync ok');
    } else {
      useStore.getState().setNostrReconnectNeeded(true);
      nostrLog('warn', `sync incomplete (pull ${pullOk ? 'ok' : 'FAILED'}, records ${recLabel}, settings ${setLabel}, plan ${planLabel}, prefs ${prefsLabel}) — signer unreachable?`);
    }
    return ok;
  } catch (e) {
    nostrLog('error', 'sync failed', e);
    useStore.getState().setNostrReconnectNeeded(true);
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}

let inFlight: Promise<boolean> | null = null;

/**
 * The single unified sync sequence — all entry points (auth gate, mount auto-restore,
 * foreground visibilitychange, manual "Sync now") call this.
 * restore-signer-if-needed → relays-if-empty → fetch+merge → publish-if-dirty.
 * Pull-merge-THEN-push: with merge-based receive this ordering is safe and publishes the merged superset.
 * Returns true ONLY when the pull and (if dirty) the push both succeeded; concurrent calls share one run.
 */
export function syncNow(nostr: NostrParam): Promise<boolean> {
  if (inFlight) return inFlight;            // concurrent triggers share one run
  inFlight = doSyncNow(nostr).finally(() => { inFlight = null; });
  return inFlight;
}
