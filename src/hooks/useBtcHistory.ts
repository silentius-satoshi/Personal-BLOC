import { useEffect, useRef, useState } from 'react';
import { usePageVisibility } from './usePageVisibility';
import { HISTORY_TIMEOUT_MS, withTimeLimit } from '../utils/timeLimit';

export type ChartRange = '1H' | '1D' | '1W';

export interface Candle {
  t:     number;   // epoch ms
  price: number;   // close
}

// granularity (seconds) + how many recent candles to keep, each ≤ 300 (Coinbase's per-request cap).
export const RANGE_CFG: Record<ChartRange, { granularity: number; count: number }> = {
  '1H': { granularity: 60,   count: 60  },   // 1-min candles, last hour
  '1D': { granularity: 900,  count: 96  },   // 15-min candles, last day
  '1W': { granularity: 3600, count: 168 },   // 1-hr candles, last week
};

const REFRESH_MS = 60_000;   // slow refresh while visible — historical rates must NOT be polled frequently

/**
 * Pure mapping of the Coinbase candles payload → ascending close-price series.
 * Coinbase returns rows `[time, low, high, open, close, volume]`, newest-first, time in epoch SECONDS.
 */
export function parseCandles(raw: number[][], count: number): Candle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => Array.isArray(r) && r.length >= 5)
    .map((r) => ({ t: r[0] * 1000, price: r[4] }))   // close = index 4; seconds → ms
    .sort((a, b) => a.t - b.t)                         // ascending for charting
    .slice(-count);                                    // newest `count`
}

/**
 * BTC price history for a timeframe, via the same-origin `/api/btc-candles` proxy (avoids CORS).
 * Ephemeral/display-only — never written to the store (like the spot price's chart, not the store value).
 */
export function useBtcHistory(range: ChartRange): { candles: Candle[]; loading: boolean; error: boolean } {
  const isVisible = usePageVisibility();
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);
  // The range whose candles are on screen (null: none yet, or the page was hidden). A refresh that fails keeps them while
  // the page stays in view; a first load that fails says so.
  const shownRange = useRef<ChartRange | null>(null);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const outer = new AbortController();   // the unmount (or a range change) aborts the request in flight
    const { granularity, count } = RANGE_CFG[range];

    async function fetchCandles() {
      setLoading(true);
      try {
        // BL23 — the request and its body inside the time limit, so a stalled request ends as failed.
        const raw = await withTimeLimit(HISTORY_TIMEOUT_MS, async (signal) => {
          const res = await fetch(`/api/btc-candles?granularity=${granularity}`, { signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json() as number[][];
        }, outer.signal);
        const parsed = parseCandles(raw, count);
        if (!cancelled) {
          setCandles(parsed);
          setError(parsed.length === 0);
          shownRange.current = parsed.length > 0 ? range : null;
        }
      } catch {
        // BL23 — a refresh that fails (past the time limit too) keeps the chart already drawn for this range: before the
        // limit, a stalled refresh kept it by never ending, and the limit must not blank it. A first load that fails says so.
        if (!cancelled && shownRange.current !== range) {
          setCandles([]);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchCandles();
    const id = setInterval(() => void fetchCandles(), REFRESH_MS);   // slow refresh, not a tight poll
    // A page back in view (or a new range) starts again: the candles on screen may be hours old, so its first refresh is a
    // first load — and a failed one says so.
    return () => { cancelled = true; clearInterval(id); outer.abort(); shownRange.current = null; };
  }, [range, isVisible]);

  return { candles, loading, error };
}
