import type { NostrSigner } from '@nostrify/nostrify';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey } from 'nostr-tools/pure';

export type { NostrSigner };

export async function connectNip07(): Promise<{ signer: NostrSigner; pubkey: string }> {
  if (!(window as any).nostr) {
    throw new Error('No NIP-07 extension detected. Install Alby or nos2x.');
  }
  const pubkey = await (window as any).nostr.getPublicKey();
  return { signer: (window as any).nostr as NostrSigner, pubkey };
}

export async function connectNip46(
  bunkerUri: string,
  onAuthUrl?: (url: string) => void,
): Promise<{ signer: NostrSigner; pubkey: string }> {
  const localKey = generateSecretKey();
  const pool     = new SimplePool();

  const authHandler = (authUrl: string) => {
    onAuthUrl?.(authUrl);
    window.open(authUrl, '_blank', 'noopener,noreferrer');
  };

  let bunker: BunkerSigner;

  if (bunkerUri.startsWith('nostrconnect://')) {
    bunker = await BunkerSigner.fromURI(
      localKey,
      bunkerUri.trim(),
      { pool, onauth: authHandler },
      60_000,
    );
  } else {
    const pointer = await parseBunkerInput(bunkerUri.trim());
    if (!pointer) throw new Error('Invalid bunker URI or NIP-05 identifier');

    bunker = BunkerSigner.fromBunker(localKey, pointer, {
      pool,
      onauth: authHandler,
    });

    await bunker.connect();
  }

  const pubkey = await bunker.getPublicKey();
  return { signer: bunker as unknown as NostrSigner, pubkey };
}
