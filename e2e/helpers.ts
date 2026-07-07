import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Shared e2e helpers for the DraggableSheet gesture smoke suite.
 * The dev server bypasses every auth/viewer gate via import.meta.env.DEV, so a 3-field localStorage
 * seed lands us straight on DailyModeView (FAB + sheets reachable).
 */

// MUST match the useStore persist version (src/store/useStore.ts). Bump ALONGSIDE any store-version
// migration — a stale value drops the seed into the migrate/onboarding path and seedAndGoto's landing
// assertion fails loudly (rather than every spec timing out on a hidden onboarding modal).
export const STORE_VERSION = 21;

const SEED = `
  // Suppress index.html's 6s boot-watchdog overlay (#sw-diag-panel) — a cold vite dev start can boot
  // slower than 6s and the panel would intercept clicks. main.tsx sets this too; we set it pre-load.
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: { onboardingComplete: true, simpleMode: true, simpleView: 'daily' },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

/** Seed localStorage before app JS, navigate, and ASSERT we reached DailyModeView. */
export async function seedAndGoto(page: Page): Promise<void> {
  await page.addInitScript(SEED);
  await page.goto('/');
  await expect(
    page.getByLabel('Log an event'),
    'e2e seed failed to reach DailyModeView — store version in e2e/helpers.ts likely out of date with the persist migration',
  ).toBeVisible({ timeout: 15_000 });
}

// Seed variant that also plants ONE draw event on today's LOCAL date (computed in-browser so it matches
// todayLocalISO() → appears in the current day's activity log as a tappable edit row). Used to reach
// EventSheet's EDIT mode (a seeded amount is dirty under the pre-fix heuristic → the real Bug A path).
const EVENT_SEED = `
  window.__APP_BOOTED = true;
  (function () {
    var d = new Date();
    var today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily',
        dayLog: [{ id: 'e2e-draw-1', date: today, ts: d.getTime(), kind: 'draw', amount: 500 }]
      },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  })();
`;

/** Seed with a draw event, navigate, open its EventSheet in EDIT mode via the log-row tap. */
export async function openEventSheetEdit(page: Page): Promise<Locator> {
  await page.addInitScript(EVENT_SEED);
  await page.goto('/');
  const row = page.getByTestId('log-row').first();
  await expect(
    row,
    'e2e seed failed to render a day-log edit row — store version likely stale, or dayLog shape changed',
  ).toBeVisible({ timeout: 15_000 });
  await row.click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  return s;
}

/** The DraggableSheet (any of the sheets). */
export function sheet(page: Page): Locator {
  return page.getByTestId('draggable-sheet');
}

/** Open the EventSheet in ADD mode via the FAB. */
export async function openEventSheet(page: Page): Promise<Locator> {
  await seedAndGoto(page);
  await page.getByLabel('Log an event').click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  return s;
}

/** Open the AlmanacConsentSheet (Almanac → live-height badge, which is off + unconsented by default). */
export async function openConsentSheet(page: Page): Promise<Locator> {
  await seedAndGoto(page);
  await page.getByLabel('Almanac').click();
  await page.getByLabel('Live block height: off, tap to toggle').click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  return s;
}

/** The inline transform written by DraggableSheet's onMove (e.g. "translateY(0px)" / "translateY(140px)"). */
export async function sheetTransform(s: Locator): Promise<string> {
  return s.evaluate((el) => (el as HTMLElement).style.transform || '');
}

/** Parse the px out of a translateY(...) string; 0 for none/empty. */
export function translateYpx(transform: string): number {
  const m = /translateY\(([-0-9.]+)px\)/.exec(transform);
  return m ? parseFloat(m[1]) : 0;
}

interface DragOpts {
  steps?: number;
  fast?: boolean; // fewer steps + no settle delay → high release velocity (a flick)
  release?: boolean; // default true; false leaves the pointer down (to inspect mid-drag)
  startOffsetY?: number; // px below the sheet's top to begin the drag (default 8 = the grabber)
}

/**
 * Drag the sheet downward from its grabber by `dyPx` using page.mouse (real pointer events, capture-capable).
 * Starts near the top of the sheet so the pointer stays within bounds. Returns after release (unless
 * release:false). A short settle wait lets the hook's rAF-batched onMove flush before callers read transform.
 */
export async function dragDown(page: Page, s: Locator, dyPx: number, opts: DragOpts = {}): Promise<void> {
  const { steps = 12, fast = false, release = true, startOffsetY = 8 } = opts;
  const box = await s.boundingBox();
  if (!box) throw new Error('sheet has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + startOffsetY; // default = the grabber
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const n = fast ? 3 : steps;
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(startX, startY + (dyPx * i) / n);
    if (!fast) await page.waitForTimeout(8);
  }
  await page.waitForTimeout(fast ? 0 : 25); // let the last rAF onMove flush
  if (release) {
    await page.mouse.up();
    await page.waitForTimeout(30);
  }
}

/**
 * Drag downward by `dyPx` STARTING FROM the center of `startEl` (a non-input content element — a field label /
 * section header). Proves the content region owns the downward drag, not only the grabber. Do NOT pass an
 * <input> — mousedown would focus it and the keyboard guard would (correctly) bail the gesture.
 */
export async function dragDownFrom(page: Page, startEl: Locator, dyPx: number, opts: DragOpts = {}): Promise<void> {
  const { steps = 12, fast = false, release = true } = opts;
  const box = await startEl.boundingBox();
  if (!box) throw new Error('start element has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const n = fast ? 3 : steps;
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(startX, startY + (dyPx * i) / n);
    if (!fast) await page.waitForTimeout(8);
  }
  await page.waitForTimeout(fast ? 0 : 25);
  if (release) {
    await page.mouse.up();
    await page.waitForTimeout(30);
  }
}
