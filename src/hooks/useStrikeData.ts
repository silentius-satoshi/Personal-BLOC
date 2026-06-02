import { useEffect } from 'react';
import { useStore } from '../store/useStore';

const POLL_INTERVAL_MS = 60_000;

export function useStrikeData(): void {
  const setStrikeUsdBalance   = useStore((s) => s.setStrikeUsdBalance);
  const setStrikeRate         = useStore((s) => s.setStrikeRate);
  const setStrikeApiConnected = useStore((s) => s.setStrikeApiConnected);
  const setStrikeLastFetched  = useStore((s) => s.setStrikeLastFetched);

  useEffect(() => {
    const fetchAll = async () => {
      const SECRET = import.meta.env.VITE_APP_PROXY_SECRET;
      const secretHeader = { 'x-app-secret': SECRET ?? '' };
      try {
        const [balanceRes, rateRes] = await Promise.all([
          fetch('/api/strike-balances', { headers: secretHeader }),
          fetch('/api/strike-rates',    { headers: secretHeader }),
        ]);

        // 503 = key not configured — silent, no error state
        if (balanceRes.status === 503 || rateRes.status === 503) return;

        if (!balanceRes.ok || !rateRes.ok) {
          setStrikeApiConnected(false);
          return;
        }

        const balanceData: any[] = await balanceRes.json();
        const rateData: any[]    = await rateRes.json();

        const usdEntry   = balanceData.find((b: any) => b.currency === 'USD');
        const usdBalance = usdEntry
          ? parseFloat(usdEntry.current?.amount ?? usdEntry.current ?? '0')
          : null;

        // rates/ticker returns an array — find the BTC→USD pair
        const rateEntry  = Array.isArray(rateData)
          ? rateData.find((r: any) => r.sourceCurrency === 'BTC' && r.targetCurrency === 'USD')
          : rateData;
        const strikeRate = rateEntry?.amount ? parseFloat(rateEntry.amount) : null;

        setStrikeUsdBalance(usdBalance);
        setStrikeRate(strikeRate);
        setStrikeApiConnected(true);
        setStrikeLastFetched(Date.now());
      } catch {
        setStrikeApiConnected(false);
      }
    };

    fetchAll();
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
