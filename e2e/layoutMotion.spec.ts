import { test, expect, type Page } from '@playwright/test';
import { seedAndGoto, openAlmanacFace, STORE_VERSION } from './helpers';

/**
 * Sweep 2c (BL52) — layout and motion, on the screen.
 *   ⭐ M1 SNAP — with Reduce Motion on, only opacity cross-fades: a toggle's knob is home within two frames, where
 *     without it the knob glides (the control: two frames in, it's still on its way).
 *   ⭐ L3 STILL — the Decision chart holds still when the price history lands, at 390, 375, 515 and 600 px (the Power
 *     Law face's STEADY, for Decision). THE MOVE card's breaker line, above the chart, took one line more while the
 *     history loaded than once it landed at 300–379 and 518–703 px (the chart moved up 18 px); a loading line one
 *     character shorter than the plain reading took one line fewer at 511–517 px (down 18 px). The loading line is now
 *     as long as the plain reading and ends alike (decisionView's BREAKER_LOADING_LINE), so it wraps alike.
 *   ⭐ L4 GUTTER — full mode on a phone: the face's own 16 px gutter, alone (not .main's 20 px on top), and the
 *     dock still edge to edge.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const MOVE_TITLE = "The support policy's move this month";

async function knobProbe(page: Page) {
  const thumb = page.locator('label:has(> input[type="checkbox"]:not([disabled])) [class*="thumb"]').first();
  await thumb.scrollIntoViewIfNeeded();
  return thumb.evaluate(async (el) => {
    const label = el.closest('label') as HTMLLabelElement;
    const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const before = getComputedStyle(el).transform;
    label.click();
    await frames();
    const mid = getComputedStyle(el).transform;
    await new Promise((r) => setTimeout(r, 400));
    const end = getComputedStyle(el).transform;
    label.click();                                                       // put it back
    await new Promise((r) => setTimeout(r, 400));
    return { before, mid, end };
  });
}

test.describe('Sweep 2c — layout and motion', () => {
  test('⭐ M1 SNAP — Reduce Motion: a toggle\'s knob is home within two frames; without it, it glides', async ({ page }) => {
    await seedAndGoto(page);
    await page.getByLabel('Settings').click();
    const glide = await knobProbe(page);
    expect(glide.end, 'M1 GLIDE: the knob moves').not.toBe(glide.before);
    expect(glide.mid, 'M1 GLIDE: two frames in, still on its way').not.toBe(glide.end);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const snap = await knobProbe(page);
    expect(snap.end, 'M1 SNAP: the knob moves').not.toBe(snap.before);
    expect(snap.mid, 'M1 SNAP: home within two frames').toBe(snap.end);
  });

  test('⭐ L3 STILL — the Decision chart holds still while the history loads, at 390, 375, 515 and 600 px', async ({ page }) => {
    test.setTimeout(60_000);
    for (const width of [390, 375, 515, 600]) {
      await page.setViewportSize({ width, height: 844 });
      let release!: () => void;
      const held = new Promise<void>((res) => { release = res; });
      await page.route(/api\.coinbase\.com\/v2\/prices|mempool\.space|blockstream\.info|blockchain\.info\/q\/|blockchair\.com/, (r) => r.abort());
      await page.route(/blockchain\.info\/charts/, async (r) => { await held; await r.fulfill({ contentType: 'application/json', body: HISTORY }); });
      await seedAndGoto(page);
      await page.getByLabel('Almanac').click();
      await openAlmanacFace(page, 'Decision');
      await expect(page.getByRole('region', { name: MOVE_TITLE })).toBeVisible({ timeout: 8000 });
      await page.evaluate(() => document.fonts.ready);
      const area = page.getByTestId('decision-chart-box').or(page.locator('[class*="chartEmpty"]')).first();
      await expect(area).toBeVisible();
      const top = () => area.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const before = await top();
      release();
      await expect(page.getByText('History', { exact: true }).first(), `L3 LANDED ${width}`).toBeVisible({ timeout: 8000 });
      expect(await top(), `L3 STILL ${width}`).toBe(before);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  test('⭐ L4 GUTTER — full mode on a phone: the face\'s 16 px gutter alone, the dock edge to edge', async ({ browser, baseURL }) => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true });
    try {
      const page = await ctx.newPage();
      await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
      await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
      await page.addInitScript(`
        window.__APP_BOOTED = true;
        localStorage.setItem('personal-bloc-store', JSON.stringify({
          state: { onboardingComplete: true, simpleMode: false, simpleView: 'daily', btcPriceMode: 'manual', btcPrice: 100000 },
          version: ${STORE_VERSION}
        }));
        localStorage.setItem('personal-bloc-onboarded', '1');
      `);
      await page.goto('/');
      const tools = page.getByRole('button', { name: /^Tools/ });
      await expect(tools, 'L4 LANDING').toBeVisible({ timeout: 15_000 });
      await tools.click();
      await page.getByRole('button', { name: 'Almanac', exact: true }).click();
      await openAlmanacFace(page, 'Decision');
      const move = page.getByRole('region', { name: MOVE_TITLE });
      await expect(move).toBeVisible({ timeout: 8000 });
      expect(Math.round((await move.boundingBox())!.x), 'L4 GUTTER: the face\'s content 16 px from the left').toBe(16);
      const dock = page.getByRole('region', { name: 'Controls' });
      const d = (await dock.boundingBox())!;
      expect([Math.round(d.x), Math.round(d.x + d.width)], 'L4 DOCK: edge to edge').toEqual([0, 390]);
    } finally {
      await ctx.close();
    }
  });
});
