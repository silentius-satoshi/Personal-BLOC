import { clearStoreEncryptionState } from './storeCrypto';

/**
 * Remove every trace of the owner's plan from this device's browser storage.
 *
 * THE RULE: identity-forget actions (disconnectNostr, Settings' "Remove local key") wipe plan-scoped storage;
 * SIGN-OUT actions (signOutLocal, nip46 reconnectNostr) retain it. Before this existed, a nip07 disconnect cleared
 * only the identity FIELDS — the persisted blob survived, the auth gates fell through to Branch J, and the
 * identity-less shell rendered the full hydrated plan to whoever opened the tab next.
 *
 * ⚠ THE KEY INVENTORY BELOW IS THE CONTRACT. Every storage key the app writes appears here, classified. Adding a
 * new key means classifying it here; `wipeLocalPlanData.test.ts` asserts this exact list.
 *
 *   PLAN-SCOPED — wiped:
 *     personal-bloc-store                       the persist blob (plaintext, or the {ct,iv} envelope)
 *     personal-bloc-store-enc-enabled           at-rest encryption flag for that blob
 *     personal-bloc-store-enc-pending-decrypt   migration marker for that blob
 *     personal-bloc-writer-key-wrapped          the wrapped nsec — key material
 *     personal-bloc-writer-key-meta             its wrap meta
 *     personal-bloc-onboarded                   ⚠ see below
 *     personal-bloc-nostr-pubkey                identity
 *     personal-bloc-nostr-auth                  identity
 *     personal-bloc-nostr-method                identity
 *     bloc-nostr-log             (sessionStorage) relay/sync metadata for the departing identity
 *
 *   DEVICE-LEVEL — retained (the only one):
 *     bloc-device-tag                           per-device tag; survives every identity, never synced
 *
 * ⚠ `personal-bloc-onboarded` is NOT blob-resident. It is a standalone key (GATE_ONBOARDED_KEY) seeded into the
 * store's INITIAL state at module init, so removing only `personal-bloc-store` would leave onboardingComplete true
 * and the fresh entry fork (ChoosePathView) would never render — the exact bug this function fixes, half-fixed.
 *
 * ⚠ NEVER sweep by `personal-bloc-` prefix: `bloc-device-tag` and `bloc-nostr-log` don't carry it, so a prefix sweep
 * would both miss the log ring and (worse) tempt someone into wiping the device tag by "fixing" the prefix.
 *
 * The three identity GATE keys are already removed synchronously by disconnectNostr's setters. Removing them here
 * too is idempotent, and makes this function correct STANDALONE rather than correct-only-when-called-after-them.
 *
 * ⚠ No reload() here — the caller owns reload ordering. And the caller must run this as its LAST mutation: zustand's
 * persist writes the blob on every set(), so any store setter after this call would resurrect it before the reload.
 */
export function wipeLocalPlanData(): void {
  // Also drops the in-memory store key. Covers: the blob, the enc flag, the pending-decrypt marker.
  clearStoreEncryptionState();

  for (const key of [
    'personal-bloc-writer-key-wrapped',
    'personal-bloc-writer-key-meta',
    'personal-bloc-onboarded',
    'personal-bloc-nostr-pubkey',
    'personal-bloc-nostr-auth',
    'personal-bloc-nostr-method',
  ]) {
    try { localStorage.removeItem(key); } catch { /* noop */ }
  }

  try { sessionStorage.removeItem('bloc-nostr-log'); } catch { /* noop */ }
}
