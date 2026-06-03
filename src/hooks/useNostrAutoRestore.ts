import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

export function useNostrAutoRestore(): boolean {
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const nostrAuthEnabled   = useStore.getState().nostrAuthEnabled;
    const nostrSigningMethod = useStore.getState().nostrSigningMethod;
    const nostrPubkey        = useStore.getState().nostrPubkey;

    if (!nostrAuthEnabled || nostrSigningMethod !== 'nip07' || !nostrPubkey || !window.nostr) {
      return;
    }

    // Optimistic: let the app render immediately
    useStore.getState().setIsAuthenticated(true);

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

        const { fetchUserRelays } = await import('../lib/nostr/relays');
        const { fetchAndSync }    = await import('../lib/nostr/sync');
        const relays = await fetchUserRelays(nostrPubkey);
        useStore.getState().setNostrRelays(relays);
        useStore.getState().setNostrSyncing(true);
        fetchAndSync(signer, nostrPubkey, relays)
          .catch(e => console.warn('[Nostr] auto-restore sync failed:', e))
          .finally(() => useStore.getState().setNostrSyncing(false));

      } catch {
        // Revert — auth gate will appear
        useStore.getState().setIsAuthenticated(false);
        useStore.getState().setNostrSigner(null);
      }
    };

    restore();
  }, []);

  return checking;
}
