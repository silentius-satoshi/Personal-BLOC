import { test, expect, type Page, type Locator } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * F-2d-1 (BL34–BL35, build 2e) — leaving the APP, not the page, with a plan setting still focused saves what was typed,
 * and the edit goes on (spec pbloc-spec-batch-1-v1 §2.2e). On the owner's iPhone, a figure typed and then left by a
 * switch to another app was lost once iOS closed the app: no React onBlur ran — React listens for `focusout`, and the
 * app going away sends the field none (WebKit's loss of page focus sends it a bare `blur`, by its source). So the app's
 * side is played here as WebKit plays it — a bare `blur` on the field and the window's blur (the app switcher), the page
 * turning hidden (the Home Screen, another app) — and the plan log is read in the SAME task, as localStorage would hold
 * it if iOS suspended the app right after. A save is counted by its event's id: a second save of the same figure within
 * 10 s replaces the first event in the log (compact.ts), so the values alone can't show it. Hermetic: round synthetic
 * figures, live prices aborted, the price history stubbed, a fixed day. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const STATE = `onboardingComplete: true, btcPriceMode: 'manual', btcPrice: 100000, advisorStartDate: '2026-10-01',
  simpleMode: true, simpleView: 'dashboard', expenses: 4000, advisorActualBlocBalance: 20000`;

async function start(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.addInitScript(`
    window.__APP_BOOTED = true;
    localStorage.setItem('personal-bloc-store', JSON.stringify({ state: { ${STATE} }, version: ${STORE_VERSION} }));
    localStorage.setItem('personal-bloc-onboarded', '1');`);
  await page.goto('/');
  await expect(page.getByLabel('Settings'), 'on the Dashboard').toBeVisible({ timeout: 15_000 });
}

/** A NumberInput by its visible label (a span, not a <label>). */
const fieldOf = (page: Page, label: string): Locator =>
  page.locator(`xpath=//span[normalize-space()="${label}"]/following-sibling::div//input`);
type Ev = { field: string; value: unknown; id: string };
/** A plan field's events in the persisted plan log. */
const events = (page: Page, field: string): Promise<Ev[]> =>
  page.evaluate((f) => ((JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.planEvents ?? []) as
    Ev[]).filter((e) => e.field === f), field);
const values = (evs: Ev[]): unknown[] => evs.map((e) => e.value);
const ids = (evs: Ev[]): string[] => evs.map((e) => e.id);

/** Settings → a subpage, by touch. */
async function openSubpage(page: Page, row: RegExp): Promise<void> {
  await page.getByLabel('Settings').tap();
  await page.getByRole('button', { name: row }).tap();
}
/** Focus by a tap, clear, then type a figure one key at a time — as on a phone. */
async function typeByTouch(field: Locator, figure: string): Promise<void> {
  await field.tap();
  await field.fill('');
  await field.pressSequentially(figure, { delay: 40 });
}

/**
 * The app goes away as WebKit plays it, step by step in ONE task — 'blur': a bare `blur` on the focused field (no
 * `focusout`) and the window's blur (the app switcher); 'hidden': the page turns hidden (the Home Screen, another app) —
 * with the field's plan events read after each step, as localStorage would hold them if iOS suspended the app then;
 * and whether the field still has focus.
 */
async function away(page: Page, steps: ('blur' | 'hidden')[], field: string): Promise<{ after: Ev[][]; focused: boolean }> {
  return page.evaluate(([st, f]) => {
    const el = document.activeElement as HTMLElement | null;
    const read = (): Ev[] => ((JSON.parse(localStorage.getItem('personal-bloc-store') || '{}').state?.planEvents ?? []) as
      Ev[]).filter((e) => e.field === f);
    const after: Ev[][] = [];
    for (const s of st) {
      if (s === 'blur') {
        el?.dispatchEvent(new FocusEvent('blur'));
        window.dispatchEvent(new FocusEvent('blur'));
      } else {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      after.push(read());
    }
    return { after, focused: el !== null && el === document.activeElement };
  }, [steps, field] as const);
}
/** The app comes back: the page visible, the window focused. */
async function back(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new FocusEvent('focus'));
  });
}

