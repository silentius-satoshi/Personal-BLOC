import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedAndGoto, seedLoanAndGoto, openSettingsSimple, openAlmanacSimple, mouseDragX, STORE_VERSION } from './helpers';

/** The four block explorers useChainTip tries once live height is on — the consent sheet's list. */
const EXPLORERS = /mempool\.space|blockstream\.info|blockchain\.info\/q\/|blockchair\.com/;
/** PowerLawChart's title — powerLawView's PL_CHART_TITLE (Playwright can't import src/). */
const PL_TITLE = 'Price and the bands';

/**
 * Z18 — the zoom toolbar sits in the chart card's title row: above the chart (never over the plot), on the title's line,
 * and right-aligned with the chart box. ROW reads the gesture area, which exists before and after the split, so the old
 * overlay fails it on a computer.
 */
async function expectToolbarInTitleRow(page: Page, title: string, boxTestId: string): Promise<void> {
  const bar = (await page.getByRole('toolbar', { name: 'Chart zoom' }).boundingBox())!;
  const head = (await page.getByText(title, { exact: true }).boundingBox())!;
  const area = (await page.getByTestId('chart-zoom').boundingBox())!;
  expect(bar.y + bar.height, 'ROW').toBeLessThanOrEqual(area.y);
  expect(Math.abs(bar.y + bar.height / 2 - (head.y + head.height / 2)), 'ROW').toBeLessThanOrEqual(bar.height / 2);
  const box = (await page.getByTestId(boxTestId).boundingBox())!;
  expect(Math.abs(bar.x + bar.width - (box.x + box.width)), 'RIGHT').toBeLessThanOrEqual(1);
}

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

  test('the Power Law face: the chart opens in view and holds still while the history and the price load; the toolbar in the title row; a drag zooms it; the tooltip and the legend name the bands; no explorer is contacted', async ({ page }) => {
    // Deterministic data (spec pbloc-spec-powerlaw-face-v1). The history is HELD until STEADY has read the loading box
    // (Z22), and the live price until PRICE — nothing above the chart may wait on it. The four block explorers are
    // aborted, so the run is hermetic; page.on('request') still sees any attempt (Playwright emits `request` before
    // routing), so OFFLINE holds.
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    let releasePrice!: () => void;
    const heldPrice = new Promise<void>((res) => { releasePrice = res; });
    const explorer: string[] = [];
    page.on('request', (r) => { if (EXPLORERS.test(r.url())) explorer.push(r.url()); });
    await page.route(EXPLORERS, (r) => r.abort());
    await page.route(/api\.coinbase\.com\/v2\/prices/, async (r) => {
      await heldPrice;
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { amount: '82000' } }) });
    });
    await page.route(/blockchain\.info\/charts/, async (r) => {
      await held;
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1710000000, y: 60000 }] }) });
    });
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /Power Law/ }).click();      // tap to the powerlaw face
    // STEADY (Z22) — the box's page top is the same while loading and once the chart arrives. The title row is 32px
    // either way; at 390 "Price and the bands" fits on one line beside the toolbar (the 360px test below pins the row).
    const loading = page.getByText('Loading price history…');
    await expect(loading).toBeVisible();
    // The web font first: IBM Plex Mono swaps in (display=swap) and the sub-nav pills above grow 33 → 34px with it
    // (line-height: normal), so a reading taken before the swap is 1px off one taken after — a flake, not the layout.
    await page.evaluate(() => document.fonts.ready);
    const before = await loading.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    release();
    const chart = page.locator('.recharts-wrapper').first();
    await expect(chart).toBeVisible({ timeout: 8000 });
    const box = page.getByTestId('powerlaw-chart-box');
    const top = () => box.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(await top(), 'STEADY').toBe(before);
    // TOP (R1) — nothing has scrolled yet. The app scrolls <body>, not the window, so window.scrollY stays 0 while the
    // page scrolls: add the scrollTop of every ancestor of the box. Without it, a scrolled-down open passes IN VIEW.
    const scrolled = await box.evaluate((el) => {
      let s = window.scrollY;
      for (let p = el.parentElement; p; p = p.parentElement) s += p.scrollTop;
      return s;
    });
    expect(scrolled, 'TOP').toBe(0);
    // IN VIEW (F2, D1) — the whole chart is on screen when the face opens (309.5–669.5 at 390×844).
    const b = (await box.boundingBox())!;
    expect(b.y + b.height, 'IN VIEW').toBeLessThanOrEqual(page.viewportSize()!.height);
    // PRICE — the tiles sit under the chart, so the price's arrival can't move it.
    await expect(page.getByText('no live price yet'), 'PREMISE').toBeVisible();
    releasePrice();
    await expect(page.getByText(/(?:below|above) the fair line/)).toBeVisible({ timeout: 15000 });
    expect(await top(), 'PRICE').toBe(before);
    // ORDER (D1) — the tiles come after the chart: Resistance's tile sits under the box.
    const tile = (await page.getByText('2.07× fair', { exact: true }).boundingBox())!;
    expect(tile.y, 'ORDER').toBeGreaterThan(b.y + b.height);
    // Z8 — now a guard: the box opens in view (IN VIEW), so this is a no-op. Before chart zoom the chart sat below the
    // fold and the drag started OFF-SCREEN, passing vacuously; this keeps a layout that pushes the chart down from doing
    // that again.
    await chart.scrollIntoViewIfNeeded();
    // P7 — the phone box: the 360px plot alone, at 390 wide. The toolbar left the box for the title row (Z18).
    expect((await box.boundingBox())!.height, 'P7').toBe(360);
    await expect(page.getByText(PL_TITLE, { exact: true }), 'TITLE').toBeVisible();
    await expectToolbarInTitleRow(page, PL_TITLE, 'powerlaw-chart-box');
    const area = (await chart.boundingBox())!;
    const scrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    // Horizontal drag with a ±30px vertical wobble, STARTING inside the chart.
    const sx = area.x + area.width / 2, sy = area.y + area.height / 2;
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
    // OFFLINE (F1, D2) — with live height off, opening Power Law contacts no block explorer.
    expect(explorer, 'OFFLINE').toEqual([]);
  });

  test('the Power Law title row holds at 32px on a 360px phone, in the Almanac and on the full-mode tab — which has no sidebar — so the box never moves when the chart arrives (F6)', async ({ browser, baseURL }) => {
    // A phone context of its own (Z20: a context made inside a test takes the project's `use` — set the phone
    // explicitly). The history is HELD until the loading box is read; the live price and the explorers are aborted, so
    // nothing above the chart can change on a tree that still has the side panel.
    test.setTimeout(60_000);
    for (const surface of ['almanac', 'full'] as const) {
      const ctx = await browser.newContext({
        baseURL, viewport: { width: 360, height: 780 }, serviceWorkers: 'block', isMobile: true, hasTouch: true,
      });
      try {
        const page = await ctx.newPage();
        let release!: () => void;
        const held = new Promise<void>((res) => { release = res; });
        await page.route(/api\.coinbase\.com\/v2\/prices|mempool\.space|blockstream\.info|blockchain\.info\/q\/|blockchair\.com/, (r) => r.abort());
        await page.route(/blockchain\.info\/charts/, async (r) => {
          await held;
          await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1710000000, y: 60000 }] }) });
        });
        if (surface === 'almanac') {
          await seedAndGoto(page);
          await page.getByLabel('Almanac').click();
          await page.getByRole('button', { name: /Power Law/ }).click();
        } else {
          await page.addInitScript(`
            window.__APP_BOOTED = true;
            localStorage.setItem('personal-bloc-store', JSON.stringify({
              state: { onboardingComplete: true, simpleMode: false, simpleView: 'daily' }, version: ${STORE_VERSION}
            }));
            localStorage.setItem('personal-bloc-onboarded', '1');
          `);
          await page.goto('/');
          const tools = page.getByRole('button', { name: /^Tools/ });
          await expect(tools, `LANDING ${surface}`).toBeVisible({ timeout: 15_000 });
          await tools.click();
          await page.getByRole('button', { name: 'Power Law', exact: true }).click();
          await expect(page.locator('aside'), `SIDEBAR ${surface}`).toBeHidden();
        }
        const loading = page.getByText('Loading price history…');
        await expect(loading).toBeVisible({ timeout: 15_000 });
        await page.evaluate(() => document.fonts.ready);
        // ROW is found by PLACE — the box's previous sibling, the chart's title row — never by its words, so a longer
        // title fails here.
        const row = (el: Locator) => el.locator('xpath=preceding-sibling::*[1]');
        expect((await row(loading).boundingBox())!.height, `ROW ${surface} loading`).toBe(32);
        const before = await loading.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        release();
        const box = page.getByTestId('powerlaw-chart-box');
        await expect(box).toBeVisible({ timeout: 8000 });
        expect((await row(box).boundingBox())!.height, `ROW ${surface}`).toBe(32);
        expect(await box.evaluate((el) => el.getBoundingClientRect().top + window.scrollY), `STEADY ${surface}`).toBe(before);
      } finally {
        await ctx.close();
      }
    }
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
    // Z18 — the box is 280px on a phone too (the toolbar row used to sit inside it: 316), and the toolbar sits in the
    // card's title row.
    const chartBox = page.getByTestId('decision-chart-box');
    await expect(chartBox, 'BOX').toHaveCount(1);
    expect((await chartBox.boundingBox())!.height, 'BOX').toBe(280);
    await expectToolbarInTitleRow(page, 'Price · history and the modeled path', 'decision-chart-box');
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

  /** G9's three points — the history the Decision tests stub. */
  const stubHistory = (page: Page) => page.route(/blockchain\.info/, (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] }),
  }));

  test('chart zoom Z17: a pinch draws no tooltip, cursor or active dots — while it runs and after it — until a fresh touch', async ({ page }) => {
    // ⚠ Z21 — reach the face with .tap() and never move page.mouse before WAKE. Playwright's mouse stays where a .click()
    // leaves it (the Decision tab): after the tap below, Chromium re-hovers at that mouse position and sends mouseout /
    // mouseleave to the chart, so recharts hides the tooltip. A real phone has no second pointer.
    await stubHistory(page);
    await seedAndGoto(page);
    await page.getByLabel('Almanac').tap();
    await page.getByRole('button', { name: /◆ Decision/ }).tap();
    const zoom = page.getByTestId('chart-zoom');
    await zoom.scrollIntoViewIfNeeded();
    await expect(zoom, 'PREMISE').toHaveAttribute('data-mode', 'none');            // Scroll mode (nothing pressed)
    await expect(zoom, 'PREMISE').toHaveAttribute('data-zoomed', 'false');
    const plot = (await zoom.getByTestId('chart-zoom-plot').boundingBox())!;
    const at = { px: plot.x + plot.width / 2, py: plot.y + plot.height / 2 };
    // ⚠ Synthetic TouchEvents prove what recharts DRAWS for these touches (the Z6 precedent), not iOS's arbitration. Each
    // Touch carries pageX / pageY: recharts reads pageX (getMouseInfo), so a touch without it never moves its tooltip.
    const r = await page.evaluate(async ({ px, py }) => {
      const target = document.elementFromPoint(px, py)!;                              // recharts' surface (Z1)
      const area = target.closest('[data-testid="chart-zoom"]')!;
      const touch = (id: number, x: number, y: number) => new Touch({
        identifier: id, target, clientX: x, clientY: y, pageX: x + window.scrollX, pageY: y + window.scrollY,
      });
      const fire = (type: string, touches: Touch[], changed: Touch[] = touches) => target.dispatchEvent(
        new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
      // Past recharts' 16ms move throttle, with React rendered.
      const settle = () => new Promise((res) => setTimeout(res, 60));
      const read = () => {
        const wrap = area.querySelector('.recharts-tooltip-wrapper');
        return {
          tip: wrap !== null && getComputedStyle(wrap).visibility === 'visible',
          cursor: area.querySelectorAll('.recharts-tooltip-cursor').length,
          dots: area.querySelectorAll('.recharts-active-dot').length,
        };
      };
      // CONTROL — one finger, one sideways move: recharts tracks these touches and draws its tooltip, so the zeros
      // below can't be vacuous.
      fire('touchstart', [touch(9, px, py)]);
      fire('touchmove', [touch(9, px + 12, py)]);
      await settle();
      const control = read().tip;
      fire('touchend', [], [touch(9, px + 12, py)]);
      // The pinch: A, then B, then the fingers move in turn. recharts follows changedTouches[0], so without quiet its
      // markers jump between the fingers (the reviewer's 209 → 299 → 210 → 319 …).
      let a = touch(1, px - 45, py);
      let b = touch(2, px + 45, py);
      fire('touchstart', [a]);
      fire('touchstart', [a, b], [b]);
      let dotsDuring = 0, tipDuring = false, cursorDuring = 0;
      const during = () => {
        const s = read();
        dotsDuring = Math.max(dotsDuring, s.dots);
        tipDuring = tipDuring || s.tip;
        cursorDuring = Math.max(cursorDuring, s.cursor);
      };
      for (let i = 1; i <= 3; i++) {
        a = touch(1, px - 45 - i, py);
        fire('touchmove', [a, b], [a]);
        await settle();
        during();
        b = touch(2, px + 45 + 20 * i, py);
        fire('touchmove', [a, b], [b]);
        await settle();
        during();
      }
      // The release: B lifts first.
      fire('touchend', [a], [b]);
      await settle();
      const after = read();
      // The pinch's leftover finger moving alone is still the pinch, not a fresh touch.
      a = touch(1, px - 70, py);
      fire('touchmove', [a]);
      await settle();
      const leftover = read().tip;
      fire('touchend', [], [a]);
      // A fresh finger down and not yet moved: recharts still holds the leftover finger's place, so a wake here would
      // pop the old tooltip back.
      const c = touch(3, px + 30, py);
      fire('touchstart', [c]);
      await settle();
      const freshStart = read().tip;
      fire('touchend', [], [c]);
      return {
        control, dotsDuring, tipDuring, cursorDuring,
        tipAfter: after.tip, cursorAfter: after.cursor, dotsAfter: after.dots, leftover, freshStart,
      };
    }, at);
    expect(r.control, 'CONTROL').toBe(true);
    expect(r.dotsDuring, 'DOTS-DURING').toBe(0);
    expect(r.tipDuring, 'TIP-DURING').toBe(false);
    expect(r.cursorDuring, 'CURSOR-DURING').toBe(0);
    expect(r.tipAfter, 'TIP-AFTER').toBe(false);
    expect(r.cursorAfter, 'CURSOR-AFTER').toBe(0);
    expect(r.dotsAfter, 'DOTS-AFTER').toBe(0);
    expect(r.leftover, 'LEFTOVER').toBe(false);
    expect(r.freshStart, 'FRESH-START').toBe(false);
    await expect(zoom, 'PINCHED').toHaveAttribute('data-zoomed', 'true');
    await expect(zoom, 'QUIET').toHaveAttribute('data-quiet', 'true');
    // WAKE — a fresh single tap: real Chromium input, whose compat mousemove positions recharts' tooltip (as on iOS).
    await page.touchscreen.tap(at.px + 40, at.py);
    await expect(zoom.locator('.recharts-tooltip-wrapper').first(), 'WAKE').toBeVisible();
    await expect(zoom, 'WAKE').toHaveAttribute('data-quiet', 'false');
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('chart zoom — the price reach: − zooms out past the fitted view toward $0.01–$10M, a pan at home moves the view, and Reset returns home', async ({ page }) => {
    await stubHistory(page);
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    const zoom = page.getByTestId('chart-zoom');
    await zoom.scrollIntoViewIfNeeded();
    const yLabels = () => zoom.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents();
    await expect(zoom, 'PREMISE').toHaveAttribute('data-zoomed', 'false');
    await expect.poll(async () => (await yLabels()).length, { message: 'PREMISE' }).toBeGreaterThan(0);
    const home = await yLabels();
    expect(home.some((l) => l.endsWith('M')), 'PREMISE').toBe(false);                // the fitted view tops out under $1M
    // − twice: past the fitted view, toward the reach (today − at home snaps straight back to it).
    const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true });
    await zoomOut.click();
    await zoomOut.click();
    await expect(zoom, 'OUT').toHaveAttribute('data-zoomed', 'true');
    await expect.poll(yLabels, { message: 'REACH' }).toContain('$1.0M');
    // The note — a double-tap goes back IN to home here, so it never says "zoom back out".
    await expect(zoom.getByText('Double-tap to reset the view'), 'NOTE').toBeVisible();
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await expect(zoom, 'HOME').toHaveAttribute('data-zoomed', 'false');
    await expect.poll(yLabels, { message: 'HOME' }).toEqual(home);
    // A pan at home moves the price — a drag DOWN shows higher prices (today it snaps straight back).
    await page.getByRole('button', { name: 'Pan', exact: true }).click();
    await expect(zoom).toHaveAttribute('data-mode', 'pan');
    const plot = (await zoom.getByTestId('chart-zoom-plot').boundingBox())!;
    const x = plot.x + plot.width / 2, y0 = plot.y + plot.height * 0.3;
    await page.mouse.move(x, y0);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x, y0 + (plot.height * 0.4 * i) / 10);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    await expect(zoom, 'PAN').toHaveAttribute('data-zoomed', 'true');
    await expect.poll(yLabels, { message: 'PAN' }).not.toEqual(home);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('chart zoom Z18 on a computer: the toolbar sits in the title row and never covers the plot', async ({ browser, baseURL }) => {
    // The project is a phone, and Z18 is a computer complaint (the fine-pointer overlay covered the end of the modeled
    // path), so this test opens a computer of its own. ⚠ Z20: Playwright Test applies the project's `use` (isMobile,
    // hasTouch) to a context made inside a test — without these two `false`s the page is still a touch phone.
    const ctx = await browser.newContext({
      baseURL, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', isMobile: false, hasTouch: false,
    });
    try {
      const page = await ctx.newPage();
      await stubHistory(page);
      await seedAndGoto(page);
      await page.getByLabel('Almanac').click();
      await page.getByRole('button', { name: /◆ Decision/ }).click();
      const zoom = page.getByTestId('chart-zoom');
      await zoom.scrollIntoViewIfNeeded();
      await expect(zoom, 'MODE').toHaveAttribute('data-mode', 'zoom');              // premise: a fine pointer
      await expectToolbarInTitleRow(page, 'Price · history and the modeled path', 'decision-chart-box');
      // CLEAR — the plot's top right, where the modeled path ends, is the chart's own, never a toolbar button. (The old
      // overlay spanned the plot's right − 170 … right − 4, top − 4 … top + 26.)
      const plot = (await zoom.getByTestId('chart-zoom-plot').boundingBox())!;
      const clear = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el !== null && el.closest('.recharts-wrapper') !== null;
      }, { x: plot.x + plot.width - 10, y: plot.y + 10 });
      expect(clear, 'CLEAR').toBe(true);
      await expect(page.getByText('Something crashed')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
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

// ── InfoTip fit (spec pbloc-spec-infotip-fit-v1, v1.1). ONE tap opens a tip; the panel sits inside the 16px gutters at
// every width and again after a resize; Escape, a second tap and a tap outside close it; with a mouse, hover opens it, a
// click keeps it open and a second click closes it. Every assertion carries a tag (PREMISE, TAP, FIT@w, TAP2, COMPAT-*,
// ESCAPE, OUTSIDE, HOVER, HOVER-AWAY, CLICK-KEEPS, AWAY-KEEPS, CLICK-CLOSES), so each named mutation fails at its own.
test.describe('InfoTip — one tap, on screen', () => {
  test('the Support policy ⓘ on Decision: one tap opens it inside the gutters at 390, 375 and 481; the tap, Escape, outside and mouse rules', async ({ page }) => {
    // Reduced motion is the harder case: the global rule gives every element an 80ms transition, and without the
    // panel's `transition-property: none` a re-place after a resize measures a transition that has only just started.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(/blockchain\.info/, (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] }),
    }));
    await seedAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    await expect(page.getByRole('region', { name: "The support policy's move this month" })).toBeVisible({ timeout: 8000 });

    const trigger = page.getByRole('button', { name: 'About the support policy' });
    const card = trigger.locator('xpath=ancestor::section[1]');
    // Scoped to the card: DemoBanner is the only other role="note", and a demo dev server would render it.
    const note = card.getByRole('note');
    // The card's top padding, clear of its rounded corner. hover() scrolls and hit-checks.
    const away = () => card.hover({ position: { x: 40, y: 4 } });
    // Two frames: long enough for React to render a continuous-priority update (a pointer enter or leave).
    const settle = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    // Layout snaps to 1/64px; this absorbs a sub-pixel, never a mis-placement (the mutants miss by 6–107px).
    const SUBPX = 0.5;
    const fit = async (): Promise<string> => {
      const w = page.viewportSize()!.width;
      const b = await note.boundingBox({ timeout: 1000 }).catch(() => null);
      if (!b) return `no panel at ${w}`;
      const inside = b.x >= 16 - SUBPX && b.x + b.width <= w - 16 + SUBPX;
      return inside ? 'inside' : `${Math.round(b.x)}..${Math.round(b.x + b.width)} at ${w}`;
    };
    /** A pointer entering the ⓘ from outside, dispatched the way a browser sends it: the bubbling over event on the
     *  trigger, then the non-bubbling enter event on the wrap and on the trigger. 'compat-mouse' is what a touch tap sends
     *  after pointerup. 50ms later — React renders a continuous-priority update in a scheduler task — what does the tip
     *  show? It proves the component's decision, not a browser's (the Z6 precedent). */
    const enterAs = (kind: 'compat-mouse' | 'touch' | 'mouse') => trigger.evaluate(async (btn, k) => {
      const wrap = btn.parentElement!;
      const make = (type: string, bubbles: boolean): Event => (k === 'compat-mouse'
        ? new MouseEvent(type, { bubbles })
        : new PointerEvent(type, { bubbles, pointerType: k }));
      const [over, enter] = k === 'compat-mouse' ? ['mouseover', 'mouseenter'] : ['pointerover', 'pointerenter'];
      btn.dispatchEvent(make(over, true));
      wrap.dispatchEvent(make(enter, false));
      btn.dispatchEvent(make(enter, false));
      await new Promise((r) => setTimeout(r, 50));
      return { expanded: btn.getAttribute('aria-expanded'), notes: wrap.querySelectorAll('[role="note"]').length };
    }, kind);

    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger, 'PREMISE').toHaveAttribute('aria-expanded', 'false');
    await expect(note, 'PREMISE').toHaveCount(0);

    // TAP — ONE tap opens it (I3: a mouseenter-open plus a click toggle shut it in the same tap).
    await trigger.tap();
    await expect(trigger, 'TAP').toHaveAttribute('aria-expanded', 'true');
    await expect(note, 'TAP').toHaveCount(1);

    // FIT — inside [16, w − 16] at each width. The tip stays open across the resizes, so this proves the re-place too.
    for (const width of [390, 375, 481]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(fit, { message: `FIT@${width}` }).toBe('inside');
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // TAP2 — a second tap on the ⓘ closes it.
    await trigger.tap();
    await expect(trigger, 'TAP2').toHaveAttribute('aria-expanded', 'false');
    await expect(note, 'TAP2').toHaveCount(0);

    // COMPAT — only a mouse pointer's hover opens it: a tap's compat mouse events and a touch pointer entering open
    // nothing. The mouse row is the positive control, so the other two can't pass vacuously.
    expect(await enterAs('compat-mouse'), 'COMPAT-MOUSE').toEqual({ expanded: 'false', notes: 0 });
    expect(await enterAs('touch'), 'COMPAT-TOUCH').toEqual({ expanded: 'false', notes: 0 });
    expect(await enterAs('mouse'), 'COMPAT-CONTROL').toEqual({ expanded: 'true', notes: 1 });

    // ESCAPE — closes it.
    await page.keyboard.press('Escape');
    await expect(trigger, 'ESCAPE').toHaveAttribute('aria-expanded', 'false');
    await expect(note, 'ESCAPE').toHaveCount(0);

    // OUTSIDE — a tap outside closes it.
    await trigger.tap();
    await expect(trigger, 'OUTSIDE').toHaveAttribute('aria-expanded', 'true');
    await card.tap({ position: { x: 40, y: 4 } });
    await expect(trigger, 'OUTSIDE').toHaveAttribute('aria-expanded', 'false');
    await expect(note, 'OUTSIDE').toHaveCount(0);

    // The mouse. The move to the padding first makes the hover a real boundary crossing, whatever a tap left behind.
    await away();
    await trigger.hover();
    await expect(trigger, 'HOVER').toHaveAttribute('aria-expanded', 'true');
    await away();
    await expect(trigger, 'HOVER-AWAY').toHaveAttribute('aria-expanded', 'false');
    await trigger.hover();
    await trigger.click();
    await settle();
    await expect(trigger, 'CLICK-KEEPS').toHaveAttribute('aria-expanded', 'true');
    await away();
    await settle();
    await expect(trigger, 'AWAY-KEEPS').toHaveAttribute('aria-expanded', 'true');
    await trigger.click();
    await expect(trigger, 'CLICK-CLOSES').toHaveAttribute('aria-expanded', 'false');
    await expect(note, 'CLICK-CLOSES').toHaveCount(0);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});

// Policy v2, Run B — Coinbase's seizure price on screen: THE MOVE's cliff and price alert, the policy card's cliff line,
// and the "Coinbase seizes" series on the three parent faces' charts. $50,000 on 1 ₿ at a manual $100,000 — round
// synthetic figures; THE MOVE's are date-independent (no accrual, no poll; the pool stays 1 ₿, since its keep at support
// is larger).
test.describe('Policy v2 Run B — the cliff on screen', () => {
  const MOVE_TITLE = "The support policy's move this month";
  const CLIFF = /^Coinbase seizes at \$[\d,]+ — (?:\d+%|less than 1%|more than 99%) below the price at month 1$/;
  const SEIZES = 'path.recharts-line-curve[stroke="var(--red)"][stroke-dasharray="1 3"]';
  const hermetic = async (page: Page): Promise<void> => {
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
    await page.route(/blockchain\.info/, (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] }),
    }));
  };
  const insidePhone = async (l: Locator, tag: string): Promise<void> => {
    const b = (await l.boundingBox())!;
    expect(b.x, `${tag}: left edge`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${tag}: right edge`).toBeLessThanOrEqual(390);
  };

  test('Decision: THE MOVE names the cliff and the price alert; the policy card names the cliff', async ({ page }) => {
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◆ Decision/ }).click();
    const move = page.getByRole('region', { name: MOVE_TITLE });
    await expect(move).toBeVisible({ timeout: 8000 });
    const cliff = move.getByText('Coinbase seizes this loan at $58,140 — 42% below today.', { exact: true });
    await expect(cliff, 'MOVE-CLIFF').toBeVisible();
    const alert = move.getByText('Set a price alert at $66,667 in your exchange app — Coinbase reaches your 75% trigger '
      + 'there. On the day, work from the Emergency Console (it runs when your Coinbase strategy is LTV-triggered).', { exact: true });
    await expect(alert, 'MOVE-ALERT').toBeVisible();
    const card = page.getByText(CLIFF);
    await expect(card, 'CARD-CLIFF').toHaveCount(1);
    await card.scrollIntoViewIfNeeded();
    await expect(card, 'CARD-CLIFF').toBeVisible();
    await insidePhone(cliff, 'MOVE-CLIFF');
    await insidePhone(alert, 'MOVE-ALERT');
    await insidePhone(card, 'CARD-CLIFF');
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('the three charts draw "Coinbase seizes" — red, dotted, in the Decision chart\'s style', async ({ page }) => {
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByLabel('Almanac').click();
    // Cycling — the BTC price path card.
    await page.getByRole('button', { name: /♻ Cycling/ }).click();
    const pricePath = page.locator('section', { hasText: 'BTC price path' });
    await pricePath.scrollIntoViewIfNeeded();
    await expect(pricePath.locator(SEIZES), 'CYCLING').toHaveCount(1);
    expect(await pricePath.locator(SEIZES).getAttribute('d'), 'CYCLING d').toBeTruthy();
    // Ownership and Strategy — the Price & liq chart.
    for (const face of [/⚖ Ownership/, /◈ Strategy/]) {
      await page.getByRole('button', { name: face }).click();
      await page.getByRole('button', { name: 'Price & liq' }).click();
      const line = page.locator(SEIZES);
      await expect(line, String(face)).toHaveCount(1);
      expect(await line.getAttribute('d'), `${String(face)} d`).toBeTruthy();
    }
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});
