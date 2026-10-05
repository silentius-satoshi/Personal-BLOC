// The client for futures.worker.ts, on the crypto client's pattern: one module worker, spawned lazily and
// feature-detected. If there is no worker, if it errors or if a job outlasts the timeout, the job runs in-thread through
// the very same `futuresFor` — the worst case is a slower answer, never a missing or a different one.
//
// LATEST ONLY. At most one job is in the worker and at most one waits behind it. A newer request takes the waiting
// slot, and the request it replaced resolves `null` (superseded) — so dragging a slider across ten values runs two jobs,
// the first and the last, not ten.

import { futuresFor, type FuturesJob } from './futuresRun';
import type { FuturesSummary } from '../../simulation/monteCarlo';

type Reply = { id: number; ok: true; summary: FuturesSummary } | { id: number; ok: false };
type Settle = (s: FuturesSummary | null) => void;

/** Far past any real run (a slow phone needs about a second): beyond it the worker is taken as stuck, and the job runs in-thread. */
const JOB_TIMEOUT_MS = 20_000;

/** Makes the worker — the real one, or a test's fake. */
export type WorkerFactory = () => Worker;
const realFactory: WorkerFactory = () =>
  new Worker(new URL('./futures.worker.ts', import.meta.url), { type: 'module' });

let factory: WorkerFactory = realFactory;
let worker: Worker | null = null;
let available: boolean | null = null;
let nextId = 0;
let running: { id: number; job: FuturesJob; settle: Settle; timer: ReturnType<typeof setTimeout> } | null = null;
let waiting: { job: FuturesJob; settle: Settle } | null = null;

function inThread(job: FuturesJob): FuturesSummary | null {
  try { return futuresFor(job); } catch { return null; }
}

/** The worker failed: drop it for the rest of the session, and finish its job — and every later one — in-thread. */
function onCrash(): void {
  available = false;
  if (worker) {
    try { worker.terminate(); } catch { /* already gone */ }
    worker = null;
  }
  const r = running;
  running = null;
  if (r) { clearTimeout(r.timer); r.settle(inThread(r.job)); }
  pump();
}

function ensureWorker(): boolean {
  if (available === false) return false;
  if (worker) return true;
  if (typeof Worker === 'undefined') { available = false; return false; }
  try {
    worker = factory();
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = running;
      if (!r || e.data.id !== r.id) return;
      running = null;
      clearTimeout(r.timer);
      r.settle(e.data.ok ? e.data.summary : inThread(r.job));
      pump();
    };
    worker.onerror = onCrash;
    worker.onmessageerror = onCrash;
    available = true;
    return true;
  } catch {
    available = false;
    worker = null;
    return false;
  }
}

/** If the worker is free, start the job that is waiting. */
function pump(): void {
  if (running || !waiting) return;
  const { job, settle } = waiting;
  waiting = null;
  if (!ensureWorker()) {
    // In-thread, but on the next tick, so the render that asked for it finishes first.
    setTimeout(() => { settle(inThread(job)); pump(); }, 0);
    return;
  }
  const id = nextId++;
  running = { id, job, settle, timer: setTimeout(onCrash, JOB_TIMEOUT_MS) };
  try { worker!.postMessage({ id, job }); } catch { onCrash(); }
}

/** The futures for `job`, or `null` when a newer request took its place before it started. */
export function runFuturesJob(job: FuturesJob): Promise<FuturesSummary | null> {
  return new Promise((resolve) => {
    if (waiting) waiting.settle(null);   // the request still waiting is superseded
    waiting = { job, settle: resolve };
    pump();
  });
}

/** Tests only: swap the worker factory and start the client from scratch. */
export function resetFuturesClientForTests(next: WorkerFactory | null = null): void {
  if (worker) { try { worker.terminate(); } catch { /* already gone */ } }
  worker = null;
  available = null;
  if (running) clearTimeout(running.timer);
  running = null;
  waiting = null;
  nextId = 0;
  factory = next ?? realFactory;
}
