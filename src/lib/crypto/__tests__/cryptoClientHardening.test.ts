import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cryptoClient, CryptoError, resetCryptoClientForTests } from '../cryptoClient';

// Hardening 1 · keys. Node has no Worker, so cryptoClient.test.ts reaches only the in-thread fallback. These
// install a FAKE module Worker that behaves like the browser's at the boundary: postMessage structured-clones the
// message WITH its transfer list (a transferred ArrayBuffer is detached on the sender's side), and the reply
// arrives later on onmessage. Every key byte is a synthetic fixed pattern.

type Reply = (msg: any) => any;
let reply: Reply = () => ({ ok: false, error: 'generic' });

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor(_url: unknown, _opts?: unknown) {}
  postMessage(msg: any, transfer: Transferable[] = []) {
    const received = structuredClone(msg, { transfer });   // what the worker side would receive
    setTimeout(() => { this.onmessage?.({ data: { id: received.id, ...reply(received) } }); }, 0);
  }
  terminate() {}
}

const hadWorker = 'Worker' in globalThis;
const realWorker = (globalThis as any).Worker;

beforeEach(() => {
  (globalThis as any).Worker = FakeWorker;
  resetCryptoClientForTests();
});
afterEach(() => {
  resetCryptoClientForTests();
  if (hadWorker) (globalThis as any).Worker = realWorker;
  else delete (globalThis as any).Worker;
});

describe('cryptoClient — the worker path (fake Worker)', () => {
  it('HK-03 · identity.md `A held key buffer is zeroed on success/teardown, NEVER in an establish finally` (nostr.md cryptoClient INTERNAL-COPY CONTRACT) — the worker path transfers a copy and never neuters the caller\'s sk', async () => {
    reply = (m) => (m.op === 'nip49encrypt' ? { ok: true, result: 'ncryptsec1fake' } : { ok: false, error: 'generic' });
    const sk = new Uint8Array(32).fill(7);
    const out = await cryptoClient.nip49Encrypt(sk, 'pass');
    expect(out).toBe('ncryptsec1fake');   // the worker answered (the worker path ran, not the fallback)
    // The caller's buffer is the caller's to zero: still 32 bytes, still its own bytes.
    expect(sk.length).toBe(32);
    expect(Array.from(sk)).toEqual(new Array(32).fill(7));
  });

  it('HK-04 · identity.md `Malformed payload ≠ wrong passphrase` — a worker ok:false keeps its classified kind (malformed is never reported as the passphrase)', async () => {
    reply = (m) => (m.op === 'nip49decrypt' ? { ok: false, error: 'malformed' } : { ok: false, error: 'generic' });
    const p = cryptoClient.nip49Decrypt('ncryptsec1truncated', 'pass');
    await expect(p).rejects.toBeInstanceOf(CryptoError);
    await expect(p).rejects.toMatchObject({ kind: 'malformed' });
  });
});
