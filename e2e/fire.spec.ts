import { test, expect, type Page, type Locator } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * The FIRE face (batch 1 build 4 — the sell lane). Hermetic and date-proof: Playwright's clock fixed at 12 Oct 2026, the
 * spot price aborted (a manual $100,000 is seeded), and the price history stubbed with a synthetic one — round invented
 * prices on real dates, a top inside each cycle's window (no price series is committed, D-2). Every word asserted here was
 * worked out first from the face's own view on this seed, this clock and this stub (fireFaceView — Playwright can't import
 * src/). Every assertion carries its tag; each planted bug in build-4-mutations.json with an e2e turns its own tag red.
 */

/** The history the face reads: each era flat under its cycle's invented top, the top mid-window, its fall and recovery. */
function stubHistory(): { values: { x: number; y: number }[] } {
  const DAY = 86_400_000;
  const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const tops: [string, number, number][] = [['2013-12-04', 1000, 400], ['2017-12-15', 20_000, 6000], ['2021-11-10', 60_000, 20_000]];
  const values: { x: number; y: number }[] = [];
  for (let t = utc('2012-01-01'); t <= utc('2025-06-30'); t += DAY) {
    let p = t < utc('2016-01-01') ? 300 : t < utc('2020-01-01') ? 5000 : 15_000;
    for (const [iso, top, low] of tops) {
      const t0 = utc(iso);
      if (t === t0) p = top;
      else if (t > t0 && t < t0 + 900 * DAY) {
        const k = (t - t0) / (900 * DAY);
        p = k < 1 / 3 ? top - (top - low) * k * 3 : low + (top * 1.1 - low) * ((k - 1 / 3) * 1.5);
      }
    }
    values.push({ x: t / 1000, y: Math.round(p * 100) / 100 });
  }
  return { values };
}
const HISTORY = JSON.stringify(stubHistory());

/** Seeded ONCE a tab: addInitScript runs again on every reload, and PERSIST reloads — an unguarded seed would wipe what
 *  was typed. 2 ₿ on Strike, nothing owed, a manual $100,000; the store's own $4,000 income and $3,500 expenses. */
const SEED = `
  window.__APP_BOOTED = true;
  if (!sessionStorage.getItem('e2e-fire-seeded')) {
    sessionStorage.setItem('e2e-fire-seeded', '1');
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: { onboardingComplete: true, simpleMode: true, simpleView: 'daily', btcPriceMode: 'manual', btcPrice: 100000, strikeCollateralBtc: 2 },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  }
`;

// fireFaceView's words (Playwright can't import src/).
const FRAMING = 'How many years of spending your bitcoin covers if you sell it to live, on the price path you pick.';
const END = 'Sep 2046';   // month 239 from Oct 2026 — the horizon's last month
const FAILED = 'The price history didn\'t load, so there are no replays and no capacity this visit.';
const OFFLINE = 'Offline — the replays need the price history, which isn\'t kept on this device.';

async function start(page: Page, history: 'stub' | 'fail' = 'stub'): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => (history === 'stub'
    ? r.fulfill({ contentType: 'application/json', body: HISTORY })
    : r.fulfill({ status: 500, body: '' })));
  await page.addInitScript(SEED);
  await page.goto('/');
  await expect(page.getByLabel('Log an event'), 'the seed reached Daily').toBeVisible({ timeout: 15_000 });
}
async function openFire(page: Page): Promise<void> {
  await page.getByLabel('Almanac').click();
  await page.getByRole('button', { name: /◎ FIRE/ }).click();
  await expect(page.getByText(FRAMING, { exact: true })).toBeVisible({ timeout: 8000 });
}
/** A tile by its label: [its value, its sub-line]. */
async function tile(page: Page, label: string): Promise<[string, string]> {
  const box = page.getByText(label, { exact: true }).locator('xpath=..');
  return [(await box.locator('xpath=./div[1]').textContent())!.trim(), (await box.locator('xpath=./div[2]').textContent())!.trim()];
}
const dockOf = (page: Page): Locator => page.getByRole('region', { name: 'Controls' });
const bottomOf = async (l: Locator) => { const b = (await l.boundingBox())!; return b.y + b.height; };

