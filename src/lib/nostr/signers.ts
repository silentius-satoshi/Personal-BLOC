import type { NostrSigner } from '@nostrify/nostrify';
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46';
import { encrypt, decrypt, getConversationKey } from 'nostr-tools/nip44';
import { SimplePool } from 'nostr-tools/pool';
import { Relay } from 'nostr-tools';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

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

export async function connectNip46QR(
  onUri: (uri: string) => void,
  onAuthUrl?: (url: string) => void,
): Promise<{ signer: NostrSigner; pubkey: string }> {
  const localKey     = generateSecretKey();
  const clientPubkey = getPublicKey(localKey);
  const relays       = ['wss://relay.primal.net'];

  const uri = createNostrConnectURI({ clientPubkey, relays, name: 'Personal ₿LOC' });
  onUri(uri);

  const relay = await Relay.connect('wss://relay.primal.net');

  return new Promise((resolve, reject) => {
    let signerPubkey: string | null = null;
    let ackSent = false;

    const timer = setTimeout(() => {
      sub.close();
      relay.close();
      reject(new Error('QR connection timed out — try again'));
    }, 60_000);

    const sub = relay.subscribe([{ kinds: [24133], '#p': [clientPubkey] }] as any, {
      onevent(event: any) {
        try {
          const convKey = getConversationKey(localKey, event.pubkey);
          const msg     = JSON.parse(decrypt(convKey, event.content));

          if (msg.method === 'connect' && !ackSent) {
            ackSent      = true;
            signerPubkey = event.pubkey;
            const ackConvKey = getConversationKey(localKey, signerPubkey);

            relay.publish(finalizeEvent({
              kind: 24133,
              created_at: Math.floor(Date.now() / 1000),
              tags: [['p', signerPubkey]],
              content: encrypt(ackConvKey, JSON.stringify({ id: msg.id, result: 'ack', error: '' })),
            }, localKey));

            relay.publish(finalizeEvent({
              kind: 24133,
              created_at: Math.floor(Date.now() / 1000),
              tags: [['p', signerPubkey]],
              content: encrypt(ackConvKey, JSON.stringify({ id: crypto.randomUUID(), method: 'get_public_key', params: [] })),
            }, localKey));
          }

          if (msg.result && /^[0-9a-f]{64}$/.test(msg.result) && signerPubkey) {
            clearTimeout(timer);
            sub.close();
            relay.close();
            const bunker = BunkerSigner.fromBunker(
              localKey,
              { pubkey: signerPubkey, relays },
              {},
            );
            resolve({ signer: bunker as unknown as NostrSigner, pubkey: msg.result });
          }

          if (typeof msg.error === 'string' && msg.error.startsWith('https://')) {
            onAuthUrl?.(msg.error);
            window.open(msg.error, '_blank', 'noopener,noreferrer');
          }
        } catch { /* ignore decrypt/parse failures */ }
      },
    });
  });
}
