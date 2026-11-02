import { test, expect, type Browser, type Page } from '@playwright/test';
import { STORE_VERSION } from './helpers';

/**
 * BL48 — trusted viewers in the Almanac (BL40's second piece; spec pbloc-spec-trusted-viewers-v1). The first viewer
 * e2e: the dev server skips every viewer gate (helpers.ts), so a viewer page is put in a viewer's state through the
 * app's own modules — the REAL trusted (or safe) payload an owner page builds (`buildViewerSnapshotPayload`), applied by
 * the relay path's one apply (`applyViewerSnapshot`, viewerSync.ts). Two devices: the owner's in its own context, the
 * viewer's the test's page. Hermetic and date-proof: round synthetic figures — $50,000 on 1 ₿ at a manual $100,000, one
 * logged month, 0.5 ₿ entered cold and a 0.1 ₿ cold move — the same manual price on both devices, live prices aborted,
 * the price history stubbed, a fixed day. Every assertion has a tag.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });
const ENTERED = Date.UTC(2026, 9, 5, 12);
const MOVE = `{ id: 'c1', date: '2026-10-08', ts: ${ENTERED + 3 * 86_400_000}, kind: 'deposit', amount: 0.1, target: 'cold' }`;
const LOG = `monthBucketReconcileDone: true, monthlyLog: [{ month: 1, date: '2026-10-05', btcBought: 0, income: 0, paydown: 0,
  strikeBal: 0, strikeLtv: 0, loggedAt: 1, updatedAt: 1, expensesActual: 500, source: 'daily', confirmed: false }]`;
const PRICE = `btcPriceMode: 'manual', btcPrice: 100000`;
const ownerState = (simple: boolean, loan = true, extra = '') => `onboardingComplete: true, ${PRICE}, advisorStartDate: '2026-10-01',
  simpleMode: ${simple}, simpleView: 'daily', hasCbLoan: ${loan}, cbLoanBalance: 50000, cbLoanBalanceAsOf: null,
  cbCollateralBtc: 1, coldStorageBtc: 0.5, coldStorageBtcAsOf: ${ENTERED}, dayLog: [${MOVE}], venueColors: { strike: '#38bdf8' },
  fireInputs: { otherUsd: 200000 }, inflationRate: 3${loan ? `, ${LOG}` : ''}${extra}`;
const VIEWER_STATE = `onboardingComplete: true, viewerMode: true, simpleMode: true, ${PRICE}`;
const seed = (state: string) => `window.__APP_BOOTED = true;
  localStorage.setItem('personal-bloc-store', JSON.stringify({ state: { ${state} }, version: ${STORE_VERSION} }));
  localStorage.setItem('personal-bloc-onboarded', '1');`;

/** What a viewer reads over a plan face (almanacGrid.ts's VIEWER_WHAT_IF_NOTE). */
const NOTE = "What-if only: what you change here isn't saved, and the plan doesn't change.";
/** The lines a viewer's faces lose or gain by BL48's calls, and nothing else: V5 A's copies, V4 B's Pin and its words. */
const OWNER_ONLY = [
  'CopyDownload .txtPrint', 'Copy', 'Download .txt', 'Print',   // the schedule's row (one line of inline buttons, or three)
  'Copy CSVDownload .csv', 'Copy CSV', 'Download .csv',         // the Ledger's
  "Pin today's plan", 'Pin a plan, then test a what-if against it.',
];
const VIEWER_ONLY = [NOTE, 'Test a what-if against the plan.'];

/** The app's own modules, as the dev server serves them — the same instances the page runs. */
const STORE_MOD = '/src/store/useStore.ts';
const PAYLOADS_MOD = '/src/store/payloads.ts';
const VIEWER_SYNC_MOD = '/src/lib/nostr/viewerSync.ts';

async function prepare(page: Page, state: string): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-12T12:00:00'));
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
  await page.addInitScript(seed(state));
  await page.goto('/');
}

