import { test, expect, type Browser, type Page } from '@playwright/test';
import { STORE_VERSION, mouseDragX } from './helpers';

/**
 * BL48 — trusted viewers in the Almanac (BL40's second piece; spec pbloc-spec-trusted-viewers-v1). The first viewer
 * e2e: the dev server skips every viewer gate (helpers.ts), so a viewer page is put in a viewer's state through the
 * app's own modules — the REAL trusted (or safe) payload an owner page builds (`buildViewerSnapshotPayload`), applied by
 * the relay path's one apply (`applyViewerSnapshot`, viewerSync.ts). Two devices: the owner's in its own context, the
 * viewer's the test's page. Hermetic and date-proof: round synthetic figures — $50,000 on 1 ₿ at a manual $100,000, one
 * logged month, 0.5 ₿ entered cold and a 0.1 ₿ cold move — the same manual price on both devices, live prices aborted,
 * the price history stubbed, a fixed day. Every assertion has a tag.
 *
 * BL50 — the owner's "Preview as viewer" (spec pbloc-spec-preview-bar-v1): its bar, his viewer's; a trusted preview's
 * "Almanac" opens his viewer's hub on the owner's device — checked face for face, line for line and field for field
 * against a real trusted viewer's handed the same plan, but the preview's label; its what-ifs save nothing; "← Preview"
 * and the swipe come back to it; a safe preview has no way in; his own Almanac is his again outside it, in either mode.
 * The preview starts as Settings → Sharing's button starts it — the flag (the dev server reaches no Sharing page: it
 * needs a key).
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

/** BL50 — the roster's one viewer, by his tier, on the owner's device (the preview reads slot 0, as before). */
const ROSTER = (tier: 'trusted' | 'safe') => `, viewers: [{ index: 0, pubkeyHex: '${'a'.repeat(64)}', npub: 'npub1example',
  label: 'Kitchen iPad', tier: '${tier}', keyVersion: 1 }], nextViewerIndex: 1`;
/** The preview's label — over its home, and over the Almanac it opens (its CSS draws it in capitals). */
const LABEL = (mode: 'Trusted' | 'Safe'): RegExp => new RegExp(`^PREVIEW · what your viewer sees — ${mode} mode$`, 'i');
/** The viewer's bottom bar, his home's (the preview draws it too, BL50). */
const homeBar = (page: Page) => page.locator('nav').filter({ hasText: 'Settings' }).last();

