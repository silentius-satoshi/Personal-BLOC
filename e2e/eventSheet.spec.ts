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

  test('keyboard guard — pressing the FOCUSED field itself does not drag (typing context)', async ({ page }) => {
    const s = await openEventSheet(page);
    const amount = s.locator('input').first();
    await amount.click(); // focus it
    await expect(amount).toBeFocused();
    const box = await s.boundingBox();
    // Start the drag ON the focused input → typing context → no drag.
    await dragDownFrom(page, amount, Math.round((box!.height ?? 500) * 0.6), { release: false });
    expect(translateYpx(await sheetTransform(s))).toBe(0);
    await page.mouse.up();
    await expect(s).toBeVisible();
    await expect(amount).toBeFocused(); // still focused (never blurred — you pressed the field)
  });

  test('focus-then-drag — pressing elsewhere with a field focused blurs + drags (H1)', async ({ page }) => {
    const s = await openEventSheet(page);
    const amount = s.locator('input').first();
    await amount.click(); // focus a field
    await expect(amount).toBeFocused();
    const label = s.getByText(/draw amount/i).first();
    const box = await s.boundingBox();
    // Drag starting on a NON-input label while the field is focused. HEAD: the activeElement guard bails on ANY
    // focused input → no blur, no drag. Fixed: pressing elsewhere blurs the field and the drag proceeds.
    await dragDownFrom(page, label, Math.round((box!.height ?? 500) * 0.6), { release: false });
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
    expect(activeTag).not.toBe('INPUT');                        // the field was blurred
    expect(translateYpx(await sheetTransform(s))).toBeGreaterThan(0); // the sheet is tracking the drag
    await page.mouse.up();
    await page.waitForTimeout(50);
    await expect(s).toHaveCount(0);                             // released past threshold → dismissed
  });

  // The scroll/drag handoff (native-scroll-vs-sheet ownership) needs REAL touch + native scroll + pointercancel
  // coordination that Chromium's mouse pipeline can't reproduce: synthetic touch events drive no pointer pipeline
  // and start no native scroll, so there's nothing to hand off. The claim RULE is unit-tested (resolveScrollClaim
  // in gestureModel.test.ts); the integrated behavior is verified in the iOS device gate. See helpers.ts note.
  test.fixme('scroll coexistence — scrolled content owns the drag until scrollTop 0 (device gate)', async () => {});
  test.fixme('jitter handoff — down-then-up hands back to native scroll (device gate)', async () => {});

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
