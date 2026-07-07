import { test, expect } from '@playwright/test';
import { seedJournal, seedJournalMonths, firstVisibleCell, openMonthModal, openMonthModalTwo, swipeX } from './helpers';

test.describe('Journal gestures (P2)', () => {
  test('calendar swipe pages months; boundary rubber-bands', async ({ page }) => {
    await seedJournalMonths(page);   // current month 2 → month 1 is a real neighbour
    await page.getByRole('tab', { name: 'Month', exact: true }).click();
    const label = page.locator('[class*="calNavLabel"]');
    const monthTwo = (await label.textContent())?.trim() ?? '';
    // Drag RIGHT (prev) → pages back to month 1 (real paging). The double-buffered snap resolves after
    // --motion-settle, so use a retrying assertion.
    await swipeX(page, await firstVisibleCell(page), 180);
    await expect(label).not.toHaveText(monthTwo);
    const monthOne = (await label.textContent())?.trim() ?? '';
    // Drag RIGHT again AT month 1 (the strategy start) → boundary rubber-band, label unchanged.
    await swipeX(page, await firstVisibleCell(page), 180);
    await page.waitForTimeout(450);   // allow any snap to resolve
    await expect(label).toHaveText(monthOne);
  });

  test('long-press opens the pre-dated add sheet; a short press just selects', async ({ page }) => {
    await seedJournal(page);
    const cell = await firstVisibleCell(page);
    await cell.scrollIntoViewIfNeeded();
    const box = await cell.boundingBox();
    const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;

    // Short press (300ms) → no sheet.
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
    await expect(page.getByTestId('draggable-sheet')).toHaveCount(0);

    // Long press (600ms stationary) → the add sheet opens.
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
    await expect(page.getByTestId('draggable-sheet')).toBeVisible();
    await expect(page.getByText('Log an event')).toBeVisible(); // add-mode title
  });

  test('swipe-to-delete: reveal → tap DELETE → snackbar → UNDO restores', async ({ page }) => {
    const row = await openMonthModal(page);
    await swipeX(page, row, -70);                       // reveal left
    const del = page.getByTestId('swipe-delete-btn');
    await expect(del).toBeVisible();
    await del.click();
    await expect(page.getByText('Event deleted')).toBeVisible();   // snackbar
    await expect(page.getByTestId('event-row')).toHaveCount(0);     // row gone
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('event-row')).toHaveCount(1);     // restored
  });

  test('only one row is open at a time', async ({ page }) => {
    await openMonthModalTwo(page);
    const rows = page.getByTestId('event-row');
    await swipeX(page, rows.nth(0), -70);
    await expect(rows.nth(0)).toHaveAttribute('data-open', 'true');
    await swipeX(page, rows.nth(1), -70);
    await expect(rows.nth(1)).toHaveAttribute('data-open', 'true');
    await expect(rows.nth(0)).not.toHaveAttribute('data-open', 'true'); // A closed when B opened
  });

  test('⭐ a fast flick NEVER deletes — it only rests the row open (non-negotiable 1)', async ({ page }) => {
    const row = await openMonthModal(page);
    await swipeX(page, row, -300, { fast: true });      // fast flick far past 96px
    // The row survives (no velocity commit); nothing deleted, no snackbar.
    await expect(page.getByTestId('event-row')).toHaveCount(1);
    await expect(page.getByText('Event deleted')).toHaveCount(0);
  });
});
