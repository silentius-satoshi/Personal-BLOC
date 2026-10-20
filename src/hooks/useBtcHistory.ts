import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePageVisibility } from './usePageVisibility';
import { HISTORY_TIMEOUT_MS, withTimeLimit } from '../utils/timeLimit';
import {
  historyTime, isDrawable, isOld, isWellFormed, msUntilOld, readHistory, subscribeHistory, writeHistory,
} from '../lib/btcCandlesCache';

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
 * BTC price history for a timeframe, via the same-origin `/api/btc-candles` proxy (avoids CORS). Display-only — never
 * written to the store.
 *
 * 5e (F12): the chart draws this device's copy of the range's history at once (lib/btcCandlesCache — its own localStorage
 * key, shared by every mounted chart), at any age, and refreshes it behind. `asOf` is the history's time once it is more
 * than 5 minutes old: the chart draws it muted with "as of …" until a fresh one lands — and a timer labels a history on
 * screen the moment it crosses, so one the refreshes can't renew (offline) is labeled on time. A range draws only its own
 * history. A load that fails keeps whatever history the chart can draw; with nothing to draw, it says so.
 */
export function useBtcHistory(range: ChartRange): { candles: Candle[]; loading: boolean; error: boolean; asOf: number | null } {
  const isVisible = usePageVisibility();
  const entry = useSyncExternalStore(subscribeHistory, () => readHistory(range), () => readHistory(range));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed]   = useState(false);   // this range's last load brought nothing it could draw
  const [, setTick]           = useState(0);       // a re-render at the moment the history on screen turns old

  const granularityMs = RANGE_CFG[range].granularity * 1000;
  const now   = Date.now();
  const drawn = isDrawable(entry, granularityMs, now) ? entry : null;
  const old   = drawn !== null && isOld(drawn, granularityMs, now);

  useEffect(() => {
    if (!drawn || old) return;
    const id = setTimeout(() => setTick((n) => n + 1), msUntilOld(drawn, granularityMs, Date.now()));
    return () => clearTimeout(id);
  }, [drawn, old, granularityMs]);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const outer = new AbortController();   // the unmount (or a range change) aborts the request in flight
    const { granularity, count } = RANGE_CFG[range];
    setFailed(false);

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
          const landed = Date.now();
          // The cache keeps it unless it is older than the history it holds (an edge-cached copy): never newer → older.
          writeHistory(range, parsed, landed, granularity * 1000, landed);
          setFailed(!isWellFormed({ at: landed, candles: parsed }));
        }
      } catch {
        // BL23 — a load that fails (past the time limit too) keeps whatever history the chart can draw, labeled once it is
        // old; with nothing to draw, the chart says so.
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchCandles();
    const id = setInterval(() => void fetchCandles(), REFRESH_MS);   // slow refresh, not a tight poll
    return () => { cancelled = true; clearInterval(id); outer.abort(); };
  }, [range, isVisible]);

  return {
    candles: drawn ? drawn.candles : [],
    loading,
    error:   failed && !drawn,
    asOf:    drawn && old ? historyTime(drawn, granularityMs) : null,
  };
}
