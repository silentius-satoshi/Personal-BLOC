import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pool so publish resolves immediately (first-ack path) — no live relay.
const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    querySync: vi.fn(),
    publish:   vi.fn(() => [Promise.resolve()]),   // one relay, acks immediately
    close:     vi.fn(),
  },
}));

vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return mockPool; }),
}));

import { publishRelayListNip65 } from '../publish';

function makeSigner() {
  const signed: any[] = [];
  const signer = {
    // captures + echoes back a "signed" event (id/sig irrelevant to the shape assertions)
    signEvent: vi.fn(async (evt: any) => { const e = { ...evt, id: 'id', sig: 'sig', pubkey: 'pk' }; signed.push(e); return e; }),
    nip44: { encrypt: vi.fn(), decrypt: vi.fn() },   // must NEVER be called for a plain kind-10002
  } as any;
  return { signer, signed };
}

describe('publishRelayListNip65', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('builds a PLAIN kind-10002 with flat r tags and never encrypts', async () => {
    const { signer, signed } = makeSigner();
    const relays = ['wss://relay.damus.io', 'wss://nos.lol'];

    const createdAt = await publishRelayListNip65(signer, 'owner-hex', relays);

    expect(signer.signEvent).toHaveBeenCalledOnce();
    expect(signer.nip44.encrypt).not.toHaveBeenCalled();   // G2: kind 10002 is public, must stay plain

    const evt = signed[0];
    expect(evt.kind).toBe(10002);
    expect(evt.content).toBe('');
    expect(evt.tags).toEqual([['r', 'wss://relay.damus.io'], ['r', 'wss://nos.lol']]);
    expect(typeof createdAt).toBe('number');
    expect(evt.created_at).toBe(createdAt);
  });

  it('publishes to publishTo when provided (reach beyond the local list)', async () => {
    const { signer } = makeSigner();
    const relays    = ['wss://relay.damus.io'];
    const publishTo = ['wss://relay.damus.io', 'wss://relay.primal.net'];

    await publishRelayListNip65(signer, 'owner-hex', relays, publishTo);

    // tags reflect the user's list; the publish target is the wider reach set
    expect(mockPool.publish).toHaveBeenCalledWith(publishTo, expect.objectContaining({ kind: 10002 }));
  });
});
