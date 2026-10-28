import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * BL15 — Customization (batch spec §2.4): Settings' "Display" and "Tabs" are one page, with the venue colours on it. A
 * swatch changes a venue's colour across the app (here: Daily's cold storage figure, which reads --venue-cold); tapping
 * the colour a venue wears stores nothing; a swatch the rule refuses changes nothing and says why; the choice survives a
 * reload; "Back to the default colors" restores the palette. Hermetic: round synthetic figures, live prices aborted, history stubbed, a fixed
 * day; the seed runs once per tab, so a reload keeps what was chosen. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const SEED = `
  window.__APP_BOOTED = true;
  if (!sessionStorage.getItem('e2e-seeded')) {
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily', btcPriceMode: 'manual', btcPrice: 100000,
        advisorStartDate: '2026-10-01', hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
        coldStorageBtc: 0.5, coldStorageBtcAsOf: 1760000000000
      },
      version: ${STORE_VERSION},
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  }`;

const ORANGE = 'rgb(247, 147, 26)';
const TEAL = 'rgb(45, 212, 191)';

async function start(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.addInitScript(SEED);
  await page.goto('/');
  await expect(page.getByLabel('Log an event'), 'on Daily').toBeVisible({ timeout: 15_000 });
}
const coldColor = (page: Page) => page.locator('[class*="coldNum"]').evaluate((el) => getComputedStyle(el).color);
const rootVar = (page: Page, name: string) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);
const stored = (page: Page) => page.evaluate(() => (localStorage.getItem('personal-bloc-store') ?? '').includes('"venueColors"'));
async function openCustomization(page: Page): Promise<void> {
  await page.getByLabel('Settings').click();
  await page.getByRole('button', { name: /Customization/ }).click();
  await expect(page.getByRole('heading', { name: 'Customization' }), 'Customization opens').toBeVisible();
}
async function leaveSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '← Settings' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('tab', { name: 'Daily' }).click();
  await expect(page.getByLabel('Log an event'), 'back on Daily').toBeVisible();
}

test.describe('Customization — BL15', () => {
  test('CUSTOMIZE — one page; a swatch recolours a venue app-wide; a refused pick changes nothing; it persists; the defaults come back', async ({ page }) => {
    await start(page);
    await expect.poll(() => coldColor(page), 'DEFAULT cold storage wears the bitcoin orange').toBe(ORANGE);

    // ONE PAGE — one row where "Display" and "Tabs" were
    await page.getByLabel('Settings').click();
    await expect(page.getByRole('button', { name: /Customization/ }), 'ONE PAGE the row').toBeVisible();
    await expect(page.getByRole('button', { name: /^(🖥️\s*)?Display\b/ }), 'ONE PAGE no Display row').toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(🗂️\s*)?Tabs\b/ }), 'ONE PAGE no Tabs row').toHaveCount(0);
    await page.getByRole('button', { name: /Customization/ }).click();
    await expect(page.getByRole('heading', { name: 'Customization' }), 'ONE PAGE opens').toBeVisible();
    for (const t of ['Monthly Mode', 'VENUE COLORS', 'TAB VISIBILITY & ORDER']) {
      await expect(page.getByText(t, { exact: true }), `ONE PAGE ${t}`).toBeVisible();
    }

    // UNCHANGED — tapping the colour a venue wears stores nothing: the device still never chose
    await page.getByRole('button', { name: 'Coinbase: blue (default)' }).click();
    expect(await stored(page), 'UNCHANGED nothing stored').toBe(false);

    // PICK — a swatch
    const teal = page.getByRole('button', { name: 'Cold storage: teal' });
    await teal.click();
    await expect(teal, 'PICK pressed').toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => stored(page), 'PICK stored (the UNCHANGED check can see a write)').toBe(true);
    expect(await rootVar(page, '--venue-cold'), 'PICK on :root').toBe('#2dd4bf');
    await expect(page.getByRole('button', { name: /^Strike: teal — Too close to Cold storage’s color\.$/ }), 'PICK the twin swatch is dimmed for Strike').toBeVisible();

    // REFUSE — a dimmed swatch: Strike in the teal cold storage now wears
    await page.getByRole('button', { name: /^Strike: teal — / }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Too close to Cold storage’s color.' }), 'REFUSE says why').toBeVisible();
    expect(await rootVar(page, '--venue-strike'), 'REFUSE nothing written').toBe('');

    // ANOTHER — a second venue's pick lands; its default takes it back off :root
    await page.getByRole('button', { name: 'Strike: violet' }).click();
    await expect.poll(() => rootVar(page, '--venue-strike'), 'ANOTHER on :root').toBe('#a78bfa');
    await page.getByRole('button', { name: 'Strike: white (default)' }).click();
    await expect.poll(() => rootVar(page, '--venue-strike'), 'ANOTHER Strike back to its default — off :root').toBe('');

    // APP-WIDE — Daily's cold figure follows
    await leaveSettings(page);
    await expect.poll(() => coldColor(page), 'APP-WIDE Daily follows').toBe(TEAL);

    // PERSIST — a reload keeps it (the sink runs before paint: a layout effect, pinned by venueColorsWiring's SINK)
    await page.reload();
    await expect(page.getByLabel('Log an event'), 'PERSIST back on Daily').toBeVisible({ timeout: 15_000 });
    expect(await coldColor(page), 'PERSIST kept').toBe(TEAL);

    // RESET — back to the defaults
    await openCustomization(page);
    const reset = page.getByRole('button', { name: 'Back to the default colors' });
    await reset.click();
    await expect(reset, 'RESET nothing left to reset').toBeDisabled();
    expect(await rootVar(page, '--venue-cold'), 'RESET off :root').toBe('');
    await leaveSettings(page);
    await expect.poll(() => coldColor(page), 'RESET the orange is back').toBe(ORANGE);
  });
});
