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

  test('face paging mounts the REAL neighbour face mid-drag (not a preview)', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();          // halving center
    await expect(page.getByText('Open Halving Clock')).toHaveCount(0);   // neighbour NOT mounted at rest
    const box = await faceHostBox(page);
    // Hold the drag (release:false) toward cycle → the incoming Cycle face mounts in the neighbour pane.
    await mouseDragX(page, box.x + box.width / 2, box.y + 120, -160, { release: false });
    // ⚠ 'Open Halving Clock' is CycleClock's onSwitchToHalving cross-link (CycleClock.tsx:119-120), owned ONLY
    // by the INCOMING Cycle face — NOT the outgoing Halving face (whose string is 'Next halving'). Do NOT swap
    // this for a Halving-owned string; that would also match the OUTGOING pane and defeat the test.
    await expect(page.getByText('Open Halving Clock')).toHaveCount(1);   // REAL neighbour, not a preview label
    await page.mouse.up();                                               // release → snap
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
    // Page through the whole strip — the defense pill still never materialises.
    const box = await faceHostBox(page);
    for (let i = 0; i < 5; i++) await mouseDragX(page, box.x + box.width / 2, box.y + 120, -220);
    await expect(page.getByRole('button', { name: /Emergency|Liq Sim/ })).toHaveCount(0);
  });

  test('chart axis ownership — a horizontal scrub (with vertical wobble) on the chart neither pages nor scrolls', async ({ page }) => {
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
    // shouldStart refused the pager → still on the Power Law face (chart present). This half IS meaningful.
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
    // Page did not scroll vertically. ⚠ touch-action governs native TOUCH scroll, which synthetic page.mouse
    // cannot drive — so this assertion passes trivially in Chromium; the REAL vertical-ownership proof is the
    // iOS device gate (like the P1.3 handoff fixmes). Kept as a guard + intent marker.
    const scrollAfter = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(scrollAfter).toBe(scrollBefore);
  });

  test('edge coordination on Almanac — a left-bezel drag backs out, does not page', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();
    const h = page.viewportSize()!.height / 2;
    await mouseDragX(page, 8, h, 234);                                 // x=8 → the edge-back zone wins over face paging
    await expect(page.getByLabel('Log an event')).toBeVisible();       // left Almanac → journal (did NOT page to cycle)
  });
});
