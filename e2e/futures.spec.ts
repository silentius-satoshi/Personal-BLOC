import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedLoanAndGoto, STORE_VERSION } from './helpers';

/**
 * The futures (spec pbloc-spec-policy-v2-lenses-v1): the Strategy face's readout and the Support policy card's line on
 * all four faces, run in a worker. Every assertion carries a tag, so each named mutation fails at its own. Hermetic: the
 * round synthetic loan seed ($50,000 owed on 1 ₿ at a manual $100,000), live prices aborted, the price history stubbed.
 * The futures start today, so their figures move with the date — these tests read shapes and behaviour, never a
 * figure. The count is read as any number (`[\d,]+`), so §9's cut to 300 needs no edit here (D-3). On screen the
 * 1,000 are "simulations" (W-4).
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });

async function hermetic(page: Page): Promise<void> {
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
}

const FACES = [
  { name: 'cycling', pill: /♻ Cycling/ },
  { name: 'strategy', pill: /◈ Strategy/ },
  { name: 'ownership', pill: /⚖ Ownership/ },
  { name: 'decision', pill: /Decision/ },
] as const;

async function openFace(page: Page, pill: RegExp): Promise<void> {
  await hermetic(page);
  await seedLoanAndGoto(page);
  await page.getByLabel('Almanac').click();
  await page.getByRole('button', { name: pill }).first().click();
}

const readoutOf = (page: Page): Locator => page.getByRole('region', { name: /^Across [\d,]+ simulations · / });
const lineOf = (page: Page): Locator => page.locator('p[class*="futures"]');
const policyCardOf = (page: Page): Locator => page.locator('section:has(> p[class*="futures"])');

/** The readout once a run has landed, as rows of [term, value, sub]. */
async function readRows(page: Page, tag: string): Promise<string[][]> {
  const card = readoutOf(page);
  await expect(card, `${tag}: the readout`).toBeVisible({ timeout: 15_000 });
  await expect(card, `${tag}: landed`).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(card.getByText('Running the simulations…'), `${tag}: landed`).toHaveCount(0);
  return card.locator('div[class*="cell"]').evaluateAll((cells) =>
    cells.map((c) => [...c.querySelectorAll('span')].map((s) => s.textContent ?? '')));
}

async function landedLine(page: Page, tag: string): Promise<string> {
  const line = lineOf(page);
  await expect(line, `${tag}: one line`).toHaveCount(1);
  await expect(line, `${tag}: landed`).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(line, `${tag}: landed`).not.toHaveText('Running the simulations…');
  return (await line.textContent()) ?? '';
}

const RANGE = /^(none|\d+\.\d\d ₿|\d+\.\d\d–\d+\.\d\d ₿)$/;
const SHARE = /^(none|all|\d+(\.\d)?%)$/;
// The card's line (Run 2): sentences of "simulations" (W-4), the seizures dated when some happen (W-3)
const HEAD = String.raw`^Over the next (year|\d+(\.\d)? years), in [\d,]+ simulations:`;
const SHARE_OR_ALL = String.raw`(none|all|\d+(\.\d)?%)`;
const WHEN = String.raw` — (${SHARE_OR_ALL} within the first year, )?half of those seizures by [A-Z][a-z]{2} \d{4}`;
// O-2: WHEN is required whenever some seize — the code always prints it then
const SEIZED_PART = String.raw`Coinbase seizes in (none of them|(all|\d+(\.\d)?%) of them${WHEN})`;
const LINE_ON = new RegExp(String.raw`${HEAD} in 8 of 10, you end owning (none|\d+\.\d\d ₿|\d+\.\d\d–\d+\.\d\d ₿); ${SEIZED_PART}\.$`);
const LINE_OFF = new RegExp(String.raw`${HEAD} ${SEIZED_PART}\.$`);
const SUB_SEIZED = new RegExp(String.raw`^of the simulations( — (${SHARE_OR_ALL} within a year, )?half of the seizures by [A-Z][a-z]{2} \d{4})?$`);

