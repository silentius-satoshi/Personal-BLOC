import { NLogin, NUser } from '@nostrify/react/login';
import { useStore } from '../../store/useStore';
import type { NostrSigner } from './signers';

// Matches the value useNostr() returns (the 2nd arg to NUser.fromBunkerLogin) without a fragile import.
export type NostrParam = Parameters<typeof NUser.fromBunkerLogin>[1];

/**
 * Rebuild the signer from the persisted login and store it. Single responsibility:
 * NO relay fetch, NO sync here. Returns the fresh signer, or null on any failure.
 */
export async function restoreSigner(nostr: NostrParam): Promise<NostrSigner | null> {
  const { nostrSigningMethod, nostrPubkey, nostrLogin } = useStore.getState();
  if (!nostrPubkey) return null;
  try {
    if (nostrSigningMethod === 'nip07') {
      if (!(window as any).nostr) throw new Error('no extension');
      const login = await Promise.race([
        NLogin.fromExtension(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('extension timeout')), 5000)),
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
    return null;
  } catch { return null; }
}
