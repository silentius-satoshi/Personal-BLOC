import { NLogin, NUser } from '@nostrify/react/login';
import { NSecSigner } from '@nostrify/nostrify';
import { useStore, storeEncEnabled } from '../../store/useStore';
import { nostrLog } from './log';
import { unwrapSecretKey, deriveStoreKeyFromNsec } from './keyVault';
import { setStoreKey } from '../store/storeCrypto';
import { migratePlaintextToEncrypted } from '../store/storeMigration';
import type { NostrSigner } from './signers';

// Matches the value useNostr() returns (the 2nd arg to NUser.fromBunkerLogin) without a fragile import.
export type NostrParam = Parameters<typeof NUser.fromBunkerLogin>[1];

/**
 * Browser extensions inject window.nostr ASYNCHRONOUSLY during page load, so on a refresh the restore effect can
 * fire before the extension is ready. Poll briefly for it (default 3s ceiling) instead of failing instantly —
 * window.nostr usually appears within a few hundred ms, and this still fails fast if no extension is installed.
 */
export async function waitForNostrExtension(timeoutMs = 3000): Promise<boolean> {
  if ((window as any).nostr) return true;
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if ((window as any).nostr) { resolve(true); return; }
      if (Date.now() - start >= timeoutMs) { resolve(false); return; }
      setTimeout(check, 100);   // poll every 100ms up to the timeout
    };
    check();
  });
}

/**
 * Rebuild the signer from the persisted login and store it. Single responsibility:
 * NO relay fetch, NO sync here. Returns the fresh signer, or null on any failure.
 * The inner worker — call the single-flight `restoreSigner` wrapper below, never this directly.
 */
async function doRestoreSigner(nostr: NostrParam, pin?: string): Promise<NostrSigner | null> {
  const { nostrSigningMethod, nostrPubkey, nostrLogin } = useStore.getState();
  if (!nostrPubkey) return null;
  try {
    if (nostrSigningMethod === 'nip07') {
      const hasExt = await waitForNostrExtension();   // extensions inject async — wait before declaring failure
      if (!hasExt) throw new Error('no extension');
      // 60s, not 5s: the extension may show an approval popup; a short race beats the user's
      // click and an abandoned prompt can wedge the extension's request queue.
      const login = await Promise.race([
        NLogin.fromExtension(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('extension timeout')), 60000)),
      ]);
      if (login.pubkey !== nostrPubkey) throw new Error('pubkey mismatch');
      const signer = NUser.fromExtensionLogin(login).signer as unknown as NostrSigner;
      useStore.getState().setNostrSigner(signer);
      return signer;
    }
    if (nostrSigningMethod === 'nip46') {
      if (!nostrLogin) throw new Error('no stored login');
      let login: any;
      try { login = JSON.parse(nostrLogin); }
      catch { useStore.getState().setNostrLogin(null); throw new Error('corrupt stored login'); }
      if (login.pubkey !== nostrPubkey) { useStore.getState().setNostrLogin(null); throw new Error('pubkey mismatch'); }
      const signer = NUser.fromBunkerLogin(login, nostr).signer as unknown as NostrSigner;
      useStore.getState().setNostrSigner(signer);
      return signer;
    }
    if (nostrSigningMethod === 'local') {
      const { writerKeyWrapped, writerKeyWrapMeta } = useStore.getState();
      if (!writerKeyWrapped || !writerKeyWrapMeta) throw new Error('no local key');
      // #5: the method may have flipped (e.g. a NIP-46 login racing auto-restore on a device with a leftover
      // wrapped key) since this restore was queued — re-read LIVE state and bail BEFORE WebAuthn, returning the
      // current signer, so no spurious Face ID / passkey prompt fires.
      if (useStore.getState().nostrSigningMethod !== 'local') return useStore.getState().nostrSigner;
      // `pin` is REQUIRED for a scheme:'pin' key (keyVault throws 'PIN required' without it) and IGNORED for a
      // PRF key, so the passkey path is byte-identical when callers pass nothing. The unlock UI collects it.
      const sk = await unwrapSecretKey(writerKeyWrapped, writerKeyWrapMeta, pin);   // → triggers Face ID / PIN
      const signer = new NSecSigner(sk.slice()) as unknown as NostrSigner;
      if (await signer.getPublicKey() !== nostrPubkey) throw new Error('pubkey mismatch');
      // 3a.1: derive the at-rest store key from the nsec while we have it (flag-gated; DERIVATION ONLY — no
      // gating, no encryption yet). Rooted in the nsec, so there's no separate credential to diverge. AFTER the
      // pubkey check (right identity), BEFORE sk is zeroed. Failure is NON-FATAL — login must never break on 3a.
      if (storeEncEnabled) {
        try {
          const storeKey = await deriveStoreKeyFromNsec(sk, nostrPubkey);
          setStoreKey(storeKey);
          // 3a.3: migrate an existing plaintext blob to the encrypted envelope NOW, using the key just derived.
          // VERIFY-BEFORE-DELETE — overwrites only after the ciphertext decrypts back === original; a failure
          // leaves plaintext intact (rehydrate below passthrough-reads it). Idempotent (no-op if already encrypted).
          // A false return is the SAFE path (plaintext intact), not an exception.
          await migratePlaintextToEncrypted();
          // 3a.2: re-hydrate so the now-encrypted (or still-plaintext-on-migration-failure) blob loads with the key.
          // (First hydration ran before the key was set → store hydrated to seeds; this re-runs getItem WITH the key.)
          await useStore.persist.rehydrate();
        } catch (e) {
          nostrLog('warn', '3a store key derivation/migration/rehydrate failed (non-fatal)', e);
        }
      }
      sk.fill(0);   // best-effort zero after the signer holds its own copy
      useStore.getState().setNostrSigner(signer);
      return signer;
    }
    return null;
  } catch (e) { nostrLog('warn', 'restoreSigner failed', e); return null; }
}

