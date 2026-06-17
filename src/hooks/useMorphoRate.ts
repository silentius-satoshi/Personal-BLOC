import { useEffect, useState } from 'react';
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