/** The owner's device, in a context of its own: the payloads its store builds, and the page to read its faces. */
async function ownerDevice(browser: Browser, state: string, width = 390): Promise<{ page: Page; trusted: string; safe: string; close: () => Promise<void> }> {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL, viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 768,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  await prepare(page, state);
  await expect(page.getByLabel('Almanac').or(page.getByRole('button', { name: /^Tools/ })), 'OWNER on his app').toBeVisible({ timeout: 20_000 });
  const p = await page.evaluate(async ([storeMod, payloadsMod]) => {
    const { useStore } = await import(/* @vite-ignore */ storeMod);
    const { buildViewerSnapshotPayload } = await import(/* @vite-ignore */ payloadsMod);
    const s = useStore.getState();
    return { trusted: JSON.stringify(buildViewerSnapshotPayload(s, 'trusted')), safe: JSON.stringify(buildViewerSnapshotPayload(s, 'safe')) };
  }, [STORE_MOD, PAYLOADS_MOD] as const);
  return { page, ...p, close: () => ctx.close() };
}

/** The viewer's device — the test's page — seeded a viewer, then handed a snapshot the way the relay path applies one. */
async function viewerDevice(page: Page, payload: string): Promise<void> {
  await prepare(page, VIEWER_STATE);
  await apply(page, payload);
  await expect(page.getByText(/^Good (morning|afternoon|evening)/), 'VIEWER on his home').toBeVisible({ timeout: 20_000 });
}

const apply = (page: Page, payload: string) => page.evaluate(async ([mod, json]) => {
  const { applyViewerSnapshot } = await import(/* @vite-ignore */ mod);
  applyViewerSnapshot(JSON.parse(json));
}, [VIEWER_SYNC_MOD, payload] as const);

/** What a test reads of the viewer's store. */
const state = (page: Page) => page.evaluate(async (mod) => {
  const { useStore } = await import(/* @vite-ignore */ mod);
  const s = useStore.getState();
  return {
    activeTab: s.activeTab as string, previousTab: s.previousTab as string, months: s.monthlyLog.length as number,
    hasCbLoan: s.hasCbLoan as boolean, cbLoanBalance: s.cbLoanBalance as number, coldStorageBtc: s.coldStorageBtc as number,
    venueStrike: (s.venueColors?.strike ?? null) as string | null, coldMoves: s.viewerColdMovedByMonth as Record<string, number> | null,
    depositISO: s.viewerStrikeDepositISO as string | null, safe: s.viewerSafeSnapshot !== null, simpleMode: s.simpleMode as boolean,
    mining: JSON.stringify(s.miningInputs), loaded: s.viewerDataLoaded as boolean, hidden: s.hiddenTabs as string[],
  };
}, STORE_MOD);

const setTab = (page: Page, tab: string, prev: string) => page.evaluate(async ([mod, t, p]) => {
  const { useStore } = await import(/* @vite-ignore */ mod);
  useStore.getState().setPreviousTab(p);
  useStore.getState().setActiveTab(t);
}, [STORE_MOD, tab, prev] as const);

/** A trusted viewer's way in — his home bar's "Almanac" — checked before the tap, so a missing way in fails at its tag,
 *  never at the test's timeout. */
async function openAlmanac(page: Page, tag: string): Promise<void> {
  const way = page.locator('nav').filter({ hasText: 'Settings' }).last().getByRole('button', { name: 'Almanac', exact: true });
  await expect(way, `${tag} the way in`).toBeVisible({ timeout: 10_000 });
  await way.click();
}

/** The faces the open hub offers, by name (the live-height switch shares the nav). */
async function faceNames(page: Page, tag: string): Promise<string[]> {
  const back = page.getByRole('button', { name: 'Almanac', exact: true });
  const nav = page.getByRole('navigation', { name: 'Faces' });
  await expect(nav.or(back), `${tag} the Almanac is open`).toBeVisible({ timeout: 20_000 });
  if (!(await nav.isVisible())) await back.click();
  return (await nav.getByRole('button').allInnerTexts()).map((t) => t.trim()).filter((t) => !/live|date-only/.test(t));
}

/** A face's whole text and every field's value and lock, once it stops changing (a worker, the stubbed history). The
 *  header's "←" names where it goes — the Journal for the owner, Home for a viewer — so it is left out. */
