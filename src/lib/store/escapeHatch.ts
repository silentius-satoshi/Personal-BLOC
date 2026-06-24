import { type NostrParam } from '../nostr/session';
import { clearStoreEncryptionState } from './storeCrypto';

/**
 * Escape hatch — "Reset local data & re-sync from relays".
 *
 * Reload-based: leave a COHERENT slate (clear the at-rest encryption flag + nuke the {ct,iv} blob + drop the in-memory
 * key via clearStoreEncryptionState), then reload. escapeHatch retains the identity (nostrPubkey/nostrSigningMethod),
 * so the normal boot path repopulates: local unlock gate → restoreSigner (3a is a no-op now, flag off) →
 * LocalUnlockGate.unlock → syncNow pulls from the relay into the clean plaintext slate. Nuking the blob → boot
 * hydrates to seeds → lastSettingsSyncAt defaults null → the sync-apply guard (remoteTs > lastSettingsSyncAt) does NOT
 * block → relay data applies.
 *
 * It NEVER publishes — this module imports no publish function (the safety guarantee is structural, not just a missing
 * call), and the post-reload boot sync is dirty-gated, so a freshly-pulled clean state can't be pushed over real relay
 * data. (The `_nostr` param is retained for call-site stability; unused now that repopulation is the boot path.)
 */
export function resetAndResync(_nostr?: NostrParam): void {
  clearStoreEncryptionState();
  window.location.reload();
}