test.describe('FIRE face', () => {
  test('⭐ PILL — the thirteenth pill is the last one and ungated; it opens the face', async ({ page }) => {
    await start(page);
    await page.getByLabel('Almanac').click();
    await expect(page.locator('[class*="subnavBtn"]').last(), 'PILL last').toHaveText('◎ FIRE');
    await page.locator('[class*="subnavBtn"]').last().click();
    await expect(page.getByText(FRAMING, { exact: true }), 'PILL the framing').toBeVisible({ timeout: 8000 });
    await expect(page.getByText('FIRE', { exact: true }), 'PILL the title').toBeVisible();
    await expect(page.getByText('Something crashed'), 'PILL nothing crashed').toHaveCount(0);
    const fold = page.getByText('Assumptions', { exact: true });
    expect(await fold.evaluate((el) => getComputedStyle(el).cursor), 'PILL the Assumptions read as a fold').toBe('pointer');
    expect(await fold.evaluate((el) => getComputedStyle(el, '::after').content), 'PILL the fold\'s marker').toBe('" ›"');
    const credit = page.getByRole('link', { name: /FIRE BTC's Compass/ });
    expect(await credit.evaluate((el) => getComputedStyle(el).color), 'PILL the credit link is readable (--text-secondary)').toBe('rgb(208, 208, 208)');
  });

  test('⭐ TILES — the six tiles on the defaults (Support, on the line; at FI), in the face\'s words', async ({ page }) => {
    await start(page);
    await openFire(page);
    await expect(page.getByText(`On Support, on the line · Oct 2026 – ${END}`, { exact: true }), 'TILES the path').toBeVisible();
    await expect(page.getByText('At least $7,000 a month', { exact: true }), 'TILES the replays landed').toBeVisible({ timeout: 8000 });
    expect(await tile(page, 'Years of spending funded today'), 'TILES years').toEqual(['4.8 years', 'Your coins after the tax a sale would owe, and your other assets, ÷ $42,000 a year.']);
    expect((await tile(page, 'You\'d need'))[0], 'TILES need').toBe('$1,050,000');
    expect(await tile(page, 'FI, on this path'), 'TILES FI').toEqual(['Dec 2035', '9.2 years away, working until then.']);
    expect(await tile(page, 'From your stop, on this path'), 'TILES lasts').toEqual([`Lasts through ${END}`, 'You stop: Dec 2035 (at FI).']);
    expect((await tile(page, 'Spending that lasts every replay'))[0], 'TILES capacity').toBe('At least $7,000 a month');
    expect((await tile(page, 'Break-even growth'))[0], 'TILES break-even').toMatch(/^\d+\.\d% a year$/);
  });

  test('⭐ REPLAYS — a line a cycle, the lowest capacity, the break-even; "Now" runs out in the replays', async ({ page }) => {
    await start(page);
    await openFire(page);
    for (const id of ['2013', '2017', '2021']) await expect(page.getByText(`${id} bear: lasts through ${END}.`, { exact: true }), `REPLAYS ${id} at FI`).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Spending that lasts all three: at least $7,000 a month (today\'s dollars) — twice your spending still lasts.', { exact: true }), 'REPLAYS at least').toBeVisible();
    await page.getByRole('button', { name: 'Now', exact: true }).click();
    for (const [id, when] of [['2013', 'May 2030'], ['2017', 'Nov 2029'], ['2021', 'Jan 2030']]) {
      await expect(page.getByText(`${id} bear: runs out in ${when}.`, { exact: true }), `REPLAYS ${id} now`).toBeVisible();
    }
    await expect(page.getByText('Spending that lasts all three: $1,771 a month (today\'s dollars) — the 2017 bear is the harshest.', { exact: true }), 'REPLAYS the lowest').toBeVisible();
    await expect(page.getByText(/^It lasts through Sep 2046 as long as bitcoin grows at least \d+\.\d% a year, steadily\.$/), 'REPLAYS the break-even').toBeVisible();
    expect((await tile(page, 'From your stop, on this path'))[0], 'REPLAYS lasts now').toBe('Runs out Aug 2032');
  });

  test('⭐ CUT — a 10-year horizon ends before each bear\'s low: no capacity, and each line says so (the follow-ups\' F-1)', async ({ page }) => {
    await start(page);
    await openFire(page);
    await expect(page.getByText(`2013 bear: lasts through ${END}.`, { exact: true }), 'CUT premise: the replays landed').toBeVisible({ timeout: 8000 });
    // The owner's way: the dock's Horizon, typed into its value field. At FI stays Dec 2035 (month 110); on this stub every
    // low is 10 months after its top, so with 120 months (the last, month 119, is Sep 2036) all three fall past the horizon.
    const dock = dockOf(page);
    await dock.getByRole('button', { name: /^Path/ }).click();
    const horizon = dock.locator('div', { has: page.getByText('Horizon', { exact: true }) }).filter({ has: page.locator('input[type="range"]') }).last();
    await horizon.locator('div').filter({ hasText: /^20 yr$/ }).click();   // its value — the slider's max label says "20 yr" too
    await horizon.locator('input[type="text"]').fill('120');
    await page.keyboard.press('Enter');
    await expect(horizon.getByText('10 yr', { exact: true }), 'CUT a 120-month horizon').toBeVisible();
    await dock.getByRole('button', { name: /^Path/ }).click();   // the panel folds
    expect(await tile(page, 'From your stop, on this path'), 'CUT premise: the stop, inside the horizon').toEqual(['Lasts through Sep 2036', 'You stop: Dec 2035 (at FI).']);
    for (const id of ['2013', '2017', '2021']) {
      await expect(page.getByText(`${id} bear: lasts through Sep 2036 — the horizon ends before its low.`, { exact: true }), `CUT ${id}`).toBeVisible();
    }
    await expect(page.getByText('No capacity: the horizon ends before a bear reaches its low.', { exact: true }), 'CUT the card').toBeVisible();
    expect(await tile(page, 'Spending that lasts every replay'), 'CUT the tile').toEqual(['—', 'The horizon ends before a bear reaches its low.']);
  });

  test('⭐ FAILED — the history didn\'t load: no replays and no capacity, said in words', async ({ page }) => {
    await start(page, 'fail');
    await openFire(page);
    await expect(page.getByText(FAILED, { exact: true }), 'FAILED').toBeVisible({ timeout: 8000 });
    expect(await tile(page, 'Spending that lasts every replay'), 'FAILED the tile').toEqual(['—', 'The price history didn\'t load.']);
    await expect(page.getByText(/ bear: lasts through /), 'FAILED never read as lasting').toHaveCount(0);
  });

  test('⭐ OFFLINE — offline: the face says so, and shows no replays and no capacity', async ({ page }) => {
    await start(page);
    await page.getByLabel('Almanac').click();
    await page.route(/blockchain\.info/, (r) => r.abort());
    await page.context().setOffline(true);
    await page.getByRole('button', { name: /◎ FIRE/ }).click();
    await expect(page.getByText(OFFLINE, { exact: true }), 'OFFLINE').toBeVisible({ timeout: 8000 });
    expect((await tile(page, 'Spending that lasts every replay'))[0], 'OFFLINE the tile').toBe('—');
    await expect(page.getByText(/ bear: /), 'OFFLINE no replay lines').toHaveCount(0);
    await page.context().setOffline(false);
  });

  test('⭐ DOCK — Month · Stress · Path, pinned to the window\'s bottom edge as the face scrolls', async ({ page }) => {
    await start(page);
    await openFire(page);
    const dock = dockOf(page);
    await expect(dock.getByRole('button'), 'DOCK tabs').toHaveText([/^Month/, /^Stress/, /^Path/]);
    expect(await dock.evaluate((el) => getComputedStyle(el).position), 'DOCK sticky').toBe('sticky');
    const max = await page.evaluate(() => document.body.scrollHeight - document.body.clientHeight);
    expect(max, 'DOCK the face scrolls').toBeGreaterThan(1000);
    const edge = page.viewportSize()!.height;
    for (const f of [0, 0.25, 0.5, 0.75]) {
      await page.evaluate((v) => { document.body.scrollTop = v; }, Math.round(max * f));
      expect(Math.abs((await bottomOf(dock)) - edge), `DOCK pinned at ${f}`).toBeLessThanOrEqual(1);
    }
    await page.evaluate((v) => { document.body.scrollTop = v; }, max);
    const disclaimer = page.getByText(/^A pattern, not a forecast\./);
    expect((await dock.boundingBox())!.y, 'DOCK under the disclaimer at the end').toBeGreaterThanOrEqual(await bottomOf(disclaimer));
  });

  test('⭐ STRESS HOLDS — a stress set in the dock survives the face re-rendering', async ({ page }) => {
    await start(page);
    await openFire(page);
    const dock = dockOf(page);
    await dock.getByRole('button', { name: /^Stress/ }).click();
    const stress = dock.getByLabel('Price stress multiplier');
    await stress.focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
    await expect(dock.getByRole('button', { name: /^Stress/ }), 'STRESS HOLDS set').toHaveText(/^Stress\s*−30%$/);
    await page.getByText('Assumptions', { exact: true }).click();   // unfold: the face re-renders
    await dock.getByRole('button', { name: /^Path/ }).click();
    await dock.getByRole('button', { name: /^Path/ }).click();
    await page.evaluate(() => { document.body.scrollTop = 600; });
    await page.waitForTimeout(300);
    await expect(dock.getByRole('button', { name: /^Stress/ }), 'STRESS HOLDS still on').toHaveText(/^Stress\s*−30%$/);
    await expect(page.getByText(/^Price −30% from Nov 2026 on\.$/), 'STRESS HOLDS the note').toBeVisible();
  });

  test('⭐ PHONE TABLE — the switch table under 768 px, the table from 768, the same figures', async ({ page }) => {
    await start(page);
    await openFire(page);
    const sw = page.getByRole('group', { name: 'Milestones figures', exact: true });
    const phone = page.getByRole('table', { name: 'Milestones', exact: true });
    const table = page.locator('table:not([aria-label]):has(th:text-is("Year"))');
    await expect(sw, 'PHONE TABLE the switch').toHaveCount(1);
    await expect(table, 'PHONE TABLE one markup').toHaveCount(0);
    await expect(sw.getByRole('button'), 'PHONE TABLE the views').toHaveText(['₿', '$', 'Years']);
    const views: Record<string, string[]> = {};
    for (const v of ['₿', '$', 'Years']) {
      await sw.getByRole('button', { name: v === '₿' ? 'Bitcoin' : v === '$' ? 'Dollars' : 'Years of spending funded', exact: true }).click();
      const heads = await phone.locator('thead th').allTextContents();
      const rows = await phone.locator('tbody').evaluateAll((bs) => bs.map((b) =>
        [...b.querySelectorAll('tr:first-child > td')].slice(1).map((td) => td.textContent!.trim())));
      heads.slice(1).forEach((h, i) => { views[h] = rows.map((r) => r[i]); });
    }
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(table, 'PHONE TABLE the table from 768').toHaveCount(1);
    await expect(sw, 'PHONE TABLE one markup').toHaveCount(0);
    const heads = (await table.locator('thead th').allTextContents()).map((h) => h.trim());
    expect(heads, 'PHONE TABLE the columns').toEqual(['Year', 'Price', '₿ owned', 'Other assets', 'Portfolio', 'Years funded', '₿ needed']);
    const rows = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) =>
      [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent!.trim())));
    heads.slice(1).forEach((h, i) => expect(views[h], `PHONE TABLE SAME ${h}`).toEqual(rows.map((r) => r[i])));
    expect(views['Other assets'].every((v) => v === '—'), 'PHONE TABLE no "$0": a zero prints "—"').toBe(true);
  });

  test('⭐ NO SIDEWAYS — nothing scrolls sideways at 390 px', async ({ page }) => {
    await start(page);
    await openFire(page);
    await page.getByText('Assumptions', { exact: true }).click();
    for (const width of [390, 375]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.body.scrollWidth - innerWidth), `NO SIDEWAYS ${width}`).toBeLessThanOrEqual(0);
    }
  });

  test('⭐ PERSIST — a typed input stays on this device across a reload; Reset clears it and leaves inflation', async ({ page }) => {
    await start(page);
    await openFire(page);
    await page.getByText('Assumptions', { exact: true }).click();
    const other = page.getByLabel('Other investable assets');
    await other.fill('200000');
    await other.press('Tab');
    await expect.poll(async () => (await tile(page, 'Years of spending funded today'))[0], { message: 'PERSIST the figure moves' }).toBe('9.5 years');
    const blob = () => page.evaluate(() => JSON.parse(localStorage.getItem('personal-bloc-store')!).state as Record<string, unknown>);
    expect((await blob()).fireInputs, 'PERSIST in the blob').toEqual({ otherUsd: 200_000 });
    await page.reload();
    await expect(page.getByLabel('Log an event'), 'PERSIST back on Daily').toBeVisible({ timeout: 15_000 });
    await openFire(page);
    expect((await tile(page, 'Years of spending funded today'))[0], 'PERSIST across the reload').toBe('9.5 years');
    await page.getByRole('button', { name: 'Reset to defaults', exact: true }).click();
    await expect.poll(async () => (await tile(page, 'Years of spending funded today'))[0], { message: 'PERSIST reset' }).toBe('4.8 years');
    const after = await blob();
    expect([after.fireInputs, after.inflationRate], 'PERSIST reset clears the inputs, leaves inflation').toEqual([null, 2]);
  });
});
