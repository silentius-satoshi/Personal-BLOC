import { test, expect, type Page, type Locator } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * BL34–BL35 — a number field saves only what the owner typed, when he says so (Batch 1, build 2d — F-2c-1; spec
 * pbloc-spec-batch-1-v1 §2.2d). Before it, a click into Settings → Coinbase Loan's balance or liquidation price and out
 * again re-saved the figure dated today, so the Dashboard dropped the interest since its entry and called it fresh; into
 * its collateral, it logged a collateral reading in the journal; it re-dated the cold total; and on a price field it
 * switched the live price to manual (frozen) — and typing saved every partial figure on the way, a journal reading per
 * keystroke on the collateral. Now a figure read off Strike or Coinbase saves on its Save (or Enter), a plan setting on
 * leaving. Hermetic: round synthetic figures — $50,000 and $70,000 entered 2026-08-13 at 6.27% on 1 ₿, a manual
 * $100,000, 0.5 ₿ cold entered 2026-10-05 plus one 0.1 ₿ move — live prices aborted (PRICE stubs them at $100,000), the
 * price history stubbed, a fixed day 60 days after the entry. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const ENTERED = Date.UTC(2026, 9, 5, 12);
const MOVE = `{ id: 'c1', date: '2026-10-08', ts: ${ENTERED + 3 * 86_400_000}, kind: 'deposit', amount: 0.1, target: 'cold' }`;
const STATE = `onboardingComplete: true, btcPriceMode: 'manual', btcPrice: 100000, advisorStartDate: '2026-10-01',
  simpleMode: true, simpleView: 'dashboard', hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: '2026-08-13',
  cbAprPct: 6.27, cbCollateralBtc: 1, cbLiquidationPrice: 70000, cbLiquidationPriceAsOf: '2026-08-13',
  coldStorageBtc: 0.5, coldStorageBtcAsOf: ${ENTERED}, dayLog: [${MOVE}]`;

async function start(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.addInitScript(`
    window.__APP_BOOTED = true;
    localStorage.setItem('personal-bloc-store', JSON.stringify({ state: { ${STATE} }, version: ${STORE_VERSION} }));
    localStorage.setItem('personal-bloc-onboarded', '1');`);
  await page.goto('/');
}

/** The Dashboard's Coinbase card: its line under the gauge (the liquidation price and the balance, both accrued). */
const cbLine = (page: Page): Locator =>
  page.locator('[class*="cardBody"]', { has: page.getByText('Coinbase LTV', { exact: true }) }).locator('p');
/** A NumberInput by its visible label (a span, not a <label>). */
const fieldOf = (page: Page, label: string): Locator =>
  page.locator(`xpath=//span[normalize-space()="${label}"]/following-sibling::div//input`);
/** The persisted plan log — every plan save appends to it. (A save within a second of the field's last one replaces that
 *  event — the log's burst rule — so a second save shows as a new event, not a longer log.) */
type Saved = { id: string; field: string; value: unknown };
const planLog = (page: Page): Promise<Saved[]> =>
  page.evaluate(() => ((JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.planEvents ?? []) as Saved[])
    .map(({ id, field, value }) => ({ id, field, value })));
/** The persisted journal's events, by id and kind — a Coinbase collateral entry logs a reading there. */
const journal = (page: Page): Promise<string[]> =>
  page.evaluate(() => ((JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.dayLog ?? []) as
    { id: string; kind: string }[]).map((e) => `${e.id}:${e.kind}`));
/** The journal's collateral readings, in order. */
const readings = (page: Page): Promise<unknown[]> =>
  page.evaluate(() => ((JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.dayLog ?? []) as
    { kind: string; cbCollateral?: number }[]).filter((e) => e.kind === 'cbCollateralReading').map((e) => e.cbCollateral));
