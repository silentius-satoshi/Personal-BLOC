import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedLoanAndGoto, STORE_VERSION } from './helpers';

/**
 * The Milestones on a phone (spec `pbloc-spec-milestones-phone-v1.md`, Run 2: the switch table). Under 768 px — and in
 * Ownership's side column from 920 px — each parent face shows its Milestones as a small table, one line a year, with a
 * switch above it that shows a few of the table's columns at a time; from 768 px, the face's own table. Every column but
 * the year sits in exactly one view, and every view carries the table's own figures: SAME reads both off one page. Every
 * assertion carries a tag, so each named mutation fails at its own. Hermetic: the round synthetic seed ($50,000 owed on
 * 1 ₿ at a manual $100,000), live prices aborted, the price history stubbed.
 */
const HISTORY = JSON.stringify({ values: [{ x: 1230940800, y: 0.1 }, { x: 1600000000, y: 10000 }, { x: 1780000000, y: 90000 }] });

async function hermetic(page: Page): Promise<void> {
  await page.route(/api\.coinbase\.com\/v2\/prices/, (r) => r.abort());
  await page.route(/blockchain\.info/, (r) => r.fulfill({ contentType: 'application/json', body: HISTORY }));
}

const FACES = [
  { name: 'cycling', pill: /♻ Cycling/, framing: 'Draw on Strike, refinance to Coinbase, never sell.', fourYear: '4-yr cycle', picks: false },
  { name: 'strategy', pill: /◈ Strategy/, framing: 'One run, two lenses — what you own, and what the flywheel earns.', fourYear: '4-yr cycle', picks: true },
  { name: 'ownership', pill: /⚖ Ownership/, framing: 'Held · owed · yours — never sell.', fourYear: 'Ride the 4-yr cycle', picks: true },
] as const;
type Face = (typeof FACES)[number];

const dockOf = (page: Page): Locator => page.getByRole('region', { name: 'Controls' });
/** The switch table — named; the face's own table has no name. */
const phoneOf = (page: Page): Locator => page.getByRole('table', { name: 'Milestones', exact: true });
const switchOf = (page: Page): Locator => page.getByRole('group', { name: 'Milestones figures', exact: true });
/** The face's Milestones table — the unnamed one with a Year header. */
const tableOf = (page: Page): Locator => page.locator('table:not([aria-label]):has(th:text-is("Year"))');

/** Simple mode: the journal → Almanac → the face; on Strategy, its Flywheel lens, where its Milestones live. */
async function openFace(page: Page, f: Face): Promise<Locator> {
  await hermetic(page);
  await seedLoanAndGoto(page);
  await page.getByLabel('Almanac').click();
  await page.getByRole('button', { name: f.pill }).click();
  await expect(page.getByText(f.framing, { exact: true })).toBeVisible({ timeout: 8000 });
  const dock = dockOf(page);
  if (f.name === 'strategy') {
    await dock.getByRole('button', { name: /^Lens/ }).click();
    await dock.getByRole('button', { name: 'Flywheel', exact: true }).click();
    await page.keyboard.press('Escape');
  }
  return dock;
}

/** FIT, the open view — every header and figure on one line (a flag may break at its hyphen), no two cells' text closer
 *  than 3 px, the table inside its card, no sideways page. */
