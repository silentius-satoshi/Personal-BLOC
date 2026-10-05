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
 *  of the page it sits under the disclaimer — never over it — on the same edge. Run 2: `end` is the block the dock must
 *  settle under (the parents pass the dock's preceding sibling — Ownership's is its two-column shell), and `minScroll`
 *  the guard that the face scrolls far enough for PINNED to mean something (a parent at 1440 can scroll under 1,000). */
async function expectPinned(
  page: Page, dock: Locator, edge: number, surface: string, opts: { end?: Locator; minScroll?: number } = {},
): Promise<void> {
  // R15 (the lenses, Run 2): the Support policy card's line opens as "Running the simulations…" and grows when its
  // first run lands — a landing between the END check's two reads moved the block under the dock. Wait for it first.
  const line = page.locator('p[class*="futures"]');
  if ((await line.count()) > 0) {
    await expect(line.first(), `LANDED ${surface}`).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect(line.first(), `LANDED ${surface}`).not.toHaveText(/^Running the /);
  }
  expect(await dock.evaluate((el) => getComputedStyle(el).position), `STICKY ${surface}`).toBe('sticky');
  // OPAQUE — --surface, no alpha: at 0.97 the schedule's text showed through.
  expect(await dock.evaluate((el) => getComputedStyle(el).backgroundColor), `OPAQUE ${surface}`).toBe('rgb(14, 18, 25)');
  const max = await maxScroll(page);
  expect(max, `the face scrolls ${surface}`).toBeGreaterThan(opts.minScroll ?? 1000);
  for (const f of [0, 0.25, 0.5, 0.75]) {
    await scrollBody(page, Math.round(max * f));
    expect(Math.abs((await bottomOf(dock)) - edge), `PINNED at ${f} ${surface}`).toBeLessThanOrEqual(1);
  }
  await scrollBody(page, max);
  const end = opts.end ?? page.getByText(DISCLAIMER);
  const under = opts.end ? 'the block before it' : 'the disclaimer';
  expect((await dock.boundingBox())!.y, `END: under ${under} ${surface}`).toBeGreaterThanOrEqual(await bottomOf(end));
  expect(Math.abs((await bottomOf(dock)) - edge), `END: on the same edge ${surface}`).toBeLessThanOrEqual(1);
}

// ── Run 2 (spec v1.6, D6–D8) — the same dock on the three parents ──────────────────────────────────────────────────
const PARENTS = [
  {
    name: 'cycling', pill: /♻ Cycling/, framing: 'Draw on Strike, refinance to Coinbase, never sell.',
    fair: 'Fair', fourYear: '4-yr cycle', chips: [/^Path/, /^Policy/],
  },
  {
    name: 'ownership', pill: /⚖ Ownership/, framing: 'Held · owed · yours — never sell.',
    fair: 'To fair', fourYear: 'Ride the 4-yr cycle', chips: [/^Path/, /^Policy/],
  },
  {
    name: 'strategy', pill: /◈ Strategy/, framing: 'One run, two lenses — what you own, and what the flywheel earns.',
    fair: 'Fair', fourYear: '4-yr cycle', chips: [/^Path/, /^Policy/, /^Lens/],
  },
] as const;
type ParentName = (typeof PARENTS)[number]['name'];
const PARENT = (name: ParentName) => PARENTS.find((f) => f.name === name)!;

/** The face's own framing line (it has rendered), then its dock. */
async function faceDock(page: Page, framing: string, name: string): Promise<Locator> {
  await expect(page.getByText(framing, { exact: true })).toBeVisible({ timeout: 8000 });
  const dock = page.getByRole('region', { name: 'Controls' });
  await expect(dock, `the face's dock ${name}`).toBeVisible();
  return dock;
}

