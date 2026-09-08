import { test, expect } from '@playwright/test';
import { seedAndGoto, openSettingsSimple, openAlmanacSimple, mouseDragX } from './helpers';

/**
 * Gesture & Motion System — P3 navigation specs: edge-swipe-back (AppShell Branch H/I) + Almanac face nav.
 * ⚠ The Almanac face-swipe pager was REMOVED — face switching is TAP-ONLY (the sub-nav pills). The specs
 * below pin that: a horizontal drag anywhere in the face host must NOT change face.
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

  test('Almanac faces switch by TAPPING the sub-nav title (halving → cycle)', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();        // default face = Halving Clock
    await expect(page.getByText('Open Halving Clock')).toHaveCount(0);
    await page.getByRole('button', { name: /Cycle Clock/ }).click();
    // 'Open Halving Clock' is CycleClock's onSwitchToHalving cross-link (CycleClock.tsx) — owned ONLY by the
    // Cycle face, so it proves the face actually swapped rather than merely rendering alongside.
    await expect(page.getByText('Open Halving Clock')).toHaveCount(1);  // exactly ONE face mounts — no neighbours
  });

  test('a horizontal drag across the Almanac does NOT change face (pager removed)', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();
    const h = page.viewportSize()!.height / 2;
    const w = page.viewportSize()!.width;
    // A committed leftward drag well clear of the 20px edge-back bezel — used to page halving → cycle.
    await mouseDragX(page, w / 2, h, -220);
    await page.waitForTimeout(300);
    await expect(page.getByText('Next halving')).toBeVisible();        // still Halving Clock
    await expect(page.getByText('Open Halving Clock')).toHaveCount(0); // never reached Cycle Clock
  });

  test('nested edge-back goes ONE level (subpage → list → journal)', async ({ page }) => {
    await openSettingsSimple(page);
    await page.getByText('Identity & Security').click();                 // open a subpage
    await expect(page.getByRole('button', { name: '← Settings' })).toBeVisible();
    const h = page.viewportSize()!.height / 2;
    // First edge-back → ONE level → the settings LIST (subpage back-btn gone, the row visible again).
    await mouseDragX(page, 8, h, 234);
    await expect(page.getByRole('button', { name: '← Settings' })).toHaveCount(0);
    await expect(page.getByText('Identity & Security')).toBeVisible();   // back on the list (the ROW)
    await expect(page.getByTestId('edge-back-zone')).toBeVisible();      // still inside Settings
    // Second edge-back → exits Settings → journal.
    await mouseDragX(page, 8, h, 234);
    await expect(page.getByLabel('Log an event')).toBeVisible();
  });

  test('gated faces (defense) never appear while !hasCbLoan', async ({ page }) => {
    await openAlmanacSimple(page);
    // The sub-nav renders ONLY visibleFaces; with the default seed (!hasCbLoan) defense is absent from it.
    await expect(page.getByRole('button', { name: /Emergency|Liq Sim/ })).toHaveCount(0);
    // Tap through every pill the sub-nav offers — the defense pill still never materialises.
    const pills = page.locator('button', { hasText: /Halving Clock|Cycle Clock|Mining|Power Law|Sats|Scenario|Ownership/ });
    for (let i = 0, n = await pills.count(); i < n; i++) {
      await pills.nth(i).click();
      await expect(page.getByRole('button', { name: /Emergency|Liq Sim/ })).toHaveCount(0);
    }
  });

  test('a horizontal scrub on the Power Law chart stays on the Power Law face', async ({ page }) => {
    // Deterministic data → loading false + error null → PowerLawMain renders the chart (it gates on both).
    await page.route(/blockchain\.info/, (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1710000000, y: 60000 }] }) }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /Power Law/ }).click();      // tap to the powerlaw face
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible({ timeout: 8000 });
    const box = (await chart.boundingBox())!;
    const scrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    // Horizontal drag with a ±30px vertical wobble, STARTING inside the chart.
    const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(sx - (220 * i) / 12, sy + (i % 2 === 0 ? 30 : -30));
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    await page.waitForTimeout(60);
    // No face-pager exists to steal the scrub → still on the Power Law face (chart present).
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
    // ⚠ Synthetic page.mouse cannot drive native TOUCH scroll, so this passes trivially in Chromium; kept as
    // a guard + intent marker (the real proof is the iOS device gate, like the P1.3 handoff fixmes).
    const scrollAfter = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(scrollAfter).toBe(scrollBefore);
  });

  test('edge-swipe back works on Almanac (left bezel → journal)', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();
    const h = page.viewportSize()!.height / 2;
    await mouseDragX(page, 8, h, 234);                                 // x=8 → the edge-back zone
    await expect(page.getByLabel('Log an event')).toBeVisible();       // left Almanac → journal
  });
});
