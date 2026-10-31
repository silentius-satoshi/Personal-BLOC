import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedLoanAndGoto, seedAndGoto, openAlmanacFace, STORE_VERSION } from './helpers';

/**
 * The plan of record, Run 1 (spec pbloc-spec-plan-of-record-v1 v1.0): Settings' "Your plan" saves the support policy;
 * every Almanac face starts from it; a face's sliders are a what-if that never writes it (D2). Hermetic like the
 * futures: the round synthetic loan seed, live prices aborted, the price history stubbed. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });

async function hermetic(page: Page): Promise<void> {
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
}

/** One policy slider, found by its label — the shared SliderInput's range input carries no name of its own. */
function slider(scope: Locator | Page, label: string): { value: Locator; range: Locator } {
  const root = scope.getByText(label, { exact: true }).locator('xpath=ancestor::div[contains(@class,"root")][1]');
  return { value: root.locator('div[class*="valueDisplay"]'), range: root.locator('input[type="range"]') };
}

async function nudge(range: Locator, key: 'ArrowRight' | 'ArrowLeft'): Promise<void> {
  await range.focus();
  await range.press(key);
}

const COINBASE = 'Coinbase limit at support';

async function openYourPlan(page: Page): Promise<void> {
  await page.getByLabel('Settings').click();
  const row = page.getByRole('button', { name: /Your plan/ });
  await expect(row, 'PLAN row').toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Your plan' }), 'Your plan opens').toBeVisible();
}

async function leaveSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '← Settings' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.getByLabel('Log an event'), 'back on the journal').toBeVisible();
}

test.describe('the plan of record — Run 1', () => {
  test('PLAN — Settings saves the plan; the Decision face starts from it; its what-if never writes it', async ({ page }) => {
    await hermetic(page);
    await seedLoanAndGoto(page);

    // PLAN — C1 by default, no off switch; one notch saves 46%
    await openYourPlan(page);
    const mine = slider(page, COINBASE);
    await expect(mine.value, 'PLAN C1').toHaveText('45%');
    await expect(page.getByRole('button', { name: 'Turn policy off' }), 'PLAN no off switch').toHaveCount(0);
    await nudge(mine.range, 'ArrowRight');
    await expect(mine.value, 'PLAN saved').toHaveText('46%');
    await leaveSettings(page);

    // FACE — the Decision face's card opens on the plan
    await page.getByLabel('Almanac').click();
    await openAlmanacFace(page, 'Decision');
    const card = page.locator('section:has(> p[class*="futures"])');
    await card.locator('summary').click();
    const face = slider(card, COINBASE);
    await expect(face.value, 'FACE starts from the plan').toHaveText('46%');

    // WHAT-IF — the face moves; "Back to your plan" returns to the plan, not to C1
    await nudge(face.range, 'ArrowRight');
    await expect(face.value, 'WHAT-IF').toHaveText('47%');
    const back = card.getByRole('button', { name: 'Back to your plan' });
    await expect(back, 'WHAT-IF reset label').toBeVisible();
    await back.click();
    await expect(face.value, 'WHAT-IF back to your plan').toHaveText('46%');
    await nudge(face.range, 'ArrowRight');
    await expect(face.value, 'WHAT-IF again').toHaveText('47%');

    // NEVER WRITES — Settings still holds 46%; "Back to the defaults (C1)" returns 45%
    await page.getByRole('button', { name: '← Back' }).click();
    await expect(page.getByLabel('Log an event'), 'back on the journal').toBeVisible();
    await openYourPlan(page);
    await expect(slider(page, COINBASE).value, 'NEVER WRITES').toHaveText('46%');
    const c1 = page.getByRole('button', { name: 'Back to the defaults (C1)' });
    await expect(c1, 'PLAN C1 button').toBeVisible();
    await c1.click();
    await expect(slider(page, COINBASE).value, 'PLAN C1 again').toHaveText('45%');
  });
});

/**
 * Run 2 (spec v1.6 §13): THIS MONTH and Daily are the plan of record's month (D-R2-2, D-R2-8). The loan seed — $50,000
 * on 1 ₿ at a manual $100,000, nothing on Strike, the store's $4,000 income and $3,500 bills — on a FIXED day, so
 * today's support is the same every run: 45% of 1 ₿ at about $64,700 is about $29,115, and Coinbase is $20,885.10 over
 * it — to the cent since Run 2.1 (BL19).
 */
