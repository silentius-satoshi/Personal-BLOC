import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { openAlmanacFace, STORE_VERSION } from './helpers';

/**
 * The Engine · Micro (BL61, step 1) — an Almanac face, the owner's only: his two loans as an engine, right now. Hermetic:
 * Playwright's clock fixed at 23 Nov 2026, the spot price aborted (a manual $100,000 is seeded), the last hour's candles
 * stubbed with a synthetic hour, the long price history aborted. Round synthetic figures: $50,000 on 1 ₿ at Coinbase
 * (10% APR, no as-of date, so nothing accrues), $10,000 on 0.5 ₿ at Strike. Every word asserted here was worked out first
 * from the face's own view on this seed (`engineView` — Playwright can't import src/): the liquidation price $50,000 ÷
 * (1 ₿ × 86%) = $58,140, a 41.8% buffer at $100,000; Coinbase's interest $50,000 × 10% ÷ 12 = $417 a month. Each assertion
 * carries its tag. A trusted viewer's hub has no Engine: `viewerAlmanac.spec.ts` (WAY IN, PARITY).
 */
const NOW = new Date('2026-11-23T12:00:00');
const SEED = `
  window.__APP_BOOTED = true;
  if (!sessionStorage.getItem('e2e-engine-seeded')) {
    sessionStorage.setItem('e2e-engine-seeded', '1');
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: { onboardingComplete: true, simpleMode: true, simpleView: 'daily', btcPriceMode: 'manual', btcPrice: 100000,
        hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1, cbAprPct: 10,
        strikeCollateralBtc: 0.5, advisorActualBlocBalance: 10000, creditLine: 25000 },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  }
`;
/** The last hour: sixty invented one-minute closes, a gentle wave about $99,500 (Coinbase's rows, newest first). */
function candles(): number[][] {
  const end = Math.floor(NOW.getTime() / 1000);
  return Array.from({ length: 60 }, (_, i) => {
    const p = 99_500 + Math.round(600 * Math.sin(i / 7)) + i * 12;
    return [end - (59 - i) * 60, p - 30, p + 30, p - 10, p, 1];
  }).reverse();
}

const HEADLINE = "Today: a 41.8% buffer to Coinbase's liquidation price ($58,140).";
const ARIA = "The Engine, right now. Bitcoin $100,000. Coinbase's liquidation price is $58,140, a 41.8% buffer. Coinbase's loan level 50.0%, Safe.";
const TRIED_NOTE = "A price you're trying: nothing is saved, and the plan doesn't change.";

async function start(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/\/api\/btc-candles/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(candles()) }));
  await page.route(/blockchain\.info|\/api\/btc-history/, (r) => r.abort());
  await page.addInitScript(SEED);
  await page.goto('/');
  await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Almanac').click();
}
const canvas = (page: Page) => page.locator('canvas[role="img"]');
const tryRow = (page: Page) => page.getByRole('group', { name: 'Try a price' });
const stored = (page: Page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('personal-bloc-store') ?? '{}').state ?? {};
  return { btcPrice: s.btcPrice, btcPriceMode: s.btcPriceMode, cbLoanBalance: s.cbLoanBalance, advisorActualBlocBalance: s.advisorActualBlocBalance };
});
/** The canvas as an image, to see whether it moved. */
const pixels = (page: Page) => canvas(page).evaluate((c: HTMLCanvasElement) => c.toDataURL());
/** The frames asked for in half a second — the frame loop's own pace (nothing else on the face asks for frames). */
const frames = (page: Page) => page.evaluate(() => new Promise<number>((res) => {
  let n = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => { n++; return raf(cb); };
  setTimeout(() => { window.requestAnimationFrame = raf; res(n); }, 500);
}));

