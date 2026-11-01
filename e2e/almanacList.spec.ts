import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { headerBack, mouseDragX, STORE_VERSION } from './helpers';

/**
 * The Almanac on a computer (BL46's A — the owner's pick), on screen: from 1200 px the faces are a list at the left and
 * the open face beside it — one click between faces, no grid page, no step back — and a narrower window keeps the grid
 * (BL45). The list opens on Decision, then on the face last open in the session; the header's "Almanac" is a plain name
 * there, and the edge swipe leaves in one stroke; the list stays in view while a face scrolls; the live-height switch
 * sits under the list's Bitcoin heading; every face keeps its full width beside the list and the plan faces' control bar
 * its one line, in simple and full mode alike; crossing 1200 px keeps the open face.
 * Every test aborts live prices and stubs the price history. Each assertion carries the tag its planted bug turns red.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
async function hermetic(page: Page): Promise<void> {
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
}
const LOAN = `hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1, btcPriceMode: 'manual', btcPrice: 100000`;
/** A logged month, so the Ledger's tile shows too — all thirteen faces. Round synthetic figures. */
const LOG = `, advisorStartDate: '2026-10-01', monthBucketReconcileDone: true,
  monthlyLog: [{ month: 1, date: '2026-10-05', btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0,
    loggedAt: 1, updatedAt: 1, expensesActual: 500, source: 'daily', confirmed: false }]`;