async function readFace(page: Page, name: string): Promise<{ lines: string[]; fields: string[] }> {
  const back = page.getByRole('button', { name: 'Almanac', exact: true });
  const nav = page.getByRole('navigation', { name: 'Faces' });
  if (!(await nav.isVisible())) await back.click();
  await nav.getByRole('button', { name, exact: true }).click();
  const read = () => page.evaluate(() => ({
    text: (document.getElementById('root') as HTMLElement).innerText,
    fields: [...document.querySelectorAll('#root input')].map((i) => {
      const el = i as HTMLInputElement;
      return `${el.type}:${el.value}:${el.disabled ? 'disabled' : ''}${el.readOnly ? 'readonly' : ''}`;
    }),
  }));
  let last = await read();
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(400);
    const now = await read();
    if (now.text === last.text && now.fields.join() === last.fields.join() && Date.now() - t0 > 1200) break;
    if (Date.now() - t0 > 15_000) break;
    last = now;
  }
  const lines = last.text.split('\n').map((l) => l.trim()).filter((l) => l && !/^← /.test(l));
  return { lines, fields: last.fields };
}

/** Every face the owner's hub offers, read on his device; then the same faces on a trusted viewer's, handed the real
 *  snapshot: the owner's less FIRE (V1), field for field and line for line but BL48's own lines — and, in the list, its
 *  FIRE entry. A phone with the loan and a logged month (all thirteen), or a computer's list with neither. */
async function parity(page: Page, browser: Browser, c: { loan: boolean; width: number; tag: string }): Promise<void> {
  const owner = await ownerDevice(browser, ownerState(true, c.loan), c.width);
  await owner.page.getByLabel('Almanac').click();
  const ownerFaces = await faceNames(owner.page, `${c.tag} premise:`);
  if (c.loan) expect(ownerFaces, `${c.tag} premise: the owner gets all thirteen`).toHaveLength(13);
  else expect(ownerFaces, `${c.tag} premise: no loan, no log — fewer faces, FIRE among them`).toEqual(expect.arrayContaining(['FIRE']));
  if (!c.loan) expect(ownerFaces, `${c.tag} premise: the gates closed`).not.toContain('Ledger');
  const ownerRead: Record<string, { lines: string[]; fields: string[] }> = {};
  for (const f of ownerFaces) ownerRead[f] = await readFace(owner.page, f);

  if (c.width > 390) await page.setViewportSize({ width: c.width, height: 900 });
  await viewerDevice(page, owner.trusted);
  await openAlmanac(page, c.tag);
  const viewerFaces = await faceNames(page, c.tag);
  expect(viewerFaces, `${c.tag} the owner's faces, less FIRE (V1)`).toEqual(ownerFaces.filter((f) => f !== 'FIRE'));
  const ownerOnly = c.width >= 1200 ? [...OWNER_ONLY, 'FIRE'] : OWNER_ONLY;   // the list draws its faces' names
  for (const f of viewerFaces) {
    const v = await readFace(page, f);
    const o = ownerRead[f];
    expect(v.fields, `${c.tag} ${f}: every field's value and lock`).toEqual(o.fields);
    const missing = o.lines.filter((l) => !v.lines.includes(l));
    const extra = v.lines.filter((l) => !o.lines.includes(l));
    expect(missing.filter((l) => !ownerOnly.includes(l)), `${c.tag} ${f}: nothing of the owner's missing`).toEqual([]);
    expect(extra.filter((l) => !VIEWER_ONLY.includes(l)), `${c.tag} ${f}: nothing the owner's device doesn't show`).toEqual([]);
    expect(v.lines.filter((l) => !VIEWER_ONLY.includes(l)), `${c.tag} ${f}: the same text, in order`)
      .toEqual(o.lines.filter((l) => !ownerOnly.includes(l)));
    if (f === 'Ledger') expect(v.lines.some((l) => l.includes('₿0.10000')), `${c.tag} Ledger: the owner's → Cold (V2)`).toBe(true);
  }
  await owner.close();
}

