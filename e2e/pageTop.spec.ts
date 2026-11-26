import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION, openSettingsSimple, mouseDragX } from './helpers';

/**
 * Sweep 3 (3.4) — a page opens at its top. The app scrolls <body>, and a page change kept the last page's offset: full
 * mode's "Switch to simple view" opened the Dashboard part-way down. AppShell now resets once, keyed on the page drawn
 * (pageTop.test.ts pins the wiring); here, the offset itself, at 390 and 1280 px, the edge swipe included. The way to the
 * other page is fired without scrolling (`dispatchEvent`), so the test never scrolls the page back up itself.
 */
const offset = (page: Page): Promise<number> =>
  page.evaluate(() => Math.max(document.body.scrollTop, document.documentElement.scrollTop));
const scrollDown = (page: Page, y: number): Promise<void> =>
  page.evaluate((px) => { document.body.scrollTop = px; document.documentElement.scrollTop = px; }, y);

const FULL_MODE = `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, simpleMode: false, simpleView: 'dashboard', btcPriceMode: 'manual', btcPrice: 100000 },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

for (const width of [390, 1280]) {
  test.describe(`⭐ PAGE TOP at ${width} px`, () => {
    test.use({ viewport: { width, height: 600 }, isMobile: width < 1000 });

    test(`⭐ PAGE TOP ${width} — full mode's "Switch to simple view" opens the Dashboard at its top`, async ({ page }) => {
      await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
      await page.addInitScript(FULL_MODE);
      await page.goto('/');
      const toSimple = page.getByLabel('Switch to simple view');
      await expect(toSimple, 'PAGE TOP full mode').toBeVisible({ timeout: 15_000 });
      await scrollDown(page, 600);
      expect(await offset(page), 'PAGE TOP premise: the full-mode page is scrolled down').toBeGreaterThan(100);
      await toSimple.dispatchEvent('click');
      await expect(page.getByRole('button', { name: 'Dashboard', exact: true }), 'PAGE TOP the Dashboard')
        .toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
      await expect.poll(() => offset(page), 'PAGE TOP the Dashboard at its top').toBe(0);
    });

    test(`⭐ PAGE TOP ${width} — an edge swipe out of a scrolled Settings opens the journal at its top`, async ({ page }) => {
      await openSettingsSimple(page);
      await scrollDown(page, 400);
      expect(await offset(page), 'PAGE TOP premise: Settings is scrolled down').toBeGreaterThan(50);
      const { width: w, height } = page.viewportSize()!;
      await mouseDragX(page, 8, height / 2, Math.round(w * 0.6));
      await expect(page.getByLabel('Log an event'), 'PAGE TOP the journal').toBeVisible();
      await expect(page.getByTestId('edge-back-zone'), 'PAGE TOP Settings left').toHaveCount(0);
      await expect.poll(() => offset(page), 'PAGE TOP the journal at its top').toBe(0);
    });
  });
}