const seed = (simple: boolean, loan: boolean): string => `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, simpleMode: ${simple}, simpleView: 'daily', ${loan ? LOAN + LOG : 'hasCbLoan: false'} },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

const PLAN = ['Decision', 'Strategy', 'Ownership', 'Cycling', 'Ledger', 'Scenario', 'Emergency', 'FIRE'];
const BITCOIN = ['Halving Clock', 'Cycle Clock', 'Power Law', 'Mining', 'Sats'];
const MOVE_TITLE = "The support policy's move this month";
const OWNERSHIP = 'Held · owed · yours — never sell.';
const CYCLING = 'Draw on Strike, refinance to Coinbase, never sell.';

/** The faces' navigation — the list on a computer, the grid below 1200 px. */
const faces = (page: Page) => page.getByRole('navigation', { name: 'Faces' });
/** The list's face buttons, and the grid's tiles (neither matches the other, nor the live-height badge). */
const items = (page: Page): Locator => faces(page).locator('button[class*="listItem"]');
const tiles = (page: Page): Locator => faces(page).locator('button[class*="tile"]');
/** The face marked open in the list. */
const current = (page: Page): Locator => faces(page).locator('button[aria-current="page"]');
const item = (page: Page, name: string): Locator => faces(page).getByRole('button', { name, exact: true });
/** The header's "Almanac" as a link (simple mode on a phone's face), or full mode's eyebrow link. */
const titleLink = (page: Page) => page.getByRole('button', { name: 'Almanac', exact: true });
const badge = (page: Page) => page.getByRole('button', { name: /^Live block height/ });
const box = (l: Locator) => l.evaluate((x) => { const r = x.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; });
/** The app scrolls <body>, never the window (as `controlDock.spec.ts`). */
const scrollBody = (page: Page, y: number) => page.evaluate((v) => { document.body.scrollTop = v; }, y);

/** A computer: a desktop context `w` wide, seeded with the loan and a logged month (or neither), on the Almanac. */
async function onAlmanac(browser: Browser, baseURL: string | undefined, w: number, simple: boolean, loan = true): Promise<{ page: Page; done: () => Promise<void> }> {
  const ctx = await browser.newContext({ baseURL, viewport: { width: w, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await hermetic(page);
  await page.addInitScript(seed(simple, loan));
  await page.goto('/');
  if (simple) {
    await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Almanac').click();
  } else {
    const tools = page.getByRole('button', { name: /^Tools/ });
    await expect(tools).toBeVisible({ timeout: 15_000 });
    await tools.click();
    await page.getByRole('button', { name: 'Almanac', exact: true }).click();
  }
  await expect(faces(page)).toBeVisible({ timeout: 15_000 });
  return { page, done: () => ctx.close() };
}

test.describe('the Almanac on a computer (BL46)', () => {
  test('⭐ LIST — from 1200 px the faces are a list beside the open face: the grid\'s faces in its order, Decision first and marked, no grid page; the header\'s "Almanac" a plain name; its "←" still leaves', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, true);
    try {
      expect(await items(page).allTextContents(), 'LIST the grid\'s faces, in its order').toEqual([...PLAN, ...BITCOIN]);
      await expect(tiles(page), 'LIST no grid page').toHaveCount(0);
      await expect(current(page), 'LIST Decision first, marked').toHaveText('Decision');
      const move = page.getByText(MOVE_TITLE, { exact: true });
      await expect(move, 'LIST its face beside it').toBeVisible({ timeout: 8000 });
      expect((await box(move)).left, 'LIST beside, not under').toBeGreaterThan((await box(faces(page))).right);
      await expect(titleLink(page), 'LIST no link to a grid').toHaveCount(0);
      await expect(page.getByText('Almanac', { exact: true }), 'LIST the header names the hub').toBeVisible();
      await headerBack(page).click();
      await expect(page.getByLabel('Log an event'), 'LIST the way out').toBeVisible();
    } finally {
      await done();
    }
  });

  test('⭐ ONE CLICK — a click on another face opens it in place; the list stays, the new face marked', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, true);
    try {
      await item(page, 'Ownership').click();
      await expect(page.getByText(OWNERSHIP, { exact: true }), 'ONE CLICK the face').toBeVisible({ timeout: 8000 });
      await expect(current(page), 'ONE CLICK marked').toHaveText('Ownership');
      await item(page, 'Halving Clock').click();
      await expect(page.getByText('Next halving'), 'ONE CLICK a bitcoin face').toBeVisible();
      await expect(page.getByText(OWNERSHIP, { exact: true }), 'ONE CLICK one face at a time').toHaveCount(0);
      await expect(current(page), 'ONE CLICK marked again').toHaveText('Halving Clock');
      await expect(items(page), 'ONE CLICK the list stays').toHaveCount(13);
      await expect(tiles(page), 'ONE CLICK no grid page').toHaveCount(0);
    } finally {
      await done();
    }
  });

  test('⭐ GATED — no loan and no logged month: the list offers the grid\'s faces for that plan, no more', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, true, false);
    try {
      const shut = ['Strategy', 'Cycling', 'Ledger', 'Emergency'];
      expect(await items(page).allTextContents(), 'GATED the gates\' faces absent').toEqual([...PLAN.filter((f) => !shut.includes(f)), ...BITCOIN]);
      await expect(current(page), 'GATED Decision, ungated').toHaveText('Decision');
    } finally {
      await done();
    }
  });

  test('⭐ SWIPE — the edge swipe from a face leaves the Almanac in one stroke: there is no grid to go back to', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, true);
    try {
      await item(page, 'Halving Clock').click();
      await expect(page.getByText('Next halving').first(), 'SWIPE the face').toBeVisible();
      await mouseDragX(page, 8, 450, 234);
      await expect(page.getByLabel('Log an event'), 'SWIPE one stroke, out').toBeVisible();
    } finally {
      await done();
    }
  });

  test('⭐ STAY — the list stays in view while a long face scrolls, at the window\'s top (the header scrolls away)', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, true);
    try {
      await expect(page.getByText(MOVE_TITLE, { exact: true }), 'STAY a face open').toBeVisible({ timeout: 8000 });
      await scrollBody(page, 1500);
      await expect.poll(() => page.evaluate(() => document.body.scrollTop), 'STAY the face scrolled').toBeGreaterThan(1000);
      const l = await box(faces(page));
      expect(l.top, 'STAY in view').toBeGreaterThanOrEqual(0);
      expect(l.top, 'STAY at the top').toBeLessThanOrEqual(13);
      await item(page, 'Ownership').click();
      await expect(current(page), 'STAY a click from anywhere on the face').toHaveText('Ownership');
    } finally {
      await done();
    }
  });

  test('⭐ AGAIN — leaving and coming back opens the face last open; a reload forgets it (Decision)', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, true);
    try {
      await item(page, 'Cycle Clock').click();
      await expect(page.getByText('Open Halving Clock'), 'AGAIN the face').toBeVisible();
      await headerBack(page).click();
      await expect(page.getByLabel('Log an event')).toBeVisible();
      await page.getByLabel('Almanac').click();
      await expect(current(page), 'AGAIN the face last open').toHaveText('Cycle Clock');
      await expect(page.getByText('Open Halving Clock'), 'AGAIN its face').toBeVisible();
      await page.reload();
      await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
      await page.getByLabel('Almanac').click();
      await expect(current(page), 'AGAIN nothing kept: Decision').toHaveText('Decision');
    } finally {
      await done();
    }
  });

  test('⭐ EDGE — 1199 px keeps the grid, 1200 px the list; crossing it keeps the open face, the same element', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1199, true);
    try {
      await expect(tiles(page), 'EDGE the grid at 1199').toHaveCount(13);
      await expect(items(page), 'EDGE no list at 1199').toHaveCount(0);
      await page.setViewportSize({ width: 1200, height: 900 });
      await expect(items(page), 'EDGE the list at 1200').toHaveCount(13);
      await expect(current(page), 'EDGE Decision first').toHaveText('Decision');
      await expect(page.getByText(MOVE_TITLE, { exact: true })).toBeVisible({ timeout: 8000 });
      await page.setViewportSize({ width: 1199, height: 900 });
      await expect(page.getByText(MOVE_TITLE, { exact: true }), 'EDGE the list\'s face stays open').toBeVisible();
      await expect(tiles(page), 'EDGE no grid page over it').toHaveCount(0);
      await page.setViewportSize({ width: 1200, height: 900 });
      await item(page, 'Cycling').click();
      const framing = page.getByText(CYCLING, { exact: true });
      await expect(framing).toBeVisible({ timeout: 8000 });
      await framing.evaluate((x) => { (x as HTMLElement & { kept?: string }).kept = 'yes'; });
      await page.setViewportSize({ width: 1199, height: 900 });
      await expect(items(page), 'EDGE back to the grid\'s side').toHaveCount(0);
      expect(await framing.evaluate((x) => (x as HTMLElement & { kept?: string }).kept), 'EDGE the same face, not remounted').toBe('yes');
      await expect(titleLink(page), 'EDGE the header\'s link again').toBeVisible();
      await page.setViewportSize({ width: 1200, height: 900 });
      expect(await framing.evaluate((x) => (x as HTMLElement & { kept?: string }).kept), 'EDGE and back').toBe('yes');
      await expect(current(page), 'EDGE still marked').toHaveText('Cycling');
    } finally {
      await done();
    }
  });

  test('⭐ FULL — full mode: the list under the tab bar names the hub, opens on Decision, one click between faces; the live-height switch under Bitcoin', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, false);
    try {
      await expect(faces(page).getByText('Almanac', { exact: true }), 'FULL the list names the hub').toBeVisible();
      await expect(titleLink(page), 'FULL no link to a grid').toHaveCount(0);
      await expect(current(page), 'FULL Decision first').toHaveText('Decision');
      await item(page, 'Ownership').click();
      await expect(page.getByText(OWNERSHIP, { exact: true }), 'FULL one click').toBeVisible({ timeout: 8000 });
      await expect(faces(page).getByRole('region', { name: 'Bitcoin' }).getByRole('button', { name: /^Live block height/ }), 'FULL the switch').toHaveCount(1);
      expect((await box(faces(page))).top, 'FULL under the tab bar').toBeGreaterThanOrEqual(40);
      await scrollBody(page, 1500);
      await expect.poll(() => page.evaluate(() => document.body.scrollTop), 'FULL the face scrolled').toBeGreaterThan(1000);
      const l = await box(faces(page));
      expect(l.top, 'FULL the list stays, under the tab bar').toBeGreaterThanOrEqual(40);
      expect(l.top, 'FULL the list stays in view').toBeLessThanOrEqual(53);
    } finally {
      await done();
    }
  });

  test('⭐ BADGE — the live-height switch under the list\'s Bitcoin heading, over its first face, inside the list', async ({ browser, baseURL }) => {
    const { page, done } = await onAlmanac(browser, baseURL, 1280, true);
    try {
      const heading = faces(page).getByRole('heading', { name: 'Bitcoin' });
      const sw = faces(page).getByRole('region', { name: 'Bitcoin' }).getByRole('button', { name: /^Live block height/ });
      await expect(badge(page), 'BADGE once').toHaveCount(1);
      const [h, b, first, list] = [await box(heading), await box(sw), await box(item(page, 'Halving Clock')), await box(faces(page))];
      expect(b.top, 'BADGE under the heading').toBeGreaterThanOrEqual(h.bottom - 0.5);
      expect(b.bottom, 'BADGE over the first face').toBeLessThanOrEqual(first.top + 0.5);
      expect(b.right, 'BADGE inside the list').toBeLessThanOrEqual(list.right + 0.5);
    } finally {
      await done();
    }
  });

  for (const simple of [true, false]) {
    test(`⭐ FIT — at 1200 px, ${simple ? 'simple' : 'full'} mode: every face beside the list keeps its own width, nothing scrolls sideways; the plan faces' bar keeps each head on one line, over the face`, async ({ browser, baseURL }) => {
      test.setTimeout(150_000);
      const { page, done } = await onAlmanac(browser, baseURL, 1200, simple);
      const at = simple ? 'simple' : 'full';
      let bars = 0;
      try {
        for (const name of [...PLAN, ...BITCOIN]) {
          await item(page, name).click();
          await expect(current(page), `FIT ${at} ${name}: marked`).toHaveText(name);
          const root = page.locator('[class*="_pane_"] > *').first();
          await expect(root).toBeVisible({ timeout: 8000 });
          await page.waitForTimeout(400);
          const fit = await root.evaluate((el) => {
            const pane = el.parentElement!.getBoundingClientRect().width;
            const max = parseFloat(getComputedStyle(el).maxWidth);
            const de = document.documentElement;
            return { pane, width: el.getBoundingClientRect().width, want: Math.min(Number.isNaN(max) ? Infinity : max, pane), sideways: de.scrollWidth - de.clientWidth };
          });
          // The pane holds a plan face's 960 px; each face takes its own width in it (Mining and Sats, two columns up to
          // 1240 px, fill it — as in any window under 1240 without the list).
          expect(fit.pane, `FIT ${at} ${name}: room for 960 px`).toBeGreaterThanOrEqual(960);
          expect(fit.width, `FIT ${at} ${name}: its own width`).toBeGreaterThanOrEqual(fit.want - 1);
          expect(fit.sideways, `FIT ${at} ${name}: nothing sideways`).toBeLessThanOrEqual(0);
          const dock = page.getByRole('region', { name: 'Controls' });
          if (await dock.count()) {
            const heads = dock.getByText(/^(Inspect month|Price stress)$/);
            const n = await heads.count();
            for (let i = 0; i < n; i++) {
              expect((await heads.nth(i).locator('..').boundingBox())!.height, `BAR ${at} ${name}: one line`).toBeLessThan(24);
            }
            if (n === 2) bars++;
            const [d, r] = [await box(dock), await box(root)];
            expect(d.left, `BAR ${at} ${name}: over the face`).toBeGreaterThanOrEqual(r.left - 0.5);
            expect(d.right, `BAR ${at} ${name}: over the face`).toBeLessThanOrEqual(r.right + 0.5);
          }
        }
        expect(bars, `BAR ${at}: the plan faces' bars measured (non-vacuous)`).toBeGreaterThanOrEqual(4);
      } finally {
        await done();
      }
    });
  }
});
