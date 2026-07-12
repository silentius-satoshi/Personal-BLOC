// Phase 2a — the codebase's FIRST dedicated module Web Worker. Runs nip49's ~1s of SYNCHRONOUS scrypt OFF the
// main thread so the UI never freezes while an encrypted key is unlocked or an encrypted backup is produced.
//
// Spawned by cryptoClient.ts as `new Worker(new URL('./crypto.worker.ts', import.meta.url), { type: 'module' })`
// (the precache-safe form). The client feature-detects module-worker support and silently falls back to an
// in-thread nip49 call when the worker is unavailable/errors/times out — worst case is exactly the pre-2a status
// quo, so nothing here is load-bearing for correctness, only for responsiveness.
//
// ⚠ SECURITY. Key bytes cross postMessage as TRANSFERRED copies and are zeroed on BOTH sides. A decrypt error is
// classified INSIDE the worker (classifyNcryptsecError) and only the classified string ('malformed' | 'passphrase'
// | 'generic') crosses back — NEVER e.message, because bech32 echoes the whole ncryptsec / the offending char into
// its error text (the exact leak ncryptsec.ts documents).
//
// Imports are kept to nip49 + the zero-import ncryptsec helper so the emitted chunk stays small.

import * as nip49 from 'nostr-tools/nip49';
import { classifyNcryptsecError } from '../nostr/ncryptsec';

// mirrors src/sw.ts's `declare const self` — gives the dedicated-worker onmessage typing + the
// postMessage(message, transfer[]) overload under `lib: WebWorker`.
declare const self: DedicatedWorkerGlobalScope;

// A LOCAL copy of the request contract (kept in sync with cryptoClient.ts's CryptoRequest by hand — ~6 lines).
// Declaring it here rather than importing from cryptoClient.ts avoids pulling the DOM-typed client into this
// WebWorker-lib project.
type CryptoRequest =
  | { id: number; op: 'nip49encrypt'; payload: ArrayBuffer; pass: string; logn?: number }
  | { id: number; op: 'nip49decrypt'; ncryptsec: string; pass: string };

self.onmessage = (e: MessageEvent<CryptoRequest>) => {
  const msg = e.data;

  if (msg.op === 'nip49encrypt') {
    const sk = new Uint8Array(msg.payload);   // view over the transferred copy
    try {
      // logn === undefined falls through to nip49's default (16); production callers pass no logn.
      const result = nip49.encrypt(sk, msg.pass, msg.logn);
      self.postMessage({ id: msg.id, ok: true, result });
    } catch {
      self.postMessage({ id: msg.id, ok: false, error: 'generic' });   // ⚠ never e.message
    } finally {
      sk.fill(0);
    }
    return;
  }

  // nip49decrypt
  try {
    const sk = nip49.decrypt(msg.ncryptsec, msg.pass);
    const copy = sk.slice();   // fresh, exactly-sized ArrayBuffer to transfer back
    sk.fill(0);
    self.postMessage({ id: msg.id, ok: true, result: copy.buffer }, [copy.buffer]);
  } catch (err) {
    // classify HERE — the message never crosses the boundary. 'malformed' | 'passphrase'.
    self.postMessage({ id: msg.id, ok: false, error: classifyNcryptsecError(err) });
  }
};
