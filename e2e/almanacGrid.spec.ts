import { test, expect, type Page } from '@playwright/test';
import { seedLoanAndGoto, openAlmanacSimple, openAlmanacFace, mouseDragX, STORE_VERSION } from './helpers';

/**
 * The Almanac's grid (BL40, BL45 — the owner's pick B), on screen: the groups and their order, the gates, a tile opening
 * its face and "← Almanac" bringing the grid back with the face just left ringed, the edge swipe one level at a time, the
 * plan's link opening the Decision face with one tap or one swipe back to where it came from, full mode, and a narrow
 * phone. Every test that opens a plan face aborts live prices and stubs the price history; SWIPE and GATED's first page
 * stay on the grid and the Halving Clock, on the plain seed, as navigation.spec's tests do. Each assertion carries the
 * tag its planted bug turns red.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
async function hermetic(page: Page): Promise<void> {
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
}
const LOAN = `hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1, btcPriceMode: 'manual', btcPrice: 100000`;
/** A seed in simple or full mode, with the loan; `extra` adds fields. */
const seed = (simple: boolean, extra = ''): string => `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, simpleMode: ${simple}, simpleView: 'daily', ${LOAN}${extra} },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

const grid = (page: Page) => page.getByRole('navigation', { name: 'Faces' });
const tilesOf = (page: Page, group: string): Promise<string[]> => page.getByRole('region', { name: group }).getByRole('button').allTextContents();
const MOVE_TITLE = "The support policy's move this month";
/** THIS MONTH's link to the Decision face (planMonthView's PLAN_PATHS_LINK — Playwright can't import src/). */
const LINK = "Your plan on other price paths — the Almanac's Decision face →";
const BITCOIN = ['Halving Clock', 'Cycle Clock', 'Power Law', 'Mining', 'Sats'];
/** Each tile's box, in the grid's order: [left, top]. */
const boxes = (page: Page): Promise<number[][]> => grid(page).getByRole('button').evaluateAll((bs) => bs.map((b) => {
  const r = b.getBoundingClientRect();
  return [Math.round(r.left), Math.round(r.top)];
}));
/** The tiles ringed as the face just left. */
const ringed = (page: Page): Promise<(string | null)[]> => grid(page).getByRole('button').evaluateAll((bs) =>
  bs.filter((b) => /tileLast/.test(b.className)).map((b) => b.textContent));

test.describe('the Almanac grid (BL45)', () => {
  test('⭐ GRID — the Almanac opens on its grid: your plan\'s faces, then bitcoin\'s, three to a row, each its own icon; no face mounts', async ({ page }) => {
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByLabel('Almanac').click();
    await expect(grid(page), 'GRID').toBeVisible();
    expect(await grid(page).getByRole('heading').allTextContents(), 'GRID the groups').toEqual(['Your plan', 'Bitcoin']);
    expect(await tilesOf(page, 'Your plan'), 'GRID your plan').toEqual(['Decision', 'Strategy', 'Ownership', 'Cycling', 'Scenario', 'Emergency', 'FIRE']);
    expect(await tilesOf(page, 'Bitcoin'), 'GRID bitcoin').toEqual(BITCOIN);
    // Three to a row on a 390px phone: the first three share a top, the fourth starts the next row under the first.
    const b = await boxes(page);
    expect(new Set(b.slice(0, 3).map((x) => x[1])).size, 'GRID three to a row').toBe(1);
    expect([b[3][0], b[3][1] > b[0][1]], 'GRID the fourth starts a row').toEqual([b[0][0], true]);
    // ICONS — every tile draws its own: none blank, no two alike (the pills' ₿ and ⚖ were shared).
    const svgs = await grid(page).getByRole('button').evaluateAll((bs) => bs.map((x) => x.querySelector('svg')?.innerHTML ?? ''));
    expect(svgs.filter((s) => s === ''), 'ICONS none blank').toEqual([]);
    expect(new Set(svgs).size, 'ICONS no two alike').toBe(svgs.length);
    // Nothing mounts on the grid: no face, and no way back to itself.
    await expect(page.getByText('Next halving'), 'GRID no face').toHaveCount(0);
    await expect(page.getByText(MOVE_TITLE), 'GRID no face').toHaveCount(0);
    await expect(page.getByRole('button', { name: '← Almanac' }), 'GRID no way back to itself').toHaveCount(0);
  });

  test('⭐ GATED — no loan: its three faces are absent; a logged month brings the Ledger in, between Cycling and Scenario', async ({ page, browser, baseURL }) => {
    await openAlmanacSimple(page);   // the plain seed: no loan, nothing logged
    expect(await tilesOf(page, 'Your plan'), 'GATED no loan, no log').toEqual(['Decision', 'Ownership', 'Scenario', 'FIRE']);
    expect(await tilesOf(page, 'Bitcoin'), 'GATED bitcoin, always').toEqual(BITCOIN);
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    try {
      const p = await ctx.newPage();
      await hermetic(p);
      await p.addInitScript(seed(true, `, advisorStartDate: '2026-10-01', monthBucketReconcileDone: true,
        monthlyLog: [{ month: 1, date: '2026-10-05', btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
          loggedAt: 1, updatedAt: 1, expensesActual: 500, source: 'daily', confirmed: false }]`));
      await p.goto('/');
      await expect(p.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
      await p.getByLabel('Almanac').click();
      expect(await tilesOf(p, 'Your plan'), 'GATED the loan and a log').toEqual(
        ['Decision', 'Strategy', 'Ownership', 'Cycling', 'Ledger', 'Scenario', 'Emergency', 'FIRE']);
    } finally {
      await ctx.close();
    }
  });

  test('⭐ OPEN — a tile opens its face in place of the grid; ← Almanac brings the grid back, the face just left ringed', async ({ page }) => {
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByLabel('Almanac').click();
    await openAlmanacFace(page, 'Decision');
    await expect(page.getByText(MOVE_TITLE).first(), 'OPEN the face').toBeVisible({ timeout: 15_000 });
    await expect(grid(page), 'OPEN the grid gives way').toHaveCount(0);
    await page.getByRole('button', { name: '← Almanac' }).click();
    await expect(grid(page), 'BACK the grid').toBeVisible();
    await expect(page.getByText(MOVE_TITLE), 'BACK the face unmounts').toHaveCount(0);
    expect(await ringed(page), 'RING the face just left').toEqual(['Decision']);
    const border = (name: string) => grid(page).getByRole('button', { name, exact: true }).evaluate((x) => getComputedStyle(x).borderTopColor);
    expect(await border('Decision'), 'RING drawn — unlike its neighbour').not.toBe(await border('Strategy'));
    await openAlmanacFace(page, 'Halving Clock');
    await expect(page.getByText('Next halving').first(), 'OPEN another').toBeVisible();
    await page.getByRole('button', { name: '← Almanac' }).click();
    expect(await ringed(page), 'RING moves with the face left').toEqual(['Halving Clock']);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('⭐ SWIPE — from a face the edge swipe goes to the grid; from the grid, out to the journal', async ({ page }) => {
    await openAlmanacSimple(page);
    await openAlmanacFace(page, 'Halving Clock');
    await expect(page.getByText('Next halving').first()).toBeVisible();
    const h = page.viewportSize()!.height / 2;
    await mouseDragX(page, 8, h, 234);
    await expect(grid(page), 'SWIPE a face → the grid').toBeVisible();
    await expect(page.getByTestId('edge-back-zone'), 'SWIPE still in the Almanac').toBeVisible();
    await expect(page.getByLabel('Log an event'), 'SWIPE not out yet').toHaveCount(0);
    expect(await ringed(page), 'SWIPE rings the face left, as ← Almanac does').toEqual(['Halving Clock']);
    await mouseDragX(page, 8, h, 234);
    await expect(page.getByLabel('Log an event'), 'SWIPE the grid → out').toBeVisible();
  });

  test('⭐ LINK — the plan\'s link opens the Decision face; ← Back or one swipe returns to THIS MONTH; ← Almanac goes to the grid', async ({ page }) => {
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByRole('tab', { name: 'Monthly' }).click();
    const link = page.getByRole('button', { name: LINK });
    const h = page.viewportSize()!.height / 2;
    await link.click();
    await expect(page.getByText(MOVE_TITLE).first(), 'LINK the Decision face').toBeVisible({ timeout: 15_000 });
    await expect(grid(page), 'LINK straight to the face').toHaveCount(0);
    // ← Back: one tap to THIS MONTH, as before the grid.
    await page.getByRole('button', { name: '← Back' }).click();
    await expect(link, 'LINK ← Back, one tap').toBeVisible();
    // One swipe too — a face the link opened swipes straight back out.
    await link.click();
    await expect(page.getByText(MOVE_TITLE).first()).toBeVisible({ timeout: 15_000 });
    await mouseDragX(page, 8, h, 234);
    await expect(link, 'LINK one swipe').toBeVisible();
    // ← Almanac goes to the grid; from there the swipe leaves.
    await link.click();
    await page.getByRole('button', { name: '← Almanac' }).click();
    await expect(grid(page), 'LINK ← Almanac, the grid').toBeVisible();
    await mouseDragX(page, 8, h, 234);
    await expect(link, 'LINK the grid, then out').toBeVisible();
  });

  test('⭐ INSIDE — from the link\'s face, a tap to another face moves inside the hub: the swipe then goes to the grid', async ({ page }) => {
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await page.getByRole('button', { name: LINK }).click();
    await page.getByRole('button', { name: '♻ Cycling', exact: true }).click();
    await expect(page.getByText('Draw on Strike, refinance to Coinbase, never sell.', { exact: true }), 'INSIDE the Cycling face').toBeVisible({ timeout: 8000 });
    await mouseDragX(page, 8, page.viewportSize()!.height / 2, 234);
    await expect(grid(page), 'INSIDE the swipe goes to the grid').toBeVisible();
    expect(await ringed(page), 'INSIDE the face left').toEqual(['Cycling']);
  });

  test('⭐ FULL — full mode on a computer: Tools → Almanac opens the grid, five to a row; a tile opens its face; ← Almanac returns', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    try {
      const page = await ctx.newPage();
      await hermetic(page);
      await page.addInitScript(seed(false));
      await page.goto('/');
      const tools = page.getByRole('button', { name: /^Tools/ });
      await expect(tools).toBeVisible({ timeout: 15_000 });
      await tools.click();
      await page.getByRole('button', { name: 'Almanac', exact: true }).click();
      await expect(grid(page), 'FULL the grid').toBeVisible();
      const b = await boxes(page);
      expect(new Set(b.slice(0, 5).map((x) => x[1])).size, 'FULL five to a row').toBe(1);
      expect(b[5][1], 'FULL the sixth starts a row').toBeGreaterThan(b[0][1]);
      await openAlmanacFace(page, 'Ownership');
      await expect(page.getByText('Held · owed · yours — never sell.', { exact: true }), 'FULL the face').toBeVisible({ timeout: 8000 });
      await page.getByRole('button', { name: '← Almanac' }).click();
      await expect(grid(page), 'FULL back to the grid').toBeVisible();
      expect(await ringed(page), 'FULL the ring').toEqual(['Ownership']);
    } finally {
      await ctx.close();
    }
  });

  test('⭐ NARROW — two to a row on a 320px phone, three from 360; no name breaks inside a word, none runs out of its tile', async ({ browser, baseURL }) => {
    for (const [w, cols] of [[320, 2], [360, 3], [390, 3]] as const) {
      const ctx = await browser.newContext({ baseURL, viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      try {
        const page = await ctx.newPage();
        await hermetic(page);
        await page.addInitScript(seed(true));
        await page.goto('/');
        await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
        await page.getByLabel('Almanac').click();
        await expect(grid(page)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const b = await boxes(page);
        expect(new Set(b.slice(0, 7).map((x) => x[0])).size, `NARROW ${w}: ${cols} to a row`).toBe(cols);
        const bad = await grid(page).getByRole('button').evaluateAll((bs) => bs.flatMap((x) => {
          const name = x.querySelector('span')!;
          const lines = Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight));
          const words = (name.textContent ?? '').split(' ').length;
          return lines > words || name.scrollWidth > name.clientWidth + 0.5 ? [name.textContent] : [];
        }));
        expect(bad, `NARROW ${w}: every name whole, inside its tile`).toEqual([]);
      } finally {
        await ctx.close();
      }
    }
  });
});
