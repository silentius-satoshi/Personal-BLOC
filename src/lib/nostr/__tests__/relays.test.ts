import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    querySync: vi.fn(),
    publish:   vi.fn(),
    close:     vi.fn(),
  },
}));

vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return mockPool; }),
}));

import { DEFAULT_RELAYS, normalizeRelayUrl, addRelay, importNip65RelayList } from '../relays';

describe('normalizeRelayUrl', () => {
  it('passes a valid wss URL through unchanged', () => {
    expect(normalizeRelayUrl('wss://relay.damus.io')).toBe('wss://relay.damus.io');
  });

  it('strips a trailing slash', () => {
    expect(normalizeRelayUrl('wss://relay.damus.io/')).toBe('wss://relay.damus.io');
  });

  it('lowercases the host', () => {
    expect(normalizeRelayUrl('wss://Relay.Damus.IO')).toBe('wss://relay.damus.io');
  });

  it('prepends wss:// when no scheme is typed', () => {
    expect(normalizeRelayUrl('relay.damus.io')).toBe('wss://relay.damus.io');
  });

  it('rejects an http(s) scheme', () => {
    expect(normalizeRelayUrl('http://relay.damus.io')).toBeNull();
    expect(normalizeRelayUrl('https://relay.damus.io')).toBeNull();
  });

  it('rejects garbage / malformed input', () => {
    expect(normalizeRelayUrl('not a url')).toBeNull();
    expect(normalizeRelayUrl('')).toBeNull();
    expect(normalizeRelayUrl('   ')).toBeNull();
  });

  it('allows ws:// only for localhost (dev)', () => {
    expect(normalizeRelayUrl('ws://localhost:7777')).toBe('ws://localhost:7777');
    expect(normalizeRelayUrl('ws://127.0.0.1:7777')).toBe('ws://127.0.0.1:7777');
    expect(normalizeRelayUrl('ws://relay.damus.io')).toBeNull();   // non-localhost ws → rejected
  });
});

describe('addRelay', () => {
  it('appends a valid new relay', () => {
    const { list, error } = addRelay(['wss://relay.damus.io'], 'wss://nos.lol');
    expect(error).toBeNull();
    expect(list).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('rejects a duplicate (list unchanged + error)', () => {
    const start = ['wss://relay.damus.io'];
    const { list, error } = addRelay(start, 'wss://relay.damus.io/');   // normalizes to the same url
    expect(error).toMatch(/already/i);
    expect(list).toBe(start);   // unchanged reference
  });

  it('rejects invalid input (list unchanged + error)', () => {
    const start = ['wss://relay.damus.io'];
    const { list, error } = addRelay(start, 'http://evil.com');
    expect(error).toMatch(/valid/i);
    expect(list).toBe(start);
  });
});

describe('DEFAULT_RELAYS', () => {
  it('is the canonical post-nostr.band default (guards restore-defaults + no-drift)', () => {
    expect(DEFAULT_RELAYS).toEqual(['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol']);
  });
});

describe('importNip65RelayList', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('found → returns ALL r tags (flat), normalized + deduped', async () => {
    mockPool.querySync.mockResolvedValue([{
      created_at: 100,
      tags: [
        ['r', 'wss://relay.damus.io'],          // no marker
        ['r', 'wss://relay.primal.net', 'write'],
        ['r', 'WSS://Relay.Damus.IO/', 'read'], // dupe-after-normalize of the first (lowercase + trailing slash)
        ['r', 'nos.lol'],                        // no scheme → prepend wss://
        ['p', 'somepubkey'],                     // non-r tag ignored
      ],
    }]);

    const res = await importNip65RelayList('owner-hex');
    expect(res).toEqual({
      found: true,
      relays: ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol'],
    });
    expect(mockPool.close).toHaveBeenCalled();
  });

  it('takes the NEWEST event when multiple are returned', async () => {
    mockPool.querySync.mockResolvedValue([
      { created_at: 100, tags: [['r', 'wss://old.example.com']] },
      { created_at: 200, tags: [['r', 'wss://new.example.com']] },
    ]);
    const res = await importNip65RelayList('owner-hex');
    expect(res).toEqual({ found: true, relays: ['wss://new.example.com'] });
  });

  it('no event → { found: false } (NOT defaults)', async () => {
    mockPool.querySync.mockResolvedValue([]);
    expect(await importNip65RelayList('owner-hex')).toEqual({ found: false });
  });

  it('query throws → { found: false } (NOT defaults)', async () => {
    mockPool.querySync.mockRejectedValue(new Error('relays down'));
    expect(await importNip65RelayList('owner-hex')).toEqual({ found: false });
    expect(mockPool.close).toHaveBeenCalled();   // finally still runs
  });

  it('10002 with no usable r tags → { found: true, relays: [] } (distinct from not-found)', async () => {
    mockPool.querySync.mockResolvedValue([{
      created_at: 100,
      tags: [['p', 'x'], ['r', 'http://nope.com'], ['r', 'not a url']],   // all unnormalizable / non-r
    }]);
    expect(await importNip65RelayList('owner-hex')).toEqual({ found: true, relays: [] });
  });
});
