import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { usePageVisibility } from './usePageVisibility';

const BTC_API = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';

const POLL_MS              = 10_000;   // display refresh cadence
const STORE_SYNC_MS        = 60_000;   // max store staleness on a quiet market
const STORE_SYNC_THRESHOLD = 0.001;    // 0.1% move forces immediate store push

interface BtcPriceState {
  livePrice:   number | null;
  lastUpdated: Date   | null;
}

export function useBtcPrice(): BtcPriceState & { isStale: boolean } {
  const setBtcPrice = useStore((s) => s.setBtcPrice);
  const [state, setState] = useState<BtcPriceState>({ livePrice: null, lastUpdated: null });
  const isVisible = usePageVisibility();

  const lastStorePrice  = useRef<number | null>(null);
  const lastStorePushAt = useRef<number>(0);

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
        setState({ livePrice: price, lastUpdated: new Date() });
        if (useStore.getState().btcPriceMode === 'live') {
          const moved = lastStorePrice.current == null
            ? true
            : Math.abs(price - lastStorePrice.current) / lastStorePrice.current >= STORE_SYNC_THRESHOLD;
          const elapsed = Date.now() - lastStorePushAt.current >= STORE_SYNC_MS;
          if (moved || elapsed) {
            setBtcPrice(price);
            lastStorePrice.current  = price;
            lastStorePushAt.current = Date.now();
          }
        }
      }
    } catch {
      // silent fallback
    }
  }

  useEffect(() => {
    if (!isVisible) return;
    void fetchPrice();
    const id = setInterval(() => void fetchPrice(), POLL_MS);
    return () => clearInterval(id);
  }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  const STALE_MS = 5 * 60 * 1000;
  const isStale = state.lastUpdated
    ? (now - state.lastUpdated.getTime()) > STALE_MS
    : false;

  return { ...state, isStale };
}
