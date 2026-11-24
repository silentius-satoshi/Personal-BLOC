/**
 * The live price — ONE connection for the whole app (BL64). This file is the pure part: no store, no DOM, no clock of its
 * own; `liveBtc.ts` wires it to the browser and the store, and the tests drive it with fakes.
 *
 * - Coinbase Exchange's public market-data socket (no key, no account). While the app is on screen it listens to
 *   `ticker_batch` — a price every 5 s when it moved. While a per-second screen holds it (the Engine), the same socket
 *   switches to `ticker`, a message per burst of trades. Measured from the owner's Mac (BL64): about 12–13 a second, some
 *   18 MB an hour before compression, against about 0.3 MB for the batch.
 * - At most one price a second reaches the screen (the owner's prototype's rule); a burst keeps its latest.
 * - The socket sends only its subscribe and unsubscribe for BTC-USD — never an amount.
 * - When it has said nothing for QUIET_MS, the REST price is asked every POLL_MS, as every screen did before.
 * - Two cadences come out: `get` for what you watch (each price let through), and `getSlow` for the screens that read the
 *   price as before — about every 10 s (`useBtcPrice`).
 * - The saved price (the store's `btcPrice`) keeps the rule it always had — a 0.1% move or a minute, live mode only —
 *   written here alone, once for the app, and weighed on the slow snapshot alone: at most once in about 10 s on either
 *   feed, as simple mode's one poll did (v1.1). Before, every screen that polled pushed it on its own clock.
 * - Hidden, the socket closes and nothing is asked; shown again, it starts over. The last holder gone, the socket closes
 *   a second later, and the last per-second holder gone, it goes back to the batch a second later — so a screen swap, or
 *   React mounting a screen twice, changes nothing.
 */

export const FEED_URL = 'wss://ws-feed.exchange.coinbase.com';
export const SPOT_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
export const PRODUCT = 'BTC-USD';

export const SCREEN_MS       = 1_000;          // at most one price a second on screen
export const SLOW_MS         = 10_000;         // the old cadence, for `useBtcPrice`'s screens
export const QUIET_MS        = 12_000;         // the socket silent this long → ask the REST price
export const POLL_MS         = 10_000;         // the REST price's cadence (as before)
export const PUSH_MS         = 60_000;         // the saved price: at least once a minute…
export const PUSH_MOVE       = 0.001;          // …or on a 0.1% move, at the next slow snapshot
export const RETRY_HEARD_MS  = 5_000;          // reconnect after a socket that spoke…
export const RETRY_SILENT_MS = 45_000;         // …or after one that never did
export const MAX_FAILS       = 3;              // silent sockets in a row before the REST price carries alone
export const IDLE_MS         = 1_000;          // the last holder gone this long → close, or back to the batch (no churn on a remount)
export const STALE_MS        = 5 * 60_000;     // a price older than this is called stale (as before)

export type Channel = 'ticker' | 'ticker_batch';

export interface LiveTick {
  price: number;
  at: number;                      // when this device heard it (ms) — not the exchange's clock
  source: 'socket' | 'poll';
}

/** The little of a WebSocket the feed uses. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface LiveDeps {
  openSocket: ((url: string) => SocketLike) | null;   // null → the REST price alone
  fetchSpot: () => Promise<number | null>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  isVisible: () => boolean;
  onVisibility: (fn: () => void) => () => void;
  priceMode: () => 'live' | 'manual';
  savePrice: (price: number) => void;
}

export interface LiveFeed {
  /** Keeps the feed running (the app's frame), with nothing to render. Returns its release. */
  hold(): () => void;
  /** The per-second channel while held (the Engine). Returns its release. */
  holdPerSecond(): () => void;
  /** What you watch: each price let through (≤ 1 a second). Holds the feed while subscribed. */
  subscribe(fn: () => void): () => void;
  get(): LiveTick | null;
  /** The old cadence, about every 10 s. Holds the feed while subscribed. */
  subscribeSlow(fn: () => void): () => void;
  getSlow(): LiveTick | null;
  /** Inspection, for tests: the channel subscribed now, and whether a socket is open. */
  channel(): Channel | null;
  socketOpen(): boolean;
}