/** Simple mode: the journal → Almanac → the parent's pill. */
async function openFace(page: Page, name: ParentName): Promise<Locator> {
  const f = PARENT(name);
  await hermetic(page);
  await seedLoanAndGoto(page);
  await page.getByLabel('Almanac').click();
  await page.getByRole('button', { name: f.pill }).click();
  return faceDock(page, f.framing, f.name);
}

/** The block the dock settles under: the disclaimer on Cycling and Strategy, the two-column shell on Ownership. */
const before = (dock: Locator): Locator => dock.locator('xpath=preceding-sibling::*[1]');
/** A card's twin of a dock button — the same name, outside the dock (the parents have no other role="region"). */
const outsideDock = (page: Page, name: string): Locator =>
  page.locator(`xpath=//button[normalize-space()="${name}"][not(ancestor::*[@role="region"])]`);

/** EDGE (Δ2) — the open panel's controls start right of EdgeBackGesture's swipe-back zone. */
async function expectClearOfTheEdge(page: Page, dock: Locator, name: string): Promise<void> {
  const zone = (await page.getByTestId('edge-back-zone').boundingBox())!;
  expect((await dock.getByLabel('Inspect month').boundingBox())!.x, `EDGE ${name}`).toBeGreaterThanOrEqual(zone.x + zone.width);
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

  test('under 1024px on a computer: Escape from inside the dock folds the open tab and gives its tab focus back; a typed value\'s Escape only cancels the edit; an Escape from the page leaves the dock alone', async ({ page }) => {
    // DC1 (spec v1.3) — the owner's computer window showed the tabs, where Escape did nothing.
    await page.setViewportSize({ width: 900, height: 900 });
    const dock = await openDecision(page);
    await expect(dock.getByRole('button'), 'TABS').toHaveText([/^Month/, /^Stress/, /^Path/, /^Line/, /^Policy/]);
    const panel = dock.locator('[id$="-panel"]');
    // TABS-ESCAPE, TABS-FOCUS — from a control inside the panel, which unmounts with the fold: focus goes to its tab.
    const path = dock.getByRole('button', { name: /^Path/ });
    await path.click();
    await dock.getByRole('button', { name: 'Fair', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(panel, 'TABS-ESCAPE').toHaveCount(0);
    await expect(path, 'TABS-FOCUS').toBeFocused();
    // TABS-EDIT-ESC — a typed value's Escape belongs to the field: the edit is cancelled, and the panel stays.
    await dock.getByRole('button', { name: /^Policy/ }).click();
    const setting = dock.getByText('Coinbase limit at support', { exact: true });
    await setting.locator('xpath=../following-sibling::div[1]').click();
    const field = dock.locator('input[type="text"]');
    await expect(field, 'TABS-EDIT-ESC: editing').toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field, 'TABS-EDIT-ESC: the edit cancelled').toHaveCount(0);
    await expect(setting, 'TABS-EDIT-ESC: the panel stays').toBeVisible();
    // TABS-PAGE — with focus outside the dock, an Escape is the page's (an ⓘ tip, a chart drag): the open tab stays.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(setting, 'TABS-PAGE').toBeVisible();
  });
});

