import { test, expect } from '@playwright/test';
import { seedAndGoto, openSettingsSimple, openAlmanacSimple, faceHostBox, mouseDragX } from './helpers';

/**
 * Gesture & Motion System — P3 navigation specs: edge-swipe-back (AppShell Branch H/I) + Almanac face swipe.
 * The dev server bypasses every gate (import.meta.env.DEV), so the simple-mode seed reaches the two edge-back
 * surfaces. Gates never mount EdgeBackGesture — verified by the component-level grep in the summary (the
 * `edge-back-zone` testid is absent everywhere but Branch H/I; the journal spec below pins that).
 */
test.describe('Navigation gestures (P3)', () => {
  test('edge-swipe back from Settings returns to the journal', async ({ page }) => {
    await openSettingsSimple(page);
    const h = page.viewportSize()!.height / 2;
    // Drag from the 20px bezel (x=8) rightward past the 50% commit threshold (234 > 195 on a 390px width).
    await mouseDragX(page, 8, h, 234);
    await expect(page.getByLabel('Log an event')).toBeVisible(); // back on DailyModeView (after the exit anim)
    await expect(page.getByTestId('edge-back-zone')).toHaveCount(0);
  });

  test('a drag starting mid-page (x=60) does NOT back-navigate', async ({ page }) => {
    await openSettingsSimple(page);
    const h = page.viewportSize()!.height / 2;
    await mouseDragX(page, 60, h, 234);              // outside the 20px zone → hits page content, not the zone
    await page.waitForTimeout(300);
    await expect(page.getByTestId('edge-back-zone')).toBeVisible();   // still on Settings
    await expect(page.getByLabel('Log an event')).toHaveCount(0);
  });

  test('tap forwarding — the left 20px is not a dead strip', async ({ page }) => {
    await openSettingsSimple(page);
    const back = page.getByRole('button', { name: '← Back' });
    const box = (await back.boundingBox())!;
    expect(box.x).toBeLessThan(20);                  // precondition: the ← Back button overlaps the 20px zone
    // A pure TAP over the zone (box.x + 2 < 20) must forward to the ← Back button beneath → navigates back.
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await expect(page.getByLabel('Log an event')).toBeVisible();
  });

  test('gate exclusion — the journal (Branch J) never mounts the edge-back zone', async ({ page }) => {
    await seedAndGoto(page);   // DailyModeView (Branch J) — no ← Back, no EdgeBackGesture
    await expect(page.getByTestId('edge-back-zone')).toHaveCount(0);
    // (Auth/viewer gates are unreachable under the dev bypass; the component-level grep covers them.)
  });

  test('Almanac faces page by swipe (halving → cycle)', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();        // default face = Halving Clock
    await expect(page.getByText('Open Halving Clock')).toHaveCount(0);
    const box = await faceHostBox(page);
    await mouseDragX(page, box.x + box.width / 2, box.y + 120, -220);  // drag left → next face
    await expect(page.getByText('Open Halving Clock')).toBeVisible();  // Cycle Clock content (after the snap)
  });

  test('gated faces (defense) never appear while !hasCbLoan', async ({ page }) => {
    await openAlmanacSimple(page);
    // The sub-nav renders ONLY visibleFaces; with the default seed (!hasCbLoan) defense is absent from it.
    await expect(page.getByRole('button', { name: /Emergency|Liq Sim/ })).toHaveCount(0);
    // Page through the whole strip — the defense pill still never materialises.
    const box = await faceHostBox(page);
    for (let i = 0; i < 5; i++) await mouseDragX(page, box.x + box.width / 2, box.y + 120, -220);
    await expect(page.getByRole('button', { name: /Emergency|Liq Sim/ })).toHaveCount(0);
  });

  test('chart exclusion — a drag starting on the Power Law chart does NOT page', async ({ page }) => {
    // Deterministic data → loading false + error null → PowerLawMain renders the chart (it gates on both).
    await page.route(/blockchain\.info/, (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1710000000, y: 60000 }] }) }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /Power Law/ }).click();      // tap to the powerlaw face
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible({ timeout: 8000 });
    const box = (await chart.boundingBox())!;
    await mouseDragX(page, box.x + box.width / 2, box.y + box.height / 2, -220); // pointerdown INSIDE the chart
    // shouldStart refused → no page → the chart is still shown (didn't advance to Sats).
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
  });

  test('edge coordination on Almanac — a left-bezel drag backs out, does not page', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();
    const h = page.viewportSize()!.height / 2;
    await mouseDragX(page, 8, h, 234);                                 // x=8 → the edge-back zone wins over face paging
    await expect(page.getByLabel('Log an event')).toBeVisible();       // left Almanac → journal (did NOT page to cycle)
  });
});
