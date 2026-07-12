// Phase 2a — the client for crypto.worker.ts. Runs nip49's ~1s of SYNCHRONOUS scrypt OFF the main thread when a
// module Web Worker is available, and SILENTLY FALLS BACK to the in-thread nip49 path otherwise (no worker
// support, a worker error, or a 30s op timeout). Worst case is exactly the pre-2a status quo.
//
// ⚠ INTERNAL-COPY CONTRACT (load-bearing). The client `.slice()`s the caller's `sk` and transfers/uses THE COPY,
// so the caller's buffer is never neutered — every existing caller-side `finally { sk.fill(0) }` keeps working
// verbatim. The fallback re-slices the caller's `sk` (intact for the duration of the await) into a fresh buffer it
// zeroes itself.
//
// ⚠ Only nip49 crosses the worker boundary (NIP-07/NIP-46 signers can't). Decrypt errors are classified as a
// STRING ('malformed' | 'passphrase' | 'generic') — never a message (bech32 echoes key material). Both paths
// surface failures as a `CryptoError` carrying `.kind`, so call sites read one shape regardless of which path ran.

import * as nip49 from 'nostr-tools/nip49';
import { classifyNcryptsecError } from '../nostr/ncryptsec';

// ── Protocol + pure helpers (node-testable without a real Worker) ─────────────────────────────

export type WorkerErrorKind = 'malformed' | 'passphrase' | 'generic';

export type CryptoRequest =
  | { id: number; op: 'nip49encrypt'; payload: ArrayBuffer; pass: string; logn?: number }
  | { id: number; op: 'nip49decrypt'; ncryptsec: string; pass: string };

export type CryptoResponse =
  | { id: number; ok: true; result: string }        // nip49encrypt → ncryptsec
  | { id: number; ok: true; result: ArrayBuffer }   // nip49decrypt → transferred sk copy
  | { id: number; ok: false; error: WorkerErrorKind };

/** A crypto failure, worker OR fallback. The message is fixed — NEVER key material (bech32 echoes the ncryptsec). */
export class CryptoError extends Error {
  readonly kind: WorkerErrorKind;
  constructor(kind: WorkerErrorKind) {
    super('crypto operation failed');
    this.name = 'CryptoError';
    this.kind = kind;
  }
}

export function encodeEncryptRequest(
  id: number, payload: ArrayBuffer, pass: string, logn?: number,
): { msg: CryptoRequest; transfer: Transferable[] } {
  return { msg: { id, op: 'nip49encrypt', payload, pass, logn }, transfer: [payload] };
}

export function encodeDecryptRequest(
  id: number, ncryptsec: string, pass: string,
): { msg: CryptoRequest; transfer: Transferable[] } {
  return { msg: { id, op: 'nip49decrypt', ncryptsec, pass }, transfer: [] };
}

/** Map an `ok:false` response's error string to a kind; anything unexpected → 'generic'. */
export function classifyWorkerFailure(resp: { error?: unknown }): WorkerErrorKind {
  const e = resp.error;
  return e === 'passphrase' || e === 'malformed' || e === 'generic' ? e : 'generic';
}

// ── Runtime client (singleton, lazy on first op) ──────────────────────────────────────────────

const OP_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  decode: (raw: string | ArrayBuffer) => unknown;   // worker `result` → the op's return type
  fallback: () => unknown;                            // re-run in-thread on infra failure
}

let worker: Worker | null = null;
let available: boolean | null = null;   // null = undetermined; false = unavailable for the session
let idCounter = 0;
const pending = new Map<number, Pending>();

/** Terminate + mark unavailable for the rest of the session. Every later op takes the fallback path. */
function markUnavailable(): void {
  available = false;
  if (worker) {
    try { worker.terminate(); } catch { /* noop */ }
    worker = null;
  }
}

function runFallback(entry: Pending): void {
  clearTimeout(entry.timer);
  try { entry.resolve(entry.fallback()); }
  catch (e) { entry.reject(e); }
}

/** A worker error / message error / op timeout: tear the worker down and re-run EVERY in-flight op in-thread. */
function onWorkerCrash(): void {
  markUnavailable();
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) runFallback(entry);
}

function handleMessage(e: MessageEvent<CryptoResponse>): void {
  const resp = e.data;
  const entry = pending.get(resp.id);
  if (!entry) return;
  pending.delete(resp.id);
  clearTimeout(entry.timer);
  if (resp.ok) entry.resolve(entry.decode(resp.result));
  else entry.reject(new CryptoError(classifyWorkerFailure(resp)));   // a legit crypto result — worker stays healthy
}

/** True if a live worker is ready. Feature-detects once; a spawn failure marks unavailable for the session. */
function ensureWorker(): boolean {
  if (available === false) return false;
  if (worker) return true;
  if (typeof Worker === 'undefined') { available = false; return false; }   // node/test + no module-worker support
  try {
    // ⚠ the precache-safe form ONLY — never `?worker&inline`.
    worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = onWorkerCrash;
    worker.onmessageerror = onWorkerCrash;
    available = true;
    return true;
  } catch {
    available = false;
    worker = null;
    return false;
  }
}

function dispatch<T>(
  msg: CryptoRequest,
  transfer: Transferable[],
  decode: (raw: string | ArrayBuffer) => T,
  fallback: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(onWorkerCrash, OP_TIMEOUT_MS);   // timeout → tear down + fallback all in-flight
    pending.set(msg.id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timer,
      decode: decode as (raw: string | ArrayBuffer) => unknown,
      fallback,
    });
    try { worker!.postMessage(msg, transfer); }
    catch { onWorkerCrash(); }   // e.g. DataCloneError — treat as infra failure, fall back
  });
}

async function nip49Encrypt(sk: Uint8Array, pass: string, logn?: number): Promise<string> {
  // The fallback re-slices the caller's still-intact `sk` and zeroes its own copy — the caller's buffer is untouched.
  const fallback = (): string => {
    const b = sk.slice();
    try { return nip49.encrypt(b, pass, logn); }
    catch { throw new CryptoError('generic'); }
    finally { b.fill(0); }
  };
  if (!ensureWorker()) return fallback();
  const copy = sk.slice();   // the transferred copy — caller's `sk` is never neutered
  const { msg, transfer } = encodeEncryptRequest(idCounter++, copy.buffer, pass, logn);
  return dispatch<string>(msg, transfer, (raw) => raw as string, fallback);
}

async function nip49Decrypt(ncryptsec: string, pass: string): Promise<Uint8Array> {
  const fallback = (): Uint8Array => {
    try { return nip49.decrypt(ncryptsec, pass); }
    catch (e) { throw new CryptoError(classifyNcryptsecError(e)); }
  };
  if (!ensureWorker()) return fallback();
  const { msg, transfer } = encodeDecryptRequest(idCounter++, ncryptsec, pass);
  return dispatch<Uint8Array>(msg, transfer, (raw) => new Uint8Array(raw as ArrayBuffer), fallback);
}

export const cryptoClient = { nip49Encrypt, nip49Decrypt };

/** Test-only: reset the singleton (mirrors resetProxyAuthCache). Not used in production. */
export function resetCryptoClientForTests(): void {
  markUnavailable();
  available = null;
  pending.clear();
  idCounter = 0;
}
