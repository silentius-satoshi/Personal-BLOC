import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDeviceTag, getDeviceLabel } from '../deviceTag';

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  });
  return store;
}

describe('deviceTag', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tag is stable across calls and persisted under bloc-device-tag', () => {
    const store = stubStorage();
    const tag = getDeviceTag();
    expect(getDeviceTag()).toBe(tag);
    expect(store.get('bloc-device-tag')).toBe(tag);
  });

  it('falls back to anon when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => {} });
    expect(getDeviceTag()).toBe('anon');
  });

  it('label prefixes the platform from the user agent', () => {
    stubStorage();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    expect(getDeviceLabel()).toMatch(/^iOS-/);
  });
});