/** The owner starts his preview from the journal, as Settings → Sharing's button does: the flag. */
async function startPreview(page: Page, tag: string): Promise<void> {
  await expect(page.getByLabel('Almanac'), `${tag} premise: the journal`).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async (mod) => {
    const { useStore } = await import(/* @vite-ignore */ mod);
    useStore.getState().setViewerPreview(true);
  }, STORE_MOD);
  await expect(page.getByRole('button', { name: '✕ Exit preview' }), `${tag} the preview`).toBeVisible();
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
    // The independent check's probe: settings null threw nothing, and the Almanac opened on the seed's figures. A snapshot
    // that isn't well-formed is refused before any of it applies — wiped too.
    await apply(page, owner.safe);
    const again = await state(page);
    expect([again.loaded, again.safe], 'SAFE premise: a safe viewer again').toEqual([true, true]);
    await apply(page, JSON.stringify({ ...JSON.parse(owner.trusted), settings: null })).catch(() => undefined);
    const after = await state(page);
    expect([after.loaded, after.safe], 'SAFE a snapshot that isn\'t well-formed, though nothing throws: wiped, never trusted')
      .toEqual([false, false]);
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

  test('COLD ZERO — an owner who logged no cold move: his Ledger shows "→ Cold", the month "—", the total ₿0.00000; his trusted viewer\'s the same; an older snapshot, none (BL49)', async ({ page, browser }) => {
    test.setTimeout(120_000);
    // The Ledger's table read by its cells (textContent — CSS may draw the header in capitals): the first month's cell and
    // the total's under "→ Cold", or null without the column.
    const coldColumn = async (p: Page, tag: string): Promise<{ month: string; total: string } | null> => {
      await faceNames(p, tag);
      await readFace(p, 'Ledger');
      const table = p.locator('table').filter({ has: p.getByRole('columnheader', { name: 'Strike LTV', exact: true }) });
      const heads = (await table.locator('thead th').allTextContents()).map((t) => t.trim());
      expect(heads, `${tag} the Ledger's header`).toContain('Strike LTV');
      const at = heads.indexOf('→ Cold');
      if (at < 0) return null;
      const cell = async (row: ReturnType<Page['locator']>) => ((await row.locator('td').nth(at).textContent()) ?? '').trim();
      return { month: await cell(table.locator('tbody tr').first()), total: await cell(table.locator('tfoot tr').last()) };
    };
    const owner = await ownerDevice(browser, ownerState(true, true, ', dayLog: []'));
    expect(JSON.parse(owner.trusted).coldMovedByMonth, 'COLD ZERO premise: the owner sends an empty map').toEqual({});
    await owner.page.getByLabel('Almanac').click();
    expect(await coldColumn(owner.page, 'COLD ZERO the owner\'s'), 'COLD ZERO the owner\'s Ledger').toEqual({ month: '—', total: '₿0.00000' });
    await viewerDevice(page, owner.trusted);
    await openAlmanac(page, 'COLD ZERO');
    expect(await coldColumn(page, 'COLD ZERO the viewer\'s'), 'COLD ZERO the viewer\'s Ledger, the owner\'s').toEqual({ month: '—', total: '₿0.00000' });
    const older = JSON.parse(owner.trusted);
    delete older.coldMovedByMonth;
    await apply(page, JSON.stringify(older));
    expect((await state(page)).coldMoves, 'COLD ZERO an older snapshot: none on the device').toBeNull();
    expect(await coldColumn(page, 'COLD ZERO an older snapshot'), 'COLD ZERO an older snapshot: no column').toBeNull();
    await owner.close();
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

test.describe('the owner\'s preview of his viewer — BL50', () => {
  test('PREVIEW BAR — the preview draws his viewer\'s bar: Home · Almanac · Settings in Trusted mode, Home · Settings in Safe; his ⚙ and Settings drawn, inert', async ({ page }) => {
    await prepare(page, ownerState(true, true, ROSTER('trusted')));
    await startPreview(page, 'PREVIEW BAR');
    await expect(page.getByText(LABEL('Trusted')), 'PREVIEW BAR the label').toBeVisible();
    await expect(homeBar(page).getByRole('button'), 'PREVIEW BAR Trusted: Home · Almanac · Settings').toHaveText(['Home', 'Almanac', 'Settings']);
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await expect(settings, 'PREVIEW BAR premise: his ⚙ and his bar\'s Settings').toHaveCount(2);
    for (const i of [0, 1]) await expect(settings.nth(i), `PREVIEW BAR his Settings (${i}): inert`).toBeDisabled();
    await settings.nth(1).click({ force: true });
    await page.waitForTimeout(300);
    await expect(page.getByText(LABEL('Trusted')), 'PREVIEW BAR a tap on it: still the preview').toBeVisible();
    expect((await state(page)).activeTab, 'PREVIEW BAR a tap on it: no Settings').not.toBe('settings');
    await page.getByRole('button', { name: 'Safe', exact: true }).click();
    await expect(page.getByText(LABEL('Safe')), 'PREVIEW BAR Safe: the label').toBeVisible();
    await expect(homeBar(page).getByRole('button'), 'PREVIEW BAR Safe: Home · Settings').toHaveText(['Home', 'Settings']);
    await page.getByRole('button', { name: 'Trusted', exact: true }).click();
    await expect(homeBar(page).getByRole('button'), 'PREVIEW BAR Trusted again').toHaveText(['Home', 'Almanac', 'Settings']);
    await page.getByRole('button', { name: '✕ Exit preview' }).click();
    await expect(page.getByLabel('Almanac'), 'PREVIEW BAR Exit: the journal').toBeVisible();
    await expect(page.getByRole('button', { name: '✕ Exit preview' }), 'PREVIEW BAR Exit: the preview gone').toHaveCount(0);
  });

  test('PREVIEW HUB — a trusted preview\'s "Almanac" is his viewer\'s hub on the owner\'s device: face for face, line for line, field for field, but the preview\'s label', async ({ page, browser }) => {
    test.setTimeout(300_000);
    // The owner's own Mining column on (a device-local switch his viewer never gets): the preview's Ledger is still his
    // viewer's.
    const owner = await ownerDevice(browser, ownerState(true, true, `${ROSTER('trusted')}, showMiningInLog: true`));
    await startPreview(owner.page, 'PREVIEW HUB');
    await openAlmanac(owner.page, 'PREVIEW HUB the preview\'s');
    await expect(owner.page.getByRole('button', { name: '← Preview', exact: true }), 'PREVIEW HUB "← Preview" back').toBeVisible();
    await expect(owner.page.getByText(LABEL('Trusted')), 'PREVIEW HUB the label over it').toBeVisible();
    const faces = await faceNames(owner.page, 'PREVIEW HUB the preview\'s');
    expect(faces, 'PREVIEW HUB premise: twelve faces, no FIRE (V1)').toHaveLength(12);
    const previewRead: Record<string, { lines: string[]; fields: string[] }> = {};
    for (const f of faces) previewRead[f] = await readFace(owner.page, f);
    await viewerDevice(page, owner.trusted);
    await openAlmanac(page, 'PREVIEW HUB the viewer\'s');
    expect(await faceNames(page, 'PREVIEW HUB the viewer\'s'), 'PREVIEW HUB face for face').toEqual(faces);
    for (const f of faces) {
      const v = await readFace(page, f);
      const p = previewRead[f];
      expect(p.fields, `PREVIEW HUB ${f}: every field's value and lock`).toEqual(v.fields);
      expect(p.lines.filter((l) => LABEL('Trusted').test(l)), `PREVIEW HUB ${f}: the label, once`).toHaveLength(1);
      expect(p.lines.filter((l) => !LABEL('Trusted').test(l)), `PREVIEW HUB ${f}: line for line`).toEqual(v.lines);
    }
    await owner.close();
  });

  test('PREVIEW SAVES NOTHING — the preview\'s what-ifs move its faces and save nothing: the stored plan, its events and the owner-only three untouched; no FIRE, Pin or copies', async ({ page }) => {
    test.setTimeout(180_000);
    await prepare(page, ownerState(true, true, ROSTER('trusted')));
    await startPreview(page, 'SAVES NOTHING');
    await openAlmanac(page, 'SAVES NOTHING');
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'SAVES NOTHING the hub').toBeVisible();
    expect(await faceNames(page, 'SAVES NOTHING'), 'SAVES NOTHING no FIRE (its inputs save)').not.toContain('FIRE');
    const saved = () => page.evaluate(async (mod) => {
      const { useStore } = await import(/* @vite-ignore */ mod);
      const s = useStore.getState();
      return { blob: localStorage.getItem('personal-bloc-store'), events: JSON.stringify(s.planEvents),
        pin: JSON.stringify(s.pinnedScenario), fire: JSON.stringify(s.fireInputs), inflation: s.inflationRate as number };
    }, STORE_MOD);
    const before = await saved();
    for (const f of ['Decision', 'Strategy', 'Ownership', 'Cycling', 'Emergency']) {
      const { lines } = await readFace(page, f);
      if (f === 'Emergency') await page.getByRole('button', { name: 'Simulate', exact: true }).click();
      const ranges = page.locator('#root input[type="range"]:not([disabled])');
      expect(await ranges.count(), `SAVES NOTHING ${f}: its sliders are live`).toBeGreaterThan(0);
      for (const i of [0, 1]) if (i < await ranges.count()) for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']) await ranges.nth(i).press(key);
      await page.waitForTimeout(800);
      const after = (await page.locator('#root').innerText()).split('\n').map((l) => l.trim()).filter((l) => l && !/^← /.test(l));
      expect(after, `SAVES NOTHING ${f}: the what-if moved the face`).not.toEqual(lines);
    }
    await readFace(page, 'Decision');
    await expect(page.getByRole('button', { name: 'Download .txt' }), 'SAVES NOTHING no schedule copies (V5 A)').toHaveCount(0);
    const dock = page.getByRole('region', { name: 'Controls' });
    await dock.getByRole('button', { name: /^Line/ }).click();
    const dockLine = dock.getByRole('slider', { name: 'Credit line (what-if)' });
    await expect(dockLine, 'SAVES NOTHING Decision: the dock\'s Line is live').toBeEnabled();
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight']) await dockLine.press(key);
    await readFace(page, 'Ledger');
    await expect(page.getByRole('button', { name: 'Copy CSV' }), 'SAVES NOTHING no Ledger copies (V5 A)').toHaveCount(0);
    await readFace(page, 'Scenario');
    await expect(page.getByRole('button', { name: "Pin today's plan" }), 'SAVES NOTHING no Pin (it saves)').toHaveCount(0);
    const lever = page.locator('#root input:not([type="range"])').first();
    await expect(lever, 'SAVES NOTHING Scenario: a live lever').toBeEditable();
    await lever.fill('50000');
    await lever.press('Tab');
    await expect(page.locator('#root'), 'SAVES NOTHING Scenario: the diff reads it').not.toContainText('No dimension worsens');
    expect(await saved(), 'SAVES NOTHING the stored plan, its events, the pin, FIRE\'s inputs and inflation').toEqual(before);
  });

  test('PREVIEW WAY BACK — "← Preview" and the swipe come back to the preview, its Safe/Trusted choice kept; Exit ends it, and his own Almanac is his again', async ({ page }) => {
    test.setTimeout(120_000);
    await prepare(page, ownerState(true, true, `${ROSTER('safe')}, showMiningInLog: true`));
    await startPreview(page, 'WAY BACK');
    await expect(page.getByText(LABEL('Safe')), 'WAY BACK premise: his viewer is safe').toBeVisible();
    await expect(homeBar(page).getByRole('button'), 'WAY BACK premise: no way in').toHaveText(['Home', 'Settings']);
    await page.getByRole('button', { name: 'Trusted', exact: true }).click();
    await openAlmanac(page, 'WAY BACK');
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'WAY BACK the hub').toBeVisible();
    await expect(page.getByText(LABEL('Trusted')), 'WAY BACK the choice, over the Almanac').toBeVisible();
    await faceNames(page, 'WAY BACK');
    await readFace(page, 'Ledger');
    await expect(page.getByRole('columnheader', { name: 'Strike LTV', exact: true }), 'WAY BACK premise: the preview\'s Ledger').toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Mining', exact: true }), 'WAY BACK the preview\'s Ledger: no Mining column (his viewer\'s never has one)').toHaveCount(0);
    // A long face, scrolled far down: the label is still on screen (sticky — the independent check).
    await readFace(page, 'Decision');
    const backBtn = page.getByRole('button', { name: '← Preview', exact: true });
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, 1500);
    await expect(backBtn, 'WAY BACK premise: the face scrolled, its header off screen').not.toBeInViewport();
    await expect(page.getByText(LABEL('Trusted')), 'WAY BACK the label stays on screen').toBeInViewport();
    await page.mouse.wheel(0, -3000);
    await expect(backBtn, 'WAY BACK premise: back at the top').toBeInViewport();
    await backBtn.click();
    await expect(page.getByText(LABEL('Trusted')), 'WAY BACK "← Preview": the preview, the choice kept').toBeVisible();
    await expect(page.getByText('previewing — actual: Safe'), 'WAY BACK the caption: his choice, not the roster').toBeVisible();
    // The swipe from the grid: its under-layer is the preview, and it lands there.
    await openAlmanac(page, 'WAY BACK the swipe');
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'WAY BACK premise: the grid').toBeVisible();
    await mouseDragX(page, 8, page.viewportSize()!.height / 2, 234, { release: false });
    // The under-layer is hidden from the accessibility tree (EdgeBackGesture's aria-hidden): read by its text.
    await expect(page.locator('[aria-hidden="true"]').getByText(LABEL('Trusted')), 'WAY BACK the swipe reveals the preview').toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'WAY BACK the swipe leaves the Almanac').toHaveCount(0);
    await expect(page.getByText(LABEL('Trusted')), 'WAY BACK the swipe lands on the preview, the choice kept').toBeVisible();
    // Exit: the journal, and his own Almanac — FIRE, the copies, the Pin, no note.
    await page.getByRole('button', { name: '✕ Exit preview' }).click();
    await page.getByLabel('Almanac').click();
    await expect(page.getByRole('button', { name: '← Journal', exact: true }), 'WAY BACK his Almanac: "← Journal"').toBeVisible();
    await expect(page.getByText(LABEL('Trusted')), 'WAY BACK his Almanac: no label').toHaveCount(0);
    expect(await faceNames(page, 'WAY BACK his own'), 'WAY BACK his own: all thirteen, FIRE among them').toHaveLength(13);
    await readFace(page, 'Decision');
    await expect(page.getByRole('button', { name: 'Download .txt' }), 'WAY BACK his copies').toBeVisible();
    await expect(page.getByRole('note'), 'WAY BACK no note').toHaveCount(0);
    await readFace(page, 'Scenario');
    await expect(page.getByRole('button', { name: "Pin today's plan" }), 'WAY BACK his Pin').toBeVisible();
    await readFace(page, 'Ledger');
    await expect(page.getByRole('columnheader', { name: 'Mining', exact: true }), 'WAY BACK his Ledger: his Mining column').toBeVisible();
    // Again: the preview follows the roster — the choice ended with the preview.
    await page.getByRole('button', { name: '← Journal', exact: true }).click();
    await startPreview(page, 'WAY BACK again');
    await expect(page.getByText(LABEL('Safe')), 'WAY BACK the choice ended with the preview').toBeVisible();
  });

  test('SAFE PREVIEW — a safe preview has no way in: no "Almanac", and the Almanac tab opens the preview; a trusted preview whose viewer turns safe, its Almanac open, goes back to it', async ({ page }) => {
    await prepare(page, ownerState(true, true, ROSTER('trusted')));
    await startPreview(page, 'SAFE PREVIEW');
    await page.getByRole('button', { name: 'Safe', exact: true }).click();
    await expect(homeBar(page).getByRole('button'), 'SAFE PREVIEW no way in').toHaveText(['Home', 'Settings']);
    await setTab(page, 'almanac', 'living');
    await expect(page.getByText(LABEL('Safe')), 'SAFE PREVIEW the Almanac tab opens the preview').toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'SAFE PREVIEW no faces').toHaveCount(0);
    await expect.poll(async () => (await state(page)).activeTab, { message: 'SAFE PREVIEW taken off the Almanac' }).toBe('living');
    // A trusted preview with its Almanac open; the roster's tier turns safe (as a sync from his other device would).
    await page.getByRole('button', { name: '✕ Exit preview' }).click();
    await startPreview(page, 'SAFE PREVIEW again');
    await expect(page.getByText(LABEL('Trusted')), 'SAFE PREVIEW premise: the roster\'s tier').toBeVisible();
    await openAlmanac(page, 'SAFE PREVIEW');
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'SAFE PREVIEW premise: the grid').toBeVisible();
    await page.evaluate(async (mod) => {
      const { useStore } = await import(/* @vite-ignore */ mod);
      useStore.setState((s: { viewers: { tier: string }[] }) => ({ viewers: s.viewers.map((v) => ({ ...v, tier: 'safe' })) }));
    }, STORE_MOD);
    await expect(page.getByText(LABEL('Safe')), 'SAFE PREVIEW turned safe: the preview, Safe mode').toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Faces' }), 'SAFE PREVIEW turned safe: no faces').toHaveCount(0);
    await expect(homeBar(page).getByRole('button'), 'SAFE PREVIEW turned safe: no way in').toHaveText(['Home', 'Settings']);
    // Settings opened inside a trusted preview's hub (a corner notice opens it from any page), then the roster turns safe:
    // Settings' way back no longer names the Almanac — it opens the preview (the independent check).
    await page.evaluate(async (mod) => {
      const { useStore } = await import(/* @vite-ignore */ mod);
      useStore.setState((s: { viewers: { tier: string }[] }) => ({ viewers: s.viewers.map((v) => ({ ...v, tier: 'trusted' })) }));
    }, STORE_MOD);
    await openAlmanac(page, 'SAFE PREVIEW Settings');
    await setTab(page, 'settings', 'almanac');
    await expect(page.getByRole('button', { name: '← Almanac', exact: true }), 'SAFE PREVIEW premise: Settings from the hub').toBeVisible();
    await page.evaluate(async (mod) => {
      const { useStore } = await import(/* @vite-ignore */ mod);
      useStore.setState((s: { viewers: { tier: string }[] }) => ({ viewers: s.viewers.map((v) => ({ ...v, tier: 'safe' })) }));
    }, STORE_MOD);
    await expect(page.getByRole('button', { name: '← Preview', exact: true }), 'SAFE PREVIEW turned safe in Settings: the way back names the preview').toBeVisible();
    expect((await state(page)).previousTab, 'SAFE PREVIEW turned safe in Settings: no way back to the Almanac').toBe('living');
    await page.getByRole('button', { name: '← Preview', exact: true }).click();
    await expect(page.getByText(LABEL('Safe')), 'SAFE PREVIEW the way back: the preview').toBeVisible();
  });

  test('FULL MODE PREVIEW — full mode draws no preview: the flag set there (Sharing\'s button is in Settings in either mode) leaves his Almanac tab his own, whatever the roster', async ({ page, browser }) => {
    // A safe roster (a tier that would send him off the tab) and a trusted one (a lens that would hide FIRE) — the
    // independent check's second case.
    for (const tier of ['safe', 'trusted'] as const) {
      const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 390, height: 844 },
        hasTouch: true, isMobile: true, serviceWorkers: 'block' });
      const p = tier === 'safe' ? page : await ctx.newPage();
      const tag = `FULL MODE PREVIEW (${tier})`;
      await prepare(p, ownerState(false, true, ROSTER(tier)));
      const tools = p.getByRole('button', { name: /^Tools/ });
      await expect(tools, `${tag} premise: full mode`).toBeVisible({ timeout: 20_000 });
      await p.evaluate(async (mod) => {
        const { useStore } = await import(/* @vite-ignore */ mod);
        useStore.getState().setViewerPreview(true);
      }, STORE_MOD);
      await expect(p.getByRole('button', { name: '✕ Exit preview' }), `${tag} nothing drawn`).toHaveCount(0);
      await tools.click();
      await p.getByRole('button', { name: 'Almanac', exact: true }).click();
      expect(await faceNames(p, tag), `${tag} his own Almanac: FIRE among its faces`).toContain('FIRE');
      await p.waitForTimeout(500);
      expect((await state(p)).activeTab, `${tag} he stays on it`).toBe('almanac');
      await expect(p.getByRole('navigation', { name: 'Faces' }), `${tag} still open`).toBeVisible();
      await ctx.close();
    }
  });
});
