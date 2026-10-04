import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedLoanAndGoto, STORE_VERSION } from './helpers';

/**
 * The Milestones on a phone (spec `pbloc-spec-milestones-phone-v1.md`). Under 768 px the three parents show their
 * Milestones as blocks, one per row; from 768 px, their tables — and Ownership's side column
 * (from 920 px) the blocks again. The blocks carry the table's own figures: SAME reads both off one page. Every assertion
 * carries a tag, so each named mutation fails at its own. Hermetic: the round synthetic seed ($50,000 owed on 1 ₿ at a
 * manual $100,000), live prices aborted, the price history stubbed.
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
const blocksOf = (page: Page): Locator => page.getByRole('list', { name: 'Milestones', exact: true });
/** The face's Milestones table — the one with a Year header. */
const tableOf = (page: Page): Locator => page.locator('table:has(th:text-is("Year"))');

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

/** FIT — every figure on one line, inside its own cell, nothing past the list's edge, and no sideways page. */
async function expectFit(page: Page, at: string): Promise<void> {
  const r = await blocksOf(page).evaluate((l) => {
    const lines = (el: Element): number => {
      const rg = document.createRange();
      rg.selectNodeContents(el);
      return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size;
    };
    const lr = l.getBoundingClientRect();
    return {
      over: [...l.querySelectorAll('dl > div')].filter((g) => g.scrollWidth > g.clientWidth + 0.5)
        .map((g) => g.querySelector('dt')?.textContent),
      wraps: [...l.querySelectorAll('dt, dd'), ...[...l.querySelectorAll(':scope > [role="listitem"]')].flatMap((li) => {
        const turn = li.firstElementChild!.firstElementChild!.nextElementSibling;
        return turn?.tagName === 'DIV' ? [turn] : [];
      })].filter((v) => lines(v) > 1).map((v) => v.textContent),
      tallHeads: [...l.querySelectorAll(':scope > [role="listitem"]')].map((li) => li.firstElementChild!.firstElementChild!)
        .filter((h) => h.getBoundingClientRect().height > 1.6 * h.lastElementChild!.getBoundingClientRect().height)
        .map((h) => h.textContent),
      outside: [...l.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > lr.right + 0.5).length,
      sideways: document.body.scrollWidth - innerWidth,
    };
  });
  expect(r.over, `FIT ${at}: no figure runs into its neighbour`).toEqual([]);
  expect(r.wraps, `FIT ${at}: every figure on one line`).toEqual([]);
  expect(r.tallHeads, `FIT ${at}: every head on one line`).toEqual([]);
  expect(r.outside, `FIT ${at}: nothing past the list's edge`).toBe(0);
  expect(r.sideways, `FIT ${at}: no sideways page`).toBeLessThanOrEqual(0);
}

interface Row { year: string; flags: string[]; turn: string | null; zone: string | null; price: string; dim: string; cells: Record<string, string> }

/** The table, row by row: the year cell's number, flags and turn (the one block-level span), and each column's text. */
async function readTable(page: Page): Promise<{ heads: string[]; rows: Row[] }> {
  return tableOf(page).evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent!.trim());
    const rows = [...t.querySelectorAll('tbody tr')].map((tr) => {
      const tds = [...tr.querySelectorAll(':scope > td')];
      const spans = [...tds[0].querySelectorAll(':scope > span')];
      const turn = spans.find((s) => getComputedStyle(s).display === 'block') ?? null;
      const cells: Record<string, string> = {};
      tds.forEach((td, i) => { cells[heads[i]] = td.textContent!.trim(); });
      return {
        year: [...tds[0].childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
        flags: spans.filter((s) => s !== turn).map((s) => s.textContent!.trim()),
        turn: turn ? turn.textContent!.trim() : null,
        zone: heads.includes('Zone') ? cells.Zone : null,
        price: cells.Price,
        dim: getComputedStyle(tr).opacity,
        cells,
      };
    });
    return { heads, rows };
  });
}