test.describe('trusted viewers in the Almanac — BL48', () => {
  test('PARITY — every face a trusted viewer gets reads the owner\'s figures and fields; FIRE stays the owner\'s', async ({ page, browser }) => {
    test.setTimeout(240_000);
    await parity(page, browser, { loan: true, width: 390, tag: 'PARITY' });
  });

  test('PARITY LIST — on a computer, a plan with no loan: the list\'s faces read the owner\'s, face for face; FIRE his alone', async ({ page, browser }) => {
    test.setTimeout(240_000);
    await parity(page, browser, { loan: false, width: 1280, tag: 'PARITY LIST' });
  });

  test('WAY IN — a trusted viewer\'s home bar opens the Almanac as its own page, "← Home" back; on a computer, the list', async ({ page, browser }) => {
    const owner = await ownerDevice(browser, ownerState(true));
    await owner.close();
    await viewerDevice(page, owner.trusted);
    const bar = page.locator('nav').filter({ hasText: 'Settings' }).last();
    await expect(bar.getByRole('button'), 'WAY IN the bar: Home · Almanac · Settings').toHaveText(['Home', 'Almanac', 'Settings']);
    await bar.getByRole('button', { name: 'Almanac', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'WAY IN the grid').toBeVisible();
    await expect(page.getByRole('button', { name: 'FIRE', exact: true }), 'WAY IN no FIRE (V1)').toHaveCount(0);
    await page.getByRole('button', { name: '← Home' }).click();
    await expect(page.getByText(/^Good (morning|afternoon|evening)/), 'WAY IN back home').toBeVisible();
    // A computer: the list beside the open face (BL46's A), its first face Decision, with the note.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openAlmanac(page, 'WAY IN');
    await expect(page.getByRole('navigation', { name: 'Faces' }).getByRole('button', { name: 'Decision', exact: true }), 'WAY IN the list')
      .toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('note'), 'WAY IN the note over a plan face (V4 B)').toHaveText(NOTE);
  });

  test('SAFE — a safe viewer has no way in: no button, and the Almanac tab or a way back to it opens his home', async ({ page, browser }) => {
    const owner = await ownerDevice(browser, ownerState(true));
    await owner.close();
    await viewerDevice(page, owner.safe);
    const bar = page.locator('nav').filter({ hasText: 'Settings' }).last();
    await expect(bar.getByRole('button'), 'SAFE the bar: Home · Settings').toHaveText(['Home', 'Settings']);
    await setTab(page, 'almanac', 'almanac');
    await expect(page.getByText(/^Good (morning|afternoon|evening)/), 'SAFE the Almanac tab opens his home').toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'SAFE no faces').toHaveCount(0);
    const tabs = await state(page);
    expect([tabs.activeTab, tabs.previousTab], 'SAFE the tabs put back').toEqual(['living', 'living']);
    await bar.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: '← Home' }), 'SAFE Settings goes home, never "← Almanac"').toBeVisible();
    // A safe viewer's figures: the seed's, never an amount of the owner's (G2-A).
    const st = await state(page);
    expect([st.months, st.hasCbLoan, st.coldMoves], 'SAFE nothing of the owner\'s').toEqual([0, false, null]);
    // A trusted-shaped snapshot that can't apply (its settings not an object) fails closed: the device wiped, never left
    // loaded without its safe block — which reads as trusted.
    const bad = JSON.stringify({ ...JSON.parse(owner.trusted), settings: 'x' });
    await apply(page, bad).catch(() => undefined);
    const now = await state(page);
    expect([now.loaded, now.safe], 'SAFE a snapshot that fails: wiped, never trusted').toEqual([false, false]);
  });

  test('DEMOTE — a safe snapshot with the Almanac open: home, and nothing of the owner\'s left — figures, cold moves, colours', async ({ page, browser }) => {
    const owner = await ownerDevice(browser, ownerState(true));
    await owner.close();
    await viewerDevice(page, owner.trusted);
    const was = await state(page);
    expect([was.months, was.hasCbLoan, was.venueStrike, was.coldMoves?.['1'] ?? null, was.depositISO],
      'DEMOTE premise: the owner\'s figures, colours and cold moves on the device').toEqual([1, true, '#38bdf8', 0.1, null]);
    await openAlmanac(page, 'DEMOTE');
    await page.getByRole('navigation', { name: 'Faces' }).getByRole('button', { name: 'Decision', exact: true }).click();
    await expect(page.getByRole('note'), 'DEMOTE premise: on a plan face').toHaveText(NOTE);
    await apply(page, owner.safe);
    await expect(page.getByText(/^Good (morning|afternoon|evening)/), 'DEMOTE home').toBeVisible();
    await expect(page.getByRole('note'), 'DEMOTE no face').toHaveCount(0);
    const now = await state(page);
    expect([now.activeTab, now.months, now.hasCbLoan, now.cbLoanBalance, now.coldStorageBtc, now.venueStrike, now.coldMoves, now.depositISO, now.safe],
      'DEMOTE the store: the seed\'s, the safe block').toEqual(['living', 0, false, 60000, 0, null, null, null, true]);
    const blob = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-bloc-store') ?? '{}').state);
    expect([blob.monthlyLog.length, blob.hasCbLoan, blob.venueColors ?? null, blob.viewerColdMovedByMonth], 'DEMOTE what a reload reads')
      .toEqual([0, false, null, null]);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--venue-strike').trim().toLowerCase()),
      'DEMOTE the colours back to the default').not.toBe('#38bdf8');
  });

  test('FULL MODE — the owner\'s full-mode layout never reaches a viewer\'s pages: Settings and the Almanac are their own pages', async ({ page, browser }) => {
    // The owner's full mode — and the Almanac's tab hidden (a stored or restored layout can carry it): his to keep.
    const owner = await ownerDevice(browser, ownerState(false, true, `, hiddenTabs: ['almanac']`));
    await owner.close();
    await viewerDevice(page, owner.trusted);
    const was = await state(page);
    expect([was.simpleMode, was.hidden], 'FULL MODE premise: the owner\'s layout arrived').toEqual([false, ['almanac']]);
    const bar = page.locator('nav').filter({ hasText: 'Settings' }).last();
    await bar.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: '← Home' }), 'FULL MODE Settings: its own page').toBeVisible();
    await expect(page.getByRole('button', { name: /^Tools/ }), 'FULL MODE no tab bar, no Tools menu').toHaveCount(0);
    await page.getByRole('button', { name: '← Home' }).click();
    await openAlmanac(page, 'FULL MODE');
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'FULL MODE the Almanac: its own page').toBeVisible();
    await expect(page.getByRole('button', { name: /^Tools/ }), 'FULL MODE no Tools menu').toHaveCount(0);
    await expect(page.getByLabel('Switch to simple view'), 'FULL MODE no mode switch').toHaveCount(0);
  });

  test('WHAT-IF — a viewer tries the plan faces\' what-ifs: the figures move, nothing is saved, Reset brings the plan back', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const owner = await ownerDevice(browser, ownerState(true));
    await owner.close();
    await viewerDevice(page, owner.trusted);
    await openAlmanac(page, 'WHAT-IF');
    await faceNames(page, 'WHAT-IF');
    const saved = () => page.evaluate(() => localStorage.getItem('personal-bloc-store'));
    const before = await saved();
    for (const f of ['Decision', 'Strategy', 'Ownership', 'Cycling', 'Emergency']) {
      const { lines } = await readFace(page, f);
      // Emergency's price slider is its simulator's: on once Simulate is tapped (session state, nothing saved).
      if (f === 'Emergency') await page.getByRole('button', { name: 'Simulate', exact: true }).click();
      const ranges = page.locator('#root input[type="range"]:not([disabled])');
      expect(await ranges.count(), `WHAT-IF ${f}: its sliders are live`).toBeGreaterThan(0);
      // Left three, right one: a slider at either end still moves.
      for (const i of [0, 1]) if (i < await ranges.count()) for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']) await ranges.nth(i).press(key);
      await page.waitForTimeout(800);
      const after = (await page.locator('#root').innerText()).split('\n').map((l) => l.trim()).filter((l) => l && !/^← /.test(l));
      expect(after, `WHAT-IF ${f}: the what-if moved the face`).not.toEqual(lines);
    }
    // Decision's dock: its Line a what-if too (V4 B — R1 locked it for a viewer, with the card's slider). Live, and it
    // moves the face; the saved store is checked below.
    await readFace(page, 'Decision');
    const dock = page.getByRole('region', { name: 'Controls' });
    const lineTab = dock.getByRole('button', { name: /^Line/ });
    await expect(lineTab, "WHAT-IF Decision: the dock's Line tab").toBeVisible();
    await lineTab.click();
    const dockLine = dock.getByRole('slider', { name: 'Credit line (what-if)' });
    await expect(dockLine, "WHAT-IF Decision: the dock's Line is live (V4 B)").toBeEnabled();
    const atLine = await page.locator('#root').innerText();
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']) await dockLine.press(key);
    await page.waitForTimeout(800);
    expect(await page.locator('#root').innerText(), "WHAT-IF Decision: the dock's Line moved the face").not.toBe(atLine);
    // Scenario's levers are number fields: typed, the diff reads the what-if; no Pin row for a viewer.
    await readFace(page, 'Scenario');
    await expect(page.getByRole('button', { name: "Pin today's plan" }), 'WHAT-IF no Pin (it saves)').toHaveCount(0);
    const lever = page.locator('#root input:not([type="range"])').first();
    await expect(lever, 'WHAT-IF Scenario: a live lever').toBeEditable();
    await lever.fill('50000');
    await lever.press('Tab');
    await expect(page.locator('#root'), 'WHAT-IF Scenario: the diff reads it').not.toContainText('No dimension worsens');
    expect(await saved(), 'WHAT-IF nothing saved on the viewer\'s device').toBe(before);
    // Decision: "Reset to live" brings the shared plan back, text for text.
    const live = await readFace(page, 'Decision');
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']) await page.locator('#root input[type="range"]:not([disabled])').first().press(key);
    await page.getByRole('button', { name: 'Reset to live' }).click();
    await page.waitForTimeout(800);
    expect((await page.locator('#root').innerText()).split('\n').map((l) => l.trim()).filter((l) => l && !/^← /.test(l)),
      'WHAT-IF Reset: the plan as shared').toEqual(live.lines);
    // The copies stay off (V5 A).
    await expect(page.getByRole('button', { name: 'Download .txt' }), 'WHAT-IF no schedule download').toHaveCount(0);
  });

  test('MINING — a viewer\'s Mining is his own tool: its fields are live and save on his device only', async ({ page, browser }) => {
    const owner = await ownerDevice(browser, ownerState(true));
    await owner.close();
    await viewerDevice(page, owner.trusted);
    await openAlmanac(page, 'MINING');
    await readFace(page, 'Mining');
    // The panel comes first on a phone: its first slider is a miner's own (the seed's two Gammas).
    const slider = page.locator('#root input[type="range"]').first();
    await expect(slider, 'MINING a miner\'s slider is live (V3)').toBeEnabled();
    await expect(page.locator('#root input[type="range"][disabled]'), 'MINING none locked').toHaveCount(0);
    const before = (await state(page)).mining;
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']) await slider.press(key);
    expect((await state(page)).mining, 'MINING his own list saves').not.toBe(before);
  });

  test('PREVIEW — "Preview as viewer" names no viewer: "what your viewer sees", whatever the roster calls him', async ({ page }) => {
    await prepare(page, `onboardingComplete: true, simpleMode: true, simpleView: 'daily', ${PRICE},
      viewers: [{ index: 0, pubkeyHex: '${'a'.repeat(64)}', npub: 'npub1example', label: 'Kitchen iPad', tier: 'trusted', keyVersion: 1 }],
      nextViewerIndex: 1`);
    await expect(page.getByLabel('Settings'), 'PREVIEW premise: the journal').toBeVisible({ timeout: 20_000 });
    await page.evaluate(async (mod) => {
      const { useStore } = await import(/* @vite-ignore */ mod);
      useStore.getState().setViewerPreview(true);
    }, STORE_MOD);
    await expect(page.getByText(/^PREVIEW · what your viewer sees — Trusted mode$/i), 'PREVIEW the banner').toBeVisible();
    await expect(page.getByText(/Kitchen iPad/i), 'PREVIEW no roster name').toHaveCount(0);
  });
});