async function expectFitView(page: Page, at: string): Promise<void> {
  const r = await phoneOf(page).evaluate((t) => {
    const wrap = t.closest('[class*="msWrap"]') ?? t.parentElement!;
    const runs: { l: number; r: number; t: number; b: number; cell: Element }[] = [];
    const walk = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent!.trim()) continue;
      const cell = n.parentElement!.closest('td, th')!;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) if (q.width > 0) runs.push({ l: q.left, r: q.right, t: q.top, b: q.bottom, cell });
    }
    const touch: string[] = [];
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const A = runs[i], B = runs[j];
        if (A.cell === B.cell) continue;
        const vo = Math.min(A.b, B.b) - Math.max(A.t, B.t);
        if (vo < 0.5 * Math.min(A.b - A.t, B.b - B.t)) continue;
        if (Math.max(A.l, B.l) - Math.min(A.r, B.r) < 3) touch.push(`${A.cell.textContent!.trim()} | ${B.cell.textContent!.trim()}`);
      }
    }
    const lines = (el: Element): number => {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size;
    };
    const one = [...t.querySelectorAll('thead th, tbody > tr:first-child > td:not(:first-child) > span, '
      + 'tbody > tr:first-child > td:first-child > span:first-child, td[colspan]')];
    const tr = t.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    return {
      touch,
      wraps: one.filter((e) => e.textContent!.trim() && lines(e) > 1).map((e) => e.textContent!.trim()),
      outside: Math.max(0, Math.ceil(tr.right - wr.right)),
      scroll: wrap.scrollWidth - wrap.clientWidth,
      sideways: document.body.scrollWidth - innerWidth,
    };
  });
  expect(r.touch, `FIT ${at}: no figure runs into its neighbour`).toEqual([]);
  expect(r.wraps, `FIT ${at}: every header and figure on one line`).toEqual([]);
  expect(r.outside, `FIT ${at}: the table inside its card`).toBe(0);
  expect(r.scroll, `FIT ${at}: no sideways scroll in the card`).toBeLessThanOrEqual(0);
  expect(r.sideways, `FIT ${at}: no sideways page`).toBeLessThanOrEqual(0);
}

/** The switch's views, by their spoken names, in order. */
const viewsOf = (page: Page): Promise<string[]> =>
  switchOf(page).getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')!));

/** FIT on every view, then the first view back. */
async function expectFit(page: Page, at: string): Promise<void> {
  await expect(switchOf(page), `FIT ${at}: the switch`).toHaveCount(1);
  const views = await viewsOf(page);
  for (const v of views) {
    await switchOf(page).getByRole('button', { name: v, exact: true }).click();
    await expectFitView(page, `${at} ${v}`);
  }
  await switchOf(page).getByRole('button', { name: views[0], exact: true }).click();
}

interface Row { year: string; flags: string[]; turn: string | null; dim: string; cells: Record<string, string> }

/** The table, row by row: the year cell's number, flags and turn (the one block-level span), and each column's text. */
async function readTable(page: Page): Promise<{ heads: string[]; rows: Row[] }> {
  return tableOf(page).evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent!.trim());
    const rows = [...t.querySelectorAll('tbody tr')].map((tr) => {
      const tds = [...tr.querySelectorAll(':scope > td')];
      const spans = [...tds[0].querySelectorAll(':scope > span')];
      const turn = spans.find((s) => getComputedStyle(s).display === 'block') ?? null;
      const cells: Record<string, string> = {};
      tds.forEach((td, i) => { if (i > 0) cells[heads[i]] = td.textContent!.trim(); });
      return {
        year: [...tds[0].childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
        flags: spans.filter((s) => s !== turn).map((s) => s.textContent!.trim()),
        turn: turn ? turn.textContent!.trim() : null,
        dim: getComputedStyle(tr).opacity,
        cells,
      };
    });
    return { heads, rows };
  });
}

/** The switch table's open view, the same shape: one row group a year — its line (the year, its flags, the view's
 *  figures) and the turn's line. */
async function readView(page: Page): Promise<{ heads: string[]; rows: (Row & { lit: string })[] }> {
  return phoneOf(page).evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent!.trim());
    const rows = [...t.querySelectorAll(':scope > tbody')].map((g) => {
      const [line, turnLine] = [...g.querySelectorAll(':scope > tr')];
      const tds = [...line.querySelectorAll(':scope > td')];
      const spans = [...tds[0].querySelectorAll(':scope > span')];
      const cells: Record<string, string> = {};
      tds.forEach((td, i) => { if (i > 0) cells[heads[i]] = td.textContent!.trim(); });
      return {
        year: spans[0].textContent!.trim(),
        flags: spans.slice(1).map((s) => s.textContent!.trim()),
        turn: turnLine ? turnLine.textContent!.trim() : null,
        dim: getComputedStyle(g).opacity,
        lit: getComputedStyle(tds[0]).backgroundColor,
        cells,
      };
    });
    return { heads, rows };
  });
}

