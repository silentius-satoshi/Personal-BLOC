import { NLogin, NUser } from '@nostrify/react/login';
import { NSecSigner } from '@nostrify/nostrify';
import { useStore, storeEncEnabled } from '../../store/useStore';
import { nostrLog } from './log';
import { unwrapSecretKey, deriveStoreKeyFromNsec } from './keyVault';
import { setStoreKey } from '../store/storeCrypto';
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
 */
export async function restoreSigner(nostr: NostrParam): Promise<NostrSigner | null> {
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
      const sk = await unwrapSecretKey(writerKeyWrapped, writerKeyWrapMeta);   // → triggers Face ID / PIN
      const signer = new NSecSigner(sk.slice()) as unknown as NostrSigner;
      if (await signer.getPublicKey() !== nostrPubkey) throw new Error('pubkey mismatch');
      // 3a.1: derive the at-rest store key from the nsec while we have it (flag-gated; DERIVATION ONLY — no
      // gating, no encryption yet). Rooted in the nsec, so there's no separate credential to diverge. AFTER the
      // pubkey check (right identity), BEFORE sk is zeroed. Failure is NON-FATAL — login must never break on 3a.
      if (storeEncEnabled) {
        try {
          const storeKey = await deriveStoreKeyFromNsec(sk, nostrPubkey);
          setStoreKey(storeKey);
          // 3a.2: the key is now available → re-hydrate so the encrypted persist blob decrypts and real data loads.
          // (First hydration ran before the key was set → store hydrated to seeds; this re-runs getItem WITH the key.)
          await useStore.persist.rehydrate();
        } catch (e) {
          nostrLog('warn', '3a store key derivation/rehydrate failed (non-fatal)', e);
        }
      }
      sk.fill(0);   // best-effort zero after the signer holds its own copy
      useStore.getState().setNostrSigner(signer);
      return signer;
    }
    return null;
  } catch (e) { nostrLog('warn', 'restoreSigner failed', e); return null; }
}
