import { restoreSigner, type NostrParam } from './session';
import { fetchAndSync } from './sync';
import { useStore, publishRecordsNow } from '../../store/useStore';

let lastReconnectAt = 0;   // NIP-46 signer-rebuild throttle (moved here from useNostrSync)

/** Stamp the rebuild throttle so syncNow doesn't immediately rebuild a signer that was just created (e.g. by the auth gate). */
export function markSignerFresh(): void { lastReconnectAt = Date.now(); }

/**
 * The single unified sync sequence — all entry points (auth gate, mount auto-restore,
 * foreground visibilitychange, manual "Sync now") call this.
 * restore-signer-if-needed → relays-if-empty → fetch+merge → publish-if-dirty.
 * Pull-merge-THEN-push: with merge-based receive this ordering is safe and publishes the merged superset.
 */
export async function syncNow(nostr: NostrParam): Promise<boolean> {
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
    await fetchAndSync(signer, nostrPubkey, useStore.getState().nostrRelays);
    if (useStore.getState().recordsDirty) await publishRecordsNow();
    useStore.getState().setNostrReconnectNeeded(false);
    return true;
  } catch (e) {
    console.warn('[Nostr] sync failed:', e);
    useStore.getState().setNostrReconnectNeeded(true);
    return false;
  } finally {
    useStore.getState().setNostrSyncing(false);
  }
}
