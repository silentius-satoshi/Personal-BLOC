import { useEffect, useSyncExternalStore } from 'react';
import { liveBtc } from '../lib/liveBtc';
import type { LiveTick } from '../lib/liveFeed';

/**
 * The live price for what you watch (BL64): a price every 5 s from Coinbase's batch feed, or each second while a
 * per-second screen holds the feed (`perSecond` — the Engine); null until the first. It re-renders only the component
 * that reads it. This is never the saved price: that is the store's `btcPrice`, which keeps its own rule (lib/liveFeed.ts).
 */
export function useLivePrice(opts: { perSecond?: boolean } = {}): LiveTick | null {
  const perSecond = opts.perSecond === true;
  useEffect(() => (perSecond ? liveBtc.holdPerSecond() : undefined), [perSecond]);
  return useSyncExternalStore(liveBtc.subscribe, liveBtc.get, () => null);
}

/**
 * The app's frame keeps the live price — and the saved price's rule — running for the whole session (Simple Mode mounts no
 * sidebar that reads it). It holds the feed and reads nothing, so a tick never re-renders the frame or the screen under it.
 */
export function useLiveFeedHold(): void {
  useEffect(() => liveBtc.hold(), []);
}
