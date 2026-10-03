import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedLoanAndGoto, STORE_VERSION } from './helpers';

/**
 * Sticky controls — the control dock on the Decision face (spec `pbloc-spec-sticky-controls-v1.md` v1.1). The dock is
 * the face's last child, sticky to the window's bottom edge: flush under 1024 px (the tabs), floating 12 px up from
 * 1024 px (the bar). The app scrolls <body>, never the window, so every scroll here sets `document.body.scrollTop`.
 * Every assertion carries a tag, so each named mutation fails at its own.
 *
 * Hermetic (Δ5): the spec's round synthetic seed — $50,000 owed on 1 ₿ at a manual $100,000 — with live prices aborted
 * and the price history stubbed.
 */

const MOVE_TITLE = "The support policy's move this month";
/** decisionView's disclaimer opens with these words (Playwright can't import src/). */
const DISCLAIMER = /^A pattern, not a forecast/;
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });

async function hermetic(page: Page): Promise<void> {
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
}

/** THE MOVE first (the face has rendered), then the dock. */
async function dockOf(page: Page): Promise<Locator> {
  await expect(page.getByRole('region', { name: MOVE_TITLE })).toBeVisible({ timeout: 8000 });
  const dock = page.getByRole('region', { name: 'Controls' });
  await expect(dock).toBeVisible();
  return dock;
}

/** Simple mode (the e2e default): the journal → Almanac → ◆ Decision. */
async function openDecision(page: Page): Promise<Locator> {
  await hermetic(page);
  await seedLoanAndGoto(page);
  await page.getByLabel('Almanac').click();
  await page.getByRole('button', { name: /◆ Decision/ }).click();
  return dockOf(page);
}

const scrollBody = (page: Page, y: number) => page.evaluate((v) => { document.body.scrollTop = v; }, y);
const maxScroll = (page: Page) => page.evaluate(() => document.body.scrollHeight - document.body.clientHeight);
const bottomOf = async (l: Locator) => { const b = (await l.boundingBox())!; return b.y + b.height; };

/** STICKY, OPAQUE, PINNED and END on one surface: the dock's bottom edge sits at `edge` at every scroll, and at the end
 *  of the page it sits under the disclaimer — never over it — on the same edge. */
async function expectPinned(page: Page, dock: Locator, edge: number, surface: string): Promise<void> {
  expect(await dock.evaluate((el) => getComputedStyle(el).position), `STICKY ${surface}`).toBe('sticky');
  // OPAQUE — --surface, no alpha: at 0.97 the schedule's text showed through.
  expect(await dock.evaluate((el) => getComputedStyle(el).backgroundColor), `OPAQUE ${surface}`).toBe('rgb(14, 18, 25)');
  const max = await maxScroll(page);
  expect(max, `the face scrolls ${surface}`).toBeGreaterThan(1000);
  for (const f of [0, 0.25, 0.5, 0.75]) {
    await scrollBody(page, Math.round(max * f));
    expect(Math.abs((await bottomOf(dock)) - edge), `PINNED at ${f} ${surface}`).toBeLessThanOrEqual(1);
  }
  await scrollBody(page, max);
  const disclaimer = page.getByText(DISCLAIMER);
  expect((await dock.boundingBox())!.y, `END: under the disclaimer ${surface}`).toBeGreaterThanOrEqual(await bottomOf(disclaimer));
  expect(Math.abs((await bottomOf(dock)) - edge), `END: on the same edge ${surface}`).toBeLessThanOrEqual(1);
}

