// The futures worker: it runs `futuresFor` off the main thread, so a thousand engine runs never stall a slider or a
// scroll. futuresClient.ts spawns it as `new Worker(new URL('./futures.worker.ts', import.meta.url), { type: 'module' })`,
// the precache-safe form the crypto worker uses. Its futuresRun module keeps the drawn futures between requests, which
// is what lets a settings change reuse them.
//
// The message shapes are declared here rather than imported from the client, as the crypto worker does — the client is
// DOM-typed, and pulling it in would drag the DOM into this WebWorker-lib project.

import { futuresFor, type FuturesJob } from './futuresRun';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<{ id: number; job: FuturesJob }>) => {
  const { id, job } = e.data;
  try {
    self.postMessage({ id, ok: true, summary: futuresFor(job) });
  } catch {
    self.postMessage({ id, ok: false });
  }
};
