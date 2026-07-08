import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { usePageVisibility } from './usePageVisibility';
import { getProxyAuthHeader } from '../lib/nostr/proxyAuth';

const POLL_INTERVAL_MS = 60_000;

// "No Strike key configured" is a property of the DEPLOYMENT, not the user — so this lives at module scope,
// not in the Zustand store. Once a 503 confirms it, every subsequent poll in this session is a wasted signing
// + fetch round-trip; skip them. A reload re-probes once (the deployment could change).
let strikeProxyUnconfigured = false;

/** `enabled` gates the fetch on the authenticated OWNER (AppShell passes `isAuthenticated && isOwner`) —
 *  an un-authenticated visitor or a non-owner key never triggers the Strike proxy. */
export function useStrikeData(enabled: boolean): void {
  const setStrikeUsdBalance   = useStore((s) => s.setStrikeUsdBalance);
  const setStrikeBtcAvailable = useStore((s) => s.setStrikeBtcAvailable);
  const setStrikeRate         = useStore((s) => s.setStrikeRate);
  const setStrikeApiConnected = useStore((s) => s.setStrikeApiConnected);
  const setStrikeLastFetched  = useStore((s) => s.setStrikeLastFetched);
  const isVisible = usePageVisibility();

  const fetchAll = async () => {
      if (strikeProxyUnconfigured) return;
      // NIP-98: each request is signed with the owner's Nostr key (Authorization: Nostr <base64>) — no bundle
      // secret. The owner-gate (enabled) means the signer is normally present; bail safely if it isn't.
      const signer = useStore.getState().nostrSigner;
      if (!signer) return;
      const balancesUrl = `${window.location.origin}/api/strike-balances`;
      const ratesUrl    = `${window.location.origin}/api/strike-rates`;
      try {
        const [balanceAuth, rateAuth] = await Promise.all([
          getProxyAuthHeader(balancesUrl, 'GET', signer),
          getProxyAuthHeader(ratesUrl,    'GET', signer),
        ]);
        const [balanceRes, rateRes] = await Promise.all([
          fetch(balancesUrl, { headers: { Authorization: balanceAuth } }),
          fetch(ratesUrl,    { headers: { Authorization: rateAuth } }),
        ]);

        // 503 = key not configured — silent, no error state
        if (balanceRes.status === 503 || rateRes.status === 503) {
          strikeProxyUnconfigured = true;
          return;
        }

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

        // dry powder — spendable (NOT collateral; Strike's API exposes no pledged field)
        const btcEntry     = balanceData.find((b: any) => b.currency === 'BTC');
        const btcAvailable = btcEntry
          ? parseFloat(btcEntry.available?.amount ?? btcEntry.available ?? '0')
          : null;

        // rates/ticker returns an array — find the BTC→USD pair
        const rateEntry  = Array.isArray(rateData)
          ? rateData.find((r: any) => r.sourceCurrency === 'BTC' && r.targetCurrency === 'USD')
          : rateData;
        const strikeRate = rateEntry?.amount ? parseFloat(rateEntry.amount) : null;

        setStrikeUsdBalance(usdBalance);
        setStrikeBtcAvailable(btcAvailable);
        setStrikeRate(strikeRate);
        setStrikeApiConnected(true);
        setStrikeLastFetched(Date.now());
      } catch {
        setStrikeApiConnected(false);
      }
  };

  useEffect(() => {
    if (!isVisible || !enabled) return;   // owner-only — no fetch/poll for non-owner or un-authenticated
    fetchAll();
    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isVisible, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
