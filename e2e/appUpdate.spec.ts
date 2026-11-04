import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * BL51 — app updates (spec pbloc-spec-app-updates-v1): the app asks which build is live when it opens (10 s in), when it
 * comes back to the front (at most once a minute) and hourly; another build → "New version ready · Update" on the home
 * (the owner's Dashboard, a viewer's home — never the owner's preview of his viewer) and in Settings → About; one tap
 * restarts it, and nothing else does. The dev server has no service worker and no `version.json` (the file is the
 * build's), so each test routes `/version.json` — another build, this one, an older deploy's page (the SPA rewrite's
 * HTML), no network, or no answer at all — and installs Playwright's clock to run the schedule. With no service worker
 * the tap is a plain restart; the worker's own path (a new one installs, takes over, and registerSW restarts the page)
 * is the spec's §4, measured on two production builds. Round synthetic figures; every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const PRICE = `btcPriceMode: 'manual', btcPrice: 100000`;
const OWNER = (view: 'dashboard' | 'daily') => `onboardingComplete: true, ${PRICE}, advisorStartDate: '2026-10-01',
  simpleMode: true, simpleView: '${view}', hasCbLoan: false`;
const seed = (state: string) => `window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({ state: { ${state} }, version: ${STORE_VERSION} }));
  localStorage.setItem('personal-bloc-onboarded', '1');`;
const STORE_MOD = '/src/store/useStore.ts';
const UPDATE_MOD = '/src/lib/appUpdate.ts';

/** What `/version.json` answers: a build's stamp (another, or this one), an older deploy (its page), no network, or
 *  nothing ever (a request that hangs). */
type Live = { sha: string; time: string } | { html: true } | { offline: true } | { hangs: true };
const NEXT: Live = { sha: 'e2e0next', time: '2026-10-12T11:00:00.000Z' };
const PAGE: Live = { html: true };
const OFFLINE: Live = { offline: true };
const HANGS: Live = { hangs: true };

async function open(page: Page, state: string, first: Live): Promise<{ live: { now: Live }; asked: () => number }> {
  const live = { now: first };
  let n = 0;
  await page.clock.install({ time: new Date('2026-10-12T12:00:00') });
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.route(/\/version\.json(\?|$)/, (r) => {
    n++;
    const l = live.now;
    if ('hangs' in l) return undefined;   // never answered: the app's own time limit ends it
    if ('offline' in l) return r.abort('internetdisconnected');
    if ('html' in l) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sha: l.sha, time: l.time }) });
  });
  await page.addInitScript(seed(state));
  await page.goto('/');
  return { live, asked: () => n };
}

const greeting = (page: Page) => page.getByText(/^Good (morning|afternoon|evening)/);
const card = (page: Page) => page.getByRole('status').filter({ hasText: /^(New version ready|Couldn’t update)/ });
const mark = (page: Page) => page.evaluate(() => { (window as unknown as { __bl51: number }).__bl51 = 1; });
const marked = (page: Page) => page.evaluate(() => (window as unknown as { __bl51?: number }).__bl51 ?? null);
const foreground = (page: Page, event: 'visibilitychange' | 'focus' | 'pageshow') => page.evaluate((e) => {
  (e === 'visibilitychange' ? document : window).dispatchEvent(new Event(e));
}, event);

