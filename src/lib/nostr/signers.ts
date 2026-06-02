import { NConnectSigner, NSecSigner, NRelay1 } from '@nostrify/nostrify';
import type { NostrSigner } from '@nostrify/nostrify';
import { generateSecretKey } from 'nostr-tools/pure';

export type { NostrSigner };

export async function connectNip07(): Promise<{ signer: NostrSigner; pubkey: string }> {
  if (!(window as any).nostr) {
    throw new Error('No NIP-07 extension detected. Install Alby or nos2x.');
  }
  const pubkey = await (window as any).nostr.getPublicKey();
  return { signer: (window as any).nostr as NostrSigner, pubkey };
}

export async function connectNip46(bunkerUri: string): Promise<{ signer: NostrSigner; pubkey: string }> {
  const url          = new URL(bunkerUri.replace('bunker://', 'https://'));
  const remotePubkey = url.hostname;
  const relayHint    = url.searchParams.get('relay') ?? 'wss://relay.damus.io';
  const secret       = url.searchParams.get('secret') ?? undefined;

  const localSigner = new NSecSigner(generateSecretKey());
  const relay       = new NRelay1(relayHint);

  const signer = new NConnectSigner({
    pubkey: remotePubkey,
    signer: localSigner,
    relay,
    timeout: 30_000,
    encryption: 'nip44',
  });

  await signer.connect(secret);

  const pubkey = await signer.getPublicKey();
  return { signer, pubkey };
}
