/**
 * BL23 (the plan of record's Run 4) — the price history's time limit.
 *
 * A request that never answers — an interface that is up but delivers nothing, a VPN tunnel left up with no network
 * under it — never counted as failed: THIS MONTH ran its cached breaker with no line for as long as the stall lasted
 * (invariant 10's suspension, made permanent), the Decision face kept loading, and the chart read "loading…" forever.
 * Both history fetches (`usePowerLawData`, `useBtcHistory`) now end as failed past this limit — the request AND its body,
 * since a body can stall too: `run` reads the body inside the limit.
 */
export const HISTORY_TIMEOUT_MS = 15_000;

/**
 * Runs `run` with a signal that aborts after `ms`, or as soon as `outer` aborts (an unmount). The timer is cleared however
 * `run` ends, so a request that finished is never aborted afterwards, and nothing is left behind.
 */
export async function withTimeLimit<T>(ms: number, run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', stop);
  const timer = setTimeout(stop, ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', stop);
  }
}
