import { describe, it, expect } from 'vitest';
import { DEFAULT_RELAYS, normalizeRelayUrl, addRelay } from '../relays';

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
