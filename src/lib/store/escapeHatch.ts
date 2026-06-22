import { restoreSigner, type NostrParam } from '../nostr/session';
import { fetchAndSync } from '../nostr/sync';
import { useStore } from '../../store/useStore';

/**
 * Escape hatch — "Reset local data & re-sync from relays".
 *
 * Clears local plan data to seeds + any stranded encryption flags, then PULLS the plan back from the relays.
 * It NEVER publishes (this module imports no publish function — the safety guarantee is structural, not just a
 * missing call). So a freshly-cleared empty/default local state can NEVER be pushed over real relay data.
 *
 * The dirty flags are cleared BEFORE any sync so the just-cleared state can't be treated as "dirty" and pushed;
 * publishing only resumes when the user makes a NEW edit after the pull repopulated their data.
 *
 *  'ok'        — pull succeeded; local is repopulated from the relays.
 *  'no-relays' — couldn't pull (no relays / relays unreachable); NOTHING was published, relay data is intact.
 *  'no-auth'   — couldn't restore the signer; the user must re-enter their login.
 */
export async function resetAndResync(nostr: NostrParam): Promise<'ok' | 'no-relays' | 'no-auth'> {
  console.log('[3a-bug2] resetAndResync ENTER', Date.now());   // TEMP [3a-bug2] instrumentation — remove after diagnosis
  const s = useStore.getState();
  s.resetPlanToSeeds();
  // Stranded at-rest-encryption flags are inert post-revert, but clear them defensively.
  try {
    localStorage.removeItem('personal-bloc-store-enc-enabled');
    localStorage.removeItem('personal-bloc-store-enc-pending-decrypt');
  } catch { /* no localStorage (SSR/test) — nothing to clear */ }
  // CRITICAL: clear dirty BEFORE any sync so a stale dirty flag can't trigger a push of the just-cleared state.
  s.setRecordsDirty(false);
  s.setSettingsDirty(false);
  // We just cleared local — re-accept whatever the relays have, regardless of timestamp. Without this the stale
  // watermark blocks the settings hydrate (applyRemoteEvent's remoteTs > lastSettingsSyncAt guard fails) and the
  // store stays at seeds until a later, newer event eventually clears the guard (the 1–2 min default-values delay).
  s.setLastSettingsSyncAt(0);
  s.setLastRecordsSyncAt(0);

  // Reuse a live signer if one exists (already-authenticated user) — avoids a needless unwrapSecretKey → Face ID
  // re-prompt. Only a genuinely missing signer (e.g. the locked-out LocalUnlockGate path) triggers the unwrap.
  let signer = useStore.getState().nostrSigner;
  if (!signer) {
    console.log('[3a-bug2] resetAndResync calling restoreSigner (no live signer)', Date.now());   // TEMP [3a-bug2] instrumentation — remove after diagnosis
    try { signer = await restoreSigner(nostr); } catch { return 'no-auth'; }
  } else {
    console.log('[3a-bug2] resetAndResync reusing live signer', Date.now());   // TEMP [3a-bug2]
  }
  if (!signer) return 'no-auth';
  const pubkey = useStore.getState().nostrPubkey;
  if (!pubkey) return 'no-auth';

  // relays-if-empty (mirrors syncNow) so a persisted-but-empty relay list can still discover the user's relays.
  if (!useStore.getState().nostrRelays.length) {
    const { fetchUserRelays } = await import('../nostr/relays');
    useStore.getState().setNostrRelays(await fetchUserRelays(pubkey));
  }
  // CRITICAL false-'ok' guard: fetchAndSync returns true even against ZERO relays (zero events → no decrypt
  // failure → true), which would report success while local stays at empty seeds. Never pull from nothing.
  if (!useStore.getState().nostrRelays.length) return 'no-relays';

  const pullOk = await fetchAndSync(signer, pubkey, useStore.getState().nostrRelays);
  if (!pullOk) return 'no-relays';   // failed pull → publish NOTHING; relay copy intact

  return 'ok';   // pull repopulated local; subsequent normal edits publish as usual
}
