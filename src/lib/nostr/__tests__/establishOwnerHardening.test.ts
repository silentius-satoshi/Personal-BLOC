import { describe, it, expect, beforeEach, vi } from 'vitest';

// node env has no localStorage — minimal shim BEFORE importing the store (its module-init seed reads localStorage).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

// Hardening 1 · keys. Unlike establishOwner.test.ts, the REAL NSecSigner and the REAL keyVault (PIN path, Node's
// WebCrypto) run here — the rule is about the signer's buffer, so the signer can't be a stub. Only the relay side
// (syncNow/markSignerFresh) is mocked, exactly as establishOwner.test.ts does. The key is a synthetic fixed pattern.
vi.mock('../syncNow', () => ({
  syncNow: vi.fn(async () => true),
  markSignerFresh: vi.fn(),
}));

import { getPublicKey, verifyEvent } from 'nostr-tools';
import { establishLocalOwner } from '../establishOwner';
import { useStore } from '../../../store/useStore';
import type { NostrSigner } from '../signers';

beforeEach(() => {
  mem.clear();
  const s = useStore.getState();
  s.setNostrSigner(null);
  s.setIsAuthenticated(false);
  s.setNostrPubkey(null);
  s.setNostrSigningMethod(null);
  s.setWriterKeyWrapped(null);
  s.setWriterKeyWrapMeta(null);
});

describe('establishLocalOwner — hardening', () => {
  it('HK-06 · identity.md `A held key buffer is zeroed on success/teardown, NEVER in an establish finally` (always pass a .slice()) — the signer establishLocalOwner stores still signs after it zeroes the payload', async () => {
    const payload = new Uint8Array(32).fill(7);
    await establishLocalOwner(payload, 'pin', {} as any, { pin: '1234' });
    expect(Array.from(payload)).toEqual(new Array(32).fill(0));   // establish zeroed its argument on success

    const signer = useStore.getState().nostrSigner as NostrSigner;
    expect(signer).toBeTruthy();
    const e = await signer.signEvent({ kind: 1, created_at: 1000, tags: [], content: 'x' });
    expect(e.pubkey).toBe(getPublicKey(new Uint8Array(32).fill(7)));
    expect(verifyEvent(e as any)).toBe(true);
  }, 20_000);
});
