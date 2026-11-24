import { describe, it, expect } from 'vitest';
import {
  createLiveFeed, parseSpot, parseTicker, subscribeMessage, withLivePoint,
  IDLE_MS, POLL_MS, PUSH_MS, QUIET_MS, RETRY_HEARD_MS, RETRY_SILENT_MS, SCREEN_MS,
  type LiveDeps, type SocketLike,
} from '../liveFeed';

/**
 * The live price (BL64) — lib/liveFeed.ts, driven by a fake socket, a fake clock and a fake REST price. Synthetic, round
 * prices. Each ⭐ names the edit that turns it red.
 */

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string): void { if (this.closed) throw new Error('closed'); this.sent.push(d); }
  close(): void { this.closed = true; }
  open(): void { this.onopen?.(); }
  tick(price: number | string, extra: Record<string, unknown> = {}): void {
    this.onmessage?.({ data: JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: String(price), ...extra }) });
  }
  drop(): void { this.closed = true; this.onclose?.(); }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function harness(o: { mode?: 'live' | 'manual'; socket?: boolean; spot?: number | null } = {}) {
  let t = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sockets: FakeSocket[] = [];
  const saved: number[] = [];
  const savedAt: number[] = [];
  const fetches: number[] = [];
  let visible = true;
  let mode: 'live' | 'manual' = o.mode ?? 'live';
  let spot: number | null = o.spot === undefined ? 100_000 : o.spot;
  let visFn: (() => void) | null = null;
  const deps: LiveDeps = {
    openSocket: o.socket === false ? null : () => { const s = new FakeSocket(); sockets.push(s); return s; },
    fetchSpot: () => { fetches.push(t); return Promise.resolve(spot); },
    now: () => t,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    isVisible: () => visible,
    onVisibility: (fn) => { visFn = fn; return () => { visFn = null; }; },
    priceMode: () => mode,
    savePrice: (p) => { saved.push(p); savedAt.push(t); },
  };
  const feed = createLiveFeed(deps);
  async function advance(ms: number): Promise<void> {
    const end = t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of timers) if (e[1].at <= end && (next === null || e[1].at < next[1].at)) next = e;
      if (next === null) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
      await flush();
    }
    t = end;
    await flush();
  }
  const last = (): FakeSocket => sockets[sockets.length - 1];
  return {
    feed, sockets, saved, savedAt, fetches, advance, last, flush,
    now: () => t,
    setVisible: (v: boolean) => { visible = v; visFn?.(); },
    setMode: (m: 'live' | 'manual') => { mode = m; },
    setSpot: (p: number | null) => { spot = p; },
  };
}

const SUB_BATCH = subscribeMessage('subscribe', 'ticker_batch');
const SUB_TICK = subscribeMessage('subscribe', 'ticker');
const UNSUB_BATCH = subscribeMessage('unsubscribe', 'ticker_batch');
const UNSUB_TICK = subscribeMessage('unsubscribe', 'ticker');