test.describe('number fields — leaving the app (F-2d-1, build 2e)', () => {
  test('HOME — a typed plan setting saves once when the app goes away, and the edit goes on', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    const expenses = fieldOf(page, 'Monthly expenses');
    await typeByTouch(expenses, '4200');
    expect(values(await events(page, 'expenses')), 'PREMISE nothing saved as it is typed').toEqual([]);
    await back(page);
    expect(values(await events(page, 'expenses')), 'VISIBLE a page shown saves nothing').toEqual([]);
    const gone = await away(page, ['blur', 'hidden'], 'expenses');
    expect(gone.focused, 'PREMISE the field still has focus — the bare blur moved none').toBe(true);
    expect(values(gone.after[0]), "AWAY saved on the window's blur, in localStorage in the same task").toEqual([4200]);
    expect(ids(gone.after[1]), 'AWAY once — the page turning hidden too saves nothing more').toEqual(ids(gone.after[0]));
    await back(page);
    await expect(expenses, 'AWAY the edit goes on — the field keeps the typing').toHaveValue('4200');
    await page.getByText('Monthly expenses', { exact: true }).tap();
    expect(ids(await events(page, 'expenses')), 'AWAY once — leaving the field afterwards saves nothing more').toEqual(ids(gone.after[0]));
    await expect(page.getByText('Something crashed'), 'no crash').toHaveCount(0);
  });

  test('HIDE — the page turning hidden alone saves a typed plan setting', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    await typeByTouch(fieldOf(page, 'Monthly expenses'), '4200');
    const gone = await away(page, ['hidden'], 'expenses');
    expect(values(gone.after[0]), 'HIDE saved, in localStorage in the same task').toEqual([4200]);
  });

  test('CLEARED — an emptied plan setting saves nothing when the app goes away, stays empty, and saves what is typed after', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    const expenses = fieldOf(page, 'Monthly expenses');
    await expenses.tap();
    await expenses.fill('');
    const gone = await away(page, ['blur', 'hidden'], 'expenses');
    expect(values(gone.after[1]), 'CLEARED nothing saved').toEqual([]);
    await back(page);
    await expect(expenses, 'CLEARED the field stays empty — no figure put back under the caret').toHaveValue('');
    await expenses.pressSequentially('4200', { delay: 40 });
    await page.getByText('Monthly expenses', { exact: true }).tap();
    expect(values(await events(page, 'expenses')), 'CLEARED only what was typed is saved').toEqual([4200]);
  });

  test('UNTOUCHED — a plan setting focused but not typed in saves nothing when the app goes away', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    await fieldOf(page, 'Monthly expenses').tap();
    const gone = await away(page, ['blur', 'hidden'], 'expenses');
    expect(gone.focused, 'PREMISE the field still has focus').toBe(true);
    expect(values(gone.after[1]), 'UNTOUCHED nothing saved').toEqual([]);
  });

  test('HELD — a typed dated figure keeps its typing and its Save when the app goes away, and saves nothing', async ({ page }) => {
    await start(page);
    await openSubpage(page, /Strike Strategy/);
    const drawn = fieldOf(page, 'Amount Drawn');
    await typeByTouch(drawn, '1234');
    await expect(page.getByRole('button', { name: 'Save — dated today' }), 'PREMISE its Save is offered').toBeVisible();
    const gone = await away(page, ['blur', 'hidden'], 'advisorActualBlocBalance');
    expect(values(gone.after[1]), 'HELD nothing saved').toEqual([]);
    await back(page);
    await expect(drawn, 'HELD the typing kept').toHaveValue('1234');
    await expect(page.getByRole('button', { name: 'Save — dated today' }), 'HELD its Save still offered').toBeVisible();
  });
});
