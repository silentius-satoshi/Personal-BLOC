import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { liveBtc } from '../lib/liveBtc';
import { STALE_MS } from '../lib/liveFeed';

interface BtcPriceState {
  livePrice:   number | null;
  lastUpdated: Date   | null;
}

/**
 * The live price at its old cadence — about every 10 s — for the screens that read it as before (the sidebars' LIVE
 * badge, the Converter, the Mining tab). It comes from the app's one live feed (lib/liveBtc.ts, BL64) instead of a poll
 * per screen, and it no longer writes the store: the saved price is written there, by the rule it always had.
 */
export function useBtcPrice(): BtcPriceState & { isStale: boolean } {
  const tick = useSyncExternalStore(liveBtc.subscribeSlow, liveBtc.getSlow, () => null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const lastUpdated = useMemo(() => (tick === null ? null : new Date(tick.at)), [tick]);
  const isStale = tick !== null && now - tick.at > STALE_MS;

  return { livePrice: tick?.price ?? null, lastUpdated, isStale };
}
