import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * BL14 — the plan's goal amount (Batch 1, build 2; spec pbloc-spec-batch-1-v1 §2.2): set in Settings → Your plan; THIS
 * MONTH and Daily print the month's goal line; the Dashboard's tile reads net coins today; "No goal" clears all three.
 * Hermetic: the round synthetic loan seed — $50,000 on 1 ₿ at a manual $100,000, nothing on Strike, nothing cold — live
 * prices aborted, the price history stubbed, a fixed day. Net coins today: 1 − 50,000 / 100,000 = ₿0.500; this month, after
 * a month of Coinbase interest (6.27%): ₿0.497. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const LOAN = "hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1";
const seedOf = (state: string): string => `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, btcPriceMode: 'manual', btcPrice: 100000, advisorStartDate: '2026-10-01', ${state} },
    version: ${STORE_VERSION},
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');`;

async function start(page: Page, state: string): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.addInitScript(seedOf(state));
  await page.goto('/');
}

async function openYourPlan(page: Page): Promise<void> {
  await page.getByLabel('Settings').click();
  await page.getByRole('button', { name: /Your plan/ }).click();
  await expect(page.getByRole('heading', { name: 'Your plan' }), 'Your plan opens').toBeVisible();
}
/** Back from Settings to the journal, then to Daily (Settings returns to whichever view opened it). */
async function leaveSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '← Settings' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('tab', { name: 'Daily' }).click();
  await expect(page.getByLabel('Log an event'), 'back on Daily').toBeVisible();
}

const UNDER = "Net coins this month: ₿0.497 of your ₿2.000 goal, at today's price.";
const AT = 'At your goal (net coins this month: ₿0.497 of ₿0.400): the plan borrows and buys nothing — spare income repays Coinbase.';

test.describe('the goal amount — BL14', () => {
  test('GOAL — Settings sets it; Daily and THIS MONTH read it, under and at it; a bad entry changes nothing; "No goal" clears it', async ({ page }) => {
    await start(page, `simpleMode: true, simpleView: 'daily', ${LOAN}`);
    await expect(page.getByLabel('Log an event'), 'on Daily').toBeVisible({ timeout: 15_000 });
    const daily = page.locator('[class*="pbcard"]');
    await expect(daily.getByText(/Net coins this month|At your goal/), 'NONE no goal line by default').toHaveCount(0);

    // SET — typed, then Enter: saved once, and the field shows it
    await openYourPlan(page);
    const field = page.getByLabel('Your goal in net coins');
    await expect(field, 'SET empty by default').toHaveValue('');
    await field.fill('2');
    await field.press('Enter');
    await expect(field, 'SET saved').toHaveValue('2');
    await expect(page.getByRole('button', { name: 'No goal' }), 'SET the clear button').toBeVisible();
    await leaveSettings(page);

    // UNDER — Daily and THIS MONTH: the month's figure against the goal
    await expect(daily.getByText(UNDER, { exact: true }), 'UNDER Daily').toBeVisible();
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await expect(page.getByText(UNDER, { exact: true }), 'UNDER THIS MONTH').toBeVisible();
    await page.getByText('Why this plan?', { exact: true }).click();
    await expect(page.getByText(/Net coins this month, at today's price once this month's Coinbase interest is added, are ₿0\.497 — under your ₿2\.000 goal\./),
      'UNDER why').toBeVisible();

    // BAD — not an amount: said, and the goal stays; leaving the field saves the change (blur)
    await openYourPlan(page);
    await field.fill('abc');
    await field.blur();
    await expect(page.getByRole('alert'), 'BAD said').toHaveText('Type an amount of bitcoin above zero, like 2 or 0.5 — or leave it empty for no goal.');
    await field.fill('0.4');
    await field.blur();
    await expect(page.getByRole('alert'), 'BAD cleared').toHaveCount(0);
    await expect(field, 'AT saved on blur').toHaveValue('0.4');
    await leaveSettings(page);

    // AT — the plan borrows and buys nothing; this month's spare income goes to Coinbase (over its limit), as the to-do says
    await expect(daily.getByText(AT, { exact: true }), 'AT Daily').toBeVisible();
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await expect(page.getByText(AT, { exact: true }), 'AT THIS MONTH').toBeVisible();
    const rows = page.locator('ul[class*="pmList"] > li');
    await expect(rows.nth(0), 'AT the to-do').toContainText('Repay Coinbase');
    await expect(rows.filter({ hasText: 'Draw on Strike' }), 'AT no draw').toContainText('—');
    await expect(rows.filter({ hasText: 'Buy bitcoin' }), 'AT no buy').toContainText('—');

    // CLEAR — "No goal": the field empties, the lines go
    await openYourPlan(page);
    await page.getByRole('button', { name: 'No goal' }).click();
    await expect(field, 'CLEAR the field').toHaveValue('');
    await leaveSettings(page);
    await expect(daily.getByText(/Net coins this month|At your goal/), 'CLEAR Daily').toHaveCount(0);
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await expect(page.getByText(/Net coins this month|At your goal/), 'CLEAR THIS MONTH').toHaveCount(0);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('TILE — the Dashboard reads net coins today against the goal; no goal, no tile', async ({ page }) => {
    await start(page, `simpleMode: true, simpleView: 'dashboard', planGoalNetBtc: 2, ${LOAN}`);
    const tile = page.getByRole('group', { name: /^Your goal:/ });
    await expect(tile, 'TILE shows').toBeVisible({ timeout: 15_000 });
    await expect(tile, 'TILE the figure — today, at the live (here manual) price').toContainText('₿0.500 of ₿2.000');
    await expect(tile, 'TILE the share').toContainText('net coins today · 25%');
    await expect(tile, 'TILE never names a plan move').not.toContainText(/borrow|buy|repay/);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('TILE — none without a goal', async ({ page }) => {
    await start(page, `simpleMode: true, simpleView: 'dashboard', ${LOAN}`);
    await expect(page.getByText("If BTC were at support ($64,700): 77.3% LTV — over the plan's 45% limit"), 'NONE the Dashboard')
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('group', { name: /^Your goal:/ }), 'NONE no tile').toHaveCount(0);
  });
});
