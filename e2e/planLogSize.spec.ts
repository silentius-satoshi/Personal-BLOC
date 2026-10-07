import { test, expect, type Page } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * 5a — the plan log's size (spec pbloc-spec-plan-log-size-v1): a slider drag leaves ONE plan event per field in the
 * persisted log, not one per notch. The Monthly Income slider (Living's "Your Life", in full mode's sidebar) has 1,000
 * notches; before 5a a 1-second drag left 59 income events (measured). The round synthetic loan seed, live prices
 * aborted, the price history stubbed. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const FULL_MODE_SEED = `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: {
      onboardingComplete: true, simpleMode: false,
      hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
      btcPriceMode: 'manual', btcPrice: 100000
    },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

/** The persisted store, read back: the income scalar, its plan events, and the log's plain JSON size. */
async function persisted(page: Page): Promise<{ income: unknown; incomeEvents: { value: unknown }[]; plainBytes: number }> {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state || {};
    const events = (state.planEvents || []) as { field: string; value: unknown }[];
    return {
      income: state.income,
      incomeEvents: events.filter((e) => e.field === 'income'),
      plainBytes: new TextEncoder().encode(JSON.stringify({ events })).length,
    };
  });
}

test.describe('5a — the plan log size', () => {
  test("DRAG — a 1-second drag of the income slider leaves one income event, at the slider's value", async ({ page }) => {
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
    await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
    await page.addInitScript(FULL_MODE_SEED);
    await page.goto('/');
    const range = page.getByText('Monthly Income', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"root")][1]').locator('input[type="range"]');
    await range.scrollIntoViewIfNeeded({ timeout: 15_000 });
    await expect(range, 'INCOME slider').toBeVisible();
    const before = await persisted(page);

    // a human-speed drag end to end: 60 moves over about a second, as the measurement did
    const box = (await range.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) {
      await page.mouse.move(box.x + 2 + ((box.width - 4) * i) / 60, y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();

    await expect.poll(async () => (await persisted(page)).income, { message: 'DRAG moved the slider' }).not.toBe(before.income);
    const after = await persisted(page);
    expect(after.incomeEvents.length, 'DRAG one event').toBe(1);
    expect(after.incomeEvents[0].value, "DRAG the slider's value").toBe(after.income);
    expect(after.plainBytes, 'DRAG log size').toBeLessThan(2_000);
  });
});