test.describe('Sticky controls — phone', () => {
  test('the dock holds the bottom edge at every scroll, and settles under the disclaimer at the end', async ({ page }) => {
    const dock = await openDecision(page);
    // ONCE-DOM — one markup at a time: the page holds each dock control once (Month open, Stress folded).
    await expect(page.getByLabel('Inspect month'), 'ONCE-DOM').toHaveCount(1);
    await expect(page.getByLabel('Price stress multiplier'), 'ONCE-DOM').toHaveCount(0);
    await expectPinned(page, dock, 844, 'phone');
  });

  test('five tabs; Month open and clear of the swipe-back edge; a tap opens Stress, a second folds it; Path drives the What-if card', async ({ page }) => {
    const dock = await openDecision(page);
    const tabs = dock.getByRole('button');
    await expect(tabs, 'TABS').toHaveText([/^Month/, /^Stress/, /^Path/, /^Line/, /^Policy/]);
    const month = dock.getByLabel('Inspect month');
    const stress = dock.getByLabel('Price stress multiplier');
    await expect(month, 'TABS: Month open').toBeVisible();
    await expect(stress, 'TABS').toHaveCount(0);
    // EDGE (Δ2) — the panel's controls start right of EdgeBackGesture's swipe-back zone, so a drag from the slider's
    // left end moves the slider, never the page.
    const zone = (await page.getByTestId('edge-back-zone').boundingBox())!;
    expect((await month.boundingBox())!.x, 'EDGE').toBeGreaterThanOrEqual(zone.x + zone.width);
    // The month: five steps right from month 1 — the tab and the readout follow.
    await month.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect(dock.getByRole('button', { name: /^Month/ }), 'MONTH').toHaveText(/^Month\s*6$/);
    await expect(dock.getByText('month 6 · 0.5 yr', { exact: true }), 'READOUT').toBeVisible();
    // Stress opens in Month's place; a second tap folds the dock to its tabs.
    await dock.getByRole('button', { name: /^Stress/ }).click();
    await expect(stress, 'TABS: Stress open').toBeVisible();
    await expect(month, 'TABS: Stress open').toHaveCount(0);
    await dock.getByRole('button', { name: /^Stress/ }).click();
    await expect(stress, 'FOLD').toHaveCount(0);
    expect((await dock.boundingBox())!.height, 'FOLD: just the tabs').toBeLessThan(80);
    // ARIA (Δ4) — folded, no tab points at a panel that isn't there.
    for (let i = 0; i < 5; i++) await expect(tabs.nth(i), 'ARIA').not.toHaveAttribute('aria-controls');
    // PATH-TAB, REMOTE (I4) — the dock's Path writes the same overlay as the What-if card below.
    await dock.getByRole('button', { name: /^Path/ }).click();
    await dock.getByRole('button', { name: 'Fair', exact: true }).click();
    await expect(dock.getByRole('button', { name: /^Path/ }), 'PATH-TAB').toHaveText(/^Path\s*Fair$/);
    const whatIf = page.locator('section', { has: page.getByText('What if · price path', { exact: true }) });
    await expect(whatIf.getByRole('button', { name: 'Fair', exact: true }), 'REMOTE').toHaveAttribute('aria-pressed', 'true');
  });

  test('Policy holds the six settings and scrolls inside the dock; its Turn policy off reaches the card; the stress note reads under the chart', async ({ page }) => {
    const dock = await openDecision(page);
    await dock.getByRole('button', { name: /^Policy/ }).click();
    await expect(dock.getByText('Coinbase limit at support', { exact: true })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Turn policy off' })).toHaveCount(1);
    const box = (await dock.boundingBox())!;
    expect(box.height, 'POLICY: under half the screen').toBeLessThan(844 / 2);
    const panel = dock.locator('[id$="-panel"]');
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight), 'POLICY: scrolls').toBe(true);
    // NOTE — the scrubber card's notes moved under the chart.
    const chartCard = page.locator('section', { has: page.getByTestId('decision-chart-box') });
    await expect(chartCard.getByText(/^Stress from this month forward/), 'NOTE').toHaveCount(1);
    // POLICY-TAB, REMOTE-POLICY (I4) — the dock's Turn policy off is the card's.
    await dock.getByRole('button', { name: 'Turn policy off' }).click();
    await expect(dock.getByRole('button', { name: /^Policy/ }), 'POLICY-TAB').toHaveText(/^Policy\s*off$/);
    const card = page.getByRole('button', { name: 'About the support policy' }).locator('xpath=ancestor::section[1]');
    await expect(card.getByText(/^Off — limits are measured at today's price/), 'REMOTE-POLICY').toBeVisible();
  });
});

test.describe('Sticky controls — computer', () => {
  // Z20 — Playwright Test applies the project's `use` (a touch phone) unless these are set false.
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('the bar floats 12px above the bottom edge at every scroll and settles under the disclaimer; the tabs below 1024px, the bar from it', async ({ page }) => {
    const dock = await openDecision(page);
    await expect(page.getByLabel('Inspect month'), 'ONCE-DOM').toHaveCount(1);
    await expect(page.getByLabel('Price stress multiplier'), 'ONCE-DOM').toHaveCount(1);
    await expectPinned(page, dock, 888, 'computer');
    // LAYOUT (R2) — the bar starts at 1024 px; a narrower window keeps the tabs.
    await page.setViewportSize({ width: 1023, height: 900 });
    await expect(dock.getByRole('button'), 'LAYOUT 1023').toHaveText([/^Month/, /^Stress/, /^Path/, /^Line/, /^Policy/]);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(dock.getByRole('button'), 'LAYOUT 1024').toHaveText([/^Path/, /^Line/, /^Policy/]);
  });

  test('month and stress always live; Policy opens upward with the chart in view and Tab enters it; Escape folds it from anywhere and gives the chip focus back; a typed value\'s Escape only cancels the edit', async ({ page }) => {
    const dock = await openDecision(page);
    const month = dock.getByLabel('Inspect month');
    const stress = dock.getByLabel('Price stress multiplier');
    await expect(month, 'LIVE').toBeVisible();
    await expect(stress, 'LIVE').toBeVisible();
    await expect(dock.getByRole('button'), 'LIVE').toHaveText([/^Path/, /^Line/, /^Policy/]);
    // The chart at the top of the window.
    const chartBox = page.getByTestId('decision-chart-box');
    await chartBox.evaluate((el) => { document.body.scrollTop += el.getBoundingClientRect().top - 60; });
    const policy = dock.getByRole('button', { name: /^Policy/ });
    await policy.click();
    const setting = dock.getByText('Coinbase limit at support', { exact: true });
    await expect(setting).toBeVisible();
    expect(await bottomOf(setting), 'UP: above the bar').toBeLessThan((await month.boundingBox())!.y);
    expect(await bottomOf(chartBox), 'UP: the chart stays in view').toBeLessThan((await dock.boundingBox())!.y);
    // TAB-INTO (Δ4) — the panel follows the bar in the DOM, so Tab from its chip lands inside it.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[id$="-panel"]') != null), 'TAB-INTO').toBe(true);
    // ESCAPE, ESCAPE-FOCUS (Δ4) — heard wherever focus is: Safari never focuses a clicked button, so focus can sit on
    // <body>. The blur stands in for it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(setting, 'ESCAPE').toHaveCount(0);
    await expect(policy, 'ESCAPE-FOCUS').toBeFocused();
    // EDIT-ESC (Δ4) — an Escape while typing a value belongs to the field (SliderInput cancels its edit); the next one
    // folds the panel.
    await policy.click();
    await setting.locator('xpath=../following-sibling::div[1]').click();
    const field = dock.locator('input[type="text"]');
    await expect(field, 'EDIT-ESC: editing').toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field, 'EDIT-ESC: the edit cancelled').toHaveCount(0);
    await expect(setting, 'EDIT-ESC: the panel stays').toBeVisible();
    await page.keyboard.press('Escape');
    await expect(setting, 'ESCAPE: the next one folds').toHaveCount(0);
  });
});