/** Every view in turn, merged: each view's columns, and each row's figures from all of them. */
async function readPhone(page: Page, at: string): Promise<{ views: { label: string; heads: string[] }[]; rows: Row[] }> {
  await expect(switchOf(page), `${at}: the switch`).toHaveCount(1);
  const labels = await viewsOf(page);
  const views: { label: string; heads: string[] }[] = [];
  let rows: Row[] = [];
  for (const [k, label] of labels.entries()) {
    await switchOf(page).getByRole('button', { name: label, exact: true }).click();
    const v = await readView(page);
    views.push({ label, heads: v.heads.slice(1) });
    if (k === 0) {
      rows = v.rows.map(({ year, flags, turn, dim, cells }) => ({ year, flags, turn, dim, cells: { ...cells } }));
    } else {
      expect(v.rows.map((r) => r.year), `${at} ${label}: the same years in every view`).toEqual(rows.map((r) => r.year));
      v.rows.forEach((r, i) => Object.assign(rows[i].cells, r.cells));
    }
  }
  await switchOf(page).getByRole('button', { name: labels[0], exact: true }).click();
  return { views, rows };
}

/** SAME — read the table (Ownership's shows only at 768–919 px), narrow the same page to 390 px, read every view of the
 *  switch table: every column but the year in exactly one view, and row for row the same figures. */
