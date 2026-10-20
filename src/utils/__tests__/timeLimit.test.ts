import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HISTORY_TIMEOUT_MS, withTimeLimit } from '../timeLimit';

/**
 * ⭐ BL23 — the plan of record's Run 4: the two price-history fetches end as failed past a time limit, so a stalled request
 * never leaves THIS MONTH running its cached breaker without its line, or the chart reading "loading…" for good.
 * `withTimeLimit` is pure (no React), so it runs here; the two hooks' wiring is read off their source, as planRunWiring
 * reads the screens' (the repo has no render harness). The e2e (planOfRecord.spec.ts, STALL) holds a request open on a
 * real page.
 */

/** A request that never answers — and, like fetch, rejects with an AbortError once its signal aborts. */
const stalled = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

afterEach(() => { vi.useRealTimers(); });

describe('⭐ STALL — withTimeLimit', () => {
  it('⭐ STALL — a request that never answers ends as failed at the limit, not before', async () => {
    vi.useFakeTimers();
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let reason: unknown = null;
    void withTimeLimit(HISTORY_TIMEOUT_MS, stalled).then(() => { settled = 'resolved'; }, (e) => { settled = 'rejected'; reason = e; });
    await vi.advanceTimersByTimeAsync(HISTORY_TIMEOUT_MS - 1);
    expect(settled, 'STALL still waiting just before the limit').toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled, 'STALL failed at the limit').toBe('rejected');
    expect((reason as Error).name, 'STALL an abort, as fetch reports it').toBe('AbortError');
  });

  it('⭐ STALL — the limit is fifteen seconds', () => {
    expect(HISTORY_TIMEOUT_MS, 'STALL the limit').toBe(15_000);
  });

  it('⭐ STALL — a request that answers in time is never aborted afterwards, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | null = null;
    const v = await withTimeLimit(1_000, async (signal) => { seen = signal; return 42; });
    expect(v, 'STALL the value passes through').toBe(42);
    expect(vi.getTimerCount(), 'STALL no timer left').toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen!.aborted, 'STALL a finished request stays un-aborted').toBe(false);
  });

  it('⭐ STALL — an unmount (the outer signal) aborts at once, and an outer signal already aborted never starts a live one', async () => {
    vi.useFakeTimers();
    const outer = new AbortController();
    let settled = false;
    void withTimeLimit(HISTORY_TIMEOUT_MS, stalled, outer.signal).catch(() => { settled = true; });
    outer.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled, 'STALL the unmount ends it').toBe(true);
    const gone = new AbortController();
    gone.abort();
    let seen: AbortSignal | null = null;
    await withTimeLimit(HISTORY_TIMEOUT_MS, async (signal) => { seen = signal; return 0; }, gone.signal);
    expect(seen!.aborted, 'STALL born aborted').toBe(true);
  });

  it('⭐ STALL — an error inside the limit passes through unchanged (a 500 stays a 500)', async () => {
    await expect(withTimeLimit(1_000, async () => { throw new Error('HTTP 500'); }), 'STALL the error').rejects.toThrow('HTTP 500');
  });
});

describe('⭐ STALL — both history fetches run inside the limit (read off the source)', () => {
  const read = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
  const HISTORY = read('hooks/usePowerLawData.ts');
  const CANDLES = read('hooks/useBtcHistory.ts');

  it('⭐ STALL — the power-law history: the request and its body inside the limit; an unmount aborts it', () => {
    expect(HISTORY, 'STALL history in the limit').toMatch(/await withTimeLimit\(HISTORY_TIMEOUT_MS, async \(signal\) => \{\s*const res = await fetch\(BLOCKCHAIN_URL, \{ signal \}\);/);
    expect(HISTORY, 'STALL history body in the limit').toMatch(/return await res\.json\(\) as \{ values: \{ x: number; y: number \}\[\] \};\s*\}, outer\.signal\);/);
    expect(HISTORY, 'STALL history ends loading').toMatch(/finally \{\s*if \(!outer\.signal\.aborted\) setLoading\(false\);\s*\}/);
    expect(HISTORY, 'STALL history unmount').toMatch(/return \(\) => outer\.abort\(\);/);
    expect(HISTORY.match(/\bfetch\(/g)?.length, 'STALL history: one fetch').toBe(1);
  });

  // 5e (F12) moved these pins: the chart now draws its history from this device's copy (lib/btcCandlesCache) at any age,
  // labeled once it is old, so a failed load keeps whatever it can draw — Run 4's "a failed refresh keeps the chart",
  // widened — and says so only with nothing to draw. The rules pinned are BL23's, unchanged.
  it('⭐ STALL — the chart: the request and its body inside the limit; a failed load keeps the history it can draw, and with none says so', () => {
    expect(CANDLES, 'STALL candles in the limit').toMatch(/await withTimeLimit\(HISTORY_TIMEOUT_MS, async \(signal\) => \{\s*const res = await fetch\(`\/api\/btc-candles\?granularity=\$\{granularity\}`, \{ signal \}\);/);
    expect(CANDLES, 'STALL candles body in the limit').toMatch(/return await res\.json\(\) as number\[\]\[\];\s*\}, outer\.signal\);/);
    expect(CANDLES, 'STALL a failed load is recorded').toMatch(/\} catch \{[\s\S]*?if \(!cancelled\) setFailed\(true\);\s*\}/);
    expect(CANDLES, 'STALL a failed load keeps what the chart can draw; with nothing, it says so').toMatch(/error:\s+failed && !drawn,/);
    expect(CANDLES, 'STALL the chart draws from the cache, never from state a load cleared').not.toMatch(/setCandles\(/);
    expect(CANDLES, 'STALL candles unmount').toMatch(/return \(\) => \{ cancelled = true; clearInterval\(id\); outer\.abort\(\); \};/);
    expect(CANDLES.match(/\bfetch\(/g)?.length, 'STALL candles: one fetch').toBe(1);
  });
});
