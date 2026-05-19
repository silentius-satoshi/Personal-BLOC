import { useEffect, useMemo, useState } from 'react';
import { daysSinceGenesis, plFairValue, plFloor, plCeiling, GENESIS } from '../simulation/powerLaw';

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
    async function fetchData() {
      try {
        const res = await fetch(BLOCKCHAIN_URL);
        if (!res.ok) throw new Error(`Blockchain.com ${res.status}`);
        const json = await res.json() as { values: { x: number; y: number }[] };
        setHistorical(
          json.values.map((d) => ({ timestamp: d.x * 1000, price: d.y }))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    void fetchData();
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
