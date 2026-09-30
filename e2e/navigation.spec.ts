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

  test('a horizontal drag on the Power Law chart stays on the face and zooms it; a 396px phone box; the tooltip and the legend name the bands', async ({ page }) => {
    // Deterministic data → loading false + error null → PowerLawMain renders the chart (it gates on both).
    await page.route(/blockchain\.info/, (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1710000000, y: 60000 }] }) }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /Power Law/ }).click();      // tap to the powerlaw face
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible({ timeout: 8000 });
    // Z8 — on the phone layout the chart's top sits at or below the bottom of the 844px viewport. Before chart zoom this
    // test measured it there, so its drag started OFF-SCREEN and never touched the chart: it passed vacuously.
    await chart.scrollIntoViewIfNeeded();
    // P7 — the phone box: a 360px plot plus the 36px touch toolbar row, at 390 wide.
    expect((await page.getByTestId('powerlaw-chart-box').boundingBox())!.height).toBe(396);
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
    // No face-pager exists to steal the drag → still on the Power Law face (chart present).
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
    // ⚠ Synthetic page.mouse cannot drive native TOUCH scroll, so this passes trivially in Chromium; kept as
    // a guard + intent marker (the real proof is the iOS device gate, like the P1.3 handoff fixmes).
    const scrollAfter = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(scrollAfter).toBe(scrollBefore);
    // Chart zoom (Z2): a MOUSE drag now draws a zoom box — this one ends 220px sideways and 30px down, so it zooms
    // both axes — and a double-click inside the plot zooms back out. Proves PowerLawChart's wiring at runtime.
    const zoom = page.getByTestId('chart-zoom');
    await expect(zoom).toHaveAttribute('data-zoomed', 'true');
    const plot = (await zoom.getByTestId('chart-zoom-plot').boundingBox())!;
    await page.mouse.dblclick(plot.x + plot.width / 2, plot.y + plot.height / 2);
    await expect(zoom).toHaveAttribute('data-zoomed', 'false');
    // The token tooltip: a UTC "D Mon YYYY" head, and the bands by their PL_BAND_LABEL names (the stub's history
    // reaches no row near the plot's centre, so the rows there are the bands).
    await page.mouse.move(plot.x + plot.width * 0.45, plot.y + plot.height * 0.5);
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
    const tip = zoom.locator('.recharts-tooltip-wrapper');
    await expect(tip).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}(?!\d)/);   // the head leads the tooltip's text
    for (const name of ['Resistance', 'Fair', 'Support']) await expect(tip).toContainText(name);
    // The legend lists only what is drawn. The stub prices ONE row, and one point draws no history (P3) — so exactly
    // the three bands.
    await expect(page.getByTestId('powerlaw-legend').locator('span')).toHaveText(['Resistance', 'Fair', 'Support']);
  });

  test('edge-swipe back works on Almanac (left bezel → journal)', async ({ page }) => {
    await openAlmanacSimple(page);
    await expect(page.getByText('Next halving')).toBeVisible();
    const h = page.viewportSize()!.height / 2;
    await mouseDragX(page, 8, h, 234);                                 // x=8 → the edge-back zone
    await expect(page.getByLabel('Log an event')).toBeVisible();       // left Almanac → journal
  });
});

