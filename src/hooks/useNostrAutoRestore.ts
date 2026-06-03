import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

export function useNostrAutoRestore(): boolean {
  // true = still checking, false = done (show normal UI)
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const nostrAuthEnabled   = useStore.getState().nostrAuthEnabled;
    const nostrSigningMethod = useStore.getState().nostrSigningMethod;
    const nostrPubkey        = useStore.getState().nostrPubkey;

    // Only attempt restore for NIP-07 with a known pubkey
    if (!nostrAuthEnabled || nostrSigningMethod !== 'nip07' || !nostrPubkey || !window.nostr) {
      setChecking(false);
      return;
    }

    const restore = async () => {
      try {
        const { NLogin, NUser } = await import('@nostrify/react/login');

        const login = await Promise.race([
          NLogin.fromExtension(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('extension timeout')), 5000)
          ),
        ]);

        if (login.pubkey !== nostrPubkey) throw new Error('pubkey mismatch');

        const signer = NUser.fromExtensionLogin(login).signer;
        useStore.getState().setNostrSigner(signer);
        useStore.getState().setIsAuthenticated(true);

        // Relay discovery + sync (same as login paths)
        const { fetchUserRelays } = await import('../lib/nostr/relays');
        const { fetchAndSync }    = await import('../lib/nostr/sync');
        const relays = await fetchUserRelays(nostrPubkey);
        useStore.getState().setNostrRelays(relays);
        useStore.getState().setNostrSyncing(true);
        fetchAndSync(signer, nostrPubkey, relays)
          .catch(e => console.warn('[Nostr] auto-restore sync failed:', e))
          .finally(() => useStore.getState().setNostrSyncing(false));

      } catch {
        // Extension unavailable, timed out, or pubkey mismatch
        // Auth gate will render normally
      } finally {
        setChecking(false);
      }
    };

    restore();
  }, []);

  return checking;
}