async function expectSame(page: Page, f: Face, step: string): Promise<{ turns: number; flags: number; dims: number }> {
  const wide = f.name === 'ownership' ? 900 : 1440;
  await page.setViewportSize({ width: wide, height: 900 });
  await expect(tableOf(page), `SAME ${f.name} ${step}: the table at ${wide}`).toHaveCount(1);
  const table = await readTable(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(phoneOf(page), `SAME ${f.name} ${step}: the switch table at 390`).toHaveCount(1);
  const phone = await readPhone(page, `SAME ${f.name} ${step}`);
  await expectFit(page, `SAME ${f.name} ${step}`);
  // PARTITION — the views together show every column of the table but the year, each once.
  const shown = phone.views.flatMap((v) => v.heads);
  expect([...shown].sort(), `PARTITION ${f.name} ${step}`).toEqual(table.heads.filter((h) => h !== 'Year').sort());
  expect(phone.rows.length, `SAME ${f.name} ${step}: one line per row`).toBe(table.rows.length);
  phone.rows.forEach((p, i) => {
    const t = table.rows[i];
    const at = `SAME ${f.name} ${step} row ${i}`;
    expect(p.year, `${at}: year`).toBe(`${t.year} yr`);
    expect(p.flags, `${at}: flags`).toEqual(t.flags);
    expect(p.turn, `${at}: turn`).toBe(t.turn);
    expect(p.dim, `${at}: dim`).toBe(t.dim);
    for (const h of shown) expect(p.cells[h], `${at}: ${h}`).toBe(t.cells[h]);
  });
  return {
    turns: table.rows.filter((r) => r.turn).length,
    flags: table.rows.filter((r) => r.flags.length).length,
    dims: table.rows.filter((r) => r.dim !== '1').length,
  };
}

const pressedOf = (page: Page): Promise<(string | null)[]> =>
  switchOf(page).getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-pressed')));

test.describe('Milestones — a phone', () => {
  test('FIT, ONCE — the three faces show the switch table and no table; every view on one line, inside its card, at 390 and 320 px', async ({ page }) => {
    test.setTimeout(90_000);
    for (const f of FACES) {
      await page.setViewportSize({ width: 390, height: 844 });
      await openFace(page, f);
      await expect(phoneOf(page), `ONCE ${f.name}: the switch table`).toHaveCount(1);
      await expect(tableOf(page), `ONCE ${f.name}: no table`).toHaveCount(0);
      expect(await phoneOf(page).locator('tbody').count(), `FIT ${f.name}: rows`).toBeGreaterThan(1);
      for (const w of [390, 320]) {
        await page.setViewportSize({ width: w, height: 844 });
        await expectFit(page, `${f.name} ${w}`);
      }
    }
  });

  test('SWITCH — one view at a time, the first on open; each shows its own columns, none twice; a picked month keeps the view', async ({ page }) => {
    test.setTimeout(60_000);
    for (const f of FACES) {
      await openFace(page, f);
      const n = await switchOf(page).getByRole('button').count();
      expect(n, `SWITCH ${f.name}: views`).toBeGreaterThan(1);
      // NAME-ONCE (R7) — a view's name is its aria-label alone: a title equal to it is also exposed as the button's
      // description, so a screen reader would read each name twice.
      expect(await switchOf(page).getByRole('button').evaluateAll((bs) => bs.filter((b) => b.hasAttribute('title')).length),
        `NAME-ONCE ${f.name}`).toBe(0);
      expect(await pressedOf(page), `SWITCH ${f.name}: the first view on open`).toEqual(Array.from({ length: n }, (_, j) => String(j === 0)));
      const seen: string[] = [];
      for (let k = 0; k < n; k++) {
        await switchOf(page).getByRole('button').nth(k).click();
        expect(await pressedOf(page), `SWITCH ${f.name} ${k}: pressed`).toEqual(Array.from({ length: n }, (_, j) => String(j === k)));
        const heads = (await readView(page)).heads;
        expect(heads[0], `SWITCH ${f.name} ${k}: the year first`).toBe('Year');
        expect(heads.length, `SWITCH ${f.name} ${k}: a column`).toBeGreaterThan(1);
        for (const h of heads.slice(1)) {
          expect(seen, `SWITCH ${f.name}: ${h} in one view`).not.toContain(h);
          seen.push(h);
        }
      }
      if (f.picks) {
        // VIEW-STAYS — the last view open, a row picked: the same view, the same columns.
        const heads = (await readView(page)).heads;
        await phoneOf(page).locator('tbody').first().tap();
        expect(await pressedOf(page), `VIEW-STAYS ${f.name}`).toEqual(Array.from({ length: n }, (_, j) => String(j === n - 1)));
        expect((await readView(page)).heads, `VIEW-STAYS ${f.name}: its columns`).toEqual(heads);
      }
    }
  });

  test('JUMP — Strategy\'s and Ownership\'s rows jump the month, by tap, Enter and Space, and the picked one is lit; Cycling\'s are not buttons', async ({ page }) => {
    test.setTimeout(60_000);
    for (const f of FACES) {
      const dock = await openFace(page, f);
      const groups = phoneOf(page).locator('tbody');
      const n = await groups.count();
      expect(n, `JUMP ${f.name}: rows`).toBeGreaterThan(1);
      if (!f.picks) {
        await expect(phoneOf(page).getByRole('button'), `JUMP ${f.name}: not buttons`).toHaveCount(0);
        continue;
      }
      await expect(phoneOf(page).getByRole('button'), `JUMP ${f.name}: one button a row`).toHaveCount(n);
      const month = dock.getByRole('button', { name: /^Month/ });
      if ((await month.getAttribute('aria-expanded')) !== 'true') await month.click();
      const readout = dock.getByText(/^month \d+ · [\d.]+ yr$/);
      for (const [i, how] of [[0, 'tap'], [n - 1, 'Enter'], [0, 'Space']] as const) {
        const row = groups.nth(i);
        const yr = Number(/^([\d.]+) yr/.exec((await row.locator('td').first().textContent())!)![1]);
        if (how === 'tap') await row.tap();
        else { await row.focus(); await page.keyboard.press(how === 'Enter' ? 'Enter' : ' '); }
        await expect(readout, `JUMP ${f.name} ${how}`).toHaveText(new RegExp(`· ${yr.toFixed(1)} yr$`));
        const lit = (await readView(page)).rows.map((r) => r.lit);
        expect(lit.map((c, k) => (c === 'rgb(21, 27, 37)' ? k : -1)).filter((k) => k >= 0), `LIT ${f.name} ${how}`).toEqual([i]);
      }
    }
  });
});

test.describe('Milestones — a computer', () => {
  // Z20 — Playwright Test applies the project's `use` (a touch phone) unless these are set false.
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('SAME — the switch table\'s views are the table\'s own columns and figures, row for row: on the 4-yr path (its turns), then under a deep stress (its flags)', async ({ page }) => {
    test.setTimeout(120_000);
    for (const f of FACES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      const dock = await openFace(page, f);
      if (f.name === 'ownership') {
        // Its default horizon (24 months) can hold no 4-yr turn: from 5 Oct 2026 the next is 1,064 days out. 36 months
        // hold one from any start date (D7) — typed into the slider's own value field.
        const horizon = page.locator('div', { has: page.getByText('Horizon', { exact: true }) })
          .filter({ has: page.locator('input[type="range"]') }).last();
        await horizon.getByText('2 yr', { exact: true }).click();
        await horizon.locator('input[type="text"]').fill('36');
        await page.keyboard.press('Enter');
        await expect(horizon.getByText('3 yr', { exact: true }), 'SAME ownership: a 36-month horizon').toBeVisible();
      }
      await dock.getByRole('button', { name: /^Path/ }).click();
      await dock.getByRole('button', { name: f.fourYear, exact: true }).click();
      await page.keyboard.press('Escape');
      const path = await expectSame(page, f, '4-yr');
      expect(path.turns, `SAME ${f.name}: the 4-yr path's turns are rows (non-vacuous)`).toBeGreaterThan(0);
      // A deep stress from today (month 0, then the stress's floor): all three tables follow it into a liquidation —
      // the post-liquidation flags.
      await page.setViewportSize({ width: 1440, height: 900 });
      await dock.getByLabel('Inspect month').focus();
      await page.keyboard.press('Home');
      await dock.getByLabel('Price stress multiplier').focus();
      await page.keyboard.press('Home');
      const stress = await expectSame(page, f, 'stress');
      expect(stress.flags, `SAME ${f.name}: flagged rows (non-vacuous)`).toBeGreaterThan(0);
      expect(stress.dims, `SAME ${f.name}: dimmed rows (non-vacuous)`).toBeGreaterThan(0);
    }
  });

  test('EDGES — the switch table under 768 px, the table from it; Ownership\'s side column the switch table again; no table scrolls sideways; the years sit under their header', async ({ page }) => {
    test.setTimeout(90_000);
    for (const f of FACES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openFace(page, f);
      const widths: [number, 'phone' | 'table'][] = f.name === 'ownership'
        ? [[767, 'phone'], [768, 'table'], [919, 'table'], [920, 'phone'], [1440, 'phone']]
        : [[767, 'phone'], [768, 'table'], [1440, 'table']];
      for (const [w, want] of widths) {
        await page.setViewportSize({ width: w, height: 900 });
        const at = `EDGES ${f.name} ${w}`;
        await expect(phoneOf(page), `${at}: ${want}`).toHaveCount(want === 'phone' ? 1 : 0);
        await expect(tableOf(page), `${at}: ${want}`).toHaveCount(want === 'table' ? 1 : 0);
        if (want === 'phone') {
          await expectFit(page, at);
        } else {
          expect(await tableOf(page).evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth), `NO-SCROLL ${at}`).toBeLessThanOrEqual(1);
          // ALIGN (R5) — the year cells sit under their header, on the left.
          const align = await tableOf(page).evaluate((t) => [t.querySelector('thead th')!, ...t.querySelectorAll('tbody tr > td:first-child')]
            .map((c) => getComputedStyle(c).textAlign));
          expect(align, `ALIGN ${at}`).toEqual(align.map(() => 'left'));
        }
      }
    }
  });
});