test.describe('the futures', () => {
  test('READOUT — Strategy: four numbers under the policy, the chance alone without it; run in a worker', async ({ page }) => {
    await openFace(page, /◈ Strategy/);
    const rows = await readRows(page, 'READOUT');
    // A readout shown only in the Flywheel lens (MF19) fails here: the face opens on Position
    expect(rows.map((r) => r[0]), 'READOUT terms').toEqual(['You own', 'In your cold storage', 'Beats never borrowing', 'Coinbase seizes']);
    expect(rows[0][1], 'READOUT you own').toMatch(RANGE);
    expect(rows[1][1], 'READOUT cold').toMatch(RANGE);
    expect(rows[2][1], 'READOUT beats').toMatch(SHARE);
    expect(rows[3][1], 'READOUT seizes').toMatch(SHARE);
    // WORKER — the run went off the main thread (MF18, a worker that never spawns, fails here)
    expect(page.workers().some((w) => /futures\.worker/.test(w.url())), 'WORKER').toBe(true);

    // OFF — the policy off: the chance alone, counted at the first dip past the line, and why (MF8, MF14 fail here)
    const card = policyCardOf(page);
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Turn policy off' }).click();
    await expect(readoutOf(page), 'OFF: a new run').toHaveAttribute('aria-busy', 'true');
    const off = await readRows(page, 'OFF');
    expect(off.map((r) => r[0]), 'OFF rows').toEqual(['Coinbase seizes']);
    expect(off[0][2], 'OFF rows: when').toMatch(SUB_SEIZED);
    await expect(readoutOf(page).getByText(/^Without the support policy/), 'OFF: why').toBeVisible();
    expect(await landedLine(page, 'OFF line'), 'OFF line').toMatch(LINE_OFF);

    // ON again — the four numbers return
    await policyCardOf(page).getByRole('button', { name: 'Turn on' }).click();
    await expect(readoutOf(page), 'ON: a new run').toHaveAttribute('aria-busy', 'true');
    expect((await readRows(page, 'ON')).length, 'ON').toBe(4);
  });

  test('LINE — the Support policy card carries the futures\' line on all four faces; another strategy, none', async ({ page }) => {
    await openFace(page, FACES[0].pill);
    for (const f of FACES) {
      await page.getByRole('button', { name: f.pill }).first().click();
      // A face that passes no line (MF20 on Cycling) fails at LINE <face>
      expect(await landedLine(page, `LINE ${f.name}`), `LINE ${f.name}`).toMatch(LINE_ON);
    }
    // NOT-CYCLE — Strategy on Hold: the card says the policy is for Cycle only, and carries no line (MF22 fails here)
    await page.getByRole('button', { name: /◈ Strategy/ }).first().click();
    await page.getByRole('button', { name: 'Hold', exact: true }).click();
    await expect(page.getByText('Applies to the Cycle strategy only.').first(), 'NOT-CYCLE: the card').toBeVisible();
    await expect(lineOf(page), 'NOT-CYCLE: no line').toHaveCount(0);
    expect((await readRows(page, 'NOT-CYCLE readout')).map((r) => r[0]), 'NOT-CYCLE readout').toEqual(['Coinbase seizes']);
  });

  test('SAME — the same inputs on the same day give the same readout, to the digit (a seeded run)', async ({ page }) => {
    await openFace(page, /◈ Strategy/);
    const a = await readRows(page, 'SAME first');
    await page.reload();
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◈ Strategy/ }).first().click();
    // Unseeded futures (MF24, Math.random) fail here
    expect(await readRows(page, 'SAME again'), 'SAME').toEqual(a);
  });

  test('FIT — full mode at 320 px with two-digit ₿: every value of the readout on one line, inside its cell', async ({ browser, baseURL }) => {
    // The narrowest frame there is: full mode's 20 px padding and the face's 16 px a side leave the card 246 px at 320.
    const ctx = await browser.newContext({ baseURL, viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    try {
      await hermetic(page);
      await page.addInitScript(`
        window.__APP_BOOTED = true;
        localStorage.setItem('personal-bloc-store', JSON.stringify({
          state: {
            onboardingComplete: true, simpleMode: false, simpleView: 'daily',
            hasCbLoan: true, cbLoanBalance: 500000, cbLoanBalanceAsOf: null, cbCollateralBtc: 10,
            btcPriceMode: 'manual', btcPrice: 100000, strikeCollateralBtc: 15, creditLine: 400000, expenses: 50000, income: 60000
          },
          version: ${STORE_VERSION}
        }));
        localStorage.setItem('personal-bloc-onboarded', '1');
      `);
      await page.goto('/');
      await page.getByRole('button', { name: /^Tools/ }).click({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Almanac', exact: true }).click();
      await page.getByRole('button', { name: /◈ Strategy/ }).first().click();
      const rows = await readRows(page, 'FIT');
      expect(rows[0][1], 'FIT: two-digit coins (non-vacuous)').toMatch(/^\d\d\./);
      // Values at a fixed 17 px (MF25) run past their cells here
      const over = await readoutOf(page).locator('span[class*="value"]').evaluateAll((vs) => vs.flatMap((v) => {
        const rg = document.createRange();
        rg.selectNodeContents(v);
        const t = rg.getBoundingClientRect();
        const cell = v.parentElement!.getBoundingClientRect();
        return t.width > cell.width + 0.5 || t.height > parseFloat(getComputedStyle(v).lineHeight) * 1.5 ? [v.textContent] : [];
      }));
      expect(over, 'FIT').toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'FIT: no sideways page').toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test('FALLBACK — with no Worker the same readout runs in-thread', async ({ page }) => {
    await openFace(page, /◈ Strategy/);
    const a = await readRows(page, 'FALLBACK worker');
    await page.addInitScript('delete window.Worker; window.Worker = undefined;');
    await page.reload();
    await page.getByLabel('Almanac').click();
    await page.getByRole('button', { name: /◈ Strategy/ }).first().click();
    // A client that gives up without a worker (MF17) fails here
    expect(await readRows(page, 'FALLBACK'), 'FALLBACK').toEqual(a);
    expect(page.workers().some((w) => /futures\.worker/.test(w.url())), 'FALLBACK: no worker ran').toBe(false);
  });
});
