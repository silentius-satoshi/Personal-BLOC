import type { NostrSigner } from '@nostrify/nostrify';

export type { NostrSigner };

export async function connectNip07(): Promise<{ signer: NostrSigner; pubkey: string }> {
  if (!(window as any).nostr) {
    throw new Error('No NIP-07 extension detected. Install Alby or nos2x.');
  }
  const pubkey = await (window as any).nostr.getPublicKey();
  return { signer: (window as any).nostr as NostrSigner, pubkey };
}
