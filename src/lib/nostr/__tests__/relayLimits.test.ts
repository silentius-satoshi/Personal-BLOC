// 5b (spec `pbloc-spec-journal-pages-v1`) — the relay-limits probe: its size arithmetic against the NIP-44 the app
// really uses, and what it sends. ⚠ No network: the pool and fetch are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';

const { mockPool } = vi.hoisted(() => ({ mockPool: { publish: vi.fn(), close: vi.fn() } }));
vi.mock('nostr-tools/pool', () => ({ SimplePool: vi.fn(function () { return mockPool; }) }));

import { nip44PayloadLen, nip44PaddedLen, probeRelaySizes, fetchRelayInfo, PROBE_PLAIN_SIZES, PROBE_DTAG } from '../relayLimits';

describe('5b — relay limits probe', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });

  it('NIP44-LEN — the payload length matches nostr-tools\' real NIP-44 v2 output at every size the step turns on', () => {
    const key = nip44.utils.getConversationKey(generateSecretKey(), getPublicKey(generateSecretKey()));
    for (const n of [1, 32, 33, 100, 1_024, 32_768, 32_769, 40_960, 40_961, 65_535]) {
      expect(nip44.encrypt('a'.repeat(n), key).length, `${n} B plain`).toBe(nip44PayloadLen(n));
    }
    expect(nip44PaddedLen(40_960)).toBe(40_960);
    expect(nip44PaddedLen(40_961), 'one byte past the step pads to the next').toBe(49_152);
    expect(nip44PayloadLen(40_960)).toBe(54_704);
    expect(nip44PayloadLen(40_961), 'already past 65,536 before the event around it').toBe(65_628);
  });

  it('PROBE — three events per relay from a one-time key, sized as the app\'s payloads; each relay\'s answer, in order', async () => {
    const sent: any[] = [];
    mockPool.publish.mockImplementation((relays: string[], event: any) => {
      sent.push(event);
      return relays.map((url) => (url.includes('stock') && event.content.length > 60_000
        ? Promise.reject(new Error(`invalid: event too large: ${event.content.length + 400}`))
        : url.includes('down') ? Promise.resolve('connection failure: refused') : Promise.resolve('')));
    });
    const relays = ['wss://stock.example', 'wss://roomy.example', 'wss://down.example'];
    const results = await probeRelaySizes(relays);
    expect(sent.map((e) => e.content.length)).toEqual(PROBE_PLAIN_SIZES.map(nip44PayloadLen));
    expect(sent.every((e) => verifyEvent(e) && e.kind === 30078 && e.tags[0][1] === PROBE_DTAG)).toBe(true);
    expect(new Set(sent.map((e) => e.pubkey)).size, 'one key for the run').toBe(1);
    expect(sent.map((e) => e.created_at - sent[0].created_at), 'each newer than the last').toEqual([0, 1, 2]);
    expect(results.map((r) => `${r.url.slice(6, 10)} ${r.plainBytes} ${r.status}`)).toEqual([
      'stoc 1024 ack', 'room 1024 ack', 'down 1024 reject',
      'stoc 40960 ack', 'room 40960 ack', 'down 40960 reject',
      'stoc 40961 reject', 'room 40961 ack', 'down 40961 reject',
    ]);
    expect(results[6].message).toMatch(/^invalid: event too large/);
    expect(results[2].message, 'a connection failure is not an ack').toMatch(/^connection failure/);
    expect(mockPool.close).toHaveBeenCalledWith(relays);
  });

  it('NIP-11 — the advertised frame cap and software, or the error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ software: 'git+https://github.com/hoytech/strfry.git', version: '1.1.3', limitation: { max_message_length: 131_072 } })),
    );
    expect(await fetchRelayInfo('wss://nos.example')).toEqual({ url: 'wss://nos.example', software: 'git+https://github.com/hoytech/strfry.git', version: '1.1.3', maxMessageLength: 131_072 });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://nos.example');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toEqual({ Accept: 'application/nostr+json' });
    fetchSpy.mockRejectedValueOnce(new Error('CORS'));
    expect(await fetchRelayInfo('wss://x.example')).toEqual({ url: 'wss://x.example', error: 'CORS' });
  });
});
