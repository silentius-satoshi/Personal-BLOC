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

/**
 * The confirm copy for the escape hatch, honest per state. ⚠ For a generated-and-never-verified key the sync engine
 * has been gated off since minute one (R2a-1), so the relay holds NOTHING — "reloads from the relays" is a LIE and
 * resetting is permanent deletion. Pass `neverSynced = !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })`
 * (never re-derived). String-only, so escapeHatch keeps its structural no-publish guarantee.
 */
export function resetAndResyncConfirmMessage(neverSynced: boolean): string {
  if (neverSynced) {
    return '⚠ This plan has never been backed up or synced — resetting deletes it permanently. Save your Recovery Key first if you want to keep it.';
  }
  return 'This clears local data on this device and reloads it from the relays. Your Nostr key and relay data are safe. Any local changes not yet synced will be lost. Continue?';
}
