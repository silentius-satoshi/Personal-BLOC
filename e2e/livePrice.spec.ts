import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { openAlmanacFace, STORE_VERSION } from './helpers';

/**
 * The live price (BL64): one feed for the app — Coinbase's batch feed while the app is on screen, a price at most once a
 * second on screen, today's REST price when the feed is silent, and the saved price by the rule it always had. The feed
 * here is fake (page.routeWebSocket): playwright.config.ts resolves Coinbase's hosts nowhere, so no test reaches the real
 * one. Synthetic, round prices.
 */

const SUB_BATCH = JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker_batch'] });
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });

/** A simple-mode owner on Daily; `live` sets the saved price's mode. */
const seed = (mode: 'live' | 'manual'): string => `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, simpleMode: true, simpleView: 'daily', btcPriceMode: '${mode}', btcPrice: 100000 },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

/**
 * Counts each component's renders, by name, from React's devtools hook — the way React DevTools tells a render from a
 * bailout: a function component's fiber carries PerformedWork (1) when it ran, and a subtree React skipped is the very
 * same child as before, so the walk stops there.
 */
const RENDER_COUNTER = `
  window.__renders = {};
  (function () {
    function nameOf(f) {
      var t = f.type;
      if (!t) return null;
      if (typeof t === 'function') return t.displayName || t.name || null;
      if (t.type && typeof t.type === 'function') return t.type.displayName || t.type.name || null;
      if (t.render) return t.render.displayName || t.render.name || null;
      return null;
    }
    function visit(f) {
      if (f.tag === 0 || f.tag === 11 || f.tag === 14 || f.tag === 15) {
        var rendered = f.alternate === null || (f.flags & 1) === 1;
        var n = rendered ? nameOf(f) : null;
        if (n) window.__renders[n] = (window.__renders[n] || 0) + 1;
      }
      var c = f.child;
      if (f.alternate !== null && c === f.alternate.child) return;
      while (c) { visit(c); c = c.sibling; }
    }
    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(), supportsFiber: true, isDisabled: false,
      inject: function (r) { var id = hook.renderers.size + 1; hook.renderers.set(id, r); return id; },
      onScheduleFiberRoot: function () {}, onCommitFiberUnmount: function () {}, onPostCommitFiberRoot: function () {},
      checkDCE: function () {},
      onCommitFiberRoot: function (id, root) { try { visit(root.current); } catch (e) { /* never break the app */ } },
    };
  })();
`;

/** Coinbase's candle rows, newest first ([time s, low, high, open, close, volume]), the newest bucket now, closing at `close`. */
function candleRows(granularity: number, close: number): number[][] {
  const now = Math.floor(Date.now() / 1000);
  const newest = now - (now % granularity);
  return Array.from({ length: 100 }, (_, i) => {
    const c = close - i * 3;
    return [newest - i * granularity, c - 10, c + 10, c, c, 1];
  });
}

interface Feed { sockets: WebSocketRoute[]; sent: string[]; tick: (price: string) => void }

/** Full mode on the Emergency tab with a Coinbase loan (50% LTV at the saved price); the saved price written at `atMs`. */
const seedConsole = (atMs: number): string => `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, simpleMode: false, activeTab: 'liqsim', btcPriceMode: 'live', btcPrice: 100000,
      btcPriceUpdatedAt: ${atMs}, hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1 },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

/** The history, the REST price (`spot`, or none) and a fake feed; then Daily (or `seed`'s page, at its `landmark`). */
async function open(page: Page, o: {
  mode?: 'live' | 'manual'; spot?: string | null; feed?: boolean; counter?: boolean; seed?: string; landmark?: string;
} = {}): Promise<Feed> {
  const feed: Feed = { sockets: [], sent: [], tick: (price) => {
    const ws = feed.sockets[feed.sockets.length - 1];
    ws.send(JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price }));
  } };
  await page.route(/\/api\/btc-candles/, (route) => {
    const g = Number(new URL(route.request().url()).searchParams.get('granularity')) || 900;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(candleRows(g, 99_000)) });
  });
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  const spot = o.spot === undefined ? '100000.00' : o.spot;
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => (spot === null ? r.abort()
    : r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: spot, base: 'BTC', currency: 'USD' } }) })));
  if (o.feed !== false) {
    await page.routeWebSocket(/ws-feed\.exchange\.coinbase\.com/, (ws) => {
      feed.sockets.push(ws);
      ws.onMessage((m) => { feed.sent.push(String(m)); });
    });
  }
  if (o.counter) await page.addInitScript(RENDER_COUNTER);
  await page.addInitScript(o.seed ?? seed(o.mode ?? 'manual'));
  await page.goto('/');
  if (o.landmark !== undefined) await expect(page.getByText(o.landmark, { exact: true })).toBeVisible({ timeout: 15_000 });
  else await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
  return feed;
}

