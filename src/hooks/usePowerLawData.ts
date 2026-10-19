import { useEffect, useMemo, useState } from 'react';
import { daysSinceGenesis, plFairValue, plFloor, plCeiling, GENESIS } from '../simulation/powerLaw';
import { HISTORY_TIMEOUT_MS, withTimeLimit } from '../utils/timeLimit';

const BLOCKCHAIN_URL = import.meta.env.DEV
  ? 'https://api.blockchain.info/charts/market-price?timespan=all&format=json&cors=true'
  : '/api/btc-history';

const ONE_WEEK = 7 * 86_400_000;

export interface PricePoint {
  timestamp: number;
  price: number;
}

export interface BandPoint {
  timestamp: number;
  fair: number;
  floor: number;
  ceiling: number;
}

interface PowerLawData {
  historical: PricePoint[];
  bands: BandPoint[];
  loading: boolean;
  error: string | null;
}

export function usePowerLawData(): PowerLawData {
  const [historical, setHistorical] = useState<PricePoint[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    // BL23 — the request and its body inside the time limit, so a stall ends as failed (THIS MONTH then says its breaker
    // is this device's last reading); an unmount aborts it.
    const outer = new AbortController();
    async function fetchData() {
      try {
        const json = await withTimeLimit(HISTORY_TIMEOUT_MS, async (signal) => {
          const res = await fetch(BLOCKCHAIN_URL, { signal });
          if (!res.ok) throw new Error(`Blockchain.com ${res.status}`);
          return await res.json() as { values: { x: number; y: number }[] };
        }, outer.signal);
        if (outer.signal.aborted) return;
        setHistorical(
          json.values.map((d) => ({ timestamp: d.x * 1000, price: d.y }))
        );
      } catch (e) {
        if (outer.signal.aborted) return;   // unmounted — nothing to say
        setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Blockchain.com timed out');
      } finally {
        if (!outer.signal.aborted) setLoading(false);
      }
    }
    void fetchData();
    return () => outer.abort();
  }, []);

  const bands = useMemo<BandPoint[]>(() => {
    const points: BandPoint[] = [];
    const end = new Date('2035-12-31T00:00:00Z');
    for (let d = GENESIS.getTime(); d <= end.getTime(); d += ONE_WEEK) {
      const date = new Date(d);
      const days = daysSinceGenesis(date);
      if (days < 1) continue;
      points.push({
        timestamp: d,
        fair:    plFairValue(date),
        floor:   plFloor(date),
        ceiling: plCeiling(date),
      });
    }
    return points;
  }, []);

  return { historical, bands, loading, error };
}