test.describe('Sticky controls — full mode', () => {
  test('full mode: the dock holds the bottom edge on the Almanac tab — a computer and a phone', async ({ browser, baseURL }) => {
    // Δ1 — in full mode the face sits in AppShell's .main, which was a scroll container that never scrolls. Two
    // contexts of its own (Z20: a context made inside a test takes the project's `use` — set each surface explicitly).
    test.setTimeout(60_000);
    const SURFACES = [
      { name: 'full computer', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, edge: 888 },
      { name: 'full phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, edge: 844 },
    ];
    for (const s of SURFACES) {
      const ctx = await browser.newContext({
        baseURL, viewport: s.viewport, serviceWorkers: 'block', isMobile: s.isMobile, hasTouch: s.hasTouch,
      });
      try {
        const page = await ctx.newPage();
        await hermetic(page);
        await page.addInitScript(`
          window.__APP_BOOTED = true;
          localStorage.setItem('personal-bloc-store', JSON.stringify({
            state: {
              onboardingComplete: true, simpleMode: false, simpleView: 'daily',
              hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
              btcPriceMode: 'manual', btcPrice: 100000
            },
            version: ${STORE_VERSION}
          }));
          localStorage.setItem('personal-bloc-onboarded', '1');
        `);
        await page.goto('/');
        const tools = page.getByRole('button', { name: /^Tools/ });
        await expect(tools, `LANDING ${s.name}`).toBeVisible({ timeout: 15_000 });
        await tools.click();
        await page.getByRole('button', { name: 'Almanac', exact: true }).click();
        await page.getByRole('button', { name: /◆ Decision/ }).click();
        const dock = await dockOf(page);
        await expectPinned(page, dock, s.edge, s.name);
      } finally {
        await ctx.close();
      }
    }
  });
});
