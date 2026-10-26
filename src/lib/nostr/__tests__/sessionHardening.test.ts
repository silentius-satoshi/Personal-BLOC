import { describe, it, expect, beforeEach } from 'vitest';

// node env has no localStorage — minimal shim BEFORE importing the store (its module-init seed reads localStorage).
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

// Hardening 1 · keys. restoreSignerSingleFlight.test.ts stubs NSecSigner and unwrapSecretKey; here both are REAL
// (keyVault's PIN path through Node's WebCrypto), so a pinless restore of a scheme:'pin' key is genuinely doomed
// ('PIN required' → null) and the restored signer genuinely signs. The key is a synthetic fixed pattern.

import { getPublicKey, verifyEvent } from 'nostr-tools';
import { restoreSigner } from '../session';
import { wrapSecretKey } from '../keyVault';
import { useStore } from '../../../store/useStore';

const PUB = getPublicKey(new Uint8Array(32).fill(7));

beforeEach(async () => {
  mem.clear();
  const { ciphertext, meta } = await wrapSecretKey(new Uint8Array(32).fill(7), 'pin', '1234');
  const s = useStore.getState();
  s.setNostrSigningMethod('local');
  s.setNostrPubkey(PUB);
  s.setWriterKeyWrapped(ciphertext);
  s.setWriterKeyWrapMeta(meta);
  s.setNostrSigner(null);
}, 20_000);

describe('restoreSigner — hardening', () => {
  it('HK-07 · identity.md `A held key buffer is zeroed on success/teardown, NEVER in an establish finally` (restoreSigner\'s copy) — a restored local signer still signs after restoreSigner zeroes the unwrapped sk', async () => {
    const signer = await restoreSigner({} as any, '1234');
    expect(signer).not.toBeNull();
    const e = await signer!.signEvent({ kind: 1, created_at: 1000, tags: [], content: 'x' });
    expect(e.pubkey).toBe(PUB);
    expect(verifyEvent(e as any)).toBe(true);
  }, 20_000);

  it('HK-08 · identity.md `⚠ The restoreSigner single-flight guard is PIN-AWARE` (the .finally ownership check) — a pinless caller after the doomed pinless restore settles joins the pinned restore', async () => {
    const a = restoreSigner({} as any);            // pinless → doomed for a scheme:'pin' key
    const b = restoreSigner({} as any, '1234');    // pin-bearing never joins a pinless in-flight → its own restore
    expect(b).not.toBe(a);
    expect(await a).toBeNull();                    // the doomed one settles first — it must not free b's slot
    const c = restoreSigner({} as any);            // pinless while b is in flight → shares b (gets the real signer)
    expect(c).toBe(b);
    const [sc, sb] = await Promise.all([c, b]);
    expect(sb).not.toBeNull();
    expect(sc).toBe(sb);
  }, 20_000);
});