describe('the live price (BL64) — one feed for the app', () => {
  it('⭐ ONE CONNECTION — any number of holders share one socket; the last one gone (after a moment) closes it', async () => {
    // mutations: a socket per holder → red; release closing at once (a screen swap drops the feed) → red
    const h = harness();
    const a = h.feed.hold();
    const b = h.feed.subscribe(() => {});
    const c = h.feed.subscribeSlow(() => {});
    expect(h.sockets.length, 'ONE CONNECTION three holders').toBe(1);
    a(); b();
    await h.advance(IDLE_MS * 3);
    expect(h.feed.socketOpen(), 'ONE CONNECTION one holder left').toBe(true);
    c();
    const d = h.feed.hold();             // a screen swap: the next holder arrives within the moment
    await h.advance(IDLE_MS * 3);
    expect(h.sockets.length, 'ONE CONNECTION a swap keeps the socket').toBe(1);
    d();
    await h.advance(IDLE_MS - 1);
    expect(h.last().closed, 'ONE CONNECTION not yet').toBe(false);
    await h.advance(1);
    expect(h.last().closed, 'ONE CONNECTION closed once no one holds it').toBe(true);
    expect(h.feed.socketOpen()).toBe(false);
    h.feed.hold();
    expect(h.sockets.length, 'ONE CONNECTION a new holder opens a new one').toBe(2);
  });

  it('⭐ CHANNELS — the batch feed by default; the per-second feed on the same socket while a per-second screen holds it', async () => {
    // mutations: the per-second feed by default → red; a second socket for it → red; no switch back → red; back at once
    // (a remount churning the channel) → red
    const h = harness();
    const stop = h.feed.hold();
    h.last().open();
    expect(h.last().sent, 'CHANNELS the batch on open').toEqual([SUB_BATCH]);
    const engine = h.feed.holdPerSecond();
    expect(h.last().sent.slice(1), 'CHANNELS switched').toEqual([UNSUB_BATCH, SUB_TICK]);
    expect(h.feed.channel()).toBe('ticker');
    const second = h.feed.holdPerSecond();
    engine();
    expect(h.feed.channel(), 'CHANNELS one per-second holder left').toBe('ticker');
    second();
    const again = h.feed.holdPerSecond();                // a remount (React mounts a screen twice in development)
    await h.advance(IDLE_MS * 3);
    expect(h.last().sent.length, 'CHANNELS a remount changes nothing').toBe(3);
    again();
    await h.advance(IDLE_MS - 1);
    expect(h.feed.channel(), 'CHANNELS not yet').toBe('ticker');
    await h.advance(1);
    expect(h.last().sent.slice(3), 'CHANNELS back to the batch, a second on').toEqual([UNSUB_TICK, SUB_BATCH]);
    expect(h.sockets.length, 'CHANNELS one socket throughout').toBe(1);
    stop();
    // held before the socket opens: it asks for the per-second feed at once, nothing to undo
    const h2 = harness();
    h2.feed.hold();
    h2.feed.holdPerSecond();
    h2.last().open();
    expect(h2.last().sent, 'CHANNELS held before open').toEqual([SUB_TICK]);
  });

  it('⭐ AMOUNT-FREE — the socket only ever sends its subscribe and unsubscribe for BTC-USD', async () => {
    // mutation: any other message (an amount, a balance) → red
    const h = harness();
    h.feed.hold();
    h.last().open();
    const off = h.feed.holdPerSecond();
    off();
    h.last().tick(100_000);
    await h.advance(PUSH_MS * 2);
    const allowed = new Set([SUB_BATCH, SUB_TICK, UNSUB_BATCH, UNSUB_TICK]);
    expect(h.sockets.flatMap((s) => s.sent).every((m) => allowed.has(m)), 'AMOUNT-FREE').toBe(true);
    expect(JSON.parse(SUB_BATCH), 'AMOUNT-FREE the message').toEqual({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker_batch'] });
  });

  it('⭐ ONE A SECOND — a burst reaches the screen as one price a second, its latest', async () => {
    // mutation: every message to the screen → red; the burst's first kept, not its latest → red
    const h = harness({ spot: null });
    const seen: number[] = [];
    h.feed.subscribe(() => seen.push(h.feed.get()!.price));
    h.last().open();
    h.last().tick(100_000);
    expect(seen, 'ONE A SECOND the first at once').toEqual([100_000]);
    await h.advance(100); h.last().tick(100_010);
    await h.advance(200); h.last().tick(100_020);
    await h.advance(600); h.last().tick(100_030);
    expect(seen, 'ONE A SECOND held').toEqual([100_000]);
    await h.advance(SCREEN_MS - 900);
    expect(seen, 'ONE A SECOND its latest, a second on').toEqual([100_000, 100_030]);
    await h.advance(5_000);
    expect(seen.length, 'ONE A SECOND nothing more').toBe(2);
    expect(h.feed.get()!.source).toBe('socket');
  });

  it('⭐ SLOW — the screens that read the price as before still get it about every 10 s', async () => {
    // mutation: useBtcPrice's cadence as fast as the screen's → red (the Mining tab would re-run every second)
    const h = harness({ spot: null });
    let fast = 0;
    let slow = 0;
    h.feed.subscribe(() => fast++);
    h.feed.subscribeSlow(() => slow++);
    h.last().open();
    for (let i = 0; i < 25; i++) { h.last().tick(100_000 + i); await h.advance(1_000); }
    expect(fast, 'SLOW the screen, every second').toBe(25);
    expect(slow, 'SLOW about every 10 s').toBe(3);                // at 0, 9 and 18 s: a second's slack for a late poll
    expect(h.feed.getSlow()!.price, 'SLOW its latest').toBe(100_018);
  });

  it('⭐ PUSH RULE — the saved price moves on a 0.1% move or once a minute, weighed on the slow snapshot alone, in live mode alone, written once for the app', async () => {
    // mutations: a save on every tick → red; a save between slow snapshots (v1.0's rule) → red; no save after a minute →
    // red; a save in manual mode → red
    const h = harness({ spot: null });
    h.feed.subscribe(() => {});
    h.feed.subscribe(() => {});        // more screens never mean more saves
    h.feed.subscribeSlow(() => {});
    h.last().open();
    h.last().tick(100_000);
    expect(h.saved, 'PUSH RULE the first').toEqual([100_000]);
    for (let i = 1; i <= 58; i++) { await h.advance(1_000); h.last().tick(100_000 + i); }   // under 0.1%, 58 s (snapshots at 9, 18 … 54 s)
    expect(h.saved, 'PUSH RULE no save under 0.1%, within the minute').toEqual([100_000]);
    await h.advance(1_000); h.last().tick(100_200);                                          // 59 s: +0.2%, the snapshot not due
    expect(h.saved, 'PUSH RULE a 0.1% move waits for the slow snapshot').toEqual([100_000]);
    for (let i = 60; i <= 63; i++) { await h.advance(1_000); h.last().tick(100_200); }       // 63 s: the snapshot
    expect(h.saved, 'PUSH RULE a 0.1% move, at the snapshot').toEqual([100_000, 100_200]);
    for (let i = 64; i <= 126; i++) { await h.advance(1_000); h.last().tick(100_200 + (i % 3)); }   // under 0.1% of 100,200
    expect(h.saved, 'PUSH RULE a minute on, at the first snapshot after it').toEqual([100_000, 100_200, 100_200]);
    expect(h.savedAt[2] - h.savedAt[1], 'PUSH RULE that minute').toBe(63_000);
    h.setMode('manual');
    await h.advance(1_000); h.last().tick(120_000);
    await h.advance(PUSH_MS * 2); h.last().tick(130_000);
    expect(h.saved.length, 'PUSH RULE never in manual mode').toBe(3);
    expect(h.feed.get()!.price, 'PUSH RULE the screen still moves').toBe(130_000);
  });

  it('⭐ FAST MARKET — a 0.1% move every second, on the per-second feed: the saved price moves at most once in ~10 s, as simple mode\'s one poll did (v1.1)', async () => {
    // mutation: the save outside the slow snapshot (v1.0) → red (30 saves, a second apart)
    const h = harness({ spot: null });
    const off = h.feed.holdPerSecond();
    h.feed.subscribe(() => {});
    h.last().open();
    let p = 100_000;
    let last = 0;
    for (let i = 0; i < 30; i++) { h.last().tick(p); last = p; p = Math.round(p * 1.002); await h.advance(1_000); }
    const gaps = h.savedAt.slice(1).map((t, i) => t - h.savedAt[i]);
    expect(h.saved.length, 'FAST MARKET a few saves, not thirty').toBe(4);       // at 0, 9, 18 and 27 s
    expect(Math.min(...gaps), 'FAST MARKET never closer than the slow snapshot').toBeGreaterThanOrEqual(9_000);
    expect(h.feed.get()!.price, 'FAST MARKET the screen still has each second\'s').toBe(last);
    off();
  });

  it('⭐ QUIET — a silent socket hands over to the REST price, every 10 s as before; a speaking one stops it', async () => {
    // mutations: no REST price when the socket is silent → red; the REST price asked while the socket speaks → red
    const h = harness({ spot: 90_000 });
    h.feed.subscribe(() => {});
    await h.flush();
    expect(h.fetches.length, 'QUIET a price at once').toBe(1);
    expect(h.feed.get(), 'QUIET the REST price on screen').toMatchObject({ price: 90_000, source: 'poll' });
    h.last().open();
    await h.advance(POLL_MS * 3);
    expect(h.fetches.length, 'QUIET the socket silent: every 10 s').toBe(4);
    h.last().tick(91_000);
    const asked = h.fetches.length;
    for (let i = 0; i < 6; i++) { await h.advance(5_000); h.last().tick(91_000 + i); }        // a batch every 5 s
    expect(h.fetches.length, 'QUIET the socket speaks: no REST price').toBe(asked);
    await h.advance(QUIET_MS + POLL_MS);
    expect(h.fetches.length, 'QUIET silent again: the REST price again').toBeGreaterThan(asked);
  });

  it('⭐ RECONNECT — after a socket that spoke, 5 s; after a silent one, 45 s; three silent in a row, the REST price alone', async () => {
    // mutations: no reconnect → red; reconnecting a silent socket every 5 s (hammering) → red; no give-up → red
    const h = harness();
    h.feed.hold();
    h.last().open();
    h.last().tick(100_000);
    h.last().drop();
    await h.advance(RETRY_HEARD_MS - 1);
    expect(h.sockets.length, 'RECONNECT not yet').toBe(1);
    await h.advance(1);
    expect(h.sockets.length, 'RECONNECT 5 s after one that spoke').toBe(2);
    h.last().drop();                                   // silent: 1
    await h.advance(RETRY_HEARD_MS);
    expect(h.sockets.length, 'RECONNECT a silent one waits longer').toBe(2);
    await h.advance(RETRY_SILENT_MS - RETRY_HEARD_MS);
    expect(h.sockets.length, 'RECONNECT 45 s after a silent one').toBe(3);
    h.last().drop();                                   // silent: 2
    await h.advance(RETRY_SILENT_MS);
    h.last().onerror?.();                              // silent: 3
    await h.advance(RETRY_SILENT_MS * 4);
    expect(h.sockets.length, 'RECONNECT gives up after three silent').toBe(4);
    h.setVisible(false);
    h.setVisible(true);
    expect(h.sockets.length, 'RECONNECT shown again: a fresh start').toBe(5);
  });

  it('⭐ HIDDEN — hidden, the socket closes and nothing is asked; shown, it starts over', async () => {
    // mutations: the socket left open while hidden → red; REST asked while hidden → red; no restart → red
    const h = harness();
    h.feed.hold();
    h.last().open();
    await h.flush();
    const asked = h.fetches.length;
    h.setVisible(false);
    expect(h.last().closed, 'HIDDEN closed').toBe(true);
    expect(h.feed.socketOpen()).toBe(false);
    await h.advance(PUSH_MS * 5);
    expect(h.fetches.length, 'HIDDEN nothing asked').toBe(asked);
    expect(h.sockets.length, 'HIDDEN nothing opened').toBe(1);
    h.setVisible(true);
    await h.flush();
    expect(h.sockets.length, 'HIDDEN shown: a new socket').toBe(2);
    expect(h.fetches.length, 'HIDDEN shown: a price at once').toBe(asked + 1);
  });

  it('⭐ NO SOCKET — with no WebSocket, the REST price carries alone, every 10 s', async () => {
    const h = harness({ socket: false, spot: 80_000 });
    h.feed.subscribe(() => {});
    await h.advance(POLL_MS * 3);
    expect(h.fetches.length, 'NO SOCKET at once, then every 10 s').toBe(4);
    expect(h.feed.get()?.price).toBe(80_000);
  });

  it('⭐ GARBAGE — another product, another message, a bad price: never a price', () => {
    // mutation: any of these read as a price → red
    expect(parseTicker(JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: '100000.5' }))).toBe(100_000.5);
    for (const bad of [
      JSON.stringify({ type: 'ticker', product_id: 'ETH-USD', price: '3000' }),
      JSON.stringify({ type: 'subscriptions', channels: [] }),
      JSON.stringify({ type: 'heartbeat', product_id: 'BTC-USD' }),
      JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: 'abc' }),
      JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: '0' }),
      JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: '-5' }),
      '{not json', 'null', '42',
    ]) expect(parseTicker(bad), bad).toBeNull();
    expect(parseSpot({ data: { amount: '123.4' } })).toBe(123.4);
    for (const bad of [null, {}, { data: {} }, { data: { amount: '0' } }, { data: { amount: 5 } }]) expect(parseSpot(bad)).toBeNull();
  });

  it('⭐ LIVE POINT — the chart\'s last point is the live price, after the last candle, on a fresh history only', () => {
    // mutations: a live point on an old history → red; one dated before the last candle → red; the input mutated → red
    const candles = [{ t: 1_000, price: 100 }, { t: 2_000, price: 110 }];
    const tick = { price: 120, at: 2_500, source: 'socket' as const };
    expect(withLivePoint(candles, tick, true), 'LIVE POINT appended').toEqual([...candles, { t: 2_500, price: 120 }]);
    expect(candles.length, 'LIVE POINT never mutates').toBe(2);
    expect(withLivePoint(candles, tick, false), 'LIVE POINT not on an old history').toBe(candles);
    expect(withLivePoint(candles, { ...tick, at: 2_000 }, true), 'LIVE POINT not before the last candle').toBe(candles);
    expect(withLivePoint(candles, null, true), 'LIVE POINT none yet').toBe(candles);
    expect(withLivePoint([candles[0]], tick, true), 'LIVE POINT not on one candle').toEqual([candles[0]]);
  });
});