test.describe('the plan of record — Run 2', () => {
  const OVER = "Coinbase is $20,885.10 over your plan's limit";

  test('MONTH — THIS MONTH and Daily read one month: the status, the to-do, the catch-up, the why, the note', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic(page);
    await seedLoanAndGoto(page);

    // DAILY — the plan reference card carries the month's one status (the same builder as THIS MONTH)
    const daily = page.locator('[class*="pbcard"]');
    await expect(daily.getByText(OVER), 'DAILY status').toBeVisible();
    await expect(daily.locator('[class*="pbRow"]', { hasText: 'Repay Coinbase' }), 'DAILY row').toContainText('$500.00');

    // MONTH — THIS MONTH: the status, then "To do this month" with the repayment first and the buy shown paused
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await expect(page.getByText(OVER), 'MONTH status').toBeVisible();
    await expect(page.getByText(/^Spare income repays it before the plan borrows again — not back within it in the next 12 months at today's price\.$/),
      'MONTH status body').toBeVisible();
    await expect(page.getByText('To do this month', { exact: true }), 'MONTH to-do').toBeVisible();
    const rows = page.locator('ul[class*="pmList"] > li');
    await expect(rows.nth(0), 'MONTH first row').toContainText('Repay Coinbase');
    await expect(rows.nth(0), 'MONTH its amount').toContainText('$500.00');
    await expect(rows.filter({ hasText: 'Buy bitcoin' }), 'MONTH buy paused').toContainText('—');

    // CATCH-UP — behind a tap, as facts (D6)
    await page.getByText('To be within it today', { exact: true }).click();
    await expect(page.getByText('Add ₿0.717 of collateral to Coinbase, or repay $20,885.10.', { exact: true }), 'CATCH-UP').toBeVisible();

    // WHY — behind a tap: the Decision face's own sentence for the month
    await page.getByText('Why this plan?', { exact: true }).click();
    await expect(page.getByText(/This month the plan would: Repay \$500\.00 of Coinbase from spare income\./), 'WHY').toBeVisible();

    // NOTE — once per device: dismissed, it stays dismissed after a reload
    const note = page.locator('[class*="_planNote_"]');
    await expect(note, 'NOTE shows').toContainText('New: your plan follows the support policy.');
    await note.getByRole('button', { name: 'Dismiss' }).click();
    await expect(note, 'NOTE dismissed').toHaveCount(0);
    await page.reload();
    await expect(page.getByText(OVER), 'NOTE reload — the month again').toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[class*="_planNote_"]'), 'NOTE stays dismissed').toHaveCount(0);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});

/**
 * Run 2.1 (spec v1.11 §14): every dollar figure shows its cents (BL19); Daily's bars read the month so far in both
 * scopes; a later month's buy says it is at today's price. The loan seed plus ONE Coinbase paydown logged earlier this
 * month, on a fixed day — round synthetic figures.
 */
/** The page's dollar figures: those WITHOUT their cents ("$500", "$217," or "$20,885." — a chart's "$95k" is no figure),
 *  and how many have them. A closed <details> isn't rendered, so its text isn't read: the unit sweeps cover those. */
async function dollarFigures(page: Page): Promise<{ whole: string[]; cents: number }> {
  const text = await page.locator('#root').innerText();
  return {
    whole: text.match(/\$\d{1,3}(?:,\d{3})*(?!\d|[.,]\d|k|M)/g) ?? [],
    cents: (text.match(/\$\d{1,3}(?:,\d{3})*\.\d{2}(?!\d)/g) ?? []).length,
  };
}

test.describe('the plan of record — Run 2.1', () => {
  const WITH_PAYDOWN = `
    window.__APP_BOOTED = true;
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily', advisorStartDate: '2026-10-01',
        hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
        btcPriceMode: 'manual', btcPrice: 100000,
        dayLog: [{ id: 'e2e-cb-pay', date: '2026-10-05', ts: 1791200000000, kind: 'paydown', amount: 200, target: 'cb' }],
      },
      version: ${STORE_VERSION},
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');`;

  test('RUN 2.1 — every figure to the cent (BL19); Daily\'s bars read the month so far, in Week and in Month', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic(page);
    await page.addInitScript(WITH_PAYDOWN);
    await page.goto('/');
    await expect(page.getByLabel('Log an event'), 'on Daily').toBeVisible({ timeout: 15_000 });

    // BARS — Week, today selected: nothing logged today, yet the bars read the month so far, and say so
    const paydown = page.locator('[class*="_stream_"]', { hasText: 'Paydown' });
    await expect(page.getByText('Month 1 so far', { exact: true }), 'E BARS caption').toBeVisible();
    await expect(paydown.locator('[class*="_streamVal_"]'), 'E BARS week').toHaveText('$200.00 / $500.00');

    // CENTS — Daily's plan card: the to-do amount to the cent
    const daily = page.locator('[class*="pbcard"]');
    await expect(daily.locator('[class*="pbRow"]', { hasText: 'Repay Coinbase' }), 'E CENTS Daily row').toContainText('$500.00');
    // CENTS — no whole-dollar figure anywhere on Daily: the trio, the price, the Safety card, the log (BL19)
    const onDaily = await dollarFigures(page);
    expect(onDaily.whole, 'E CENTS no whole dollars on Daily').toEqual([]);
    expect(onDaily.cents, 'E CENTS premise: Daily shows dollar figures').toBeGreaterThan(5);
    await expect(page.getByText('BTC $100,000.00', { exact: true }), 'E CENTS the price').toBeVisible();

    // BARS — Month: the same month so far, no caption (the head already says month-to-date)
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    await expect(paydown.locator('[class*="_streamVal_"]'), 'E BARS month').toHaveText('$200.00 / $500.00');
    await expect(page.getByText('Month 1 so far', { exact: true }), 'E BARS no caption in Month').toHaveCount(0);

    // CENTS — THIS MONTH: the to-do and the status, to the cent (BL19)
    await page.getByRole('tab', { name: 'Monthly' }).click();
    const rows = page.locator('ul[class*="pmList"] > li');
    await expect(rows.nth(0), 'E CENTS THIS MONTH row').toContainText('Repay Coinbase');
    await expect(rows.nth(0), 'E CENTS THIS MONTH amount').toContainText('$500.00');
    await expect(page.getByText(/^Coinbase is \$\d{1,3}(?:,\d{3})*\.\d{2} over your plan's limit$/), 'E CENTS the status to the cent').toBeVisible();
    const onMonth = await dollarFigures(page);
    expect(onMonth.whole, 'E CENTS no whole dollars on THIS MONTH').toEqual([]);
    expect(onMonth.cents, 'E CENTS premise: THIS MONTH shows dollar figures').toBeGreaterThan(5);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test("RUN 2.1 — a later month's buy is its dollars at today's price; this month's is not labelled", async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic(page);
    await seedAndGoto(page);
    await page.getByRole('tab', { name: 'Monthly' }).click();
    const buy = page.locator('ul[class*="pmList"] > li', { hasText: 'Buy bitcoin' });
    await expect(buy, "E TODAY'S PRICE this month: dollars to the cent").toContainText(/\$\d{1,3}(?:,\d{3})*\.\d{2}/);
    await expect(buy, "E TODAY'S PRICE this month: no label").not.toContainText("at today's price");
    const scrub = page.getByLabel('Scrub through months');
    await scrub.focus();
    await scrub.press('ArrowRight');
    await expect(page.getByText('The plan for month 2', { exact: true }), 'E month 2').toBeVisible();
    await expect(buy, "E TODAY'S PRICE a later month").toContainText("· at today's price");
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});

/**
 * Run 3 (spec §15): the year. The full-mode Advisor tab shows THIS MONTH's card — one run, the same words, no Pay / Skip
 * — and its month log plans the plan's month; the Outlook became a link to the Decision face; the expenses prompt moved
 * onto THIS MONTH, to the cent. The loan seed on a fixed day, as in Run 2 — round synthetic figures.
 */
test.describe('the plan of record — Run 3', () => {
  const OVER = "Coinbase is $20,885.10 over your plan's limit";
  const PLAN_LINE = "This is your plan of record's move this month — the support policy, with your settings.";
  const LINK = "Your plan on other price paths — the Almanac's Decision face →";
  /** The Decision face's card (its print copy repeats the line, hidden). */
  const moveCard = (page: Page): Locator => page.getByLabel("The support policy's move");
  const seedOf = (state: string): string => `
    window.__APP_BOOTED = true;
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: { onboardingComplete: true, btcPriceMode: 'manual', btcPrice: 100000, ${state} },
      version: ${STORE_VERSION},
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');`;
  const LOAN = "hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1";

  test("YEAR — the Advisor tab shows THIS MONTH's card, no Pay / Skip; its log plans the plan's month; its link opens the Decision face", async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic(page);
    await page.addInitScript(seedOf(`simpleMode: false, activeTab: 'advisor', advisorStartDate: '2026-10-01', ${LOAN}`));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Advisor', exact: true }), 'YEAR on the Advisor tab').toBeVisible({ timeout: 15_000 });

    // YEAR — THIS MONTH's own card: its status and its to-do, in its own words (to the cent, as on THIS MONTH)
    await expect(page.getByText(OVER), "YEAR the card's status").toBeVisible();
    const rows = page.locator('ul[class*="pmList"] > li');
    await expect(rows.nth(0), 'YEAR the to-do').toContainText('Repay Coinbase');
    await expect(rows.nth(0), 'YEAR its amount').toContainText('$500.00');
    // …and no Pay / Skip (the policy has no skip), no projection table
    await expect(page.getByRole('button', { name: 'Skip', exact: true }), 'YEAR no skip').toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pay', exact: true }), 'YEAR no pay').toHaveCount(0);
    await expect(page.getByText(/^(?:12-Month|Months \d+–12) Projection$/), 'YEAR no projection').toHaveCount(0);

    // LOG — the month log's planned figures are the plan's: it pauses the buy while Coinbase is over its limit
    const income = page.locator('[class*="fieldCell"]', { hasText: 'Income → BTC' });
    await expect(income, "LOG the plan's buy, paused").toContainText('$0');
    await expect(income, 'LOG projected').toContainText('(proj)');

    // PATHS — the link opens the Almanac on the Decision face
    await page.getByRole('button', { name: LINK }).click();
    await expect(moveCard(page).getByText(PLAN_LINE), 'PATHS the Decision face').toBeVisible({ timeout: 15_000 });

    // …and once the hub is left, full mode's Tools menu (which opens the tab directly) opens the grid again (BL45).
    const tools = page.getByRole('button', { name: /^Tools/ });
    const menu = page.locator('[class*="toolsDropdown"]');
    await tools.click();
    await menu.getByRole('button', { name: 'Sats', exact: true }).click();
    await tools.click();
    await menu.getByRole('button', { name: 'Almanac', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'PATHS forgotten on leaving — the grid').toBeVisible({ timeout: 15_000 });
    await expect(moveCard(page), 'PATHS not the Decision face').toHaveCount(0);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('PATHS — THIS MONTH has no Outlook switch; its link opens the Decision face; the nav still opens the grid', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic(page);
    await seedLoanAndGoto(page);
    await page.getByRole('tab', { name: 'Monthly' }).click();
    await expect(page.getByText(OVER), 'PATHS on THIS MONTH').toBeVisible();
    await expect(page.getByRole('button', { name: 'Outlook', exact: true }), 'PATHS no Outlook switch').toHaveCount(0);

    await page.getByRole('button', { name: LINK }).click();
    await expect(moveCard(page).getByText(PLAN_LINE), 'PATHS the Decision face').toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '← Back' }).click();
    await expect(page.getByText(OVER), 'PATHS back on THIS MONTH').toBeVisible();

    // The nav's Almanac button opens the hub on the grid (BL45) — the link's face is forgotten once the hub is left.
    await page.getByLabel('Almanac').click();
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'PATHS the grid').toBeVisible({ timeout: 15_000 });
    await expect(moveCard(page), 'PATHS not the Decision face').toHaveCount(0);
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('REANCHOR — the expenses prompt sits on THIS MONTH, to the cent; its Update saves the average to the cent', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic(page);
    // Three logged months whose bills average $3,812.47 against the store's $3,500.00 — 9% off, past the 5% nudge. Month 4
    // is the month in progress (October, from a July start), $500 drawn so far: it stays out of the average (F-R4-1) — in
    // it would read $2,712.47.
    const month = (m: number, iso: string, spent: number): string =>
      `{ month: ${m}, date: '${iso}', btcBought: 0, income: 0, paydown: 0, strikeBal: 0, strikeLtv: 0, loggedAt: 1780000000000, expensesActual: ${spent} }`;
    await page.addInitScript(seedOf(`simpleMode: true, simpleView: 'monthly', advisorStartDate: '2026-07-01', monthBucketReconcileDone: true,
      monthlyLog: [${month(1, '2026-07-01', 3800)}, ${month(2, '2026-08-01', 3812.4)}, ${month(3, '2026-09-01', 3825)}, ${month(4, '2026-10-01', 500)}]`));
    await page.goto('/');
    // BL26 — the subject named; the buttons say what they do.
    const prompt = page.getByText('Monthly expenses: your last 3 logged months averaged $3,812.47; your plan uses $3,500.00.', { exact: true });
    await expect(prompt, 'REANCHOR on THIS MONTH, to the cent').toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Keep $3,500.00', exact: true }), 'REANCHOR Keep names the plan\'s figure').toBeVisible();
    await page.getByRole('button', { name: 'Update plan to $3,812.47', exact: true }).click();
    await expect(prompt, 'REANCHOR gone once the assumption matches').toHaveCount(0);
    await page.getByRole('button', { name: /Edit your numbers/ }).click();
    const expensesField = page.locator('[class*="modalFieldGroup"]', { hasText: 'Monthly expenses' }).locator('input');
    await expect(expensesField, 'REANCHOR saved to the cent').toHaveValue('3812.47');
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});

// ── The plan of record, Run 4 — Safety and the edges (spec pbloc-spec-plan-of-record-v1 §16). Every assertion has a tag.
test.describe('the plan of record — Run 4', () => {
  const seedOf = (state: string): string => `
    window.__APP_BOOTED = true;
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: { onboardingComplete: true, btcPriceMode: 'manual', btcPrice: 100000, ${state} },
      version: ${STORE_VERSION},
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');`;

  test('STALL — a price history that never answers ends as failed: THIS MONTH names its cached breaker, the chart stops loading', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
    // Both histories hold the request open and never answer — a VPN tunnel left up with no network under it.
    await page.route(/blockchain\.info/, () => { /* never answers */ });
    await page.route(/\/api\/btc-candles/, () => { /* never answers */ });
    await page.addInitScript(seedOf(`simpleMode: true, simpleView: 'monthly', advisorStartDate: '2026-10-01',
      planBreakerCache: { state: { monthsBelow: 0, monthsAtOrAbove: 0, broken: false, brokenMonth: null }, lastMonthEndISO: '2026-09-30' }`));
    await page.goto('/');
    const line = page.getByText(/^Price history hasn't loaded — the breaker as of .+, this device's last reading\.$/);
    await expect(page.getByText("Your plan on other price paths — the Almanac's Decision face →"), 'STALL on THIS MONTH').toBeVisible({ timeout: 15_000 });
    // While the request is open the cache runs the month with no line (v1.7's Δ12), and the chart is loading …
    await expect(line, 'STALL no line while the request is open').toHaveCount(0);
    await expect(page.getByText('loading…', { exact: true }), 'STALL the chart loading').toBeVisible();
    // … and once the 15 s limit has passed, both requests have failed: the line shows, and the chart says so.
    await expect(line, 'STALL the line past the limit').toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('price history unavailable', { exact: true }), 'STALL the chart past the limit').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  // The round synthetic loan: $50,000 on 1 ₿ at a manual $100,000, no as-of date (nothing accrues). On 2026-10-12 support is
  // $64,699.79, so at support Coinbase is at 77.3% LTV — over the plan's 45% — while today's bar
  // (50%, under the 75% trigger) is green.
  const LOAN = "hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1";
  const hermetic4 = async (page: Page): Promise<void> => {
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
    await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  };
  // Run 4.1 (BL29, F-R4-2): a what-if in the bar's terms, over or within in words.
  const AT_SUPPORT = "If BTC were at support ($64,699.79): 77.3% LTV — over the plan's 45% limit";

  test('SAFETY — the Safety card reads Coinbase at support: the line under the bar, amber over the limit, and the verdict', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic4(page);
    await page.addInitScript(seedOf(`simpleMode: true, simpleView: 'monthly', advisorStartDate: '2026-10-01', ${LOAN}`));
    await page.goto('/');
    const line = page.getByText(AT_SUPPORT, { exact: true });
    await expect(line, 'SAFETY the line on THIS MONTH').toBeVisible({ timeout: 15_000 });
    await expect(line, 'SAFETY amber over the limit').toHaveAttribute('style', /var\(--amber\)/);
    // Today's bar is green; the verdict takes the worse reading and says which.
    await expect(page.getByText('50.0% LTV', { exact: true }), 'SAFETY premise: today\'s bar').toBeVisible();
    await expect(page.getByText("Watch — Coinbase is over the plan's limit at support", { exact: true }), 'SAFETY the verdict').toBeVisible();
    // THIS MONTH's card agrees: the same over-the-limit fact, after the month's move (nothing moves here).
    await expect(page.getByText("Coinbase is $20,885.10 over your plan's limit"), 'SAFETY the card agrees').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('SAFETY — within the limit at support: the line, no tone, and today\'s verdict', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic4(page);
    await page.addInitScript(seedOf(`simpleMode: true, simpleView: 'daily', advisorStartDate: '2026-10-01',
      hasCbLoan: true, cbLoanBalance: 20000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1`));
    await page.goto('/');
    const line = page.getByText("If BTC were at support ($64,699.79): 30.9% LTV — within the plan's 45% limit", { exact: true });
    await expect(line, 'SAFETY the line on Daily').toBeVisible({ timeout: 15_000 });
    await expect(line, 'SAFETY no tone within').not.toHaveAttribute('style', /var\(--amber\)/);
    await expect(page.getByText('Safe — nothing to do today', { exact: true }), 'SAFETY today\'s verdict').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('SAFETY — when this month\'s move tops Coinbase up from Strike, the line says the move brings it within', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic4(page);
    // 2 ₿ on Strike with nothing drawn and no logged deposit (no hold): this month's move sends what the line doesn't need
    // at support to Coinbase — enough to bring it within.
    await page.addInitScript(seedOf(`simpleMode: true, simpleView: 'monthly', advisorStartDate: '2026-10-01', ${LOAN}, strikeCollateralBtc: 2`));
    await page.goto('/');
    const line = page.getByText(`${AT_SUPPORT}; this month's move brings it within`, { exact: true });
    await expect(line, 'MOVE the line names the move').toBeVisible({ timeout: 15_000 });
    await expect(line, 'MOVE still amber: the position as it stands').toHaveAttribute('style', /var\(--amber\)/);
    // The card reads after the move: within — and its to-do is the move.
    await expect(page.getByText("Within your plan's limits", { exact: true }), 'MOVE the card, after the move').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('VIEWER — the owner\'s Dashboard (the trusted path) reads Coinbase at support under its gauge, in whole dollars', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic4(page);
    await page.addInitScript(seedOf(`simpleMode: true, simpleView: 'dashboard', advisorStartDate: '2026-10-01', ${LOAN}`));
    await page.goto('/');
    await expect(page.getByText("If BTC were at support ($64,700): 77.3% LTV — over the plan's 45% limit"), 'VIEWER the Dashboard')
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Worth keeping an eye', { exact: true }), 'VIEWER the overall folds it').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('CONSOLE — with a Coinbase loan the Emergency Console runs, whatever the old strategy (it never was LTV-triggered here)', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic4(page);
    await page.addInitScript(seedOf(`simpleMode: false, activeTab: 'liqsim', advisorStartDate: '2026-10-01', ${LOAN}`));
    await page.goto('/');
    await expect(page.getByText('50.0% CB LTV', { exact: true }), 'CONSOLE the console\'s stage').toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Simulate' }), 'CONSOLE its simulate').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('NO LOAN — with the Coinbase loan switched off, the Emergency tab gives way to the first tab, never an empty page', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic4(page);
    await page.addInitScript(seedOf(`simpleMode: false, activeTab: 'liqsim', advisorStartDate: '2026-10-01', hasCbLoan: false`));
    await page.goto('/');
    await expect(page.locator('[data-active-tab="living"]'), 'NO LOAN the first tab').toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Living on Bitcoin' }), 'NO LOAN its page').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('CBTAB — the CB Loan tab: its crash day is the console\'s, at the trigger, one tap away; no projection', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await hermetic4(page);
    await page.addInitScript(seedOf(`simpleMode: false, activeTab: 'coinbase', advisorStartDate: '2026-10-01', ${LOAN}`));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'On a crash day' }), 'CBTAB the card').toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("At your 75% trigger — BTC at $66,667 today — work from the Emergency Console: it names the day's moves "
      + 'from your live position and your cold storage.', { exact: true }), 'CBTAB the words').toBeVisible();
    await expect(page.getByText(/Emergency Protocol/), 'CBTAB no protocol').toHaveCount(0);
    await expect(page.getByText('12-Month Projection', { exact: true }), 'CBTAB no projection').toHaveCount(0);
    await expect(page.getByText('Your trigger', { exact: true }), 'CBTAB the alert row').toBeVisible();
    await page.getByRole('button', { name: 'Open the Emergency Console →' }).click();
    await expect(page.getByText('50.0% CB LTV', { exact: true }), 'CBTAB the link opens the console').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});