// ── Decision face (Run B, G9) — nothing else ever mounts the face: the every-pill test above taps by an explicit
// name list, and the repo has no render harness. So: open it, with the price history stubbed and with it failing.
test.describe('Decision face — the smoke', () => {
  const MOVE_TITLE = "The support policy's move this month";
  // decisionView's ON_SUPPORT_NOTE (Playwright can't import src/) — the legend note on the defaults.
  const ON_SUPPORT = 'After today the modeled path runs on the support line, so the two are drawn as one.';

  test('opens with price history: THE MOVE and the chart render, and nothing crashes', async ({ page }) => {
    await page.route(/blockchain\.info/, (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] }),
    }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    const move = page.getByRole('region', { name: MOVE_TITLE });
    await expect(move).toBeVisible({ timeout: 8000 });
    await expect(move.getByText(/Your Monthly Playbook is your plan of record/)).toBeVisible();
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
    // The defaults (Support, on the line): after today the path IS the support line — the legend says so.
    await expect(page.getByText(ON_SUPPORT)).toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('D2: the schedule\'s "Strike keep" header is ONE line, at 390px and at 375px', async ({ page }) => {
    await page.route(/blockchain\.info/, (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] }),
    }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    const th = page.getByTestId('schedule-keep');
    for (const width of [390, 375]) {
      await page.setViewportSize({ width, height: 844 });
      await th.scrollIntoViewIfNeeded();
      // One line = every line box of the cell's text shares one top; and nothing spills past the cell.
      const m = await th.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set([...range.getClientRects()].map((q) => Math.round(q.top)));
        return { lines: tops.size, overflows: el.scrollWidth > el.clientWidth };
      });
      expect(m, `at ${width}px`).toEqual({ lines: 1, overflows: false });
    }
  });

  test('chart zoom: a dragged box zooms, a double-click zooms back out, and the tooltip still answers', async ({ page }) => {
    await page.route(/blockchain\.info/, (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] }),
    }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    const zoom = page.getByTestId('chart-zoom');
    await zoom.scrollIntoViewIfNeeded();
    await expect(zoom).toHaveAttribute('data-zoomed', 'false');
    const ticks = () => zoom.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').allTextContents();
    const before = await ticks();
    expect(before.length).toBeGreaterThan(0);
    const plot = (await zoom.getByTestId('chart-zoom-plot').boundingBox())!;
    // A box across the middle 40% × 50% of the plot (mobile emulation: no mode pressed — a MOUSE still draws a box).
    const x0 = plot.x + plot.width * 0.3, x1 = plot.x + plot.width * 0.7;
    const y0 = plot.y + plot.height * 0.25, y1 = plot.y + plot.height * 0.75;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    await expect(zoom).toHaveAttribute('data-zoomed', 'true');
    await expect(zoom.getByText('Double-click to zoom back out')).toBeVisible();
    await expect.poll(ticks).not.toEqual(before);
    // Double-click back out: the full view, and today's labels.
    await page.mouse.dblclick(plot.x + plot.width / 2, plot.y + plot.height / 2);
    await expect(zoom).toHaveAttribute('data-zoomed', 'false');
    await expect.poll(ticks).toEqual(before);
    // Z1 — the overlay never takes the pointer: a hover inside the plot still raises recharts' tooltip.
    await page.mouse.move(plot.x + plot.width * 0.45, plot.y + plot.height * 0.5);
    await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
    await expect(zoom.locator('.recharts-tooltip-wrapper').first()).toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('chart zoom Z6: in Scroll mode a sideways stroke is held once it passes 8px; a tap, a vertical stroke and a touchstart never are', async ({ page }) => {
    // ⚠ Synthetic TouchEvents prove the HOOK's decisions — which touches it cancels — not iOS's scroll arbitration
    // (that is device-gate step 2). dispatchEvent returns false if and only if a listener called preventDefault.
    await page.route(/blockchain\.info/, (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] }),
    }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    const zoom = page.getByTestId('chart-zoom');
    await zoom.scrollIntoViewIfNeeded();
    await expect(zoom).toHaveAttribute('data-mode', 'none');            // premise: Scroll mode (nothing pressed)
    await expect(zoom).toHaveAttribute('data-zoomed', 'false');
    const plot = (await zoom.getByTestId('chart-zoom-plot').boundingBox())!;
    const at = { px: plot.x + plot.width / 2, py: plot.y + plot.height / 2 };
    const held = await page.evaluate(({ px, py }) => {
      const target = document.elementFromPoint(px, py)!;               // recharts' surface — .plot never takes it (Z1)
      const touch = (id: number, x: number, y: number) => new Touch({ identifier: id, target, clientX: x, clientY: y });
      /** true = the event went through; false = a listener cancelled it. */
      const fire = (type: string, touches: Touch[], changed: Touch[] = touches) => target.dispatchEvent(
        new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
      const r: Record<string, boolean> = {};
      // A sideways stroke that wobbles: free under 8px (it may be a tap), held from the move that passes 8px on.
      r.sideStart = fire('touchstart', [touch(1, px, py)]);
      r.sideUnder8 = fire('touchmove', [touch(1, px + 3, py + 1)]);
      r.sideLock = fire('touchmove', [touch(1, px + 12, py + 3)]);
      r.sideWobble = fire('touchmove', [touch(1, px + 20, py - 9)]);
      fire('touchend', [], [touch(1, px + 20, py - 9)]);
      // A vertical start scrolls, as before — even when the finger turns sideways later.
      r.vertStart = fire('touchstart', [touch(2, px, py)]);
      r.vertLock = fire('touchmove', [touch(2, px + 2, py + 12)]);
      r.vertTurn = fire('touchmove', [touch(2, px + 40, py + 14)]);
      fire('touchend', [], [touch(2, px + 40, py + 14)]);
      // A second finger hands a held scrub over to the pinch, which spreads the dates.
      fire('touchstart', [touch(3, px, py)]);
      r.scrub = fire('touchmove', [touch(3, px + 12, py)]);
      const two = [touch(3, px + 12, py), touch(4, px - 40, py)];
      r.twoStart = fire('touchstart', two, [two[1]]);
      const spread = [touch(3, px + 30, py), touch(4, px - 60, py)];
      r.pinch = fire('touchmove', spread);
      // The fingers lift in the SAME task — no frame runs between the last move and the release, so the zoom below
      // needs the release itself to land the pinch (Z14), as a drag's release does.
      fire('touchend', [], spread);
      return r;
    }, at);
    expect(held).toEqual({
      sideStart: true, sideUnder8: true, sideLock: false, sideWobble: false,
      vertStart: true, vertLock: true, vertTurn: true,
      scrub: false, twoStart: true, pinch: false,
    });
    await expect(zoom).toHaveAttribute('data-zoomed', 'true');           // the pinch took over and zoomed the dates
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('opens with the price history failing: it still renders, and says the history did not load', async ({ page }) => {
    await page.route(/blockchain\.info/, (r) => r.fulfill({ status: 500, body: '' }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    const move = page.getByRole('region', { name: MOVE_TITLE });
    await expect(move).toBeVisible({ timeout: 8000 });
    await expect(move.getByText("Price history didn't load, so this run assumes the model isn't treated as broken."))
      .toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});

// ── Sats face — the rates under the converter (spec pbloc-spec-sats-rates-v1). Every assertion carries a tag (S1, PREMISE,
// S2, KEY, D2, D1@w, SCROLL@w), so each named mutation can be shown to fail at its own assertion.
test.describe('Sats face — the rates under the converter', () => {
  test('the rates sit under the converter; a tap or Enter fills it; one line per row; no sideways scroll; the panel inset', async ({ page }) => {
    // The spot price answered with the store's own default (82,000), registered BEFORE the app loads, so the widths
    // measured below can't move with the market.
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: '82000' } }) }));
    await openAlmanacSimple(page);
    await page.getByRole('button', { name: /丰 Sats/ }).click();
    const rates = page.getByRole('region', { name: 'Satoshi Rates' });
    await expect(rates, 'S1').toBeVisible();

    // S1 — in the converter's column, right after the converter card; never in the side panel.
    const where = await rates.evaluate((el) => ({
      inPanel: el.closest('[class*="facePanel"]') !== null,
      prev: el.previousElementSibling?.textContent ?? '',
    }));
    expect(where.inPanel, 'S1').toBe(false);
    expect(where.prev, 'S1').toMatch(/SATOSHIS[\s\S]*BITCOIN[\s\S]*US DOLLAR/);

    const fields = rates.locator('xpath=preceding-sibling::*[1]').locator('input');
    await expect(fields.nth(0), 'PREMISE').toHaveValue('0');
    await expect(fields.nth(1), 'PREMISE').toHaveValue('0');

    // S2 — ONE tap on the 1,000 row fills the converter at once. The filter still matches with the unit words back, so
    // that mutation fails at D1, not at a timeout here.
    const rows = rates.locator('tbody tr');
    await rows.filter({ has: page.locator('td', { hasText: /^丰 1,000(?:\s|$)/ }) }).tap();
    await expect(fields.nth(0), 'S2').toHaveValue('1,000');
    await expect(fields.nth(1), 'S2').toHaveValue('0.00001');

    // KEY — Tab from US DOLLAR lands on the first row, and Enter fills it.
    await fields.nth(2).focus();
    await page.keyboard.press('Tab');
    await expect(rows.first(), 'KEY').toBeFocused();
    await page.keyboard.press('Enter');
    await expect(fields.nth(0), 'KEY').toHaveValue('1');
    await expect(fields.nth(1), 'KEY').toHaveValue('0.00000001');

    // D2 — the side panel's first text gets the converter's 16px gutter.
    const panelText = (await page.getByText('Sats Per Dollar', { exact: true }).boundingBox())!;
    expect(panelText.x, 'D2').toBeGreaterThanOrEqual(16);

    // D1 — one line per cell (the Decision D2 rule: every line box of the text shares one top). No sideways scroll: the
    // page itself can't scroll sideways (overflow-x: hidden on html, body and the tool container), so the check is the
    // table's own scroll box. 350 stands for the full-mode tab: the Almanac box there is 316px, the full-mode tab's box
    // at 390.
    const measure = () => rates.evaluate((el) => {
      const table = el.querySelector('table')!;
      const box = table.parentElement!;
      const lines = [...table.querySelectorAll('tbody td')].map((td) => {
        const range = document.createRange();
        range.selectNodeContents(td);
        return new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size;
      });
      return { maxLines: Math.max(...lines), scrolls: box.scrollWidth > box.clientWidth };
    });
    for (const width of [390, 375, 350]) {
      await page.setViewportSize({ width, height: 844 });
      const m = await measure();
      expect(m.maxLines, `D1@${width}`).toBe(1);
      expect(m.scrolls, `SCROLL@${width}`).toBe(false);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await measure()).scrolls, 'SCROLL@1280').toBe(false);
  });
});
