import { restoreSigner, type NostrParam } from './session';
import { fetchAndSync } from './sync';
import { nostrLog } from './log';
import { useStore, publishRecordsNow } from '../../store/useStore';

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
    let pushOk = true;
    let pushLabel = 'skipped';   // not dirty → no push attempted
    if (useStore.getState().recordsDirty) {
      pushOk = await publishRecordsNow();
      pushLabel = pushOk ? 'ok' : 'FAILED';
    }
    const ok = pullOk && pushOk;
    if (ok) {
      useStore.getState().setNostrReconnectNeeded(false);
      nostrLog('info', 'sync ok');
    } else {
      useStore.getState().setNostrReconnectNeeded(true);
      nostrLog('warn', `sync incomplete (pull ${pullOk ? 'ok' : 'FAILED'}, push ${pushLabel}) — signer unreachable?`);
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
