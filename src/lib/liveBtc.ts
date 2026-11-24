import { useStore } from '../store/useStore';
import { createLiveFeed, parseSpot, SPOT_URL, type SocketLike } from './liveFeed';

/**
 * The app's one live price (BL64) — `liveFeed.ts` wired to the browser and the store. The saved price is written here
 * and nowhere else on a tick: `setBtcPrice`, by the rule it always had (liveFeed.ts).
 *
 * Visibility is read the way `usePageVisibility` reads it, from several signals, because an iOS PWA fires
 * `visibilitychange` unreliably on resume: the event, window focus and pageshow, and a re-read every 20 s.
 */
export const liveBtc = createLiveFeed({
  openSocket: typeof WebSocket === 'function' ? (url) => new WebSocket(url) as unknown as SocketLike : null,
  fetchSpot: async () => {
    const res = await fetch(SPOT_URL);
    if (!res.ok) return null;
    return parseSpot(await res.json());
  },
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  isVisible: () => typeof document === 'undefined' || !document.hidden,
  onVisibility: (fn) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', fn);
    window.addEventListener('focus', fn);
    window.addEventListener('pageshow', fn);
    const id = setInterval(fn, 20_000);
    return () => {
      document.removeEventListener('visibilitychange', fn);
      window.removeEventListener('focus', fn);
      window.removeEventListener('pageshow', fn);
      clearInterval(id);
    };
  },
  priceMode: () => useStore.getState().btcPriceMode,
  savePrice: (price) => useStore.getState().setBtcPrice(price),
});
