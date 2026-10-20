import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION, APP_FONT_FILES, seedAndGoto } from './helpers';

// 5e — start-up and offline (spec `pbloc-spec-batch-1-v1` §2.1, batch 1 build 1). In a real browser: the font is the
// app's own (E1), the price chart draws this device's copy of its history at once — labeled once it is more than
// 5 minutes old — and the live history replaces it (F12), and the start-up diagnostic removes itself once the app has
// started (F2). F1's loading screen is an auth-ladder branch the dev server bypasses, like gates A–F: its tests are unit
// tests (firstPull.test.ts, firstPullFresh.test.ts) and the preview's device look. Every assertion is tagged. Round
// synthetic prices.

const FIXED = new Date('2026-10-12T12:00:00').getTime();   // local midday: an "as of" five minutes back is still today
const G_1D_S = 900;                                          // 1D's candles are 15 minutes

/** Coinbase's rows, newest first, [time s, low, high, open, close, volume]: four 15-minute candles closing at `last`. */
const rows = (newestStartMs: number, last: number): number[][] =>
  [0, 1, 2, 3].map((i) => {
    const t = Math.floor(newestStartMs / 1000) - i * G_1D_S;
    const close = i === 0 ? last : last - 500 + i * 10;
    return [t, close - 50, close + 50, close, close, 1];
  });

/** This device's copy of the 1D history, landed at `at`, its newest candle still open then — so it is dated `at`. */
const cacheSeed = (at: number, last: number): string => {
  const candles = rows(at - 60_000, last).reverse().map(([t, , , , close]) => ({ t: t * 1000, price: close }));
  return `localStorage.setItem('bloc-btc-candles', ${JSON.stringify(JSON.stringify({ v: 1, ranges: { '1D': { at, candles } } }))});`;
};

/** Hold the live candles until the test releases them, then answer with a fresh history closing at `last`. */
async function holdCandles(page: Page, last: number): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(/\/api\/btc-candles/, async (route) => {
    await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows(FIXED - 5 * 60_000, last)) });
  });
  return release;
}

test.describe('5e — start-up and offline', () => {
  test('⭐ E1 FONTS — the app loads its own font files, the ₿ face among them, and asks Google for nothing', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await seedAndGoto(page);
    await page.evaluate(() => document.fonts.ready);
    expect(urls.some((u) => APP_FONT_FILES.test(u)), 'E1 FONTS its own files').toBe(true);
    expect(urls.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u)), 'E1 FONTS nothing from Google').toEqual([]);
    expect(await page.evaluate(() => document.fonts.check('400 14px "IBM Plex Mono"')), 'E1 FONTS the regular face').toBe(true);
    const faces = await page.evaluate(async () => (await document.fonts.load('700 15px "IBM Plex Mono"', '₿')).length);
    expect(faces, 'E1 FONTS a face for ₿').toBeGreaterThan(0);
    expect(urls.some((u) => /ibm-plex-mono-latin-ext-700-normal[^/]*\.woff2/.test(u)), 'E1 FONTS ₿ from the app\'s own extended-Latin file').toBe(true);
  });

  test('⭐ F12 AT ONCE — a minute-old copy is drawn at once, unlabeled; the live history replaces it, to the cent on Daily', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED));
    await page.addInitScript(cacheSeed(FIXED - 60_000, 98_765.43));
    const release = await holdCandles(page, 99_000);
    await seedAndGoto(page);
    await expect(page.getByText('$98,765.43', { exact: true }), 'AT ONCE the device\'s copy, before any answer').toBeVisible();
    await expect(page.getByText('loading…', { exact: true }), 'AT ONCE never "loading…"').toHaveCount(0);
    await expect(page.getByText(/^as of /), 'AT ONCE a minute old: no label').toHaveCount(0);
    release();
    await expect(page.getByText('$99,000.00', { exact: true }), 'AT ONCE the live history, counted to').toBeVisible();
    await expect(page.getByText('$98,765.43', { exact: true }), 'AT ONCE the copy replaced').toHaveCount(0);
  });

  test('⭐ F12 OLD — a copy 5 minutes and 1 second old is drawn at once with its time; the live history replaces it, the label gone', async ({ page }) => {
    await page.clock.setFixedTime(new Date(FIXED));
    await page.addInitScript(cacheSeed(FIXED - 5 * 60_000 - 1_000, 98_765.43));
    const release = await holdCandles(page, 99_000);
    await seedAndGoto(page);
    await expect(page.getByText('$98,765.43', { exact: true }), 'OLD drawn at once').toBeVisible();
    await expect(page.getByText(/^as of \d{1,2}:\d{2}\s[AP]M$/), 'OLD labeled with its time').toBeVisible();
    await expect(page.locator('[data-old="true"]'), 'OLD drawn muted').toHaveCount(1);
    await expect(page.getByText('loading…', { exact: true }), 'OLD never "loading…"').toHaveCount(0);
    release();
    await expect(page.getByText('$99,000.00', { exact: true }), 'OLD the live history').toBeVisible();
    await expect(page.getByText(/^as of /), 'OLD the label gone').toHaveCount(0);
    await expect(page.locator('[data-old="true"]'), 'OLD no longer muted').toHaveCount(0);
  });

  test('⭐ F2 GONE — a watchdog panel removes itself the moment the app starts', async ({ page }) => {
    test.setTimeout(60_000);
    // No pre-set flag here (every other spec sets one): main.tsx sets it.
    await page.addInitScript(`
      localStorage.setItem('personal-bloc-store', JSON.stringify({
        state: { onboardingComplete: true, simpleMode: true, simpleView: 'daily' }, version: ${STORE_VERSION}
      }));
      localStorage.setItem('personal-bloc-onboarded', '1');`);
    await page.goto('/');
    await expect(page.getByLabel('Log an event'), 'GONE PREMISE: the app started').toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as { __APP_BOOTED?: boolean }).__APP_BOOTED), 'GONE PREMISE: main.tsx set the flag').toBe(true);
    // As if the start were slow: the watchdog sees no flag at 15 s and paints …
    await page.evaluate(() => { delete (window as unknown as { __APP_BOOTED?: boolean }).__APP_BOOTED; });
    const panel = page.locator('#sw-diag-panel');
    await expect(panel, 'GONE PREMISE: painted at 15 s').toBeVisible({ timeout: 20_000 });
    // … then the app starts, and the panel goes.
    await page.evaluate(() => { (window as unknown as { __APP_BOOTED?: boolean }).__APP_BOOTED = true; });
    await expect(panel, 'GONE removed').toHaveCount(0, { timeout: 2_000 });
  });

  test('⭐ F2 SWDEBUG — ?swdebug paints at once and stays over a started app: it was asked for', async ({ page }) => {
    await page.addInitScript(`
      window.__APP_BOOTED = true;
      localStorage.setItem('personal-bloc-store', JSON.stringify({
        state: { onboardingComplete: true, simpleMode: true, simpleView: 'daily' }, version: ${STORE_VERSION}
      }));
      localStorage.setItem('personal-bloc-onboarded', '1');`);
    await page.goto('/?swdebug');
    const panel = page.locator('#sw-diag-panel');
    await expect(panel, 'SWDEBUG painted').toBeVisible();
    await expect(panel, 'SWDEBUG the diagnostic').toContainText('SW DIAG');
    await expect(page.getByLabel('Log an event'), 'SWDEBUG the app started beneath it').toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await expect(panel, 'SWDEBUG stays').toBeVisible();
  });
});
