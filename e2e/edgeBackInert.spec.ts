import { test, expect } from '@playwright/test';
import { openSettingsSimple, mouseDragX, headerBack } from './helpers';

/**
 * Sweep 3 (3.3) — EdgeBackGesture's under-layer is INERT while a swipe shows it. It was aria-hidden only, and its dim
 * takes no pointer, so a second finger on the revealed journal's nav opened the Almanac (or Settings) mid-swipe.
 * And the page still takes taps once the swipe ends — cancelled (Settings stays) or committed (the journal is the page).
 * The project has touch on (playwright.config: hasTouch), so the second finger is a real touch tap while the mouse holds.
 */
test.describe('⭐ EDGE INERT — the swipe\'s under-layer takes no tap', () => {
  test('⭐ EDGE INERT — a second finger on the revealed nav opens nothing; after a cancelled swipe and after a committed one, a tap on the page lands', async ({ page }) => {
    await openSettingsSimple(page);
    const { width, height } = page.viewportSize()!;
    const h = height / 2;
    const held = Math.round(width * 0.9);

    // Hold a swipe most of the way across: the journal underneath shows almost whole.
    await mouseDragX(page, 8, h, held - 8, { release: false });
    const under = page.locator('div[aria-hidden="true"]:has(button[aria-label="Almanac"])').first();
    const nav = under.locator('button[aria-label="Almanac"]');
    const box = (await nav.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    expect(x, 'EDGE INERT premise: the nav button is out from under the page').toBeLessThan(held - 4);
    await page.touchscreen.tap(x, y);                      // the second finger, on the revealed "Almanac"
    await page.waitForTimeout(300);

    // Let go where it cancels: back under the commit line, slowly, then release — the page springs back.
    for (let px = held; px >= 20; px -= Math.round(width / 12)) {
      await page.mouse.move(px, h);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'EDGE INERT the tap opened nothing').toHaveCount(0);
    await expect(page.getByTestId('edge-back-zone'), 'EDGE INERT still on Settings').toBeVisible();

    // After the cancelled swipe, a tap on the page lands: its own "←" leaves Settings.
    await headerBack(page).tap();
    await expect(page.getByLabel('Log an event'), 'EDGE INERT a tap after a cancel lands').toBeVisible();
    await expect(page.getByTestId('edge-back-zone')).toHaveCount(0);

    // After a committed swipe, a tap on the page it revealed lands: the journal's own Settings opens.
    await page.getByLabel('Settings').tap();
    await expect(page.getByTestId('edge-back-zone')).toBeVisible();
    await mouseDragX(page, 8, h, Math.round(width * 0.6));
    await expect(page.getByLabel('Log an event'), 'EDGE INERT the swipe committed').toBeVisible();
    await expect(page.getByTestId('edge-back-zone')).toHaveCount(0);
    await page.getByLabel('Settings').tap();
    await expect(page.getByTestId('edge-back-zone'), 'EDGE INERT a tap after a commit lands').toBeVisible();
  });
});