/** The journal's Strike collateral readings (balance readings that carry one), in order. */
const strikeReadings = (page: Page): Promise<unknown[]> =>
  page.evaluate(() => ((JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.dayLog ?? []) as
    { kind: string; reading?: { strikeCollateral?: number } }[])
    .filter((e) => e.kind === 'balanceReading' && e.reading?.strikeCollateral !== undefined).map((e) => e.reading!.strikeCollateral));
/** A field's own box — its label, its input and, while it holds typing (`'button'` fields — BL35), its two buttons. */
const rootOf = (page: Page, label: string): Locator => page.locator(`xpath=//span[normalize-space()="${label}"]/parent::div`);
const saveOf = (page: Page, label: string): Locator => rootOf(page, label).getByRole('button', { name: 'Save — dated today' });
const cancelOf = (page: Page, label: string): Locator => rootOf(page, label).getByRole('button', { name: 'Cancel' });
/** Every Save button on the page. */
const anySave = (page: Page): Locator => page.getByRole('button', { name: 'Save — dated today' });
/** Clear a field, then type a figure one key at a time, as a person does. */
async function typeInto(field: Locator, figure: string): Promise<void> {
  await field.click();
  await field.fill('');
  await field.pressSequentially(figure, { delay: 40 });
}

/** A click into the field, then a click on its label: focus and leave, nothing typed. */
async function clickInAndOut(page: Page, label: string): Promise<void> {
  await fieldOf(page, label).click();
  await page.getByText(label, { exact: true }).click();
}

