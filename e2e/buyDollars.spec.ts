import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION, sheet, waitForSheetAtRest } from './helpers';

// 5d (BL13) — a buy's dollars: "Dollars spent (incl. fee)", prefilled with the app's guess (the BTC at today's price),
// saved as typed, kept when the buy is edited — and a dollars-only edit keeps a signed month signed, with the figures its
// sign-off recorded. A manual $100,000 price (nothing polls), so the guess is exact. Round synthetic figures.
const seed = (opts: { buy?: boolean; signed?: boolean }) => `
  window.__APP_BOOTED = true;
  (function () {
    var d = new Date();
    var today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    var t = d.getTime() - 60000;
    var dayLog = [{ id: 'e2e-read-1', date: today, ts: t, kind: 'balanceReading', reading: { strikeBal: 5000, strikeLtv: 0.1, strikeCollateral: 0.5 } }];
    ${opts.buy ? "dayLog.push({ id: 'e2e-buy-1', date: today, ts: t + 1, kind: 'buy', amount: 0.01, usd: 650 });" : ''}
    ${opts.signed ? "dayLog.push({ id: 'e2e-draw-1', date: today, ts: t + 2, kind: 'draw', amount: 3000 });" : ''}
    // signed after its events (updatedAt): the sign-off recorded $2,500 of expenses for the $3,000 drawn (some from savings)
    var monthlyLog = ${opts.signed ? `[{ month: 1, date: today, btcBought: 0.01, income: 650, paydown: 0, strikeBal: 5000, strikeLtv: 0.1,
      loggedAt: t, updatedAt: t + 10, expensesActual: 2500, btcHeld: 0.5, provisional: false, collateralAdjustment: 0, source: 'daily', confirmed: true }]` : '[]'};
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily', advisorStartDate: today,
        btcPriceMode: 'manual', btcPrice: 100000, dayLog: dayLog, monthlyLog: monthlyLog,
        monthBucketReconcileDone: true
      },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  })();
`;

async function go(page: Page, opts: { buy?: boolean; signed?: boolean }): Promise<void> {
  await page.addInitScript(seed(opts));
  await page.goto('/');
  await expect(page.getByLabel('Log an event'), 'e2e seed failed to reach DailyModeView').toBeVisible({ timeout: 15_000 });
}

const HINT = "at today's price — change it to what you paid";
const dollars = (page: Page) => sheet(page).getByTestId('buy-dollars').locator('input');
/** Month 1's entry as this device stores it (the persisted store). */
const storedMonth1 = (page: Page) => page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state || {};
  return ((state.monthlyLog || []) as { month: number }[]).find((e) => e.month === 1);
});
const buyRow = (page: Page) => page.getByTestId('log-row').filter({ hasText: 'Bought Bitcoin' });

async function openBuyEdit(page: Page): Promise<void> {
  await buyRow(page).first().click();
  await expect(sheet(page)).toBeVisible();
  await waitForSheetAtRest(sheet(page));
}