let restoreInFlight: Promise<NostrSigner | null> | null = null;
/** Whether the in-flight restore carries a pin. A BOOLEAN — the pin itself is never retained at module scope. */
let restoreInFlightPinned = false;

/**
 * Single-flight: concurrent callers share ONE restore (and the SAME signer). WebAuthn permits only one ceremony
 * at a time — launching two (e.g. the LocalUnlockGate escape AND a reactive syncNow) aborts one (AbortError) and
 * loops the other (NotAllowedError). Mirrors syncNow's in-flight guard; module-level (one ceremony per browser);
 * `.finally` clears it so later non-concurrent restores work.
 *
 * `pin` is supplied ONLY by the unlock UI for a scheme:'pin' key (LocalUnlockGate / NostrAuthGate's #6).
 *
 * ⚠ THE GUARD IS PIN-AWARE, and that is load-bearing. `syncNow` calls `restoreSigner(nostr)` with NO pin, and it
 * can run concurrently with the gate's unlock (the Bug-2 history). For a scheme:'pin' key that pinless promise is
 * ALREADY DOOMED — keyVault throws 'PIN required' → caught → null. A plain `if (restoreInFlight) return it` would
 * hand the user that doomed promise and report failure on a CORRECT PIN. So: a pin-bearing call never joins a
 * pinless in-flight restore. Every other combination shares exactly as before — including a pinless syncNow
 * joining a pinned unlock, which is desirable (it gets the real signer).
 *
 * WebAuthn's one-ceremony rule is preserved: the PRF path NEVER passes a pin, so two PRF callers always match
 * (undefined/undefined) and always share. The only case that starts a second worker is scheme:'pin', which runs
 * PBKDF2, not WebAuthn.
 */
export function restoreSigner(nostr: NostrParam, pin?: string): Promise<NostrSigner | null> {
  if (restoreInFlight && !(pin !== undefined && !restoreInFlightPinned)) return restoreInFlight;
  const p = doRestoreSigner(nostr, pin);
  restoreInFlight = p;
  restoreInFlightPinned = pin !== undefined;
  // Ownership check: a superseded promise settling later must not null the slot its replacement now owns.
  p.finally(() => { if (restoreInFlight === p) { restoreInFlight = null; restoreInFlightPinned = false; } });
  return p;
}