async function openCoinbaseLoan(page: Page): Promise<void> {
  await page.getByLabel('Settings').click();
  await page.getByRole('button', { name: /Coinbase Loan/ }).click();
  await expect(page.getByText('COINBASE LOAN', { exact: true }), 'Coinbase Loan opens').toBeVisible();
}
async function backToDashboard(page: Page): Promise<void> {
  await page.getByRole('button', { name: '← Settings' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
}

test.describe('number fields — BL34–BL35', () => {
  test('COINBASE — a click into the balance, the collateral and the liquidation price and out saves nothing: the Dashboard keeps their interest', async ({ page }) => {
    await start(page);
    const line = cbLine(page);
    // PREMISE — 60 days of interest at 6.27% on both figures (the stray click took them back to $50,000 and $70,000)
    await expect(line, 'PREMISE the balance, accrued').toContainText(/\$50,5\d\d balance/, { timeout: 15_000 });
    await expect(line, 'PREMISE the liquidation price, accrued').toContainText(/Liq at ~\$70,7\d\d/);
    const before = (await line.textContent()) ?? '';
    const log = await planLog(page);
    const logged = await journal(page);
    expect(logged, 'PREMISE the journal holds the seeded move').toEqual(['c1:deposit']);

    await openCoinbaseLoan(page);
    await expect(fieldOf(page, 'Loan balance'), 'COINBASE the balance as entered').toHaveValue('50000');
    await expect(fieldOf(page, 'Liquidation price'), 'COINBASE the liquidation price as entered').toHaveValue('70000');
    await clickInAndOut(page, 'Loan balance');
    await clickInAndOut(page, 'BTC collateral');
    await clickInAndOut(page, 'Liquidation price');
    await expect(fieldOf(page, 'Loan balance'), 'COINBASE the field shows its figure').toHaveValue('50000');
    await expect(anySave(page), 'COINBASE nothing held for Save').toHaveCount(0);
    expect(await planLog(page), 'COINBASE nothing saved').toEqual(log);
    expect(await journal(page), 'COINBASE nothing logged').toEqual(logged);

    // KEPT — the Dashboard reads what it read before
    await backToDashboard(page);
    await expect(line, 'KEPT the balance and the liquidation price').toHaveText(before);
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test("COLD — the owner's own case: a click into the cold total and out keeps its date and its move", async ({ page }) => {
    await start(page);
    await expect(cbLine(page), 'on the Dashboard').toBeVisible({ timeout: 15_000 });
    const log = await planLog(page);
    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: /Strike Strategy/ }).click();
    const cold = page.getByLabel('Total in cold storage');
    await expect(cold, 'COLD the live total').toHaveValue('0.60000000');
    await cold.click();
    await page.getByText('COLD STORAGE', { exact: true }).click();
    await expect(cold, 'COLD the field shows the total').toHaveValue('0.60000000');
    await expect(page.getByText('Entered 2026-10-05, plus 1 move since.', { exact: true }), 'COLD its date and move').toBeVisible();
    expect(await planLog(page), 'COLD nothing saved').toEqual(log);
  });

  test('PRICE — a click into the price field and out keeps the live price live', async ({ page }) => {
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ data: { amount: '100000.00', base: 'BTC', currency: 'USD' } }) }));
    await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
    await page.addInitScript(`
      window.__APP_BOOTED = true;
      localStorage.setItem('personal-bloc-store', JSON.stringify({ state: { onboardingComplete: true, simpleMode: false,
        activeTab: 'coinbase', btcPriceMode: 'live', btcPrice: 100000, advisorStartDate: '2026-10-01', hasCbLoan: true,
        cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1 }, version: ${STORE_VERSION} }));
      localStorage.setItem('personal-bloc-onboarded', '1');`);
    await page.goto('/');
    // The Coinbase tab's sidebar: "BTC PRICE", its badge, and the field under them
    const label = page.getByText('BTC PRICE', { exact: true }).first();
    const row = label.locator('xpath=..');
    await expect(row.getByRole('button', { name: 'LIVE' }), 'PREMISE the price is live').toBeVisible({ timeout: 15_000 });
    const field = label.locator('xpath=../..').locator('input[type="number"]');
    await expect(field, 'PREMISE the live figure').toHaveValue('100000');
    await field.click();
    await label.click();
    await expect(row.getByRole('button', { name: 'Manual' }), 'PRICE not switched to manual').toHaveCount(0);
    await expect(row.getByRole('button', { name: 'LIVE' }), 'PRICE still live').toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.btcPriceMode),
      'PRICE the mode kept').toBe('live');
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test('BUTTON — a typed balance saves only on its Save: nothing as it is typed or when left; once on Save, dated today', async ({ page }) => {
    await start(page);
    await expect(cbLine(page), 'on the Dashboard').toContainText(/\$50,5\d\d balance/, { timeout: 15_000 });
    const log = await planLog(page);
    await openCoinbaseLoan(page);
    const balance = fieldOf(page, 'Loan balance');
    const save = saveOf(page, 'Loan balance');
    await expect(save, 'BUTTON none before typing').toHaveCount(0);
    await typeInto(balance, '40000');
    expect(await planLog(page), 'BUTTON nothing saved as it is typed').toEqual(log);
    await expect(save, 'BUTTON its Save, once typed').toBeVisible();
    await page.getByText('COINBASE LOAN', { exact: true }).click();
    await expect(balance, 'BUTTON left — the typing kept').toHaveValue('40000');
    await expect(save, 'BUTTON left — still offered').toBeVisible();
    expect(await planLog(page), 'BUTTON nothing saved on leaving').toEqual(log);
    await balance.click();
    await expect(save, 'BUTTON held through a second focus').toBeVisible();
    await save.click();
    await expect(save, 'BUTTON gone once saved').toHaveCount(0);
    expect((await planLog(page)).filter((e) => e.field === 'cbLoanBalance').map((e) => e.value), 'BUTTON saved once').toEqual([40000]);
    await backToDashboard(page);
    // dated today: at most a day's interest on it (the accrual counts from the as-of day's start)
    await expect(cbLine(page), 'BUTTON the Dashboard reads it, dated today').toContainText(/\$40,00\d balance/);
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test("JOURNAL — Coinbase's collateral logs one reading, on Save — none per keystroke; Cancel restores the figure", async ({ page }) => {
    await start(page);
    await expect(cbLine(page), 'on the Dashboard').toBeVisible({ timeout: 15_000 });
    const logged = await journal(page);
    await openCoinbaseLoan(page);
    const coll = fieldOf(page, 'BTC collateral');
    await typeInto(coll, '2');
    await expect(cancelOf(page, 'BTC collateral'), 'CANCEL offered once typed').toBeVisible();
    await cancelOf(page, 'BTC collateral').click();
    await expect(coll, 'CANCEL the saved figure back').toHaveValue('1');
    expect(await journal(page), 'CANCEL nothing logged').toEqual(logged);
    await typeInto(coll, '1.2345');
    expect(await journal(page), 'JOURNAL nothing as it is typed').toEqual(logged);
    await saveOf(page, 'BTC collateral').click();
    expect(await readings(page), 'JOURNAL one reading, on Save').toEqual([1.2345]);
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test("STRIKE — Strike's collateral logs one balance reading, on Save: none for a click in and out, none per keystroke", async ({ page }) => {
    await start(page);
    await expect(cbLine(page), 'on the Dashboard').toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: /Strike Strategy/ }).click();
    const coll = fieldOf(page, 'Current BTC collateral');
    await coll.click();
    await page.getByText('Current BTC collateral', { exact: true }).click();
    expect(await strikeReadings(page), 'STRIKE nothing for a click').toEqual([]);
    await typeInto(coll, '1.5');
    expect(await strikeReadings(page), 'STRIKE nothing as it is typed').toEqual([]);
    await saveOf(page, 'Current BTC collateral').click();
    expect(await strikeReadings(page), 'STRIKE one reading, on Save').toEqual([1.5]);
    await expect(coll, 'STRIKE the field shows it').toHaveValue('1.5');
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test('LEAVE — a plan setting saves once, on leaving — nothing as it is typed, no Save button; a negative leaves as 0', async ({ page }) => {
    await start(page);
    await expect(cbLine(page), 'on the Dashboard').toBeVisible({ timeout: 15_000 });
    const log = await planLog(page);
    await openCoinbaseLoan(page);
    const apr = fieldOf(page, 'APR');
    await typeInto(apr, '7.5');
    expect(await planLog(page), 'LEAVE nothing as it is typed').toEqual(log);
    await expect(anySave(page), 'LEAVE no Save button').toHaveCount(0);
    await page.getByText('APR', { exact: true }).click();
    expect((await planLog(page)).filter((e) => e.field === 'cbAprPct').map((e) => e.value), 'LEAVE saved once').toEqual([7.5]);
    // CLAMP — the APR's setter doesn't clamp, so the field's own rule saves 0
    await apr.fill('-5');
    await page.getByText('APR', { exact: true }).click();
    await expect(apr, 'CLAMP to the range').toHaveValue('0');
    const aprs = (await planLog(page)).filter((e) => e.field === 'cbAprPct').map((e) => e.value);
    expect(aprs[aprs.length - 1], 'CLAMP saved as 0').toBe(0);
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test('DATED — the unchanged liquidation price, re-entered and saved by Enter, is dated today: the Dashboard drops the interest since', async ({ page }) => {
    await start(page);
    const line = cbLine(page);
    await expect(line, 'PREMISE accrued').toContainText(/Liq at ~\$70,7\d\d/, { timeout: 15_000 });
    await openCoinbaseLoan(page);
    const liq = fieldOf(page, 'Liquidation price');
    await typeInto(liq, '70000');
    await expect(saveOf(page, 'Liquidation price'), 'DATED offered though unchanged').toBeVisible();
    await liq.press('Enter');
    await expect(saveOf(page, 'Liquidation price'), 'DATED saved by Enter').toHaveCount(0);
    await backToDashboard(page);
    await expect(line, 'DATED the confirmed figure, dated today').toContainText(/Liq at ~\$70,0\d\d/);
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });
});
