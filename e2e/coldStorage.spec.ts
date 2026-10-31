import { test, expect } from '@playwright/test';
import { openAlmanacFace, STORE_VERSION } from './helpers';

/**
 * BL33 — cold storage, in Settings and on the four engine faces (Batch 1, build 2c; spec pbloc-spec-batch-1-v1 §2.2).
 * Hermetic: the round synthetic loan seed — $50,000 on 1 ₿ at a manual $100,000, nothing on Strike — with 0.5 ₿ entered
 * cold on 2026-10-05 and one 0.1 ₿ cold move logged after it; live prices aborted, the price history stubbed, a fixed
 * day. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const ENTERED = Date.UTC(2026, 9, 5, 12);
const MOVE = `{ id: 'c1', date: '2026-10-08', ts: ${ENTERED + 3 * 86_400_000}, kind: 'deposit', amount: 0.1, target: 'cold' }`;
const STATE = `onboardingComplete: true, btcPriceMode: 'manual', btcPrice: 100000, advisorStartDate: '2026-10-01',
  simpleMode: true, simpleView: 'daily', hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
  coldStorageBtc: 0.5, coldStorageBtcAsOf: ${ENTERED}, dayLog: [${MOVE}]`;
const FACES = [['cycling', 'Cycling'], ['strategy', 'Strategy'], ['ownership', 'Ownership'], ['decision', 'Decision']] as const;

test.describe('cold storage — BL33', () => {
  test('COLD — Settings: its own group and what its figure is made of; an entry re-dates it; net coins count it; the four faces\' one card', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
    await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
    await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
    await page.addInitScript(`
      window.__APP_BOOTED = true;
      localStorage.setItem('personal-bloc-store', JSON.stringify({ state: { ${STATE} }, version: ${STORE_VERSION} }));
      localStorage.setItem('personal-bloc-onboarded', '1');`);
    await page.goto('/');
    await expect(page.getByLabel('Log an event'), 'on Daily').toBeVisible({ timeout: 15_000 });

    // GROUP — Settings → Strike Strategy: the live total (the entered 0.5 plus the move), and what it is made of
    await page.getByLabel('Settings').click();
    await page.getByRole('button', { name: /Strike Strategy/ }).click();
    await expect(page.getByText('COLD STORAGE', { exact: true }), 'GROUP its own').toBeVisible();
    const field = page.getByLabel('Total in cold storage');
    await expect(field, 'GROUP the live total').toHaveValue('0.60000000');
    await expect(page.getByText('Entered 2026-10-05, plus 1 move since.', { exact: true }), 'GROUP what it is made of').toBeVisible();

    // ENTER — a new total, saved by Enter (BL35: the field's Save, or Enter), dated today; the move before it is inside it now
    await field.fill('0.75');
    await field.press('Enter');
    await expect(field, 'ENTER the total').toHaveValue('0.75000000');
    await expect(page.getByText('Entered 2026-10-12.', { exact: true }), 'ENTER re-dated').toBeVisible();

    // NET — Your plan reads it in net coins today: 1 + 0.75 − 50,000 / 100,000
    await page.getByRole('button', { name: '← Settings' }).click();
    await page.getByRole('button', { name: /Your plan/ }).click();
    await expect(page.getByRole('group', { name: /^Net coins today:/ }), 'NET cold counts').toContainText('₿1.250');

    // FACES — one card on each, seeded from the live total; the Decision face leaves the total to its outcome strip
    await page.getByRole('button', { name: '← Settings' }).click();
    await page.getByRole('button', { name: '← Back' }).click();
    await page.getByLabel('Almanac').click();
    for (const [face, tile] of FACES) {
      await openAlmanacFace(page, tile);
      const card = page.getByRole('region', { name: 'Cold storage' });
      await expect(card, `${face}: one card`).toHaveCount(1, { timeout: 15_000 });
      await expect(card, `${face}: the reserve`).toContainText('0.750 ₿ you hold today');
      if (face === 'decision') await expect(card, `${face}: no second total`).not.toContainText('in your own custody');
      else await expect(card, `${face}: the total`).toContainText('in your own custody by ');
      await card.getByText('How the plan uses cold storage', { exact: true }).click();
      await expect(card.getByText(/^The support policy decides what goes to cold:/), `${face}: the rules`).toBeVisible();
    }
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });
});
