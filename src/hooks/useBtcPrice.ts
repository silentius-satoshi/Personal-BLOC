import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

const BTC_API = 'https://api.crypto.com/exchange/v1/public/get-ticker?instrument_name=BTC_USD';

interface BtcPriceState {
  price: number | null;
  lastUpdated: Date | null;
  isLive: boolean;
}

export function useBtcPrice(): BtcPriceState {
  const setBtcPrice = useStore((s) => s.setBtcPrice);
  const [state, setState] = useState<BtcPriceState>({
    price: null,
    lastUpdated: null,
    isLive: false,
  });

  useEffect(() => {
    async function fetchPrice() {
      try {
        const res = await fetch(BTC_API);
        if (!res.ok) return;
        const json = await res.json() as {
          result?: { data?: Array<{ a?: string; b?: string }> };
        };
        const raw = json?.result?.data?.[0]?.a ?? json?.result?.data?.[0]?.b;
        const price = raw ? parseFloat(raw) : NaN;
        if (!isNaN(price) && price > 0) {
          setBtcPrice(price);
          setState({ price, lastUpdated: new Date(), isLive: true });
        }
      } catch {
        // silent fallback
      }
    }

    void fetchPrice();
    const id = setInterval(() => void fetchPrice(), 60_000);
    return () => clearInterval(id);
  }, [setBtcPrice]);

  return state;
}