test.describe('Sticky controls — the parents on a phone (Run 2)', () => {
  test('Cycling: four tabs, Month open and clear of the swipe-back edge; the notes stay in place; the dock holds the edge; Path drives the price-path card and brings the 4-yr timing; Policy drives its card', async ({ page }) => {
    const dock = await openFace(page, 'cycling');
    // ONCE-DOM — the scrubber card is gone: the month exists once, in the dock, and the folded stress not at all.
    await expect(page.getByLabel('Inspect month'), 'ONCE-DOM cycling').toHaveCount(1);
    await expect(page.getByLabel('Price stress multiplier'), 'ONCE-DOM cycling').toHaveCount(0);
    await expect(dock.getByRole('button'), 'TABS cycling').toHaveText([/^Month/, /^Stress/, /^Path/, /^Policy/]);
    await expectClearOfTheEdge(page, dock, 'cycling');
    // NOTE — the card's notes stay where it was: outside the dock, above Holdings by venue.
    const note = page.getByText(/^Stress from this month forward/);
    await expect(note, 'NOTE cycling').toHaveCount(1);
    await expect(dock.getByText(/^Stress from this month forward/), 'NOTE cycling: not in the dock').toHaveCount(0);
    expect((await note.boundingBox())!.y, 'NOTE cycling: in place')
      .toBeLessThan((await page.getByText('Holdings by venue', { exact: true }).boundingBox())!.y);
    await expectPinned(page, dock, 844, 'cycling phone', { end: before(dock), minScroll: 600 });
    // PATH-TAB, REMOTE (I4) — the dock's Path writes the price-path card's overlay.
    const pathTab = dock.getByRole('button', { name: /^Path/ });
    await pathTab.click();
    await dock.getByRole('button', { name: 'Fair', exact: true }).click();
    await expect(pathTab, 'PATH-TAB cycling').toHaveText(/^Path\s*Fair$/);
    const card = page.locator('section', { has: page.getByText('Price path', { exact: true }) });
    await expect(card.getByRole('button', { name: 'Fair', exact: true }), 'REMOTE cycling').toHaveAttribute('aria-pressed', 'true');
    // TIMING, TIMING-REMOTE — the 4-yr path brings its timing slider into the dock, and it moves the card's.
    await dock.getByRole('button', { name: '4-yr cycle', exact: true }).click();
    const timing = dock.getByLabel('4-yr cycle timing');
    await expect(timing, 'TIMING cycling').toBeVisible();
    await timing.focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
    await expect(card.getByText('+2 mo late', { exact: true }), 'TIMING-REMOTE cycling').toBeVisible();
    expect((await dock.boundingBox())!.height, 'PATH-4YR cycling: under half the screen').toBeLessThan(844 / 2);
    // POLICY-TAB, REMOTE-POLICY — the dock's Turn policy off is the card's.
    const policyTab = dock.getByRole('button', { name: /^Policy/ });
    await policyTab.click();
    await dock.getByRole('button', { name: 'Turn policy off' }).click();
    await expect(policyTab, 'POLICY-TAB cycling').toHaveText(/^Policy\s*off$/);
    const policyCard = page.getByRole('button', { name: 'About the support policy' }).locator('xpath=ancestor::section[1]');
    await expect(policyCard.getByText(/^Off — limits are measured at today's price/), 'REMOTE-POLICY cycling').toBeVisible();
  });

  test('Ownership: "Inspect month" and the dock\'s readout; four tabs; the notes in place; the dock holds the edge and settles under both columns; Path and Policy drive the cards', async ({ page }) => {
    const dock = await openFace(page, 'ownership');
    // RENAME — one name on all four faces; READOUT — the dock's words (Δ10).
    await expect(page.getByLabel('Month', { exact: true }), 'RENAME').toHaveCount(0);
    await expect(page.getByLabel('Inspect month'), 'RENAME').toHaveCount(1);
    await expect(dock.getByText('month 24 · 2.0 yr', { exact: true }), 'READOUT ownership').toBeVisible();
    await expect(dock.getByRole('button'), 'TABS ownership').toHaveText([/^Month/, /^Stress/, /^Path/, /^Policy/]);
    await expectClearOfTheEdge(page, dock, 'ownership');
    // NOTE — in place: in the main column, above the stat grid.
    const note = page.getByText(/^Stress from this month forward/);
    await expect(note, 'NOTE ownership').toHaveCount(1);
    await expect(dock.getByText(/^Stress from this month forward/), 'NOTE ownership: not in the dock').toHaveCount(0);
    expect((await note.boundingBox())!.y, 'NOTE ownership: in place')
      .toBeLessThan((await page.getByText('Net ownership', { exact: true }).boundingBox())!.y);
    await expectPinned(page, dock, 844, 'ownership phone', { end: before(dock), minScroll: 600 });
    // PATH-TAB, REMOTE — the face's own path buttons ("To fair"), the tab's shared word ("Fair").
    const pathTab = dock.getByRole('button', { name: /^Path/ });
    await pathTab.click();
    await dock.getByRole('button', { name: 'To fair', exact: true }).click();
    await expect(pathTab, 'PATH-TAB ownership').toHaveText(/^Path\s*Fair$/);
    await expect(outsideDock(page, 'To fair'), 'REMOTE ownership').toHaveAttribute('aria-pressed', 'true');
    const policyTab = dock.getByRole('button', { name: /^Policy/ });
    await policyTab.click();
    await dock.getByRole('button', { name: 'Turn policy off' }).click();
    await expect(policyTab, 'POLICY-TAB ownership').toHaveText(/^Policy\s*off$/);
  });

  test('Strategy: five tabs, Lens last; the switch lives only in the dock and both views render (I20); a stress survives a flip (F18); the notes in place; the dock holds the edge', async ({ page }) => {
    const dock = await openFace(page, 'strategy');
    await expect(dock.getByRole('button'), 'TABS strategy').toHaveText([/^Month/, /^Stress/, /^Path/, /^Policy/, /^Lens/]);
    await expectClearOfTheEdge(page, dock, 'strategy');
    // LENS-ONCE — folded, the switch is nowhere on the page.
    await expect(page.getByRole('group', { name: 'Lens' }), 'LENS-ONCE: off the page').toHaveCount(0);
    await expect(page.getByText(/^Yours in bitcoin/), 'VIEW: Position').toBeVisible();
    await expect(page.getByText(/^Cash flow at month/), 'VIEW: Position').toHaveCount(0);
    // STRESS — the dock's Stress moves `lens`, the price stress (F18).
    const stressTab = dock.getByRole('button', { name: /^Stress/ });
    await stressTab.click();
    await dock.getByLabel('Price stress multiplier').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await expect(stressTab, 'STRESS').toHaveText(/^Stress\s*−3%$/);
    // LENS — the dock's Lens moves `lensView`: Flywheel replaces Position below.
    const lensTab = dock.getByRole('button', { name: /^Lens/ });
    await lensTab.click();
    await expect(page.getByRole('group', { name: 'Lens' }), 'LENS-ONCE: in the dock').toHaveCount(1);
    await expect(dock.getByRole('group', { name: 'Lens' }), 'LENS-ONCE: in the dock').toHaveCount(1);
    await dock.getByRole('button', { name: 'Flywheel', exact: true }).click();
    await expect(lensTab, 'LENS').toHaveText(/^Lens\s*Flywheel$/);
    await expect(page.getByText(/^Cash flow at month/), 'LENS: the Flywheel view').toBeVisible();
    await expect(page.getByText(/^Yours in bitcoin/), 'LENS: the Position view gone').toHaveCount(0);
    // STRESS-HOLDS — flipping the view resets nothing.
    await expect(stressTab, 'STRESS-HOLDS').toHaveText(/^Stress\s*−3%$/);
    await dock.getByRole('button', { name: 'Position', exact: true }).click();
    await expect(page.getByText(/^Yours in bitcoin/), 'LENS-BACK').toBeVisible();
    // NOTE — in place: above the tiles.
    const note = page.getByText(/^Stress from this month forward/);
    await expect(note, 'NOTE strategy').toHaveCount(1);
    expect((await note.boundingBox())!.y, 'NOTE strategy: in place')
      .toBeLessThan((await page.getByText('Total debt', { exact: true }).boundingBox())!.y);
    await expectPinned(page, dock, 844, 'strategy phone', { end: before(dock), minScroll: 600 });
  });
});

test.describe('Sticky controls — the parents on a computer (Run 2)', () => {
  // Z20 — Playwright Test applies the project's `use` (a touch phone) unless these are set false.
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('the three bars: month and stress live, each head one line at 1440 and 1024; the chips; the edge at 888; Path opens upward with its 4-yr timing', async ({ page }) => {
    test.setTimeout(60_000);   // three faces in one test (the full-mode test's budget)
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByLabel('Almanac').click();
    for (const f of PARENTS) {
      await scrollBody(page, 0);
      await page.getByRole('button', { name: f.pill }).click();
      const dock = await faceDock(page, f.framing, f.name);
      const month = dock.getByLabel('Inspect month');
      await expect(page.getByLabel('Inspect month'), `ONCE-DOM ${f.name}`).toHaveCount(1);
      await expect(page.getByLabel('Price stress multiplier'), `ONCE-DOM ${f.name}`).toHaveCount(1);
      await expect(dock.getByRole('button'), `LIVE ${f.name}`).toHaveText([...f.chips]);
      // NO-WRAP (R2, R4) — each live slider's head on one line, so the bar keeps its height.
      for (const w of [1440, 1024]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const label of ['Inspect month', 'Price stress']) {
          const head = dock.getByText(label, { exact: true }).locator('..');
          expect((await head.boundingBox())!.height, `NO-WRAP ${f.name} ${label} at ${w}`).toBeLessThan(24);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      // UP, 4YR-UP — Path's panel opens above the bar, and the 4-yr timing comes with it.
      await dock.getByRole('button', { name: /^Path/ }).click();
      expect(await bottomOf(dock.getByRole('button', { name: f.fair, exact: true })), `UP ${f.name}`)
        .toBeLessThan((await month.boundingBox())!.y);
      await dock.getByRole('button', { name: f.fourYear, exact: true }).click();
      const timing = dock.getByLabel('4-yr cycle timing');
      await expect(timing, `4YR-UP ${f.name}`).toBeVisible();
      expect(await bottomOf(timing), `4YR-UP ${f.name}`).toBeLessThan((await month.boundingBox())!.y);
      await page.keyboard.press('Escape');
      await expect(timing, `4YR-UP ${f.name}: folded`).toHaveCount(0);
      await expectPinned(page, dock, 888, `${f.name} computer`, { end: before(dock), minScroll: 600 });
    }
  });

  test('Strategy\'s Lens chip opens upward and flips the view; Escape folds it and gives the chip focus back', async ({ page }) => {
    const dock = await openFace(page, 'strategy');
    const lens = dock.getByRole('button', { name: /^Lens/ });
    await expect(lens, 'LENS-CHIP').toHaveText(/^Lens\s*Position/);
    await lens.click();
    const flywheel = dock.getByRole('button', { name: 'Flywheel', exact: true });
    expect(await bottomOf(flywheel), 'LENS-UP').toBeLessThan((await dock.getByLabel('Inspect month').boundingBox())!.y);
    await flywheel.click();
    await expect(lens, 'LENS-VIEW').toHaveText(/^Lens\s*Flywheel/);
    await expect(page.getByText(/^Cash flow at month/), 'LENS-VIEW').toBeVisible();
    // ESCAPE, ESCAPE-FOCUS (Δ4) — Safari never focuses a clicked button; the blur stands in for it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(flywheel, 'ESCAPE').toHaveCount(0);
    await expect(lens, 'ESCAPE-FOCUS').toBeFocused();
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

  test('full mode: Ownership\'s dock holds the bottom edge and settles under both columns — a computer and a phone', async ({ browser, baseURL }) => {
    // Run 2 — the parent with the two-column shell (F16). Two contexts of its own (Z20), as the Decision test's.
    test.setTimeout(60_000);
    const SURFACES = [
      { name: 'full ownership computer', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, edge: 888 },
      { name: 'full ownership phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, edge: 844 },
    ];
    const f = PARENT('ownership');
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
        await page.getByRole('button', { name: f.pill }).click();
        const dock = await faceDock(page, f.framing, s.name);
        await expectPinned(page, dock, s.edge, s.name, { end: before(dock), minScroll: 600 });
      } finally {
        await ctx.close();
      }
    }
  });
});