/** Coinbase's spot payload → a price, or null. */
export function parseSpot(json: unknown): number | null {
  const amount = (json as { data?: { amount?: unknown } } | null)?.data?.amount;
  const p = typeof amount === 'string' ? parseFloat(amount) : NaN;
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** A socket message → a BTC-USD price, or null (another product, another type, garbage). */
export function parseTicker(data: unknown): number | null {
  let m: unknown;
  try { m = JSON.parse(String(data)); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  const o = m as { type?: unknown; product_id?: unknown; price?: unknown };
  if (o.type !== 'ticker' || o.product_id !== PRODUCT) return null;
  const p = Number(o.price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/** The only messages the socket ever sends. */
export function subscribeMessage(type: 'subscribe' | 'unsubscribe', channel: Channel): string {
  return JSON.stringify({ type, product_ids: [PRODUCT], channels: [channel] });
}

/** The chart's series with the live price as its last point: only after the history's last candle, and only while the
 *  history is fresh (an old one is drawn muted with its time, and a live point would hide the gap). Never mutates. */
export function withLivePoint<C extends { t: number; price: number }>(
  candles: C[], tick: LiveTick | null, historyFresh: boolean,
): (C | { t: number; price: number })[] {
  if (!historyFresh || tick === null || candles.length < 2) return candles;
  if (!(tick.at > candles[candles.length - 1].t)) return candles;
  return [...candles, { t: tick.at, price: tick.price }];
}

export function createLiveFeed(deps: LiveDeps): LiveFeed {
  let holders = 0;
  let perSecond = 0;
  let awake = false;
  let unwatch: (() => void) | null = null;

  let ws: SocketLike | null = null;
  let wsChannel: Channel | null = null;   // subscribed on the open socket; null until it opens
  let heard = false;
  let fails = 0;
  let lastSocketAt = -Infinity;

  let retryT: unknown = null;
  let pollT: unknown = null;
  let flushT: unknown = null;
  let idleT: unknown = null;
  let backT: unknown = null;

  let pending: LiveTick | null = null;
  let lastScreenAt = -Infinity;
  let tick: LiveTick | null = null;
  let slow: LiveTick | null = null;
  let lastPush: number | null = null;
  let lastPushAt = -Infinity;

  const fastFns = new Set<() => void>();
  const slowFns = new Set<() => void>();

  const want = (): Channel => (perSecond > 0 ? 'ticker' : 'ticker_batch');
  const clear = (id: unknown): null => { if (id !== null) deps.clearTimer(id); return null; };

  function save(price: number): void {
    if (deps.priceMode() !== 'live') return;
    const now = deps.now();
    const moved = lastPush === null || Math.abs(price - lastPush) / lastPush >= PUSH_MOVE;
    if (moved || now - lastPushAt >= PUSH_MS) {
      deps.savePrice(price);
      lastPush = price;
      lastPushAt = now;
    }
  }

  function accept(t: LiveTick): void {
    lastScreenAt = deps.now();
    tick = t;
    fastFns.forEach((f) => f());
    if (slow === null || t.at - slow.at >= SLOW_MS - 1_000) {   // a second's slack: a poll lands a little early or late
      slow = t;
      slowFns.forEach((f) => f());
      save(t.price);   // weighed here alone: a tick a second never saves more often than the old 10 s poll (v1.1)
    }
  }

  function flush(): void {
    if (pending === null) return;
    const wait = SCREEN_MS - (deps.now() - lastScreenAt);
    if (wait <= 0) {
      flushT = clear(flushT);
      const t = pending;
      pending = null;
      accept(t);
    } else if (flushT === null) {
      flushT = deps.setTimer(() => { flushT = null; flush(); }, wait);
    }
  }

  function send(type: 'subscribe' | 'unsubscribe', ch: Channel): void {
    try { ws?.send(subscribeMessage(type, ch)); } catch { /* closed already */ }
  }

  function switchChannel(): void {
    if (ws === null || wsChannel === null || wsChannel === want()) return;   // not open yet: onopen asks for want()
    send('unsubscribe', wsChannel);
    wsChannel = want();
    send('subscribe', wsChannel);
  }

  function connect(): void {
    if (ws !== null || !awake || deps.openSocket === null || fails >= MAX_FAILS) return;
    let s: SocketLike;
    try { s = deps.openSocket(FEED_URL); } catch { fails++; return; }
    ws = s;
    wsChannel = null;
    heard = false;
    s.onopen = () => {
      if (ws !== s) return;
      wsChannel = want();
      send('subscribe', wsChannel);
    };
    s.onmessage = (ev) => {
      if (ws !== s) return;
      const price = parseTicker(ev.data);
      if (price === null) return;
      heard = true;
      fails = 0;
      lastSocketAt = deps.now();
      pending = { price, at: lastSocketAt, source: 'socket' };
      flush();
    };
    const gone = (): void => {
      if (ws !== s) return;
      ws = null;
      wsChannel = null;
      if (!heard) fails++;
      if (awake && fails < MAX_FAILS) {
        retryT = deps.setTimer(() => { retryT = null; connect(); }, heard ? RETRY_HEARD_MS : RETRY_SILENT_MS);
      }
    };
    s.onclose = gone;
    s.onerror = () => { try { s.close(); } catch { /* ignore */ } gone(); };
  }

  function pollNow(): void {
    deps.fetchSpot().then((price) => {
      if (!awake || price === null) return;
      if (deps.now() - lastSocketAt <= QUIET_MS) return;   // the socket spoke meanwhile
      accept({ price, at: deps.now(), source: 'poll' });
    }, () => { /* the next poll tries again */ });
  }

  function schedulePoll(): void {
    pollT = deps.setTimer(() => {
      pollT = null;
      if (!awake) return;
      if (deps.now() - lastSocketAt > QUIET_MS) pollNow();
      schedulePoll();
    }, POLL_MS);
  }

  function wake(): void {
    if (awake) return;
    awake = true;
    fails = 0;
    lastSocketAt = -Infinity;
    pollNow();          // a price at once, as before
    connect();
    schedulePoll();
  }

  function sleep(): void {
    if (!awake) return;
    awake = false;
    retryT = clear(retryT);
    pollT = clear(pollT);
    flushT = clear(flushT);
    backT = clear(backT);
    pending = null;
    const s = ws;
    ws = null;
    wsChannel = null;
    if (s !== null) { try { s.close(); } catch { /* ignore */ } }
  }

  function onVisibility(): void {
    if (holders > 0 && deps.isVisible()) wake(); else sleep();
  }

  function retain(): void {
    holders++;
    idleT = clear(idleT);
    if (unwatch === null) {
      unwatch = deps.onVisibility(onVisibility);
      if (deps.isVisible()) wake();
    }
  }

  function release(): void {
    holders = Math.max(0, holders - 1);
    if (holders > 0 || idleT !== null) return;
    idleT = deps.setTimer(() => {
      idleT = null;
      if (holders > 0) return;
      unwatch?.();
      unwatch = null;
      sleep();
    }, IDLE_MS);
  }

  function once(fn: () => void): () => void {
    let done = false;
    return () => { if (done) return; done = true; fn(); };
  }

  return {
    hold() {
      retain();
      return once(release);
    },
    holdPerSecond() {
      perSecond++;
      backT = clear(backT);
      retain();
      switchChannel();
      return once(() => {
        perSecond = Math.max(0, perSecond - 1);
        if (perSecond === 0 && backT === null) backT = deps.setTimer(() => { backT = null; switchChannel(); }, IDLE_MS);
        release();
      });
    },
    subscribe(fn) {
      fastFns.add(fn);
      retain();
      return once(() => { fastFns.delete(fn); release(); });
    },
    get: () => tick,
    subscribeSlow(fn) {
      slowFns.add(fn);
      retain();
      return once(() => { slowFns.delete(fn); release(); });
    },
    getSlow: () => slow,
    channel: () => wsChannel,
    socketOpen: () => ws !== null,
  };
}
