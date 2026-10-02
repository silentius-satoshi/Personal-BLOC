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

// Policy v2, Run B — a Coinbase loan the faces can price: $50,000 on 1 ₿ at a MANUAL $100,000 (nothing polls), with no
// as-of date (nothing accrues), so THE MOVE's cliff and trigger prices are the same on any day. Round synthetic figures.
const LOAN_SEED = `
  window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({
    state: {
      onboardingComplete: true, simpleMode: true, simpleView: 'daily',
      hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
      btcPriceMode: 'manual', btcPrice: 100000
    },
    version: ${STORE_VERSION}
  }));
  localStorage.setItem('personal-bloc-onboarded', '1');
`;

/** Seed a $50,000 Coinbase loan on 1 ₿ at a manual $100,000 + land on DailyModeView. */
export async function seedLoanAndGoto(page: Page): Promise<void> {
  await page.addInitScript(LOAN_SEED);
  await page.goto('/');
  await expect(page.getByLabel('Log an event'), 'e2e loan seed failed to reach DailyModeView').toBeVisible({ timeout: 15_000 });
}

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

/** Seed with a draw event on today + land on DailyModeView (Week scope). */
export async function seedJournal(page: Page): Promise<void> {
  await page.addInitScript(EVENT_SEED);
  await page.goto('/');
  await expect(
    page.getByLabel('Log an event'),
    'e2e seed failed to reach DailyModeView — store version in e2e/helpers.ts likely stale',
  ).toBeVisible({ timeout: 15_000 });
}

// Seed with advisorStartDate ~45 days ago (→ current strategy month 2) + a draw on today, so month paging
// has a real neighbour (month 1) to page to.
const MULTI_MONTH_SEED = `
  window.__APP_BOOTED = true;
  (function () {
    var now = new Date();
    var t = function (d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
    var start = new Date(now.getTime() - 45 * 86400000);
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily', advisorStartDate: t(start),
        dayLog: [{ id: 'e2e-draw-1', date: t(now), ts: now.getTime(), kind: 'draw', amount: 500 }]
      },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  })();
`;

// Seed TWO events on different days (today + yesterday) → the month modal shows two swipeable rows.
const TWO_EVENT_SEED = `
  window.__APP_BOOTED = true;
  (function () {
    var now = new Date();
    var t = function (d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
    var yday = new Date(now.getTime() - 86400000);
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: true, simpleView: 'daily',
        dayLog: [
          { id: 'e2e-draw-1', date: t(now),  ts: now.getTime(),        kind: 'draw', amount: 500 },
          { id: 'e2e-draw-2', date: t(yday), ts: now.getTime() - 1000, kind: 'draw', amount: 250 }
        ]
      },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  })();
`;

/** Two-event variant of openMonthModal (for the one-open-row spec). */
export async function openMonthModalTwo(page: Page): Promise<void> {
  await page.addInitScript(TWO_EVENT_SEED);
  await page.goto('/');
  await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Month', exact: true }).click();
  await page.getByText(/from \d+ day/).click();
  await expect(page.getByTestId('event-row')).toHaveCount(2);
}

/** Horizontal mouse drag from (startX, startY) by `dxPx` (negative = left). Real pointer events; a fast
 *  flick uses fewer steps + no inter-step wait (high release velocity). Used by the P3 navigation specs. */
export async function mouseDragX(page: Page, startX: number, startY: number, dxPx: number, opts: { fast?: boolean; release?: boolean } = {}): Promise<void> {
  const { fast = false, release = true } = opts;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const n = fast ? 3 : 12;
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(startX + (dxPx * i) / n, startY);
    if (!fast) await page.waitForTimeout(8);
  }
  await page.waitForTimeout(fast ? 0 : 25);
  if (release) { await page.mouse.up(); await page.waitForTimeout(40); }   // release:false → inspect mid-drag
}

/** seedAndGoto (daily journal) → open the simple-mode Settings subpage (AppShell Branch H, edge-back wrapped). */
export async function openSettingsSimple(page: Page): Promise<void> {
  await seedAndGoto(page);
  await page.getByLabel('Settings').click();
  await expect(page.getByTestId('edge-back-zone')).toBeVisible();
}

/** seedAndGoto (daily journal) → open the simple-mode Almanac subpage (AppShell Branch I, edge-back wrapped). */
export async function openAlmanacSimple(page: Page): Promise<void> {
  await seedAndGoto(page);
  await page.getByLabel('Almanac').click();
  await expect(page.getByTestId('edge-back-zone')).toBeVisible();
}

