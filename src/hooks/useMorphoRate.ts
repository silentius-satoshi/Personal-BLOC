import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageVisibility } from './usePageVisibility';

export interface MorphoRate {
  borrowApy:    number | null;   // percent, e.g. 6.12 (null when unavailable)
  netBorrowApy: number | null;   // percent, net of reward incentives
}

const REFRESH_MS = 300_000;   // slow refresh while visible — the proxy also caches 5 min; NOT a tight poll

/**
 * Pure mapping of the proxy's GraphQL response → borrow APYs in PERCENT.
 * Morpho returns a decimal fraction (e.g. 0.0612), so ×100 → 6.12. Malformed/empty/null → nulls (no crash).
 */
export function parseMorphoRate(json: unknown): MorphoRate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (json as any)?.data?.marketById?.state;
  const toPct = (v: unknown) =>
    typeof v === 'number' && isFinite(v) ? v * 100 : null;
  return { borrowApy: toPct(s?.borrowApy), netBorrowApy: toPct(s?.netBorrowApy) };
}

/**
 * What this market has ACTUALLY charged, from Morpho's `historicalState` (monthly points, Oct 2024 → Sep
 * 2026). Static on purpose: these move ~0.2pt/yr, so re-fetching 24 points at runtime to recompute them
 * would be a request and a consent gate for a rounding error. Refresh by hand when it feels stale:
 *
 *   curl -s https://api.morpho.org/graphql -H 'Content-Type: application/json' \
 *     -d '{"query":"query { marketById(marketId: \"0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836\", chainId: 8453) { historicalState { borrowApy(options: {interval: MONTH}) { x y } } } }"}'
 *
 * ⚠ ONE CYCLE ONLY. The market opened Oct 2024, so this window covers a single crypto cycle under one
 * dollar-rate regime. It describes what HAS happened; it does not bound what can. The AdaptiveCurveIRM
 * permits up to 200% at target. Never present this as a range the rate cannot leave.
 * ⚠ `p10` excludes the first two months — market warm-up ran at 1.6–3.1% on thin utilization, which is a
 * property of a new market, not of this rate.
 */
export const MORPHO_REALIZED_APY = {
  p10: 4.1, median: 5.3, p90: 7.5, max: 9.9,
  months: 23, since: 'Oct 2024',
} as const;

/**
 * ON-DEMAND twin of `useMorphoRate` — fetches ONLY when `fetchNow()` is called, never on mount and never
 * on a timer. 🔴 This is what the Almanac faces use: the Almanac's background network surface stays the
 * consented `useChainTip` alone, and this stays a thing the owner asks for. Same-origin, display-only,
 * never written to the store.
 */
export function useMorphoRateOnDemand(): {
  rate: MorphoRate; loading: boolean; error: boolean; fetched: boolean; fetchNow: () => void;
} {
  const [rate, setRate]       = useState<MorphoRate>({ borrowApy: null, netBorrowApy: null });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);
  const [fetched, setFetched] = useState(false);
  const inFlight = useRef(false);

  const fetchNow = useCallback(() => {
    if (inFlight.current) return;            // single-in-flight, like restoreSigner/useChainTip
    inFlight.current = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/morpho-rate');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseMorphoRate(await res.json());
        setRate(parsed);
        setError(parsed.borrowApy === null);
      } catch {
        setRate({ borrowApy: null, netBorrowApy: null });
        setError(true);
      } finally {
        setLoading(false);
        setFetched(true);
        inFlight.current = false;
      }
    })();
  }, []);

  return { rate, loading, error, fetched, fetchNow };
}

/**
 * Live Morpho borrow APY for the confirmed cbBTC/USDC Base market, via the same-origin `/api/morpho-rate`
 * proxy. Ephemeral/display-only — never written to the store (a labeled reference beside the manual CB APR).
 */
export function useMorphoRate(): { rate: MorphoRate; loading: boolean; error: boolean } {
  const isVisible = usePageVisibility();
  const [rate, setRate]       = useState<MorphoRate>({ borrowApy: null, netBorrowApy: null });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;

    async function fetchRate() {
      setLoading(true);
      try {
        const res = await fetch('/api/morpho-rate');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const parsed = parseMorphoRate(json);
        if (!cancelled) {
          setRate(parsed);
          setError(parsed.borrowApy === null);
        }
      } catch {
        if (!cancelled) {
          setRate({ borrowApy: null, netBorrowApy: null });
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchRate();
    const id = setInterval(() => void fetchRate(), REFRESH_MS);   // slow refresh, not a tight poll
    return () => { cancelled = true; clearInterval(id); };
  }, [isVisible]);

  return { rate, loading, error };
}
