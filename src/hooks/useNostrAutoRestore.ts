import { useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useStore } from '../store/useStore';

export function useNostrAutoRestore(): void {
  const { nostr } = useNostr();

  useEffect(() => {
    const { nostrAuthEnabled, nostrSigningMethod, nostrPubkey, nostrLogin } = useStore.getState();
    if (!nostrAuthEnabled || !nostrPubkey) return;

    useStore.getState().setIsAuthenticated(true);  // optimistic

    const restore = async () => {
      try {
        if (nostrSigningMethod === 'nip07') {
          if (!window.nostr) throw new Error('no extension');
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
          fetchAndSync(signer, nostrPubkey, relays, true)
            .catch(e => console.warn('[Nostr] auto-restore sync failed:', e))
            .finally(() => useStore.getState().setNostrSyncing(false));

        } else if (nostrSigningMethod === 'nip46') {
          if (!nostrLogin) throw new Error('no stored login');
          let login: any;
          try {
            login = JSON.parse(nostrLogin);
          } catch {
            useStore.getState().setNostrLogin(null);   // corrupt JSON — clear permanently
            throw new Error('corrupt stored login');
          }
          if (login.pubkey !== nostrPubkey) {
            useStore.getState().setNostrLogin(null);   // wrong identity — clear permanently
            throw new Error('pubkey mismatch');
          }
          const { NUser } = await import('@nostrify/react/login');
          const user   = NUser.fromBunkerLogin(login, nostr);
          const signer = user.signer as any;
          useStore.getState().setNostrSigner(signer);
          const { fetchUserRelays } = await import('../lib/nostr/relays');
          const { fetchAndSync }    = await import('../lib/nostr/sync');
          const relays = await fetchUserRelays(nostrPubkey);
          useStore.getState().setNostrRelays(relays);
          useStore.getState().setNostrSyncing(true);
          fetchAndSync(signer, nostrPubkey, relays, true)
            .catch(e => console.warn('[Nostr] auto-restore sync failed:', e))
            .finally(() => useStore.getState().setNostrSyncing(false));

        } else {
          throw new Error('unknown signing method');
        }
      } catch {
        // Transient failure — revert auth this launch, stored login intact for next open
        useStore.getState().setIsAuthenticated(false);
        useStore.getState().setNostrSigner(null);
      }
    };

    restore();
  }, [nostr]);   // nostr is stable (singleton pool from NostrProvider)
}
