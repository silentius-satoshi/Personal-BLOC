import { restoreSigner, type NostrParam } from './session';
import { fetchAndSync } from './sync';
import { nostrLog } from './log';
import { useStore } from '../../store/useStore';
import { publishRecordsNowImmediate, publishPlanEventsNow, publishPrefsNow, flushViewerRevocations, refusedForSize, heldWithoutPlan } from './syncEngine';
import { isBackupGateSatisfied } from '../backupGate';

let lastReconnectAt = 0;   // NIP-46 signer-rebuild throttle (moved here from useNostrSync)

/** Stamp the rebuild throttle so syncNow doesn't immediately rebuild a signer that was just created (e.g. by the auth gate). */
export function markSignerFresh(): void { lastReconnectAt = Date.now(); }

async function doSyncNow(nostr: NostrParam): Promise<boolean> {
  const { nostrPubkey, nostrSigningMethod, keyProvenance, backupVerifiedAt, viewerMode } = useStore.getState();
  // Backup gate: a generated-but-unverified key runs NO sync at all — not even a pull (a pull sets
  // initialSettingsPullDone, which would re-arm publishing). Consulted at the same layer as the pubkey check.
  if (viewerMode || !nostrPubkey || !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })) return false;
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
    const { ok: pullOk, planFound } = await fetchAndSync(signer, nostrPubkey, useStore.getState().nostrRelays);
    // R2b-2: record whether this key has a plan on the relays — set EXACTLY ONCE per session (the store action
    // holds a module-level latch), so the notice's Dismiss (which writes null) can never be re-opened by the
    // next foreground sync. Viewer installs never reach doSyncNow, and a backup-gated key returns above.
    useStore.getState().recordRemotePlanFound(planFound);
    // The baseline pull has now resolved this session (whether it applied real data or the relay was empty).
    // Set regardless of pullOk — a decrypt failure must not permanently block publishing; a brand-new owner with
    // an empty relay must still be able to publish. Set only in this normal-completion path (a THROW from
    // fetchAndSync is caught below and leaves the flag false). This flag permits the plan and prefs publishes —
    // the seed-clobber discipline (no first publish before the initial pull) outlives the retired 4e guard class.
    useStore.getState().setInitialSettingsPullDone(true);
    let recOk = true, planOk = true, prefsOk = true;
    let recLabel = 'skipped', planLabel = 'skipped', prefsLabel = 'skipped';   // not dirty → no push attempted
    // 5b — a channel refused for its size ('TOO LARGE') is not a signer problem: Reconnect can't fix it, so it doesn't
    // raise Reconnect; the app names what is too large instead (syncGuard). 5c — nor is a publish HELD because this device
    // hasn't loaded the plan (planLoad): the app says so in plain words instead.
    const label = (ok: boolean, ch: 'records' | 'plan' | 'prefs') => (ok ? 'ok' : refusedForSize(ch) ? 'TOO LARGE' : heldWithoutPlan(ch) ? 'HELD' : 'FAILED');
    if (useStore.getState().recordsDirty)  { recOk = await publishRecordsNowImmediate();  recLabel = label(recOk, 'records'); }
    if (useStore.getState().planDirty && useStore.getState().initialSettingsPullDone) { planOk = await publishPlanEventsNow(); planLabel = label(planOk, 'plan'); }
    if (useStore.getState().prefsDirty && useStore.getState().initialSettingsPullDone) { prefsOk = await publishPrefsNow(); prefsLabel = label(prefsOk, 'prefs'); }
    const revOk = await flushViewerRevocations();
    const ok = pullOk && recOk && planOk && prefsOk && revOk;
    const signerOk = pullOk && revOk && [recLabel, planLabel, prefsLabel].every((l) => l !== 'FAILED');
    if (ok) {
      useStore.getState().setNostrReconnectNeeded(false);
      nostrLog('info', 'sync ok');
    } else if (signerOk) {
      useStore.getState().setNostrReconnectNeeded(false);
      const why = [recLabel, planLabel, prefsLabel].includes('HELD') ? 'held until the plan loads here' : 'too large to sync';
      nostrLog('warn', `sync incomplete (records ${recLabel}, plan ${planLabel}, prefs ${prefsLabel}) — ${why}, not a signer problem`);
    } else {
      useStore.getState().setNostrReconnectNeeded(true);
      nostrLog('warn', `sync incomplete (pull ${pullOk ? 'ok' : 'FAILED'}, records ${recLabel}, plan ${planLabel}, prefs ${prefsLabel}, revocations ${revOk ? 'ok' : 'FAILED'}) — signer unreachable?`);
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
