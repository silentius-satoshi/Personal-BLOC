import { restoreSigner, type NostrParam } from './session';
import { fetchAndSync } from './sync';
import { nostrLog } from './log';
import { useStore, publishRecordsNowImmediate, publishSettingsNow } from '../../store/useStore';

let lastReconnectAt = 0;   // NIP-46 signer-rebuild throttle (moved here from useNostrSync)

/** Stamp the rebuild throttle so syncNow doesn't immediately rebuild a signer that was just created (e.g. by the auth gate). */
export function markSignerFresh(): void { lastReconnectAt = Date.now(); }

async function doSyncNow(nostr: NostrParam): Promise<boolean> {
  const { nostrPubkey, nostrSigningMethod } = useStore.getState();
  if (!nostrPubkey) return false;
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
    const pullOk = await fetchAndSync(signer, nostrPubkey, useStore.getState().nostrRelays);
    // The settings pull query has now resolved this session (whether it hydrated real data or the relay was
    // empty). Set regardless of pullOk — a decrypt failure must not permanently block publishing; a brand-new
    // owner with an empty relay must still be able to publish. Set only in this normal-completion path (a THROW
    // from fetchAndSync is caught below and leaves the flag false). This flag now permits settings publishing +
    // re-arms syncSettingsToNostr's dirty-trigger, closing the fresh-install seed-clobber race.
    useStore.getState().setInitialSettingsPullDone(true);
    let recOk = true, setOk = true;
    let recLabel = 'skipped', setLabel = 'skipped';   // not dirty → no push attempted
    if (useStore.getState().recordsDirty)  { recOk = await publishRecordsNowImmediate();  recLabel = recOk ? 'ok' : 'FAILED'; }
    if (useStore.getState().settingsDirty && useStore.getState().initialSettingsPullDone) { setOk = await publishSettingsNow(); setLabel = setOk ? 'ok' : 'FAILED'; }
    const ok = pullOk && recOk && setOk;
    if (ok) {
      useStore.getState().setNostrReconnectNeeded(false);
      nostrLog('info', 'sync ok');
    } else {
      useStore.getState().setNostrReconnectNeeded(true);
      nostrLog('warn', `sync incomplete (pull ${pullOk ? 'ok' : 'FAILED'}, records ${recLabel}, settings ${setLabel}) — signer unreachable?`);
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
