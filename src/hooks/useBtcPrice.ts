import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { usePageVisibility } from './usePageVisibility';

const BTC_API = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';

interface BtcPriceState {
  livePrice:   number | null;
  lastUpdated: Date   | null;
}

export function useBtcPrice(): BtcPriceState & { isStale: boolean } {
  const setBtcPrice = useStore((s) => s.setBtcPrice);
  const [state, setState] = useState<BtcPriceState>({ livePrice: null, lastUpdated: null });
  const isVisible = usePageVisibility();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function fetchPrice() {
    try {
      const res  = await fetch(BTC_API);
      if (!res.ok) return;
      const json  = await res.json() as { data?: { amount?: string } };
      const price = parseFloat(json?.data?.amount ?? '');
      if (!isNaN(price) && price > 0) {
        if (useStore.getState().btcPriceMode === 'live') setBtcPrice(price);
        setState({ livePrice: price, lastUpdated: new Date() });
      }
    } catch {
      // silent fallback
    }
  }

  useEffect(() => {
    if (!isVisible) return;
    void fetchPrice();
    const id = setInterval(() => void fetchPrice(), 60_000);
    return () => clearInterval(id);
  }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const STALE_MS = 5 * 60 * 1000;
  const isStale = state.lastUpdated
    ? (now - state.lastUpdated.getTime()) > STALE_MS
    : false;

  return { ...state, isStale };
}