test.describe('BL51 — app updates', () => {
  test('UPDATE CARD — another build live: the card at the open check; no restart through hours of checks; one tap restarts once', async ({ page }) => {
    const { asked } = await open(page, OWNER('dashboard'), NEXT);
    await expect(greeting(page), 'CARD the Dashboard').toBeVisible({ timeout: 20_000 });
    await mark(page);
    await page.clock.fastForward(10_000);
    await expect(card(page), 'CARD the open check finds it').toBeVisible({ timeout: 10_000 });
    await expect(card(page), 'CARD its words').toHaveText(/^New version ready\s*Update$/);
    expect(asked(), 'CARD one request').toBe(1);
    for (let h = 1; h <= 3; h++) await page.clock.fastForward('01:00:00');
    await expect.poll(asked, 'CARD the hourly checks ran').toBe(4);
    await expect(card(page), 'CARD still offered').toBeVisible();
    expect(await marked(page), 'CARD no restart by itself').toBe(1);
    let loads = 0;
    page.on('load', () => { loads++; });
    await card(page).getByRole('button', { name: 'Update', exact: true }).click();
    await expect.poll(() => marked(page), 'CARD the tap restarts').toBeNull();
    await expect(greeting(page), 'CARD the app again').toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);
    expect(loads, 'CARD once').toBe(1);
  });

  test('UPDATE FOREGROUND — back to the front: a check, at most one a minute, on screen; no stamp is never an update', async ({ page }) => {
    const { live, asked } = await open(page, OWNER('dashboard'), PAGE);
    await expect(greeting(page), 'FOREGROUND the Dashboard').toBeVisible({ timeout: 20_000 });
    await mark(page);
    await page.clock.fastForward(10_000);
    await expect.poll(asked, 'FOREGROUND the open check').toBe(1);
    await page.waitForTimeout(500);
    await expect(card(page), 'FOREGROUND an older deploy\'s page is no update').toHaveCount(0);
    live.now = NEXT;
    await page.clock.fastForward(30_000);
    for (const e of ['visibilitychange', 'focus', 'pageshow'] as const) await foreground(page, e);
    await page.waitForTimeout(500);
    expect(asked(), 'FOREGROUND within the minute: none').toBe(1);
    await page.clock.fastForward(31_000);
    await foreground(page, 'focus');
    await expect.poll(asked, 'FOREGROUND a minute on').toBe(2);
    await expect(card(page), 'FOREGROUND the card').toBeVisible({ timeout: 10_000 });
    await page.clock.fastForward(61_000);
    live.now = OFFLINE;
    await foreground(page, 'visibilitychange');
    await expect.poll(asked, 'FOREGROUND again').toBe(3);
    await page.waitForTimeout(500);
    await expect(card(page), 'FOREGROUND offline keeps the offer').toBeVisible();
    expect(await marked(page), 'FOREGROUND no restart by itself').toBe(1);
  });

  test('UPDATE STALL — a request that never answers ends at its limit; the next check goes out and finds the build', async ({ page }) => {
    const { live, asked } = await open(page, OWNER('dashboard'), HANGS);
    await expect(greeting(page), 'STALL the Dashboard').toBeVisible({ timeout: 20_000 });
    await mark(page);
    await page.clock.fastForward(10_000);
    await expect.poll(asked, 'STALL the open check went out').toBe(1);
    live.now = NEXT;
    await page.clock.fastForward(16_000);
    await page.clock.fastForward(50_000);
    await foreground(page, 'focus');
    await expect.poll(asked, 'STALL the next check went out').toBe(2);
    await expect(card(page), 'STALL the card').toBeVisible({ timeout: 10_000 });
    expect(await marked(page), 'STALL no restart by itself').toBe(1);
  });

  test('UPDATE ABOUT — Settings → About: this build → the latest; an older deploy or no network → couldn\'t check; another → Update, one tap', async ({ page }) => {
    const { live, asked } = await open(page, OWNER('daily'), PAGE);
    const settings = page.getByLabel('Settings');
    await expect(settings, 'ABOUT the way to Settings').toBeVisible({ timeout: 20_000 });
    await settings.click();
    const aboutRow = page.getByText('About', { exact: true });
    await expect(aboutRow, 'ABOUT the About row').toBeVisible({ timeout: 10_000 });
    await aboutRow.click();
    const build = page.getByText(/^Build \S+ · /);
    await expect(build, 'ABOUT the build line').toBeVisible({ timeout: 20_000 });
    const own = await page.evaluate(async (mod) => (await import(/* @vite-ignore */ mod)).ownStamp(), UPDATE_MOD) as { sha: string; time: string };
    expect(await build.innerText(), 'ABOUT premise: the bundle\'s own stamp, its sha on the build line').toContain(`Build ${own.sha} · `);
    const check = page.getByRole('button', { name: 'Check for updates', exact: true });
    const line = (text: string) => page.getByRole('status').filter({ hasText: text });
    await expect(page.getByText('Updates', { exact: true }), 'ABOUT the row').toBeVisible();
    await check.click();
    await expect(line('Couldn’t check — check your connection'), 'ABOUT an older deploy\'s page').toBeVisible();
    live.now = OFFLINE;
    await check.click();
    await expect.poll(asked, 'ABOUT asked again').toBeGreaterThanOrEqual(2);
    await expect(line('Couldn’t check — check your connection'), 'ABOUT offline').toBeVisible();
    live.now = own;
    await check.click();
    await expect(line('You’re on the latest version'), 'ABOUT this build').toBeVisible();
    await mark(page);
    live.now = NEXT;
    await check.click();
    await expect(line('New version ready'), 'ABOUT another build').toBeVisible();
    const update = page.getByRole('button', { name: 'Update', exact: true });
    await expect(update, 'ABOUT the tap').toBeVisible();
    expect(await marked(page), 'ABOUT no restart by itself').toBe(1);
    await update.click();
    await expect.poll(() => marked(page), 'ABOUT the tap restarts').toBeNull();
  });

  test('UPDATE PREVIEW — the card is the device\'s: never in the owner\'s preview of his viewer; on his Dashboard after it', async ({ page }) => {
    await open(page, OWNER('dashboard'), NEXT);
    await expect(greeting(page), 'PREVIEW the Dashboard').toBeVisible({ timeout: 20_000 });
    await mark(page);
    await page.evaluate(async (mod) => {
      const { useStore } = await import(/* @vite-ignore */ mod);
      useStore.getState().setViewerPreview(true);
    }, STORE_MOD);
    await expect(page.getByRole('button', { name: '✕ Exit preview' }), 'PREVIEW the preview').toBeVisible();
    await page.clock.fastForward(10_000);
    await page.waitForTimeout(1_000);
    expect(await marked(page), 'PREVIEW no restart by itself').toBe(1);
    await expect(greeting(page), 'PREVIEW his viewer\'s home').toBeVisible();
    await expect(card(page), 'PREVIEW no card').toHaveCount(0);
    const exit = page.getByRole('button', { name: '✕ Exit preview' });
    await expect(exit, 'PREVIEW the way out').toBeVisible();
    await exit.click();
    await expect(card(page), 'PREVIEW his Dashboard has it').toBeVisible({ timeout: 10_000 });
  });

  test('UPDATE VIEWER — a viewer\'s home offers it too, and his Settings', async ({ page }) => {
    await open(page, `onboardingComplete: true, viewerMode: true, simpleMode: true, ${PRICE}`, NEXT);
    await expect(greeting(page), 'VIEWER his home').toBeVisible({ timeout: 20_000 });
    await page.clock.fastForward(10_000);
    await expect(card(page), 'VIEWER the card').toBeVisible({ timeout: 10_000 });
    const settings = page.getByLabel('Settings');
    await expect(settings, 'VIEWER the way to his Settings').toBeVisible();
    await settings.click();
    await expect(page.getByText('Updates', { exact: true }), 'VIEWER his Settings\' row').toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Update', exact: true }), 'VIEWER his Settings offer it').toBeVisible();
  });
});
