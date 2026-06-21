import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// node test env has no `window` — minimal shim so the helper's `(window as any).nostr` reads resolve.
(globalThis as any).window = (globalThis as any).window ?? {};

import { waitForNostrExtension } from '../session';

describe('waitForNostrExtension — async window.nostr injection race', () => {
  beforeEach(() => { delete (globalThis as any).window.nostr; });
  afterEach(() => { vi.useRealTimers(); delete (globalThis as any).window.nostr; });

  it('resolves true immediately when window.nostr is already present', async () => {
    (globalThis as any).window.nostr = {};
    await expect(waitForNostrExtension(3000)).resolves.toBe(true);
  });

  it('resolves true when the extension injects mid-poll (the refresh race)', async () => {
    vi.useFakeTimers();
    const p = waitForNostrExtension(3000);
    setTimeout(() => { (globalThis as any).window.nostr = {}; }, 250);   // extension appears after ~250ms
    await vi.advanceTimersByTimeAsync(400);                              // run injection + polling checks
    await expect(p).resolves.toBe(true);
  });

  it('resolves false when no extension appears before the timeout (genuinely absent)', async () => {
    vi.useFakeTimers();
    const p = waitForNostrExtension(500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBe(false);
  });
});