test.describe('5d — a buy\'s dollars (BL13)', () => {
  test('E DOLLARS add: prefilled at today\'s price, saved as typed, kept when the BTC changes', async ({ page }) => {
    await go(page, {});
    await page.getByLabel('Log an event').click();
    const s = sheet(page);
    await expect(s).toBeVisible();
    await waitForSheetAtRest(s);
    await s.getByRole('button', { name: 'Buy ₿' }).click();
    const btcInput = s.locator('input').first();
    const hint = s.getByText(HINT);
    await expect(dollars(page), 'E DOLLARS tap premise — $0.00 before any bitcoin').toHaveValue('0.00');
    await expect(hint, 'E DOLLARS tap premise — no hint before a guess').toHaveCount(0);
    await dollars(page).click();                                              // a stray tap on the field…
    await btcInput.click();                                                   // …and away: its blur re-emits $0.00
    await btcInput.fill('0.012');
    await expect(dollars(page), 'E DOLLARS tap — the guess still comes').toHaveValue('1200.00');   // 0.012 × $100,000
    await expect(hint).toBeVisible();
    const save = s.getByRole('button', { name: 'Save' });
    await expect(save, 'E DOLLARS gate — premise').toBeEnabled();
    await dollars(page).fill('0');
    await expect(save, 'E DOLLARS gate — no dollars, no save').toBeDisabled();
    await dollars(page).fill('1234.56');
    await expect(save, 'E DOLLARS gate — dollars typed, save on').toBeEnabled();
    await expect(s.getByTestId('buy-implied-price')).toHaveText('≈ $102,880 per ₿ · today $100,000');
    await btcInput.fill('0.013');                                             // the BTC changes after the dollars were typed…
    await expect(dollars(page)).toHaveValue('1234.56');                       // …and the typed dollars stay
    await btcInput.fill('0.012');
    await save.click();
    await expect(s).toHaveCount(0);
    await expect(buyRow(page)).toHaveCount(1);
    await expect(buyRow(page)).toContainText('₿ 0.012 · $1,235');           // the typed dollars, not the guess's $1,200
  });

  test('E DOLLARS edit: the stored dollars, never re-priced', async ({ page }) => {
    await go(page, { buy: true });
    await openBuyEdit(page);
    await expect(dollars(page)).toHaveValue('650.00');                        // as stored — not 0.01 × $100,000
    await expect(sheet(page).getByText(HINT)).toHaveCount(0);
    const save = sheet(page).getByRole('button', { name: 'Save' });
    await dollars(page).fill('0');
    await expect(save, 'E DOLLARS edit gate — no dollars, no save').toBeDisabled();
    await dollars(page).fill('650');
    await expect(save, 'E DOLLARS edit gate — dollars back, save on').toBeEnabled();
    await sheet(page).locator('input').first().fill('0.011');
    await expect(dollars(page)).toHaveValue('650.00');                        // a BTC correction keeps what was paid
    await save.click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(buyRow(page)).toContainText('₿ 0.011 · $650');
  });

  test('E SIGNOFF: a dollars-only edit keeps the month signed; a BTC edit reopens it', async ({ page }) => {
    await go(page, { buy: true, signed: true });
    const monthTab = page.getByRole('tab', { name: 'Month', exact: true });
    const weekTab = page.getByRole('tab', { name: 'Week', exact: true });
    const review = page.getByRole('button', { name: 'Review', exact: true });
    await monthTab.click();
    await expect(page.getByText(/from \d+ day/)).toBeVisible();               // premise: the month view is up, with activity
    await expect(review).toHaveCount(0);                                      // premise: signed
    expect(await storedMonth1(page), 'E SIGNOFF premise — the seeded sign-off').toMatchObject({ confirmed: true, expensesActual: 2500 });

    await weekTab.click();
    await openBuyEdit(page);
    await expect(dollars(page), 'E SIGNOFF premise — the dollars field').toHaveValue('650.00');
    await dollars(page).fill('702.15');
    await sheet(page).getByRole('button', { name: 'Save' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(buyRow(page)).toContainText('₿ 0.01 · $702');
    await monthTab.click();
    await expect(page.getByText(/from \d+ day/)).toBeVisible();
    await expect(review).toHaveCount(0);                                      // still signed
    await expect.poll(() => storedMonth1(page), { message: 'E SIGNOFF figures kept — the sign-off\'s $2,500, not the $3,000 drawn' })
      .toMatchObject({ confirmed: true, expensesActual: 2500, income: 702.15 });

    await weekTab.click();
    await openBuyEdit(page);
    await sheet(page).locator('input').first().fill('0.012');
    await sheet(page).getByRole('button', { name: 'Save' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await monthTab.click();
    await expect(review).toBeVisible();                                       // a BTC edit reopens it (LD4)
    await expect.poll(() => storedMonth1(page), { message: 'E SIGNOFF re-rolled — a BTC edit takes the full path' })
      .toMatchObject({ confirmed: false, expensesActual: 3000, btcBought: 0.012 });
  });
});
