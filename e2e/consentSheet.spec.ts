import { test, expect } from '@playwright/test';
import { openConsentSheet, dragDown } from './helpers';

test.describe('AlmanacConsentSheet (never dirty)', () => {
  test('clean drag past threshold dismisses', async ({ page }) => {
    const s = await openConsentSheet(page);
    await expect(s).toHaveAttribute('data-dirty', 'false');
    const box = await s.boundingBox();
    // drag well past 45% of the sheet height
    await dragDown(page, s, Math.round((box!.height ?? 400) * 0.7));
    await expect(s).toHaveCount(0); // portal unmounted → dismissed
  });
});
