import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { usePageVisibility } from './usePageVisibility';

const BTC_API = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';

interface BtcPriceState {
  livePrice:   number | null;
  lastUpdated: Date   | null;
}

export function useBtcPrice(): BtcPriceState {
  const setBtcPrice    = useStore((s) => s.setBtcPrice);
  const hasInitialized = useRef(false);
  const [state, setState] = useState<BtcPriceState>({ livePrice: null, lastUpdated: null });
  const isVisible = usePageVisibility();

  async function fetchPrice() {
    try {
      const res  = await fetch(BTC_API);
      if (!res.ok) return;
      const json  = await res.json() as { data?: { amount?: string } };
      const price = parseFloat(json?.data?.amount ?? '');
      if (!isNaN(price) && price > 0) {
        if (!hasInitialized.current) {
          setBtcPrice(price);
          hasInitialized.current = true;
        }
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

  return state;
}
