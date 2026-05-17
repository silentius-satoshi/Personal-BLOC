import { useEffect, useState } from 'react';

const HEIGHT_URL = 'https://mempool.space/api/blocks/tip/height';

export interface MempoolData {
  blockHeight:      number | null;
  daysUntilHalving: number | null;
  halvingYear:      number | null;
  nextHalvingBlock: number | null;
  loading:          boolean;
  error:            string | null;
}

export function useMempoolData(): MempoolData {
  const [data, setData] = useState<MempoolData>({
    blockHeight:      null,
    daysUntilHalving: null,
    halvingYear:      null,
    nextHalvingBlock: null,
    loading:          true,
    error:            null,
  });

  useEffect(() => {
    async function fetchAll() {
      try {
        const res = await fetch(HEIGHT_URL);
        if (!res.ok) throw new Error(`mempool ${res.status}`);
        const blockHeight = parseInt(await res.text(), 10);
        if (isNaN(blockHeight)) throw new Error('Invalid block height');

        const HALVING_INTERVAL = 210_000;
        const nextHalvingBlock  = Math.ceil((blockHeight + 1) / HALVING_INTERVAL) * HALVING_INTERVAL;
        const blocksRemaining   = nextHalvingBlock - blockHeight;
        const daysUntilHalving  = Math.ceil(blocksRemaining * 10 / (60 * 24));
        const halvingYear       = new Date(Date.now() + daysUntilHalving * 86_400_000).getFullYear();

        setData({ blockHeight, daysUntilHalving, halvingYear, nextHalvingBlock, loading: false, error: null });
      } catch (e) {
        setData((prev) => ({
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : 'Unknown',
        }));
      }
    }

    void fetchAll();
  }, []);

  return data;
}
