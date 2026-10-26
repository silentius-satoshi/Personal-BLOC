import { test, expect, type Page, type Locator } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * BL34–BL35 (F1) — leaving a page by the edge swipe-back, or by a tap on its left 20px, saves a typed plan setting as a
 * tap on "← Back" does (spec pbloc-spec-batch-1-v1 §2.2d). React runs no onBlur for a field it unmounts, and neither a
 * touch swipe nor the zone's forwarded tap moves focus, so `EdgeBackGesture` blurs the focused field first. A real
 * touch stream (CDP touch events, as on a phone): a mouse drag's mousedown blurs the field itself, so
 * navigation.spec.ts's swipes can't show it. Hermetic: round synthetic figures, live prices aborted, the price history
 * stubbed, a fixed day. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const STATE = `onboardingComplete: true, btcPriceMode: 'manual', btcPrice: 100000, advisorStartDate: '2026-10-01',
  simpleMode: true, simpleView: 'dashboard', expenses: 4000, advisorActualBlocBalance: 20000`;

async function start(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.addInitScript(`
    window.__APP_BOOTED = true;
    localStorage.setItem('personal-bloc-store', JSON.stringify({ state: { ${STATE} }, version: ${STORE_VERSION} }));
    localStorage.setItem('personal-bloc-onboarded', '1');`);
  await page.goto('/');
  await expect(page.getByLabel('Settings'), 'on the Dashboard').toBeVisible({ timeout: 15_000 });
}

/** A NumberInput by its visible label (a span, not a <label>). */
const fieldOf = (page: Page, label: string): Locator =>
  page.locator(`xpath=//span[normalize-space()="${label}"]/following-sibling::div//input`);
/** A plan field's saved values, from the persisted plan log. */
const saved = (page: Page, field: string): Promise<unknown[]> =>
  page.evaluate((f) => ((JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.planEvents ?? []) as
    { field: string; value: unknown }[]).filter((e) => e.field === f).map((e) => e.value), field);

/** Settings → a subpage, by touch. */
async function openSubpage(page: Page, row: RegExp): Promise<void> {
  await page.getByLabel('Settings').tap();
  await page.getByRole('button', { name: row }).tap();
}
/** Focus by a tap, clear, then type a figure one key at a time — as on a phone. */
async function typeByTouch(field: Locator, figure: string): Promise<void> {
  await field.tap();
  await field.fill('');
  await field.pressSequentially(figure, { delay: 40 });
}
/** A real touch swipe from the left bezel, past half the width (390 px): touchstart → touchmoves → touchend. */
async function touchSwipeBack(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const y = page.viewportSize()!.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 8, y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 8 + (260 * i) / 12, y }] });
    await page.waitForTimeout(8);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const isFocused = (field: Locator): Promise<boolean> => field.evaluate((el) => el === document.activeElement);

test.describe('number fields — leaving the page (BL34–BL35, F1)', () => {
  test('SWIPE — a typed plan setting saves once when the page is swiped away', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    const expenses = fieldOf(page, 'Monthly expenses');
    await typeByTouch(expenses, '4200');
    expect(await isFocused(expenses), 'PREMISE the field still has focus').toBe(true);
    expect(await saved(page, 'expenses'), 'PREMISE nothing saved as it is typed').toEqual([]);
    await touchSwipeBack(page);
    await expect(page.getByRole('button', { name: /Strike Strategy/ }), 'SWIPE back on the menu').toBeVisible();
    expect(await saved(page, 'expenses'), 'SWIPE saved once').toEqual([4200]);
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test('TAP — a typed plan setting saves when a tap on the edge strip leaves through "← Back"', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    const expenses = fieldOf(page, 'Monthly expenses');
    await typeByTouch(expenses, '4200');
    const back = (await page.getByRole('button', { name: '← Back' }).boundingBox())!;
    expect(back.x + 2, 'PREMISE the tap lands on the 20px zone, over "← Back"').toBeLessThan(20);
    await page.touchscreen.tap(back.x + 2, back.y + back.height / 2);
    await expect(page.getByLabel('Settings'), 'TAP left Settings').toBeVisible();
    expect(await saved(page, 'expenses'), 'TAP saved').toEqual([4200]);
  });

  test('GOAL — the goal field, which saves on leaving, saves when the page is swiped away', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Your plan/);
    const goal = page.getByLabel('Your goal in net coins');
    await typeByTouch(goal, '2.5');
    expect(await isFocused(goal), 'PREMISE the field still has focus').toBe(true);
    await touchSwipeBack(page);
    await expect(page.getByRole('button', { name: /Your plan/ }), 'GOAL back on the menu').toBeVisible();
    expect(await saved(page, 'planGoalNetBtc'), 'GOAL saved').toEqual([2.5]);
  });

  test('HELD — a typed dated figure is dropped when the page is swiped away, as designed: only its Save saves it', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    const drawn = fieldOf(page, 'Amount Drawn');
    await typeByTouch(drawn, '1234');
    await expect(page.getByRole('button', { name: 'Save — dated today' }), 'PREMISE its Save is offered').toBeVisible();
    await touchSwipeBack(page);
    await expect(page.getByRole('button', { name: /Strike Strategy/ }), 'HELD back on the menu').toBeVisible();
    expect(await saved(page, 'advisorActualBlocBalance'), 'HELD nothing saved').toEqual([]);
    await page.getByRole('button', { name: /Strike Strategy/ }).click();
    await expect(drawn, 'HELD the saved figure again').toHaveValue('20000');
    await expect(page.getByRole('button', { name: 'Save — dated today' }), 'HELD no Save left over').toHaveCount(0);
  });
});