/** Seed a mid-strategy plan (current month ≥ 2) + land on DailyModeView. */
export async function seedJournalMonths(page: Page): Promise<void> {
  await page.addInitScript(MULTI_MONTH_SEED);
  await page.goto('/');
  await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
}

/** The first day-cell whose box lies inside the viewport — the SwipeStrip's CENTER pane (neighbour panes sit
 *  off-screen left/right and are pointer-events:none). Works regardless of which day is selected. */
export async function firstVisibleCell(page: Page): Promise<Locator> {
  const cells = page.getByTestId('day-cell');
  const vw = page.viewportSize()!.width;
  const n = await cells.count();
  for (let i = 0; i < n; i++) {
    const b = await cells.nth(i).boundingBox();
    if (b && b.x >= 0 && b.x + b.width <= vw + 1) return cells.nth(i);
  }
  throw new Error('no visible day cell');
}

/** Switch to Month scope + open the month-events modal (needs a seeded event so "from N entries" shows). */
export async function openMonthModal(page: Page): Promise<Locator> {
  await seedJournal(page);
  await page.getByRole('tab', { name: 'Month', exact: true }).click();
  await page.getByText(/from \d+ day/).click();
  const modal = page.getByTestId('event-row').first();
  await expect(modal).toBeVisible();
  return modal;
}

/** Horizontal drag by `dxPx` (negative = left) from a locator's center, via page.mouse (pointer events). */
export async function swipeX(page: Page, target: Locator, dxPx: number, opts: { fast?: boolean; release?: boolean } = {}): Promise<void> {
  const { fast = false, release = true } = opts;
  await target.scrollIntoViewIfNeeded();   // month-scope calendar sits below the fold — bring it on-screen
  const box = await target.boundingBox();
  if (!box) throw new Error('swipe target has no bounding box');
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const n = fast ? 3 : 12;
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(startX + (dxPx * i) / n, y);
    if (!fast) await page.waitForTimeout(8);
  }
  await page.waitForTimeout(fast ? 0 : 25);
  if (release) { await page.mouse.up(); await page.waitForTimeout(40); }
}

/**
 * Seed with a draw event, navigate, open its EventSheet in EDIT mode via the log-row tap; returns once the sheet is at
 * rest.
 */
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
  await waitForSheetAtRest(s);
  return s;
}

/** The DraggableSheet (any of the sheets). */
export function sheet(page: Page): Locator {
  return page.getByTestId('draggable-sheet');
}

/**
 * Wait until a just-opened sheet has stopped moving (the sheet-entry race, spec pbloc-spec-e2e-sheet-race-v1).
 * DraggableSheet slides in over 280 ms, and toBeVisible() passes on the slide's first frame (Playwright counts a
 * translated element as visible), so a box read straight after can sit anywhere on the way in — as low as the screen's
 * bottom edge — and a drag from there runs below the screen. At rest: the COMPUTED transform is the identity (the
 * inline style already reads translateY(0px) while the slide runs) AND the box top is equal on two consecutive
 * animation frames (Playwright's own "stable" rule, which also catches a bottom-anchored sheet whose height changes).
 * Polls; no fixed sleep. Keep both: a slide that hasn't started yet reads its from-state on every frame, so two equal
 * frames alone would pass at the very start.
 */
export async function waitForSheetAtRest(s: Locator): Promise<void> {
  await expect.poll(() => s.evaluate((el) => new Promise<boolean>((resolve) => {
    requestAnimationFrame(() => {
      const top = el.getBoundingClientRect().top;
      requestAnimationFrame(() => {
        const t = getComputedStyle(el).transform;
        resolve((t === 'none' || new DOMMatrixReadOnly(t).isIdentity) && el.getBoundingClientRect().top === top);
      });
    });
  })), { message: 'the sheet came to rest' }).toBe(true);
}

/** Open the EventSheet in ADD mode via the FAB; returns once the sheet is at rest. */
export async function openEventSheet(page: Page): Promise<Locator> {
  await seedAndGoto(page);
  await page.getByLabel('Log an event').click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  await waitForSheetAtRest(s);
  return s;
}

/**
 * Open the AlmanacConsentSheet (Almanac → live-height badge, which is off + unconsented by default); returns once the
 * sheet is at rest.
 */
export async function openConsentSheet(page: Page): Promise<Locator> {
  await seedAndGoto(page);
  await page.getByLabel('Almanac').click();
  await page.getByLabel('Live block height: off, tap to toggle').click();
  const s = sheet(page);
  await expect(s).toBeVisible();
  await waitForSheetAtRest(s);
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