test.describe('the Engine · Micro (BL61)', () => {
  test('⭐ OPENS — first in your plan; the face, its headline and the canvas, drawn, saying what it shows', async ({ page }) => {
    await start(page);
    const plan = page.getByRole('region', { name: 'Your plan' }).getByRole('button');
    await expect(plan.first(), 'OPENS first in your plan').toHaveText('Engine');
    await openAlmanacFace(page, 'Engine');
    await expect(page.getByText('Engine', { exact: true }), 'OPENS the title').toBeVisible();
    await expect(page.getByText(HEADLINE, { exact: true }), 'OPENS the headline').toBeVisible();
    await expect(canvas(page), 'OPENS the canvas says what it shows').toHaveAttribute('aria-label', new RegExp(`^${ARIA.replace(/[.$()]/g, '\\$&')}`));
    const inked = await canvas(page).evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n / (d.length / 4);
    });
    expect(inked, 'OPENS the canvas is drawn').toBeGreaterThan(0.2);
    await expect(page.getByText('Something crashed'), 'OPENS nothing crashed').toHaveCount(0);
  });

  test('⭐ TRIED — the buttons try a price: the figures follow it, it says nothing is saved, the store keeps today\'s; the way back', async ({ page }) => {
    await start(page);
    await openAlmanacFace(page, 'Engine');
    await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
    const before = await stored(page);
    await tryRow(page).getByRole('button', { name: '−10%' }).click();
    await tryRow(page).getByRole('button', { name: '−10%' }).click();
    await expect(tryRow(page), 'TRIED the price tried').toContainText('Test price $81,000');
    await expect(page.getByText("At this price: a 28.2% buffer to Coinbase's liquidation price ($58,140).", { exact: true }), 'TRIED the headline follows').toBeVisible();
    await expect(page.getByText(TRIED_NOTE, { exact: true }), 'TRIED nothing saved, said').toBeVisible();
    expect(await stored(page), 'TRIED nothing saved').toEqual(before);
    await page.reload();   // the tried price is the face's alone: gone with it
    await openAlmanacFace(page, 'Engine');
    await expect(page.getByText(HEADLINE, { exact: true }), 'TRIED gone on leaving').toBeVisible();
    await tryRow(page).getByRole('button', { name: '+10%' }).click();
    await tryRow(page).getByRole('button', { name: "Back to today's price" }).click();
    await expect(tryRow(page), 'TRIED the way back').toContainText('Price $100,000');
    await expect(page.getByText(TRIED_NOTE, { exact: true }), 'TRIED the note goes').toHaveCount(0);
  });

  test('⭐ DRAG — a drag on the piston tries a lower price; a tap on the piston opens its card; nothing is saved', async ({ page }) => {
    await start(page);
    await openAlmanacFace(page, 'Engine');
    await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
    const before = await stored(page);
    const handle = page.locator('[data-engine-piston]');
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 70, { steps: 7 });
    await page.mouse.up();
    const shown = await tryRow(page).textContent();
    expect(shown, 'DRAG a price tried').toMatch(/^.*Test price \$\d{2},\d{3}.*$/);
    expect(Number((shown ?? '').match(/Test price \$([\d,]+)/)![1].replace(/,/g, '')), 'DRAG lower').toBeLessThan(100_000);
    expect(await stored(page), 'DRAG nothing saved').toEqual(before);
    await tryRow(page).getByRole('button', { name: "Back to today's price" }).click();
    const b2 = (await handle.boundingBox())!;
    // a finger's tap wobbles a pixel or two: still a tap, not a drag
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2 + 2);
    await page.mouse.up();
    await expect(page.getByRole('region', { name: 'Bitcoin $100,000' }), 'DRAG a tap opens the price\'s card').toBeVisible();
    await expect(tryRow(page), 'DRAG a tap tries nothing').toContainText('Price $100,000');
  });

  test('⭐ PARTS — a tap on the picture or a part\'s button opens its card, in the face\'s words', async ({ page }) => {
    await start(page);
    await openAlmanacFace(page, 'Engine');
    await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + 54, box.y + 49);   // the gauge, where the scene draws it
    await expect(page.getByRole('region', { name: 'Loan level 50.0%' }), 'PARTS the gauge\'s card').toBeVisible();
    await page.mouse.click(box.x + 54, box.y + 49);   // as in the prototype, a second tap on an open part closes its card
    await expect(page.getByRole('region', { name: 'Loan level 50.0%' }), 'PARTS a second tap on the picture closes it').toHaveCount(0);
    await page.getByRole('group', { name: "The engine's parts" }).getByRole('button', { name: 'This month' }).click();
    const month = page.getByRole('region', { name: 'This month' });
    await expect(month, 'PARTS the month').toContainText("In: Coinbase's interest $417 (at today's balance), Strike's interest");
    await expect(month, 'PARTS moves between the loans left out').toContainText('moves between the two loans are left out');
    await page.getByRole('group', { name: "The engine's parts" }).getByRole('button', { name: 'This month' }).click();
    await expect(month, 'PARTS a second tap closes it').toHaveCount(0);
  });

  test('⭐ MOTION — the picture moves while it can; under reduced motion it is one still frame', async ({ page }) => {
    await start(page);
    await openAlmanacFace(page, 'Engine');
    await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    const a = await pixels(page);
    await page.waitForTimeout(500);
    expect(await pixels(page), 'MOTION it moves').not.toBe(a);
    expect(await frames(page), 'MOTION the loop runs').toBeGreaterThan(10);
    // off screen, no loop at all; back on screen, it runs again (v1.4). Mutation: the loop runs off screen → red
    await canvas(page).evaluate((c: HTMLCanvasElement) => { c.style.transform = 'translateY(-4000px)'; });
    await expect.poll(() => frames(page), { message: 'MOTION no loop off screen' }).toBeLessThan(3);
    await canvas(page).evaluate((c: HTMLCanvasElement) => { c.style.transform = ''; });
    await expect.poll(() => frames(page), { message: 'MOTION the loop again on screen' }).toBeGreaterThan(10);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(600);
    const c = await pixels(page);
    await page.waitForTimeout(700);
    expect(await pixels(page), 'MOTION still under reduced motion').toBe(c);
    expect(await frames(page), 'MOTION no loop under reduced motion').toBeLessThan(3);
  });

  test('⭐ LIVE FEED — open, the Engine asks the feed for each second and rides it; closed, the feed goes back to its 5 s (BL64)', async ({ page }) => {
    // mutations: the Engine on the 5 s feed (no per-second hold) → red; the picture on the saved price while live → red
    // The clock runs here: the feed lets one price a second through, which a fixed clock would hold for good.
    const sent: string[] = [];
    let feed: WebSocketRoute | null = null;
    await page.routeWebSocket(/ws-feed\.exchange\.coinbase\.com/, (ws) => { feed = ws; ws.onMessage((m) => { sent.push(String(m)); }); });
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: '100000.00' } }) }));
    await page.route(/\/api\/btc-candles/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(candles()) }));
    await page.route(/blockchain\.info|\/api\/btc-history/, (r) => r.abort());
    await page.addInitScript(SEED.replace("btcPriceMode: 'manual'", "btcPriceMode: 'live'"));
    await page.goto('/');
    await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
    const sub = (type: string, ch: string) => JSON.stringify({ type, product_ids: ['BTC-USD'], channels: [ch] });
    await expect.poll(() => sent, { message: 'LIVE FEED the app: 5 s' }).toEqual([sub('subscribe', 'ticker_batch')]);
    await page.getByLabel('Almanac').click();
    await openAlmanacFace(page, 'Engine');
    await expect.poll(() => sent.slice(1), { message: 'LIVE FEED the Engine: each second' })
      .toEqual([sub('unsubscribe', 'ticker_batch'), sub('subscribe', 'ticker')]);
    await expect(page.getByText(HEADLINE, { exact: true }), 'LIVE FEED at the saved price first').toBeVisible();
    // A move under 0.1% leaves the saved price where it is: the picture rides the live price alone.
    await page.waitForTimeout(1_100);
    feed!.send(JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: '100050.00' }));
    await expect(canvas(page), 'LIVE FEED the picture rides the live price').toHaveAttribute('aria-label', /^The Engine, right now\. Bitcoin \$100,050\./);
    expect((await stored(page)).btcPrice, 'LIVE FEED the saved price stays').toBe(100_000);
    await page.waitForTimeout(1_100);
    feed!.send(JSON.stringify({ type: 'ticker', product_id: 'BTC-USD', price: '90000.00' }));
    await expect(page.getByText("Today: a 35.4% buffer to Coinbase's liquidation price ($58,140).", { exact: true }),
      'LIVE FEED the headline rides it').toBeVisible();
    await page.getByRole('button', { name: 'Almanac', exact: true }).click();
    await expect.poll(() => sent.slice(3), { message: 'LIVE FEED closed: back to 5 s' })
      .toEqual([sub('unsubscribe', 'ticker'), sub('subscribe', 'ticker_batch')]);
  });
});