/** A fresh phone context on the Almanac: simple mode (the journal) or full mode (Tools → Almanac). */
async function almanacAt(browser: import('@playwright/test').Browser, baseURL: string | undefined, w: number, simple: boolean,
  extra = ''): Promise<{ ctx: import('@playwright/test').BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL, viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await hermetic(page);
  await page.addInitScript(`
    window.__APP_BOOTED = true;
    localStorage.setItem('personal-bloc-store', JSON.stringify({
      state: {
        onboardingComplete: true, simpleMode: ${simple}, simpleView: 'daily',
        hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
        btcPriceMode: 'manual', btcPrice: 100000${extra}
      },
      version: ${STORE_VERSION}
    }));
    localStorage.setItem('personal-bloc-onboarded', '1');
  `);
  await page.goto('/');
  if (simple) {
    await expect(page.getByLabel('Log an event')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Almanac').click();
  } else {
    const tools = page.getByRole('button', { name: /^Tools/ });
    await expect(tools).toBeVisible({ timeout: 15_000 });
    await tools.click();
    await page.getByRole('button', { name: 'Almanac', exact: true }).click();
  }
  return { ctx, page };
}

test.describe('Milestones — the dock\'s tabs (R3), and full mode', () => {
  test('TABS, BLEED — every tab value whole at 320 and 360 px in simple and full mode; in full mode the dock spans the window', async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    for (const simple of [true, false]) {
      for (const w of [320, 360]) {
        const at = `${simple ? 'simple' : 'full'} ${w}`;
        const { ctx, page } = await almanacAt(browser, baseURL, w, simple);
        try {
          await page.getByRole('button', { name: /◈ Strategy/ }).click();
          const dock = dockOf(page);
          await dock.getByRole('button', { name: /^Lens/ }).click();
          await dock.getByRole('button', { name: 'Flywheel', exact: true }).click();
          await expect(dock.getByRole('button', { name: /^Lens/ })).toHaveText(/^Lens\s*Flywheel$/);
          const cut = await dock.locator('button[aria-expanded]').evaluateAll((bs) => bs
            .map((b) => b.lastElementChild!).filter((v) => v.scrollWidth > v.clientWidth).map((v) => v.textContent));
          expect(cut, `TABS ${at}: no value cut`).toEqual([]);
          await expectFit(page, `TABS ${at}`);
          const box = (await dock.boundingBox())!;
          expect([Math.round(box.x), Math.round(box.width)], `BLEED ${at}: edge to edge`).toEqual([0, w]);
        } finally {
          await ctx.close();
        }
      }
    }
  });

  test('FULL — full mode at 320 px, the narrowest frame (218 px on Cycling): every view of all three faces fits, on the 4-yr path and under a deep stress', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    // The probe seed's round figures: Strike collateral and a line, bills and income — Cycling's ₿ view at its widest.
    const { ctx, page } = await almanacAt(browser, baseURL, 320, false,
      ', strikeCollateralBtc: 1.5, creditLine: 40000, expenses: 5000, income: 6000');
    try {
      for (const f of FACES) {
        await page.getByRole('button', { name: f.pill }).click();
        await expect(page.getByText(f.framing, { exact: true })).toBeVisible({ timeout: 8000 });
        const dock = dockOf(page);
        const tab = async (re: RegExp): Promise<void> => {
          const t = dock.getByRole('button', { name: re });
          if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
        };
        if (f.name === 'strategy') {
          await tab(/^Lens/);
          await dock.getByRole('button', { name: 'Flywheel', exact: true }).click();
        }
        await tab(/^Path/);
        await dock.getByRole('button', { name: f.fourYear, exact: true }).click();
        await page.keyboard.press('Escape');
        await expectFit(page, `FULL ${f.name} 4-yr`);
        await tab(/^Month/);
        await dock.getByLabel('Inspect month').focus();
        await page.keyboard.press('Home');
        await tab(/^Stress/);
        await dock.getByLabel('Price stress multiplier').focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('Escape');
        expect((await readView(page)).rows.filter((r) => r.flags.length).length, `FULL ${f.name}: flagged rows (non-vacuous)`).toBeGreaterThan(0);
        await expectFit(page, `FULL ${f.name} stress`);
      }
    } finally {
      await ctx.close();
    }
  });
});