/** The blocks, the same shape: the head line (year, flags, zone, price), the turn line, then each term and its figures. */
async function readBlocks(page: Page): Promise<Row[]> {
  return blocksOf(page).evaluate((l) => [...l.querySelectorAll(':scope > [role="listitem"]')].map((li) => {
    const inner = li.firstElementChild!;
    const head = inner.firstElementChild!;
    const year = head.firstElementChild!;
    const next = head.nextElementSibling;
    const cells: Record<string, string> = {};
    for (const g of inner.querySelectorAll('dl > div')) {
      cells[g.querySelector('dt')!.textContent!.trim()] = [...g.querySelectorAll('dd')].map((d) => d.textContent!.trim()).join('');
    }
    return {
      year: [...year.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(),
      flags: [...year.querySelectorAll('span')].map((s) => s.textContent!.trim()),
      turn: next && next.tagName === 'DIV' ? next.textContent!.trim() : null,
      zone: head.children.length === 3 ? head.children[1].textContent!.trim() : null,
      price: head.lastElementChild!.textContent!.trim(),
      dim: getComputedStyle(li).opacity,
      cells,
    };
  }));
}

/** SAME — read the table (Ownership's shows only at 768–919 px), narrow the same page to 390 px, read the blocks: row for
 *  row, the same figures. */
async function expectSame(page: Page, f: Face, step: string): Promise<{ turns: number; flags: number; dims: number }> {
  const wide = f.name === 'ownership' ? 900 : 1440;
  await page.setViewportSize({ width: wide, height: 900 });
  await expect(tableOf(page), `SAME ${f.name} ${step}: the table at ${wide}`).toHaveCount(1);
  const table = await readTable(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(blocksOf(page), `SAME ${f.name} ${step}: the blocks at 390`).toHaveCount(1);
  const blocks = await readBlocks(page);
  await expectFit(page, `SAME ${f.name} ${step}`);
  expect(blocks.length, `SAME ${f.name} ${step}: one block per row`).toBe(table.rows.length);
  // SAME-COLUMNS — a block's terms are the table's headers, less Year, Zone and Price (its head line carries those).
  const terms = table.heads.filter((h) => !['Year', 'Zone', 'Price'].includes(h)).sort();
  blocks.forEach((b, i) => {
    const t = table.rows[i];
    const at = `SAME ${f.name} ${step} row ${i}`;
    expect(Object.keys(b.cells).sort(), `SAME-COLUMNS ${f.name} ${step} row ${i}`).toEqual(terms);
    expect(b.year, `${at}: year`).toBe(`${t.year} yr`);
    expect(b.flags, `${at}: flags`).toEqual(t.flags);
    expect(b.turn, `${at}: turn`).toBe(t.turn);
    expect(b.zone, `${at}: zone`).toBe(t.zone);
    expect(b.price, `${at}: price`).toBe(t.price);
    expect(b.dim, `${at}: dim`).toBe(t.dim);
    for (const term of terms) expect(b.cells[term], `${at}: ${term}`).toBe(t.cells[term]);
  });
  return {
    turns: table.rows.filter((r) => r.turn).length,
    flags: table.rows.filter((r) => r.flags.length).length,
    dims: table.rows.filter((r) => r.dim !== '1').length,
  };
}

test.describe('Milestones — a phone', () => {
  test('FIT, ONCE — the three faces show blocks and no table; every figure on one line, inside its cell, at 390 and 320 px', async ({ page }) => {
    test.setTimeout(60_000);
    for (const f of FACES) {
      await page.setViewportSize({ width: 390, height: 844 });
      await openFace(page, f);
      await expect(blocksOf(page), `ONCE ${f.name}: the blocks`).toHaveCount(1);
      await expect(tableOf(page), `ONCE ${f.name}: no table`).toHaveCount(0);
      expect(await blocksOf(page).getByRole('listitem').count(), `FIT ${f.name}: rows`).toBeGreaterThan(1);
      for (const w of [390, 320]) {
        await page.setViewportSize({ width: w, height: 844 });
        await expectFit(page, `${f.name} ${w}`);
      }
    }
  });

  test('JUMP — Strategy\'s and Ownership\'s blocks jump the month, by tap, Enter and Space, and the picked one is lit; Cycling\'s are not buttons', async ({ page }) => {
    test.setTimeout(60_000);
    for (const f of FACES) {
      const dock = await openFace(page, f);
      const items = blocksOf(page).getByRole('listitem');
      const n = await items.count();
      expect(n, `JUMP ${f.name}: rows`).toBeGreaterThan(1);
      if (!f.picks) {
        await expect(blocksOf(page).getByRole('button'), `JUMP ${f.name}: not buttons`).toHaveCount(0);
        continue;
      }
      await expect(blocksOf(page).getByRole('button'), `JUMP ${f.name}: one button a block`).toHaveCount(n);
      const month = dock.getByRole('button', { name: /^Month/ });
      if ((await month.getAttribute('aria-expanded')) !== 'true') await month.click();
      const readout = dock.getByText(/^month \d+ · [\d.]+ yr$/);
      for (const [i, how] of [[0, 'tap'], [n - 1, 'Enter'], [0, 'Space']] as const) {
        const btn = items.nth(i).getByRole('button');
        const yr = Number(/^([\d.]+) yr/.exec((await btn.textContent())!)![1]);
        if (how === 'tap') await btn.tap();
        else { await btn.focus(); await page.keyboard.press(how === 'Enter' ? 'Enter' : ' '); }
        await expect(readout, `JUMP ${f.name} ${how}`).toHaveText(new RegExp(`· ${yr.toFixed(1)} yr$`));
        const lit = await items.evaluateAll((els) => els.map((e) => getComputedStyle(e.firstElementChild!).backgroundColor));
        expect(lit.map((c, k) => (c === 'rgb(21, 27, 37)' ? k : -1)).filter((k) => k >= 0), `LIT ${f.name} ${how}`).toEqual([i]);
      }
    }
  });
});

test.describe('Milestones — a computer', () => {
  // Z20 — Playwright Test applies the project's `use` (a touch phone) unless these are set false.
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('SAME — the blocks are the table\'s own figures, row for row: on the 4-yr path (its turns), then under a deep stress (its flags)', async ({ page }) => {
    test.setTimeout(90_000);
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

  test('EDGES — blocks under 768 px, the table from it; Ownership\'s side column the blocks again; no table scrolls sideways; the years sit under their header', async ({ page }) => {
    test.setTimeout(60_000);
    for (const f of FACES) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openFace(page, f);
      const widths: [number, 'blocks' | 'table'][] = f.name === 'ownership'
        ? [[767, 'blocks'], [768, 'table'], [919, 'table'], [920, 'blocks'], [1440, 'blocks']]
        : [[767, 'blocks'], [768, 'table'], [1440, 'table']];
      for (const [w, want] of widths) {
        await page.setViewportSize({ width: w, height: 900 });
        const at = `EDGES ${f.name} ${w}`;
        await expect(blocksOf(page), `${at}: ${want}`).toHaveCount(want === 'blocks' ? 1 : 0);
        await expect(tableOf(page), `${at}: ${want}`).toHaveCount(want === 'table' ? 1 : 0);
        if (want === 'blocks') {
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

test.describe('Milestones — the dock\'s tabs (R3)', () => {
  test('TABS, BLEED — every tab value whole at 320 and 360 px in simple and full mode; in full mode the dock spans the window', async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    for (const simple of [true, false]) {
      for (const w of [320, 360]) {
        const at = `${simple ? 'simple' : 'full'} ${w}`;
        const ctx = await browser.newContext({ baseURL, viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
        try {
          const page = await ctx.newPage();
          await hermetic(page);
          await page.addInitScript(`
            window.__APP_BOOTED = true;
            localStorage.setItem('personal-bloc-store', JSON.stringify({
              state: {
                onboardingComplete: true, simpleMode: ${simple}, simpleView: 'daily',
                hasCbLoan: true, cbLoanBalance: 50000, cbLoanBalanceAsOf: null, cbCollateralBtc: 1,
                btcPriceMode: 'manual', btcPrice: 100000
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
});
