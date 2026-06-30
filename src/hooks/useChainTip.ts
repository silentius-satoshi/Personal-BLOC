import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { usePageVisibility } from './usePageVisibility';
import { blockAtDate } from '../simulation/cycleModel';

/**
 * Almanac CycleClock P3 — the live block-height tip.
 *
 * SOVEREIGN-FIRST: default OFF. When the device-local `almanacLiveEnabled` flag is off the hook NEVER
 * fetches — `height` is computed locally via `blockAtDate(Date.now())` (mode 'estimated'). Live is opt-in;
 * off and live feed the SAME `epochProgress` geometry (§4 fallback parity / HR-1) — only the badge + a
 * height-precision marker differ.
 *
 * Lifecycle mirrors useBtcPrice: a visibility-gated poll (clears its interval on cleanup), a slow `now`
 * ticker (drives the off-estimate freshness + the staleness clock), a single-in-flight ref, and an
 * AbortController aborted on unmount / when the toggle flips off. Silent on failure (keeps the last good
 * tip). 🔴 Imports nothing from the risk/position core; reads the store ONLY for the toggle flag.
 */

export interface ChainTip {
  height: number;
  mode: 'live' | 'estimated';
  source: string | null;
  lastUpdated: Date | null;
  isStale: boolean;
}

// Fixed list, structured config-ready ({name,url,parse}) — a later phase promotes this to user-config.
// Tried sequentially; first plausible answer wins. mempool/blockstream/blockchain.info return a plain-text
// number; blockchair returns JSON with data.blocks.
export const PROVIDERS = [
  { name: 'mempool.space',    url: 'https://mempool.space/api/blocks/tip/height',   parse: (t: string) => parseInt(t, 10) },
  { name: 'blockstream.info', url: 'https://blockstream.info/api/blocks/tip/height', parse: (t: string) => parseInt(t, 10) },
  { name: 'blockchain.info',  url: 'https://blockchain.info/q/getblockcount',        parse: (t: string) => parseInt(t, 10) },
  { name: 'blockchair.com',   url: 'https://api.blockchair.com/bitcoin/stats',       parse: (t: string) => JSON.parse(t)?.data?.blocks },
] as const;

export const isPlausibleHeight = (h: number): boolean =>
  Number.isFinite(h) && h > 800_000 && h < 2_000_000;

const POLL_MS = 120_000;     // live refresh cadence
const TICK_MS = 60_000;      // now-ticker (off-estimate freshness + staleness clock)
const FETCH_TIMEOUT_MS = 8_000;
const STALE_MS = 10 * 60 * 1000;

interface LiveTip {
  height: number;
  source: string;
  lastUpdated: Date;
}

export function useChainTip(): ChainTip {
  const almanacLiveEnabled = useStore((s) => s.almanacLiveEnabled);
  const isVisible = usePageVisibility();

  const [live, setLive] = useState<LiveTip | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  async function fetchTip() {
    if (inFlightRef.current) return;     // single in-flight — don't stack overlapping polls
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      for (const provider of PROVIDERS) {
        try {
          const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          const res = await fetch(provider.url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!res.ok) continue;
          const h = provider.parse(await res.text());
          if (isPlausibleHeight(h)) {
            setLive({ height: h, source: provider.name, lastUpdated: new Date() });
            return; // first valid wins
          }
        } catch {
          if (controller.signal.aborted) return; // unmount / toggle-off — stop the whole sweep
          // otherwise try the next provider
        }
      }
      // all failed → keep the last good tip (silent)
    } finally {
      inFlightRef.current = false;
    }
  }

  // Effect A — slow now-ticker (always on, cheap): keeps the off-estimate current across a long session
  // and drives the staleness check. Mirrors useBtcPrice's now ticker.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Effect B — live poll: ONLY when visible AND the toggle is on. Flipping off (or backgrounding) re-runs
  // this effect → early-return + cleanup clears the interval and aborts any in-flight fetch. Never fetches
  // when off.
  useEffect(() => {
    if (!isVisible || !almanacLiveEnabled) return;
    void fetchTip();
    const id = setInterval(() => void fetchTip(), POLL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [isVisible, almanacLiveEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (almanacLiveEnabled && live) {
    return {
      height: live.height,
      mode: 'live',
      source: live.source,
      lastUpdated: live.lastUpdated,
      isStale: now - live.lastUpdated.getTime() > STALE_MS,
    };
  }

  return {
    height: Math.round(blockAtDate(now)),
    mode: 'estimated',
    source: null,
    lastUpdated: null,
    isStale: false,
  };
}
