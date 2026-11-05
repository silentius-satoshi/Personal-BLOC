import { test, expect, type Page, type Locator } from '@playwright/test';
import { STORE_VERSION, openAlmanacFace } from './helpers';

// R1 (BL45, B′) — the Decision card in sections: "To do today" first, always open; a card per venue — Strike, Coinbase,
// cold storage — folding under a row with its ₿, folded on every visit (nothing stored); the folded Coinbase card keeps its
// seizure price in view. A plan whose move is made: 2.5 ₿ on Strike for a $40,000 line, a $20,000 Coinbase loan on 2.2 ₿,
// 0.5 ₿ in cold, at a manual $160,000 (nothing polls; no as-of date, so nothing accrues). Today's support moves with the
// date, so the amounts are read as shapes, never pinned. Round synthetic figures. Every assertion carries its tag.
const SEED = `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: {
      onboardingComplete: true, simpleMode: true, simpleView: 'daily',
      strikeCollateralBtc: 2.5, creditLine: 40000, coldStorageBtc: 0.5,
      hasCbLoan: true, cbLoanBalance: 20000, cbLoanBalanceAsOf: null, cbCollateralBtc: 2.2,
      btcPriceMode: 'manual', btcPrice: 160000
    },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;
const MOVE_TITLE = "The support policy's move this month";
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });

async function openDecision(page: Page): Promise<Locator> {
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.addInitScript(SEED);
  await page.goto('/');
  await expect(page.getByLabel('Log an event'), 'the seed reached the journal').toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Almanac').click();
  await openAlmanacFace(page, 'Decision');
  const move = page.getByRole('region', { name: MOVE_TITLE });
  await expect(move).toBeVisible({ timeout: 8000 });
  return move;
}
/** A venue's row, by its name for a screen reader — "Strike, 1.219 ₿" (`rowName`). */
const rowOf = (move: Locator, name: string): Locator => move.getByRole('button', { name: new RegExp(`^${name}, `) });

test.describe('R1 — the Decision card in sections (B′)', () => {
  test('To do today first; three venue cards, folded; the folded Coinbase card keeps its seizure price', async ({ page }) => {
    const move = await openDecision(page);
    await expect(move.getByText('To do today', { exact: true }), 'TODO').toBeVisible();
    await expect(move.getByText(/^Release [\d.]+ ₿ of Strike collateral to cold storage\.$/), 'TODO a row').toBeVisible();
    for (const name of ['Strike', 'Coinbase', 'Cold storage']) {
      await expect(rowOf(move, name), `FOLDED ${name}`).toHaveAttribute('aria-expanded', 'false');
      await expect(rowOf(move, name), `FOLDED ${name} its ₿`).toHaveText(new RegExp(`^${name}[\\d.]+ ₿›$`));
    }
    await expect(move.getByText('Keeps', { exact: true }), 'FOLDED no fact but a warning').toHaveCount(0);
    await expect(move.getByText('Seizes at', { exact: true }), 'COINBASE FOLDED').toBeVisible();
    await expect(move.getByText(/^\$[\d,]+$/).first(), 'COINBASE FOLDED its price').toBeVisible();
    await expect(page.getByText('Something crashed')).toHaveCount(0);
  });

  test('a row opens its card and folds it again; leaving the face and coming back folds every card', async ({ page }) => {
    const move = await openDecision(page);
    const strike = rowOf(move, 'Strike');
    await strike.click();
    await expect(strike, 'OPEN').toHaveAttribute('aria-expanded', 'true');
    const body = move.locator(`[id="${await strike.getAttribute('aria-controls')}"]`);
    await expect(body.getByText('Keeps', { exact: true }), 'OPEN Keeps').toBeVisible();
    await expect(body.getByText(/^[\d.]+ ₿ of [\d.]+ ₿$/), 'OPEN Keeps its figures').toBeVisible();
    await expect(body.getByText('For', { exact: true }), 'OPEN For').toBeVisible();
    await strike.click();
    await expect(strike, 'FOLD again').toHaveAttribute('aria-expanded', 'false');
    await expect(body.getByText('Keeps', { exact: true }), 'FOLD again').toHaveCount(0);
    // Open all three, leave for the grid, come back: folded again — the fold lives in the card alone.
    for (const name of ['Strike', 'Coinbase', 'Cold storage']) await rowOf(move, name).click();
    await expect(move.getByText(/^[\d]+% of all [\d.]+ ₿$|^less than 1% of all|^more than 99% of all/), 'VISIT premise the cold card open').toBeVisible();
    // Out and in by the helper's own way — the header's "Almanac", then the tile, as navigation's tap test goes. Never
    // a tap on the header first: the helper's one check would then meet the grid and the header's link at once, for
    // the render the link takes to clear (v1.0's race, red 10 of 10 on the owner's Mac).
    await openAlmanacFace(page, 'Decision');
    const again = page.getByRole('region', { name: MOVE_TITLE });
    await expect(again).toBeVisible({ timeout: 8000 });
    for (const name of ['Strike', 'Coinbase', 'Cold storage']) {
      await expect(rowOf(again, name), `VISIT ${name} folded`).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('all three open: no sideways scroll at 390px or 375px, and every row is a 44px target', async ({ page }) => {
    const move = await openDecision(page);
    for (const name of ['Strike', 'Coinbase', 'Cold storage']) await rowOf(move, name).click();
    for (const width of [390, 375]) {
      await page.setViewportSize({ width, height: 844 });
      const over = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
      expect(over, `WIDTH ${width}`).toBeLessThanOrEqual(0);
      for (const name of ['Strike', 'Coinbase', 'Cold storage']) {
        const b = (await rowOf(move, name).boundingBox())!;
        expect(b.height, `TARGET ${name} @${width}`).toBeGreaterThanOrEqual(44);
        expect(b.x + b.width, `WIDTH ${name} @${width}`).toBeLessThanOrEqual(width);
      }
    }
  });
});
