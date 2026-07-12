import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same mock scaffold as publishRelayList.test.ts — one resolved promise per relay (real SimplePool shape).
const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    querySync: vi.fn(),
    publish:   vi.fn((rlys: string[]) => rlys.map(() => Promise.resolve())),
    close:     vi.fn(),
  },
}));

vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return mockPool; }),
}));

import { publishEncrypted, getPublishReports } from '../publish';

function makeSigner() {
  const signed: any[] = [];
  const signer = {
    signEvent: vi.fn(async (evt: any) => { const e = { ...evt, id: 'id', sig: 'sig', pubkey: 'pk' }; signed.push(e); return e; }),
    nip44: {
      encrypt: vi.fn(async (_pubkey: string, plaintext: string) => `ciphertext:${plaintext}`),
      decrypt: vi.fn(),
    },
  } as any;
  return { signer, signed };
}

describe('publishEncrypted', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('records both eventBytes (wire) and plainBytes (pre-encryption) as REAL bytes, not UTF-16 length', async () => {
    const { signer, signed } = makeSigner();
    const relays = ['wss://relay.damus.io', 'wss://nos.lol'];
    // non-ASCII text so byte length actually diverges from String.length (the point of this test)
    const data = { label: 'Dad’s iPhone ééé 👍', n: 42 };

    await publishEncrypted(signer, 'owner-hex', 'test:dtag:v1', data, relays);

    const report = getPublishReports().at(-1)!;
    const plaintext = JSON.stringify(data);
    const expectedPlainBytes = new TextEncoder().encode(plaintext).length;
    const expectedEventBytes = new TextEncoder().encode(JSON.stringify(signed[0])).length;

    expect(report.plainBytes).toBe(expectedPlainBytes);
    expect(report.eventBytes).toBe(expectedEventBytes);
    // sanity: the non-ASCII fixture makes byte length diverge from UTF-16 code-unit length
    expect(expectedPlainBytes).not.toBe(plaintext.length);
    // sanity: the encrypted wire payload differs from the plaintext (ciphertext wrapper), so the two byte counts diverge
    expect(report.eventBytes).not.toBe(report.plainBytes);
  });
});
