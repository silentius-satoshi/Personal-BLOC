import { test, expect, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { openAlmanacFace, STORE_VERSION } from './helpers';

/**
 * The Engine · Micro (BL61, step 1) — an Almanac face, the owner's only: his two loans as an engine, right now. Hermetic:
 * Playwright's clock fixed at 23 Nov 2026, the spot price aborted (a manual $100,000 is seeded), the last hour's candles
 * stubbed with a synthetic hour, the long price history aborted. Round synthetic figures: $50,000 on 1 ₿ at Coinbase
 * (10% APR, no as-of date, so nothing accrues), $10,000 on 0.5 ₿ at Strike. Every word asserted here was worked out first
 * from the face's own view on this seed (`engineView` — Playwright can't import src/): the liquidation price $50,000 ÷
 * (1 ₿ × 86%) = $58,140, a 41.8% buffer at $100,000; Coinbase's interest $50,000 × 10% ÷ 12 = $417 a month. Each assertion
 * carries its tag. A trusted viewer's hub has no Engine: `viewerAlmanac.spec.ts` (WAY IN, PARITY).
 *
 * The hand (the owner's look, 2026-11-25): a part's card pops up on the screen as the prototypes' does — a sheet on a
 * phone, the part kept in view above it; beside the part on a computer — and the tape reads out as the Dashboard's chart,
 * to a finger and a mouse (POP PHONE, POP COMPUTER, READ). A finger's stroke is a real touch (CDP, as
 * `numberFieldSwipe.spec.ts`), so the page takes an up-and-down one as a phone does. The parts' places are the scene's
 * at the 372 px canvas this phone draws (`engineScene` on this seed — the e2e can't import src/).
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
    await expect(page.getByRole('dialog', { name: 'Bitcoin $100,000' }), 'DRAG a tap opens the price\'s card').toBeInViewport({ ratio: 1 });
    await expect(tryRow(page), 'DRAG a tap tries nothing').toContainText('Price $100,000');
  });

  test('⭐ PARTS — a tap on the picture or a part\'s button opens its card, in the face\'s words', async ({ page }) => {
    await start(page);
    await openAlmanacFace(page, 'Engine');
    await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.click(box.x + 54, box.y + 49);   // the gauge, where the scene draws it
    await expect(page.getByRole('dialog', { name: 'Loan level 50.0%' }), 'PARTS the gauge\'s card').toBeInViewport({ ratio: 1 });
    await page.mouse.click(box.x + 54, box.y + 49);   // as in the prototype, a second tap on an open part closes its card
    await expect(page.getByRole('dialog', { name: 'Loan level 50.0%' }), 'PARTS a second tap on the picture closes it').toHaveCount(0);
    await page.getByRole('group', { name: "The engine's parts" }).getByRole('button', { name: 'This month' }).click();
    const month = page.getByRole('dialog', { name: 'This month' });
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

  test('⭐ POP PHONE — a tap on any part pops its card up from the screen\'s bottom, the part kept in view above it; ✕, Escape, a tap elsewhere or on the part again close it; another part swaps it', async ({ page }) => {
    // mutations: the card back under the parts' buttons → red (off the screen); the sheet not sticky → red; no scroll to
    // keep the part above it → red (the pipes); Escape, a tap elsewhere or the ✕ doing nothing → red
    await start(page);
    await openAlmanacFace(page, 'Engine', { tap: true });
    await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
    const parts: [name: string, x: number, y: number, title: string | RegExp][] = [
      ['the gauge', 54, 49, 'Loan level 50.0%'], ['the flywheel', 224, 58, /~\d+%$/], ['the motor', 308, 58, 'Live price'],
      ['the tape', 83, 248, 'Live price'], ['Coinbase\'s tube', 221, 244, 'Coinbase'], ['Strike\'s tube', 274, 244, 'Strike'],
      ['the red line', 219, 312, 'Liquidation $58,140'], ['the price', 333, 141, 'Bitcoin $100,000'],
      ['the liquidation price', 333, 328, 'Liquidation $58,140'], ['the piston', 240, 146, 'Bitcoin $100,000'],
      ['the pipes', 186, 483, 'This month'],
    ];
    for (const [name, x, y, title] of parts) {
      await toTop(page);
      const c0 = (await canvas(page).boundingBox())!;
      await page.touchscreen.tap(c0.x + x, c0.y + y);
      const card = page.getByRole('dialog', { name: title });
      await expect(card, `POP PHONE ${name}: its card, all of it on the screen`).toBeInViewport({ ratio: 1 });
      const sheet = await rect(card);
      expect([sheet.left, sheet.right, page.viewportSize()!.height - sheet.bottom], `POP PHONE ${name}: a sheet, 8 px from the screen's edges`)
        .toEqual([8, 382, 8]);
      // the part stays in view, above it (the page moves just enough, smoothly)
      await expect.poll(async () => (await canvas(page).boundingBox())!.y + y + 10 <= (await rect(card)).top,
        { message: `POP PHONE ${name}: the part above the sheet` }).toBe(true);
      expect((await canvas(page).boundingBox())!.y + y, `POP PHONE ${name}: the part still on the screen`).toBeGreaterThan(0);
      await page.waitForTimeout(400);   // past the moment a press is taken for one aimed at what was there before
      await card.getByRole('button', { name: 'Close' }).tap();
      await expect(page.getByRole('dialog'), `POP PHONE ${name}: the ✕ closes it`).toHaveCount(0);
    }
    // the other ways out, and a swap
    await toTop(page);
    const c = (await canvas(page).boundingBox())!;
    const gauge = page.getByRole('dialog', { name: 'Loan level 50.0%' });
    await page.touchscreen.tap(c.x + 54, c.y + 49);
    await expect(gauge).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(gauge, 'POP PHONE Escape closes it').toHaveCount(0);
    await page.touchscreen.tap(c.x + 54, c.y + 49);
    await expect(gauge).toBeVisible();
    await page.getByText(HEADLINE, { exact: true }).tap();
    await expect(gauge, 'POP PHONE a tap elsewhere closes it').toHaveCount(0);
    await page.touchscreen.tap(c.x + 54, c.y + 49);
    await expect(gauge).toBeVisible();
    await page.touchscreen.tap(c.x + 130, c.y + 100);   // no part there (and above any sheet)
    await expect(gauge, 'POP PHONE a tap on no part closes it').toHaveCount(0);
    await page.touchscreen.tap(c.x + 54, c.y + 49);
    await page.touchscreen.tap(c.x + 274, c.y + 244);
    await expect(page.getByRole('dialog', { name: 'Strike' }), 'POP PHONE another part swaps it').toBeVisible();
    await expect(page.getByRole('dialog'), 'POP PHONE one card at a time').toHaveCount(1);
    await page.touchscreen.tap(c.x + 274, c.y + 244);
    await expect(page.getByRole('dialog'), 'POP PHONE the part again closes it').toHaveCount(0);
  });

  test('⭐ POP COMPUTER — on a computer a part\'s card opens beside the part, on the screen, never over it; a part\'s button opens it beside the button; Escape closes it', async ({ browser, baseURL }) => {
    // mutations: the card where it was (under the buttons) → red (off the screen); placed over the part → red
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    try {
      await start(page);
      await openAlmanacFace(page, 'Engine');
      await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
      const c = (await canvas(page).boundingBox())!;
      expect(c.width, 'POP COMPUTER premise: the canvas at its widest').toBe(700);
      for (const [name, x, y, w, h, title] of [
        ['the gauge', 14, 9, 80, 80, 'Loan level 50.0%'], ['the price', 630, 126, 62, 30, 'Bitcoin $100,000'],
        ['Coinbase\'s tube', 487, 110, 83, 268, 'Coinbase'], ['the pipes', 0, 456, 700, 54, 'This month'],
      ] as const) {
        await page.mouse.click(c.x + x + w / 2, c.y + y + h / 2);
        const card = page.getByRole('dialog', { name: title });
        await expect(card, `POP COMPUTER ${name}: its card, all of it on the screen`).toBeInViewport({ ratio: 1 });
        const r = await rect(card);
        expect(r.width, `POP COMPUTER ${name}: a card, not a sheet`).toBe(330);
        const part = { left: c.x + x, top: c.y + y, right: c.x + x + w, bottom: c.y + y + h };
        const covers = r.left < part.right && r.right > part.left && r.top < part.bottom && r.bottom > part.top;
        const wide = w >= 330;   // a part wider than any card: the card is centred over it, as the prototypes do
        expect(covers && !wide, `POP COMPUTER ${name}: beside the part, never over it`).toBe(false);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog'), `POP COMPUTER ${name}: Escape closes it`).toHaveCount(0);
      }
      const btn = page.getByRole('group', { name: "The engine's parts" }).getByRole('button', { name: 'Strike' });
      await btn.click();
      const card = page.getByRole('dialog', { name: 'Strike' });
      await expect(card, 'POP COMPUTER from a button: on the screen').toBeInViewport({ ratio: 1 });
      const b = (await btn.boundingBox())!;
      const r = await rect(card);
      expect(r.bottom <= b.y - 9 || r.top >= b.y + b.height + 9, 'POP COMPUTER from a button: above it or under it').toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('⭐ READ — the tape reads out as the Dashboard\'s chart: a finger sliding along it, kept where it lets go until the next touch; an up-and-down stroke still scrolls; a tap still opens its card; a mouse\'s goes with it; the edge swipe still leaves', async ({ page }) => {
    // mutations: a finger reads nothing → red; its readout gone on letting go → red; a mouse's kept off the tape → red
    await page.emulateMedia({ reducedMotion: 'reduce' });   // one still frame a scene: what changes is the readout alone
    await start(page);
    await openAlmanacFace(page, 'Engine', { tap: true });
    await expect(page.getByText(HEADLINE, { exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    const plain = await pixels(page);
    const c = (await canvas(page).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent',
      { type, touchPoints: x === undefined ? [] : [{ x: c.x + x, y: c.y + y! }] });
    await touch('touchStart', 30, 250);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', 30 + i * 10, 250 + (i % 2)); await page.waitForTimeout(16); }
    await expect.poll(() => pixels(page), { message: 'READ a finger sliding along the tape reads it' }).not.toBe(plain);
    await touch('touchEnd');
    await page.waitForTimeout(300);
    const kept = await pixels(page);
    expect(kept, 'READ it stays where the finger let go').not.toBe(plain);
    await expect(page.getByRole('dialog'), 'READ a readout opens no card').toHaveCount(0);
    await page.touchscreen.tap(c.x + 130, c.y + 100);   // no part there (and above any sheet)
    await expect.poll(() => pixels(page), { message: 'READ the next touch takes it away' }).toBe(plain);
    // an up-and-down stroke from the tape scrolls the page and reads nothing
    await toTop(page);
    await touch('touchStart', 83, 330);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', 83 + (i % 2), 330 - i * 18); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await expect.poll(() => scrolled(page), { message: 'READ an up-and-down stroke scrolls the page' }).toBeGreaterThan(40);
    expect(await pixels(page), 'READ …and reads nothing').toBe(plain);
    await toTop(page);
    const c2 = (await canvas(page).boundingBox())!;
    await page.touchscreen.tap(c2.x + 83, c2.y + 248);
    await expect(page.getByRole('dialog', { name: 'Live price' }), 'READ a tap on the tape still opens its card').toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('dialog', { name: 'Live price' }), 'READ its card says how to read it')
      .toContainText('Slide a finger along the tape, or point at it, to read its price at any moment.');
    await page.keyboard.press('Escape');
    // a mouse: over the tape it reads; off it, gone
    await page.mouse.move(c2.x + 100, c2.y + 250);
    await expect.poll(() => pixels(page), { message: 'READ a mouse over the tape reads it' }).not.toBe(plain);
    await page.mouse.move(c2.x + 130, c2.y + 100);   // still on the picture, off the tape (no part there: no ring)
    await expect.poll(() => pixels(page), { message: 'READ off the tape, gone' }).toBe(plain);
    await page.mouse.move(c2.x + 100, c2.y + 250);
    await expect.poll(() => pixels(page), { message: 'READ back over it' }).not.toBe(plain);
    await page.mouse.move(c2.x + 186, c2.y - 40);
    await expect.poll(() => pixels(page), { message: 'READ off the picture, gone' }).toBe(plain);
    // the Almanac's swipe from the screen's edge, across the tape, still leaves the face (BL65's kill criterion)
    const y = c2.y + 250;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 8, y }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 8 + (260 * i) / 12, y }] });
      await page.waitForTimeout(8);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'READ the edge swipe still leaves the face').toBeVisible();
  });
});

/** The face's page at its top — the app scrolls <body>, a browser may scroll the document (utils/pageTop). */
async function toTop(page: Page): Promise<void> {
  await page.evaluate(() => { document.body.scrollTop = 0; document.documentElement.scrollTop = 0; });
  await page.waitForTimeout(150);
}
/** How far the page is scrolled, whichever box scrolls it. */
const scrolled = (page: Page): Promise<number> => page.evaluate(() => document.body.scrollTop + document.documentElement.scrollTop);
/** A box on the screen. */
const rect = (l: Locator): Promise<{ left: number; top: number; right: number; bottom: number; width: number }> =>
  l.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }; });
