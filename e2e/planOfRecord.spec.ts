import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedLoanAndGoto } from './helpers';

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
    await page.getByRole('button', { name: /Decision/ }).first().click();
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