const chart = (page: Page) => page.locator('[data-old]');
const saved = (page: Page): Promise<number> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('personal-bloc-store') ?? '{}').state.btcPrice as number);

test.describe('the live price (BL64)', () => {
  test('⭐ ONE FEED — one socket for the app, asking only for the BTC-USD batch feed, kept across screens', async ({ page }) => {
    // mutations: a socket per screen → red; the per-second feed by default → red
    const feed = await open(page);
    await expect.poll(() => feed.sockets.length, { message: 'ONE FEED opened' }).toBe(1);
    await expect.poll(() => feed.sent, { message: 'ONE FEED the batch' }).toEqual([SUB_BATCH]);
    await page.getByLabel('Almanac').click();
    await openAlmanacFace(page, 'Power Law');
    await expect(page.getByText('The model', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Almanac', exact: true }).click();
    await page.waitForTimeout(1_500);
    expect(feed.sockets.length, 'ONE FEED across screens').toBe(1);
    expect(feed.sent, 'ONE FEED nothing else sent').toEqual([SUB_BATCH]);
  });

  test('⭐ CHART — the Dashboard\'s price chart follows the feed: its headline and last point', async ({ page }) => {
    // mutation: the chart on its history alone → red
    const feed = await open(page);
    await expect(chart(page).getByText('$100,000.00', { exact: true }), 'CHART the REST price at once').toBeVisible();
    await expect.poll(() => feed.sockets.length).toBe(1);
    feed.tick('101234.56');
    await expect(chart(page).getByText('$101,234.56', { exact: true }), 'CHART a tick').toBeVisible();
    await page.waitForTimeout(1_100);
    feed.tick('101250.00');
    await expect(chart(page).getByText('$101,250.00', { exact: true }), 'CHART the next').toBeVisible();
  });

  test('⭐ FRAME — a tick re-renders the chart, never the app\'s frame or the screen under it', async ({ page }) => {
    // mutation: AppShell reading the live price → red (it re-renders on every tick)
    const feed = await open(page, { counter: true });
    await expect(chart(page).getByText('$100,000.00', { exact: true })).toBeVisible();
    await expect.poll(() => feed.sockets.length).toBe(1);
    await page.waitForTimeout(1_500);
    // The counter sees them (it isn't vacuous): each rendered at the start.
    const atStart = await page.evaluate(() => (window as unknown as { __renders: Record<string, number> }).__renders);
    for (const n of ['AppShell', 'DailyModeView', 'PriceChart']) expect(atStart[n] ?? 0, `FRAME the counter sees ${n}`).toBeGreaterThan(0);
    await page.evaluate(() => { (window as unknown as { __renders: Record<string, number> }).__renders = {}; });
    for (let i = 1; i <= 5; i++) {
      feed.tick(String(100_000 + i * 10));
      await page.waitForTimeout(1_200);
    }
    await expect(chart(page).getByText('$100,050.00', { exact: true })).toBeVisible();
    const renders = await page.evaluate(() => (window as unknown as { __renders: Record<string, number> }).__renders);
    expect(renders.PriceChart ?? 0, 'FRAME the chart, on each tick').toBeGreaterThanOrEqual(5);
    expect(renders.AppShell ?? 0, 'FRAME never the frame').toBe(0);
    expect(renders.DailyModeView ?? 0, 'FRAME never the screen').toBe(0);
  });

  test('⭐ SAVED PRICE — live mode: the saved price moves on a 0.1% move, weighed on the slow snapshot, never on every tick', async ({ page }) => {
    // mutations: every tick saved (v1.0's rule) → red; a 0.1% move never saved → red
    await page.clock.install();                                       // at today's time: the live point follows the candles
    const feed = await open(page, { mode: 'live' });
    await expect.poll(() => saved(page), { message: 'SAVED PRICE the REST price' }).toBe(100_000);
    await expect.poll(() => feed.sockets.length).toBe(1);
    // The installed clock moves only when told: a second past the REST price, each tick shows at once; runFor lets the
    // headline's count finish (its frames ride the same clock).
    await page.clock.fastForward(1_100);
    feed.tick('100050.00');                                           // +0.05%
    await page.clock.runFor(600);
    await expect(chart(page).getByText('$100,050.00', { exact: true })).toBeVisible();
    expect(await saved(page), 'SAVED PRICE under 0.1%: unchanged').toBe(100_000);
    await page.clock.fastForward(1_100);
    feed.tick('100200.00');                                           // +0.2%, the slow snapshot not yet due
    await page.clock.runFor(600);
    await expect(chart(page).getByText('$100,200.00', { exact: true }), 'SAVED PRICE on screen at once').toBeVisible();
    expect(await saved(page), 'SAVED PRICE not on the tick').toBe(100_000);
    await page.clock.fastForward(9_000);
    feed.tick('100200.00');                                           // the next slow snapshot
    await expect.poll(() => saved(page), { message: 'SAVED PRICE a 0.1% move, at the snapshot' }).toBe(100_200);
  });

  test('⭐ CONSOLE CLOCK — the Emergency Console ages the saved price on its own clock: with no price coming, its stale banner comes (v1.1)', async ({ page }) => {
    // mutations: the console reading Date.now() as it draws, with no clock (v1.0) → red; its clock never ticking → red
    const t0 = new Date('2026-10-12T12:00:00');
    await page.clock.install({ time: t0 });
    await open(page, { spot: null, seed: seedConsole(t0.getTime()), landmark: '50.0% CB LTV' });
    const banner = page.getByText('⚠ Figures may be stale — verify before acting.', { exact: true });
    await expect(banner, 'CONSOLE CLOCK fresh at first').toHaveCount(0);
    await page.clock.fastForward('16:00');                            // no price for 16 minutes; nothing else moves
    await expect(banner, 'CONSOLE CLOCK stale, on its own').toBeVisible();
  });

  test('⭐ DAY — the open screen turns with the local day, though no price and no tap comes (v1.1)', async ({ page }) => {
    // mutation: the frame's day clock dropped (v1.0) → red: Daily still calls yesterday "Today"
    await page.clock.install({ time: new Date('2026-10-12T23:59:00') });
    await open(page, { mode: 'manual', spot: null });
    await expect(page.getByText("Today's log", { exact: true }), 'DAY today').toBeVisible();
    await page.clock.fastForward('02:00');                            // 00:01 the next day
    await expect(page.getByText("Today's log", { exact: true }), 'DAY yesterday is no longer today').toHaveCount(0);
  });

  test('⭐ POWER LAW — the face\'s price and the chart\'s live dot follow the feed', async ({ page }) => {
    // mutations: the tiles on the old cadence → red; no live dot → red
    const feed = await open(page);
    await page.getByLabel('Almanac').click();
    await openAlmanacFace(page, 'Power Law');
    await expect(page.getByText('$100,000', { exact: true }), 'POWER LAW the REST price').toBeVisible();
    await expect(page.getByTestId('powerlaw-live-dot'), 'POWER LAW the dot').toHaveCount(1);
    const before = await page.getByTestId('powerlaw-live-dot').getAttribute('cy');
    feed.tick('150000.00');
    await expect(page.getByText('$150,000', { exact: true }), 'POWER LAW a tick').toBeVisible();
    await expect.poll(() => page.getByTestId('powerlaw-live-dot').getAttribute('cy'), { message: 'POWER LAW the dot moves' })
      .not.toBe(before);
  });

  test('⭐ NO REAL FEED — with no feed routed, nothing reaches Coinbase and the REST price still comes', async ({ page }) => {
    // mutation: the host rule dropped from playwright.config.ts → red on a networked machine (a frame from the real feed)
    let frames = 0;
    page.on('websocket', (ws) => { if (/coinbase/.test(ws.url())) ws.on('framereceived', () => { frames++; }); });
    await open(page, { feed: false, spot: '95000.00' });
    await expect(chart(page).getByText('$95,000.00', { exact: true }), 'NO REAL FEED the REST price').toBeVisible();
    await page.waitForTimeout(3_000);
    expect(frames, 'NO REAL FEED no frame from Coinbase').toBe(0);
  });
});
