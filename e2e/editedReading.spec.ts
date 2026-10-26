import { test, expect, type Page, type Locator } from '@playwright/test';
import { STORE_VERSION, sheet, waitForSheetAtRest } from './helpers';

// N1 (BL39) — an edit keeps a reading's Strike collateral as recorded, through the sheet. Today's journal: a reading that
// records ₿1, a balance saved from the Safety card after it (a reading that records none), and a ₿0.2 Strike deposit
// logged on its own after both — so today's total, ₿1.2, is no reading's figure, and stamping it on either reading counts
// the deposit twice (₿1.4). A manual $100,000 price (nothing polls). Round synthetic figures.
const seed = (startDaysBack: number) => `
  window.__APP_BOOTED = true;
  (function () {
    var iso = function (d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
    var d = new Date();
    var today = iso(d);
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ${startDaysBack});
    var t = d.getTime() - 60000;
    var dayLog = [
      { id: 'e2e-read-fig', date: today, ts: t, kind: 'balanceReading', reading: { strikeBal: 25000, strikeLtv: 0.25, strikeCollateral: 1 } },
      { id: 'e2e-read-none', date: today, ts: t + 1, kind: 'balanceReading', reading: { strikeBal: 30000, strikeLtv: 0.25, price: 100000 } },
      { id: 'e2e-dep-1', date: today, ts: t + 2, kind: 'deposit', amount: 0.2, target: 'strike' }
    ];
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily', advisorStartDate: iso(start),
        btcPriceMode: 'manual', btcPrice: 100000, dayLog: dayLog, monthlyLog: [], monthBucketReconcileDone: true
      },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  })();
`;

async function go(page: Page, startDaysBack = 0): Promise<void> {
  await page.addInitScript(seed(startDaysBack));
  await page.goto('/');
  await expect(page.getByLabel('Log an event'), 'e2e seed failed to reach DailyModeView').toBeVisible({ timeout: 15_000 });
}

const FIELD = 'Strike collateral (BTC)';
const NOTE = 'This reading doesn\'t record Strike collateral — an edit keeps it that way.';
const PAST_NOTE = 'Strike collateral isn\'t recorded for a past date — this sheet only knows today\'s figure.';
/** A day event's reading as this device stores it (the persisted store). */
const storedReading = (page: Page, id: string) => page.evaluate((id) => {
  const state = JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state || {};
  const ev = ((state.dayLog || []) as { id: string; reading?: object }[]).find((e) => e.id === id);
  return ev ? ev.reading : null;
}, id);
/** Daily's Strike collateral — the trio's figure, getCurrentBtcHeld() to 5 dp. */
const strikeHeld = (page: Page) => page.getByText('Strike BLOC collateral', { exact: true }).locator('xpath=..');
const collateralField = (s: Locator) => s.getByText(FIELD, { exact: true }).locator('xpath=..').locator('input');

async function openEdit(page: Page, row: string): Promise<Locator> {
  await page.getByTestId('log-row').filter({ hasText: row }).click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  await waitForSheetAtRest(s);
  return s;
}

test.describe('N1 — an edit keeps a reading\'s Strike collateral as recorded (BL39)', () => {
  test('E NONE: a reading that records none — the field hidden with its note, Save on, none written, the total kept', async ({ page }) => {
    await go(page);
    await expect(strikeHeld(page), 'E NONE premise — the deposit counted once').toContainText('₿ 1.20000');
    expect(await storedReading(page, 'e2e-read-none'), 'E NONE premise — the reading records none')
      .toEqual({ strikeBal: 30000, strikeLtv: 0.25, price: 100000 });
    const s = await openEdit(page, 'Strike $30,000.00');
    await expect(s.getByText(FIELD, { exact: true }), 'E NONE field — hidden, never a blank 0').toHaveCount(0);
    await expect(s.getByText(NOTE, { exact: true }), 'E NONE note').toBeVisible();
    const save = s.getByRole('button', { name: 'Save' });
    await expect(save, 'E NONE save — on with no collateral figure').toBeEnabled();
    await s.locator('input').first().fill('30500');
    await save.click();
    await expect(s).toHaveCount(0);
    await expect.poll(() => storedReading(page, 'e2e-read-none'), { message: 'E NONE stored — the balance fixed, no Strike collateral' })
      .toEqual({ strikeBal: 30500, strikeLtv: 0.25, price: 100000 });
    await expect(strikeHeld(page), 'E NONE held — not ₿1.4').toContainText('₿ 1.20000');
  });

  test('E FIGURE: a reading that records a figure — the field shows it, not today\'s total, and Save keeps it', async ({ page }) => {
    await go(page);
    await expect(strikeHeld(page), 'E FIGURE premise — today\'s total is not the reading\'s figure').toContainText('₿ 1.20000');
    expect(await storedReading(page, 'e2e-read-fig'), 'E FIGURE premise — the reading records ₿1')
      .toEqual({ strikeBal: 25000, strikeLtv: 0.25, strikeCollateral: 1 });
    const s = await openEdit(page, 'Strike $25,000.00');
    await expect(collateralField(s), 'E FIGURE field — the recorded ₿1, not today\'s ₿1.2').toHaveValue('1.00000000');
    await expect(s.getByText(NOTE, { exact: true })).toHaveCount(0);
    await s.locator('input').first().fill('25500');
    await s.getByRole('button', { name: 'Save' }).click();
    await expect(s).toHaveCount(0);
    await expect.poll(() => storedReading(page, 'e2e-read-fig'), { message: 'E FIGURE kept — the balance fixed, the figure as recorded' })
      .toEqual({ strikeBal: 25500, strikeLtv: 0.25, strikeCollateral: 1, price: 100000 });
    await expect(strikeHeld(page), 'E FIGURE held — not ₿1.4').toContainText('₿ 1.20000');
  });

  test('E PAST: a past-dated add still hides the field with the past-date note (3b, unchanged)', async ({ page }) => {
    await go(page, 10);
    const start = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state.advisorStartDate as string);
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    await page.locator(`[data-testid="day-cell"][data-date="${start}"]`).click();
    await page.getByLabel('Log an event').click();
    const s = sheet(page);
    await expect(s).toBeVisible();
    await waitForSheetAtRest(s);
    await expect(s.getByText(/^backfilling /), 'E PAST premise — a past-dated add').toBeVisible();
    await s.getByRole('button', { name: 'Set balance' }).click();
    await expect(s.getByText(FIELD, { exact: true }), 'E PAST field — hidden').toHaveCount(0);
    await expect(s.getByText(PAST_NOTE, { exact: true }), 'E PAST note — the past date\'s').toBeVisible();
    await expect(s.getByText(NOTE, { exact: true }), 'E PAST — never the edit\'s note').toHaveCount(0);
  });
});
