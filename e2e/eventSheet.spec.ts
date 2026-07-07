import { test, expect } from '@playwright/test';
import { openEventSheet, openEventSheetEdit, dragDown, dragDownFrom, sheetTransform, translateYpx } from './helpers';

test.describe('EventSheet gesture behavior', () => {
  test('clean open is not dirty and flick-dismisses', async ({ page }) => {
    const s = await openEventSheet(page);
    // Bug A: a freshly-opened add sheet must NOT be dirty (nothing staged yet).
    await expect(s).toHaveAttribute('data-dirty', 'false');
    const box = await s.boundingBox();
    await dragDown(page, s, Math.round((box!.height ?? 500) * 0.6));
    await expect(s).toHaveCount(0); // dismissed
  });

  test('Bug E — the SHEET stays opaque while dragging; only the backdrop fades', async ({ page }) => {
    const s = await openEventSheet(page);
    const backdrop = page.getByTestId('sheet-backdrop');
    const box = await s.boundingBox();
    await dragDown(page, s, Math.round((box!.height ?? 500) * 0.4), { release: false });
    const sheetOpacity = await s.evaluate((el) => getComputedStyle(el as HTMLElement).opacity);
    const backdropOpacity = await backdrop.evaluate((el) => parseFloat(getComputedStyle(el as HTMLElement).opacity));
    expect(sheetOpacity).toBe('1');          // sheet never receives an opacity write
    expect(backdropOpacity).toBeLessThan(1); // the backdrop IS the progress indicator
    await page.mouse.up();
  });

  test('Bug D — a downward drag from mid-content (not the grabber) dismisses', async ({ page }) => {
    const s = await openEventSheet(page);
    // Start from a non-input content element (a field label) — proves the content region owns the drag.
    const startEl = s.getByText(/draw amount/i).first();
    await expect(startEl).toBeVisible();
    const box = await s.boundingBox();
    await dragDownFrom(page, startEl, Math.round((box!.height ?? 500) * 0.7));
    await expect(s).toHaveCount(0); // dismissed
  });

  test('Bug A — unmodified EDIT sheet is not dirty and flick-dismisses', async ({ page }) => {
    // The real device Bug A: opening an existing event seeds amount>0, which the pre-fix heuristic
    // counted as "dirty" → the unmodified edit sheet rubber-band-capped and refused to dismiss.
    // Touched-flag fix: a sheet is dirty only after the USER edits a field.
    const s = await openEventSheetEdit(page);
    await expect(s).toHaveAttribute('data-dirty', 'false');
    const box = await s.boundingBox();
    await dragDown(page, s, Math.round((box!.height ?? 500) * 0.6));
    await expect(s).toHaveCount(0); // dismissed
  });

  test('editing a field in an EDIT sheet makes it dirty (caps, no dismiss)', async ({ page }) => {
    const s = await openEventSheetEdit(page);
    const amount = s.locator('input').first();
    await amount.click();
    await amount.fill('750');
    await page.getByRole('dialog').click({ position: { x: 5, y: 5 } });
    await expect(s).toHaveAttribute('data-dirty', 'true');
    const box = await s.boundingBox();
    const dist = Math.round((box!.height ?? 500) * 0.6);
    await dragDown(page, s, dist, { release: false });
    expect(translateYpx(await sheetTransform(s))).toBeLessThan(dist * 0.5);
    await page.mouse.up();
    await page.waitForTimeout(50);
    await expect(s).toBeVisible();
  });

  test('one keystroke in amount → dirty → drag caps and refuses to dismiss', async ({ page }) => {
    const s = await openEventSheet(page);
    // Type into the amount field (the first input in the sheet).
    const amount = s.locator('input').first();
    await amount.click();
    await amount.fill('100');
    // Blur so the keyboard guard doesn't block the drag (Bug B is a separate test).
    await page.getByRole('dialog').click({ position: { x: 5, y: 5 } });
    await expect(s).toHaveAttribute('data-dirty', 'true');
    const box = await s.boundingBox();
    const dist = Math.round((box!.height ?? 500) * 0.6);
    await dragDown(page, s, dist, { release: false });
    const ty = translateYpx(await sheetTransform(s));
    // Dirty cap = rubberBand(dy, 0.25*height) ≪ the raw drag distance.
    expect(ty).toBeGreaterThan(0);
    expect(ty).toBeLessThan(dist * 0.5);
    await page.mouse.up();
    await page.waitForTimeout(50);
    await expect(s).toBeVisible(); // sprang back, not dismissed
  });

  test('keyboard guard — focused input → drag produces zero movement', async ({ page }) => {
    const s = await openEventSheet(page);
    const amount = s.locator('input').first();
    await amount.click(); // keep it focused
    await expect(amount).toBeFocused();
    const box = await s.boundingBox();
    await dragDown(page, s, Math.round((box!.height ?? 500) * 0.6), { release: false });
    const ty = translateYpx(await sheetTransform(s));
    expect(ty).toBe(0); // guard blocked the gesture entirely
    await page.mouse.up();
    await expect(s).toBeVisible();
  });

  test('scroll coexistence — scrolled content blocks the drag until scrollTop 0', async ({ page }) => {
    // Shrink the viewport so the sheet content overflows and can scroll.
    await page.setViewportSize({ width: 390, height: 500 });
    const s = await openEventSheet(page);
    // Force a scrolled position.
    await s.evaluate((el) => { (el as HTMLElement).scrollTop = 60; });
    const scrolled = await s.evaluate((el) => (el as HTMLElement).scrollTop);
    test.skip(scrolled === 0, 'sheet content did not overflow — cannot exercise scroll gate');
    const box = await s.boundingBox();
    await dragDown(page, s, Math.round((box!.height ?? 400) * 0.6), { release: false });
    expect(translateYpx(await sheetTransform(s))).toBe(0); // native scroll owns the pointer
    await page.mouse.up();
    await expect(s).toBeVisible();
    // Back at the top, the drag dismisses.
    await s.evaluate((el) => { (el as HTMLElement).scrollTop = 0; });
    await dragDown(page, s, Math.round((box!.height ?? 400) * 0.7));
    await expect(s).toHaveCount(0);
  });

  test('reduced-motion — no continuous transform but release still dismisses', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const s = await openEventSheet(page);
    const box = await s.boundingBox();
    const dist = Math.round((box!.height ?? 500) * 0.6);
    await dragDown(page, s, dist, { release: false });
    // Under reduced motion the sheet does not track the finger.
    expect(translateYpx(await sheetTransform(s))).toBe(0);
    await page.mouse.up();
    await page.waitForTimeout(50);
    await expect(s).toHaveCount(0); // still dismisses on release past threshold
  });
});
