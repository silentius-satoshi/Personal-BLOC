import { test, expect, type Page } from '@playwright/test';
import { openAlmanacFace, mouseDragX, STORE_VERSION } from './helpers';

/**
 * BL47 — the simple-mode header's way out says where it goes (spec `pbloc-spec-back-label-v1`), on screen: "← Dashboard"
 * or "← Journal" by where the owner came from, in Settings and in the Almanac — on the grid and on a face — and a tap
 * opens that page; Settings opened from inside the Almanac says "← Almanac", and the Almanac then leaves to the journal,
 * never to itself — by its "←" and by its swipe from the grid. A viewer's "← Home" and the preview's "← Preview" are
 * the rule's unit test (`backPlace.test.ts`): the dev server reaches neither page. With the five journal tabs hidden and
 * no loan, simple mode still opens the journal and every "←" goes where it says; full mode keeps its guard (HIDDEN —
 * Claude Code's F1). Each assertion carries the tag its planted bug turns red.
 */
/** A seed in simple or full mode, on a journal view; `extra` adds fields. */
const seed = (simple: boolean, view: 'dashboard' | 'daily' | 'monthly', extra = ''): string => `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, simpleMode: ${simple}, simpleView: '${view}'${extra} },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;
/** The header's "←", by the name it should carry. */
const back = (page: Page, place: string) => page.getByRole('button', { name: `← ${place}`, exact: true });
const grid = (page: Page) => page.getByRole('navigation', { name: 'Faces' });
/** The nav's Dashboard icon, current on the Dashboard; the Journal's Daily and Monthly tabs. */
const dashboard = (page: Page) => page.getByRole('button', { name: 'Dashboard', exact: true });
const tab = (page: Page, name: 'Daily' | 'Monthly') => page.getByRole('tab', { name });

/**
 * Full mode's way to Settings from inside the Almanac — the Almanac by Tools, Settings by the brand menu, so
 * `previousTab` is 'almanac' — then the simple view: Settings (Branch H), whose "←" goes to the Almanac.
 */
async function settingsFromInsideTheAlmanac(page: Page): Promise<void> {
  const tools = page.getByRole('button', { name: /^Tools/ });
  await expect(tools).toBeVisible({ timeout: 15_000 });
  await tools.click();
  await page.getByRole('button', { name: 'Almanac', exact: true }).click();
  await expect(grid(page)).toBeVisible();
  await page.getByRole('button', { name: /Personal ₿LOC/ }).click();
  await page.locator('[class*="dropdown"] button', { hasText: 'Settings' }).click();
  await page.getByLabel('Switch to simple view').click();
}

test.describe('the header\'s way out, named (BL47)', () => {
  test('⭐ DASH — from the Dashboard: "← Dashboard" in Settings and in the Almanac, on the grid and on a face; a tap opens the Dashboard', async ({ page }) => {
    await page.addInitScript(seed(true, 'dashboard'));
    await page.goto('/');
    await expect(dashboard(page), 'DASH the Dashboard').toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
    await page.getByLabel('Settings').click();
    await expect(back(page, 'Dashboard'), 'DASH Settings').toBeVisible();
    await back(page, 'Dashboard').click();
    await expect(dashboard(page), 'DASH Settings → the Dashboard').toHaveAttribute('aria-current', 'page');
    await page.getByLabel('Almanac').click();
    await expect(back(page, 'Dashboard'), 'DASH the grid').toBeVisible();
    await openAlmanacFace(page, 'Halving Clock');
    await expect(page.getByText('Next halving'), 'DASH a face').toBeVisible();
    await expect(back(page, 'Dashboard'), 'DASH on a face').toBeVisible();
    await back(page, 'Dashboard').click();
    await expect(dashboard(page), 'DASH the Almanac → the Dashboard').toHaveAttribute('aria-current', 'page');
  });

  test('⭐ JOURNAL — from the Journal\'s Daily tab: "← Journal" in Settings and in the Almanac; a tap opens Daily', async ({ page }) => {
    await page.addInitScript(seed(true, 'daily'));
    await page.goto('/');
    await expect(tab(page, 'Daily'), 'JOURNAL Daily').toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await page.getByLabel('Settings').click();
    await expect(back(page, 'Journal'), 'JOURNAL Settings').toBeVisible();
    await back(page, 'Journal').click();
    await expect(tab(page, 'Daily'), 'JOURNAL Settings → Daily').toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Almanac').click();
    await expect(back(page, 'Journal'), 'JOURNAL the grid').toBeVisible();
    await openAlmanacFace(page, 'Halving Clock');
    await expect(page.getByText('Next halving'), 'JOURNAL a face').toBeVisible();
    await expect(back(page, 'Journal'), 'JOURNAL on a face').toBeVisible();
    await back(page, 'Journal').click();
    await expect(tab(page, 'Daily'), 'JOURNAL the Almanac → Daily').toHaveAttribute('aria-selected', 'true');
  });

  test('⭐ MONTH — from THIS MONTH (the Journal\'s Monthly tab): "← Journal"; a tap opens THIS MONTH again', async ({ page }) => {
    await page.addInitScript(seed(true, 'monthly'));
    await page.goto('/');
    await expect(tab(page, 'Monthly'), 'MONTH Monthly').toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await page.getByLabel('Settings').click();
    await expect(back(page, 'Journal'), 'MONTH Settings').toBeVisible();
    await back(page, 'Journal').click();
    await expect(tab(page, 'Monthly'), 'MONTH Settings → THIS MONTH').toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Almanac').click();
    await expect(back(page, 'Journal'), 'MONTH the Almanac').toBeVisible();
    await back(page, 'Journal').click();
    await expect(tab(page, 'Monthly'), 'MONTH the Almanac → THIS MONTH').toHaveAttribute('aria-selected', 'true');
  });

  test('⭐ NOWHERE — Settings opened inside the Almanac says "← Almanac"; the Almanac then leaves to the journal, never to itself — by its "←" and by its swipe from the grid', async ({ page }) => {
    await page.addInitScript(seed(false, 'daily'));
    await page.goto('/');
    await settingsFromInsideTheAlmanac(page);
    await expect(back(page, 'Almanac'), 'NOWHERE Settings names the Almanac').toBeVisible();
    await back(page, 'Almanac').click();
    await expect(grid(page), 'NOWHERE back in the Almanac').toBeVisible();
    await expect(back(page, 'Journal'), 'NOWHERE the Almanac never names itself').toBeVisible();
    await back(page, 'Journal').click();
    await expect(page.getByLabel('Log an event'), 'NOWHERE the button leaves').toBeVisible();
    await expect(grid(page), 'NOWHERE the button leaves the Almanac').toHaveCount(0);
    // Once more, and out by the swipe from the grid. While the swipe animates, its under-layer shows the journal, so the
    // proof it left is the Almanac gone — not the journal shown.
    await page.getByLabel('Switch to full app').click();
    await settingsFromInsideTheAlmanac(page);
    await back(page, 'Almanac').click();
    await expect(grid(page)).toBeVisible();
    await mouseDragX(page, 8, page.viewportSize()!.height / 2, 234);
    await expect(grid(page), 'NOWHERE the swipe leaves the Almanac').toHaveCount(0);
    await expect(page.getByLabel('Log an event'), 'NOWHERE the swipe leaves').toBeVisible();
  });

  test('⭐ HIDDEN — the five journal tabs hidden, no loan: simple mode opens the journal and every "←" goes where it says; full mode keeps its guard', async ({ page }) => {
    await page.addInitScript(seed(true, 'daily', `, hiddenTabs: ['living', 'bloc', 'powerlaw', 'converter', 'mining']`));
    await page.goto('/');
    await expect(tab(page, 'Daily'), 'HIDDEN simple mode opens the journal').toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await page.getByLabel('Almanac').click();
    await expect(back(page, 'Journal'), 'HIDDEN the Almanac').toBeVisible();
    await back(page, 'Journal').click();
    await expect(tab(page, 'Daily'), 'HIDDEN the Almanac → Daily').toHaveAttribute('aria-selected', 'true');
    await expect(grid(page), 'HIDDEN the Almanac left').toHaveCount(0);
    await page.getByLabel('Settings').click();
    await expect(back(page, 'Journal'), 'HIDDEN Settings').toBeVisible();
    await back(page, 'Journal').click();
    await expect(tab(page, 'Daily'), 'HIDDEN Settings → Daily').toHaveAttribute('aria-selected', 'true');
    // Full mode keeps its guard: a hidden tab never stays open there — the first one shown is the Almanac.
    await page.getByLabel('Switch to full app').click();
    await expect(grid(page), 'HIDDEN full mode opens the first tab shown').toBeVisible({ timeout: 15_000 });
  });
});
