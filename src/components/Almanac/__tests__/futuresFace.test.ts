import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { futuresFor, futuresAnchor, type FuturesJob } from '../futuresRun';
import { runFuturesJob, resetFuturesClientForTests } from '../futuresClient';
import {
  futuresReadout, futuresCardLine, futuresTitle, shareText, rangeText, horizonText, FUTURES_RUNNING, FUTURES_DEBOUNCE_MS,
  FUTURES_TIP, FUTURES_TIP_LABEL, horizonWords, monthYear,
} from '../futuresView';
import { priceFutures, FUTURES_SEED, FUTURES_COUNT } from '../../../simulation/pricePaths';

// priceFutures, wrapped in a spy that calls straight through — REUSE counts how often futuresRun draws the futures.
vi.mock('../../../simulation/pricePaths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../simulation/pricePaths')>();
  return { ...actual, priceFutures: vi.fn(actual.priceFutures) };
});
import { runFutures, type FuturesSummary } from '../../../simulation/monteCarlo';
import { STRIKE_MAX_DRAW_LTV } from '../../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../../simulation/emergencyModel';

/**
 * The futures on the faces (spec pbloc-spec-policy-v2-lenses-v1): the crossing, the anchor grid, the words, the worker
 * client and the wiring — the wiring read off the source, since the repo has no render harness. e2e/futures.spec.ts
 * covers the readout on screen, the line on every face and the worker. Each assertion carries the tag its named
 * mutation turns red.
 */
const ROOT = process.cwd();
const ALMANAC = join(ROOT, 'src/components/Almanac');
const read = (f: string): string => readFileSync(join(ALMANAC, f), 'utf8');
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const INPUTS: FuturesJob['inputs'] = {
  startYear: 2026, strikeCollateralBtc: 1, strikeBalance: 0, strikeCreditLine: 30_000,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV, cbCollateralBtc: 1, cbDebt: 30_000,
  openingColdBtc: 0, income: 8_000, expenses: 6_000, strikeAprPct: 13, cbAprPct: 6.27, cycleMonths: 1,
  cbLtvCapPct: 70, strikeLtvCapPct: 60, coldStoreBufferPct: 30, defendCbLtv: true, mode: 'cycle',
};
const JOB: FuturesJob = { inputs: INPUTS, anchorPrice: 84_000, startISO: '2026-10-04', months: 24, count: 40 };

describe('the crossing — futuresRun', () => {
  it('RUN — the futures run is the beliefs\' futures through the engine, nothing added', () => {
    const paths = priceFutures({
      anchorPrice: 84_000, startDate: new Date('2026-10-04T00:00:00Z'), months: 24, count: 40, seed: FUTURES_SEED,
    }).map((f) => f.prices);
    expect(futuresFor(JOB), 'RUN').toEqual(runFutures(INPUTS, paths, JOB.startISO));
    expect(futuresFor({ ...JOB, count: undefined }).count, 'RUN: the faces\' count').toBe(FUTURES_COUNT);
  });

  it('SAME FUTURES — a setting changes the answer, never the dice: a re-run on the same futures matches a fresh one', () => {
    // MF11 (the cache keyed by nothing) turns this red with stale futures; MF26 (keyed by the inputs too) turns REUSE red
    const a = futuresFor(JOB);
    const b = futuresFor({ ...JOB, inputs: { ...INPUTS, cbDebt: 20_000 } });
    expect(b, 'SAME FUTURES: the setting moved the answer').not.toEqual(a);
    expect(futuresFor({ ...JOB, anchorPrice: 90_000 }), 'SAME FUTURES: a new anchor, new futures')
      .toEqual(runFutures(INPUTS, priceFutures({
        anchorPrice: 90_000, startDate: new Date('2026-10-04T00:00:00Z'), months: 24, count: 40, seed: FUTURES_SEED,
      }).map((f) => f.prices), JOB.startISO));
    // REUSE (D-2, L-I6) — a setting runs the engine on the futures already drawn; a new horizon draws once
    const draws = vi.mocked(priceFutures);
    futuresFor({ ...JOB, anchorPrice: 77_000 });
    draws.mockClear();
    futuresFor({ ...JOB, anchorPrice: 77_000, inputs: { ...INPUTS, cbDebt: 25_000 } });
    expect(draws, 'SAME FUTURES: REUSE').not.toHaveBeenCalled();
    futuresFor({ ...JOB, anchorPrice: 77_000, months: 25 });
    expect(draws, 'SAME FUTURES: REUSE, a new horizon').toHaveBeenCalledTimes(1);
  });

  it('ANCHOR GRID — the futures\' month 0 moves in 1% steps: a tick inside a step changes nothing', () => {
    // MF12 (futuresAnchor returning the price as is) turns this red
    const g = futuresAnchor(84_000);
    expect(Math.abs(g / 84_000 - 1), 'ANCHOR GRID: within half a step').toBeLessThanOrEqual(0.005);
    expect(futuresAnchor(g * 1.001), 'ANCHOR GRID: a tick').toBe(g);
    expect(futuresAnchor(g * 1.012), 'ANCHOR GRID: a step').not.toBe(g);
    expect([futuresAnchor(0), futuresAnchor(Number.NaN)], 'ANCHOR GRID: junk passes').toEqual([0, Number.NaN]);
  });
});

const SUMMARY: FuturesSummary = {
  count: 1000, months: 240,
  yoursBtc: { p10: 3.1, p50: 3.754, p90: 4.761 }, coldBtc: { p10: 2.79, p50: 3.27, p90: 4.05 },
  beatsNeverDraw: 990, seized: 11, seizedWithinYear: 3, seizedHalfByMonth: 37, startISO: '2026-10-04', countsSeizures: true,
};

describe('the words — futuresView', () => {
  it('SHARE — a share of the futures, never "0%" or "100%" unless it is exactly none or all', () => {
    // MF13 (every share rounded, so 999 of 1,000 reads "100%") turns this red
    expect([0, 1, 5, 11, 99, 100, 940, 990, 999, 1000].map((k) => shareText(k, 1000)), 'SHARE')
      .toEqual(['none', '0.1%', '0.5%', '1.1%', '9.9%', '10%', '94%', '99%', '99.9%', 'all']);
  });

  it('RANGE — p10 to p90; one figure when they print the same; "none" when that figure is zero', () => {
    expect(rangeText({ p10: 3.1, p90: 4.761 }), 'RANGE').toBe('3.10–4.76 ₿');
    expect(rangeText({ p10: 2.244, p90: 2.236 }), 'RANGE one').toBe('2.24 ₿');
    expect(rangeText({ p10: 0, p90: 0.001 }), 'RANGE none').toBe('none');
    expect([12, 18, 60, 240].map(horizonText), 'HORIZON').toEqual(['1 yr', '1.5 yr', '5 yr', '20 yr']);
    expect(futuresTitle(1000, 60), 'TITLE').toBe('Across 1,000 simulations · 5 yr');
    expect([12, 18, 60, 240].map(horizonWords), 'HORIZON words').toEqual(['the next year', 'the next 1.5 years', 'the next 5 years', 'the next 20 years']);
    // WHEN month — month m after the start, "Nov 2029" (MF36, a month late, turns it red)
    expect([0, 2, 3, 14, 37, 240].map((m) => monthYear('2026-10-04', m)), 'WHEN month')
      .toEqual(['Oct 2026', 'Dec 2026', 'Jan 2027', 'Dec 2027', 'Nov 2029', 'Oct 2046']);
    // R14 — the Price path card's four paths, by name (MF56, v1.4's phrase back, turns it red)
    expect(FUTURES_TIP[0], 'TIP: not the four paths').toMatch(/not the four Price paths \(Support, Fair, Resistance, 4-yr cycle\)/);
    // R12 — the ⓘ names no count; the title beside it carries one. MF30 ("1,000" back in the tip) turns this red
    const tip = FUTURES_TIP.join(' ');
    expect(tip, 'TIP: no count').not.toContain('1,000');
    expect(tip, 'TIP: no count').not.toContain(FUTURES_COUNT.toLocaleString('en-US'));
  });

  it('FOUR — under the applied policy the readout shows the owner\'s four numbers, in his order', () => {
    const r = futuresReadout(SUMMARY);
    expect(r.rows.map((x) => [x.label, x.value]), 'FOUR').toEqual([
      ['You own', '3.10–4.76 ₿'], ['In your cold storage', '2.79–4.05 ₿'],
      ['Beats never borrowing', '99%'], ['Coinbase seizes', '1.1%'],
    ]);
    expect(r.rows[0].sub, 'FOUR: the middle').toBe('at the end, in 8 of 10 simulations · middle 3.75 ₿');
    expect(r.rows[3].sub, 'FOUR: when').toBe('of the simulations — 0.3% within a year, half of the seizures by Nov 2029');
    // A "none" range names no middle (O-1)
    expect(futuresReadout({ ...SUMMARY, coldBtc: { p10: 0, p50: 0, p90: 0.004 } }).rows[1], 'FOUR: none')
      .toEqual({ label: 'In your cold storage', value: 'none', sub: 'at the end, in 8 of 10 simulations' });
    expect(r.rows[1].sub, 'FOUR: the cold middle').toBe('at the end, in 8 of 10 simulations · middle 3.27 ₿');
    // The short form's other shapes: every seizure in the first year says "all" (MF40 drops it; the line and the readout
    // share one decision, seizedShares — R16); none in it says "none" (R10; MF52 drops the clause); a year's horizon
    // has no first-year part; none seized, the bare sub (MF50, "of the futures" there).
    expect(futuresReadout({ ...SUMMARY, seizedWithinYear: 11 }).rows[3].sub, 'FOUR: all early')
      .toBe('of the simulations — all within a year, half of the seizures by Nov 2029');
    expect(futuresReadout({ ...SUMMARY, seizedWithinYear: 0 }).rows[3].sub, 'FOUR: none early')
      .toBe('of the simulations — none within a year, half of the seizures by Nov 2029');
    expect(futuresReadout({ ...SUMMARY, months: 12, seizedHalfByMonth: 5 }).rows[3].sub, 'FOUR: a year')
      .toBe('of the simulations — half of the seizures by Mar 2027');
    expect(futuresReadout({ ...SUMMARY, seized: 0, seizedWithinYear: 0, seizedHalfByMonth: null }).rows[3], 'FOUR: none seized')
      .toEqual({ label: 'Coinbase seizes', value: 'none', sub: 'of the simulations' });
    expect(r.note, 'FOUR: no note').toBeNull();
  });

  it('CHANCE ALONE — without the applied policy only the chance shows, counted during the month, and says why', () => {
    // MF14 (the four rows whatever the policy) turns this red
    const r = futuresReadout({ ...SUMMARY, seized: 951, countsSeizures: false });
    expect(r.rows.map((x) => [x.label, x.value, x.sub]), 'CHANCE ALONE')
      .toEqual([['Coinbase seizes', '95%', 'of the simulations — 0.3% within a year, half of the seizures by Nov 2029']]);
    expect(r.note, 'CHANCE ALONE: why').toMatch(/^Without the support policy/);
    // R16 — where near-twins happen (the policy off, a short horizon): the value goes to one decimal with the sub's
    // share, never "19%" over "19.0% within a year". MF58 (the value from shareText) turns only this red
    expect(futuresReadout({ ...SUMMARY, months: 13, seized: 191, seizedWithinYear: 190, seizedHalfByMonth: 2,
      countsSeizures: false }).rows.map((x) => [x.label, x.value, x.sub]), 'CHANCE ALONE: twin')
      .toEqual([['Coinbase seizes', '19.1%', 'of the simulations — 19.0% within a year, half of the seizures by Dec 2026']]);
  });

  it('LINE — the card\'s one line: running, the reward and the risk, the chance alone, never seized', () => {
    expect(futuresCardLine(null), 'LINE running').toBe(FUTURES_RUNNING);
    // Sentences that say what they count, and when (W-3), of "simulations" (W-4)
    expect(futuresCardLine(SUMMARY), 'LINE').toBe('Over the next 20 years, in 1,000 simulations: in 8 of 10, you end owning '
      + '3.10–4.76 ₿; Coinbase seizes in 1.1% of them — 0.3% within the first year, half of those seizures by Nov 2029.');
    expect(futuresCardLine({ ...SUMMARY, seized: 951, countsSeizures: false }), 'LINE off')
      .toBe('Over the next 20 years, in 1,000 simulations: Coinbase seizes in 95% of them — 0.3% within the first year, '
        + 'half of those seizures by Nov 2029.');
    expect(futuresCardLine({ ...SUMMARY, seized: 0, seizedWithinYear: 0, seizedHalfByMonth: null }), 'LINE never')
      .toBe('Over the next 20 years, in 1,000 simulations: in 8 of 10, you end owning 3.10–4.76 ₿; Coinbase seizes in none of them.');
    expect(futuresCardLine({ ...SUMMARY, seized: 1000, seizedWithinYear: 1000, seizedHalfByMonth: 0 }), 'LINE all')
      .toBe('Over the next 20 years, in 1,000 simulations: in 8 of 10, you end owning 3.10–4.76 ₿; Coinbase seizes in all of '
        + 'them — all within the first year, half of those seizures by Oct 2026.');
    expect(futuresCardLine({ ...SUMMARY, seized: 0, seizedWithinYear: 0, seizedHalfByMonth: null, countsSeizures: false }),
      'LINE off never').toBe('Over the next 20 years, in 1,000 simulations: Coinbase seizes in none of them.');
    // Every seizure in the first year: "all", not the same share twice (MF40: the share instead → red)
    expect(futuresCardLine({ ...SUMMARY, seized: 3, seizedWithinYear: 3, seizedHalfByMonth: 1 }), 'LINE all early')
      .toBe('Over the next 20 years, in 1,000 simulations: in 8 of 10, you end owning 3.10–4.76 ₿; Coinbase seizes in 0.3% of '
        + 'them — all within the first year, half of those seizures by Nov 2026.');
    // A year's horizon: "within the first year" would say nothing (MF37: shown anyway → red)
    expect(futuresCardLine({ ...SUMMARY, months: 12, seizedHalfByMonth: 5 }), 'LINE a year')
      .toBe('Over the next year, in 1,000 simulations: in 8 of 10, you end owning 3.10–4.76 ₿; Coinbase seizes in 1.1% of '
        + 'them — half of those seizures by Mar 2027.');
    // Just past a year the first-year part shows (MF42 moves the cut past 12 months); none in it reads "none" (MF52)
    expect(futuresCardLine({ ...SUMMARY, months: 13 }), 'LINE 13 months')
      .toBe('Over the next 1.1 years, in 1,000 simulations: in 8 of 10, you end owning 3.10–4.76 ₿; Coinbase seizes in 1.1% '
        + 'of them — 0.3% within the first year, half of those seizures by Nov 2029.');
    // Two shares that print alike while the counts differ: BOTH to one decimal (O-3, R16) — never the same share twice
    // ("19% … 19.0%"), nor a first year larger than the whole ("13% … 13.1%"). Where it happens: the policy off, a short
    // horizon, as here. MF55, MF57, MF59 and MF60 turn this red
    expect(futuresCardLine({ ...SUMMARY, months: 13, seized: 191, seizedWithinYear: 190, seizedHalfByMonth: 2,
      countsSeizures: false }), 'LINE twin')
      .toBe('Over the next 1.1 years, in 1,000 simulations: Coinbase seizes in 19.1% of them — 19.0% within the first '
        + 'year, half of those seizures by Dec 2026.');
    expect(futuresCardLine({ ...SUMMARY, seized: 194, seizedWithinYear: 185 }), 'LINE close early')
      .toBe('Over the next 20 years, in 1,000 simulations: in 8 of 10, you end owning 3.10–4.76 ₿; Coinbase seizes in 19.4% '
        + 'of them — 18.5% within the first year, half of those seizures by Nov 2029.');
    expect(futuresCardLine({ ...SUMMARY, seizedWithinYear: 0 }), 'LINE none early')
      .toBe('Over the next 20 years, in 1,000 simulations: in 8 of 10, you end owning 3.10–4.76 ₿; Coinbase seizes in 1.1% '
        + 'of them — none within the first year, half of those seizures by Nov 2029.');
    // W-4 — "simulations", never "futures", in any word the app shows (MF38: "futures" back in a word → red)
    const shown = [...FUTURES_TIP, FUTURES_TIP_LABEL, FUTURES_RUNNING, futuresTitle(1000, 60), futuresCardLine(SUMMARY),
      futuresCardLine({ ...SUMMARY, countsSeizures: false }),
      ...[futuresReadout(SUMMARY), futuresReadout({ ...SUMMARY, countsSeizures: false }),
        futuresReadout({ ...SUMMARY, seized: 0, seizedWithinYear: 0, seizedHalfByMonth: null })]
        .flatMap((x) => [...x.rows.flatMap((row) => [row.label, row.value, row.sub]), x.note ?? ''])];
    expect(shown.filter((t) => /\bfutures?\b/i.test(t)), 'NAME').toEqual([]);
  });
});

// ── The worker client: latest only, and an in-thread fallback ─────────────────────────────────────────────────────

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  posted: { id: number; job: FuturesJob }[] = [];
  constructor() { FakeWorker.all.push(this); }
  postMessage(msg: { id: number; job: FuturesJob }): void { this.posted.push(msg); }
  terminate(): void { /* nothing to stop */ }
  reply(i: number, ok = true): void {
    const { id, job } = this.posted[i];
    this.onmessage?.({ data: ok ? { id, ok: true, summary: futuresFor(job) } : { id, ok: false } } as MessageEvent);
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the worker client', () => {
  afterEach(() => {
    resetFuturesClientForTests();
    FakeWorker.all = [];
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  it('LATEST ONLY — a newer request replaces the one waiting; it never runs', async () => {
    // MF15 (a replaced request that never settles) turns this red by timing out
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    resetFuturesClientForTests(() => new FakeWorker() as unknown as Worker);
    const a = runFuturesJob(JOB);
    const b = runFuturesJob({ ...JOB, months: 12 });
    const c = runFuturesJob({ ...JOB, months: 36 });
    const w = FakeWorker.all[0];
    expect(w.posted.map((p) => p.job.months), 'LATEST ONLY: one running').toEqual([24]);
    expect(await b, 'LATEST ONLY: superseded').toBeNull();
    w.reply(0);
    expect((await a)?.months, 'LATEST ONLY: the first lands').toBe(24);
    expect(w.posted.map((p) => p.job.months), 'LATEST ONLY: then the latest').toEqual([24, 36]);
    w.reply(1);
    expect((await c)?.months, 'LATEST ONLY: the latest lands').toBe(36);
    // The hook, read off its source (D-2, R6): keyed by the job's CONTENT, run after 300 ms of stillness.
    // MF27 (keyed by the job's identity) turns the content key red; MF28 (no wait) turns the 300 ms red
    const hook = strip(read('useFutures.ts'));
    expect(hook, 'LATEST ONLY: content key').toContain('JSON.stringify(job)');
    expect(hook, 'LATEST ONLY: content key').toMatch(/\}, \[key\]\);/);
    expect(hook, 'LATEST ONLY: 300 ms').toMatch(/\}, FUTURES_DEBOUNCE_MS\);/);
    expect(FUTURES_DEBOUNCE_MS, 'LATEST ONLY: 300 ms').toBe(300);
  });

  it('FALLBACK — a worker failure, or no worker at all, runs the same function in-thread', async () => {
    // MF16 (a failed reply settling null) and MF17 (no worker settling null) turn this red
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    resetFuturesClientForTests(() => new FakeWorker() as unknown as Worker);
    const a = runFuturesJob(JOB);
    FakeWorker.all[0].reply(0, false);
    expect(await a, 'FALLBACK failed reply').toEqual(futuresFor(JOB));
    delete (globalThis as { Worker?: unknown }).Worker;
    resetFuturesClientForTests();
    const b = runFuturesJob(JOB);
    await flush();
    expect(await b, 'FALLBACK no worker').toEqual(futuresFor(JOB));
  });
});

// ── The wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────

const FACES = ['CyclingFace.tsx', 'UnifiedFace.tsx', 'OwnershipFace.tsx', 'DecisionFace.tsx'] as const;

describe('the wiring', () => {
  it('EVERY FACE — one futures run from the face\'s own inputs and anchor grid; the line on its policy card', () => {
    for (const f of FACES) {
      const src = strip(read(f));
      // MF20 (Cycling passing no line) turns LINE red; MF21 (Decision on the raw anchor) turns INPUTS red
      expect(count(src, 'useFutures('), `ONE RUN ${f}`).toBe(1);
      expect(src, `INPUTS ${f}`).toMatch(/inputs: engineInputs, anchorPrice: futuresAnchor\(anchorPrice\)/);
      expect(count(src, 'futuresLine={futuresCardLine(futures.summary)}'), `LINE ${f}`).toBe(1);
    }
  });

  it('STRATEGY — the readout under the tiles, outside both lenses', () => {
    // A card moved into the Flywheel branch turns this red (MF19 instead hides it on Position — the e2e sees that)
    const src = strip(read('UnifiedFace.tsx'));
    const tiles = src.indexOf('<div className={styles.statGrid}>');
    const card = src.indexOf('<FuturesCard');
    const lens = src.indexOf("{lensView === 'position' ? (");
    expect(count(src, '<FuturesCard'), 'STRATEGY: one card').toBe(1);
    expect(tiles > 0 && tiles < card && card < lens, 'STRATEGY: after the tiles, before the lenses').toBe(true);
    // D-1 — the ⓘ's name is a word, so it comes from futuresView. MF29 (the literal in the face) turns this red
    expect(src, 'STRATEGY: the tip label').toContain('tipLabel={FUTURES_TIP_LABEL}');
  });

  it('WORKER — the worker posts only the summary; it is the worker project\'s, not the app\'s', () => {
    const worker = strip(read('futures.worker.ts'));
    expect(worker, 'WORKER').toMatch(/self\.postMessage\(\{ id, ok: true, summary: futuresFor\(job\) \}\)/);
    const app = JSON.parse(readFileSync(join(ROOT, 'tsconfig.app.json'), 'utf8')) as { exclude: string[] };
    const wk = JSON.parse(readFileSync(join(ROOT, 'tsconfig.worker.json'), 'utf8')) as { include: string[] };
    expect(app.exclude, 'WORKER: not the app\'s').toContain('src/components/Almanac/futures.worker.ts');
    expect(wk.include, 'WORKER: the worker project\'s').toContain('src/components/Almanac/futures.worker.ts');
    // The client spawns it the precache-safe way, as the crypto client does.
    expect(strip(read('futuresClient.ts')), 'WORKER: spawn')
      .toContain("new Worker(new URL('./futures.worker.ts', import.meta.url), { type: 'module' })");
  });

  it('LAYOUT-ONLY — FuturesCard reads no store or engine, writes no word, and its CSS is tokens only', () => {
    // MF23 (the card writing a word of its own) turns WORDLESS red; MF25 (a fixed 17 px) turns CLAMP red
    const src = strip(read('FuturesCard.tsx'));
    const imports = [...src.matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]).sort();
    expect(imports, 'LAYOUT-ONLY imports').toEqual(['../ui/InfoTip', './FuturesCard.module.css', './futuresView']);
    const body = src.replace(/^import[^;]*;$/gm, '');
    const literals = [...body.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]).filter((t) => /[A-Za-z]{2}/.test(t));
    const jsxText = [...body.matchAll(/(?<!=)>([^<>{}]+)</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-z]{2}/.test(t));
    expect([...literals, ...jsxText], 'WORDLESS').toEqual([]);
    expect(read('FuturesCard.module.css'), 'TOKENS').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // CLAMP — the values shrink with the window under 448 px; FIT in e2e/futures.spec.ts shows why
    expect(strip(read('FuturesCard.module.css')), 'CLAMP').toMatch(/\.value \{[^}]*font-size: clamp\(12px, 3\.8vw, 17px\);[^}]*white-space: nowrap;/);
  });

  it('WALL — futuresRun is the only module that imports both the futures and the batch runner', () => {
    // A face importing pricePaths' futures and the runner itself turns this red
    const both = ['futuresRun.ts', 'UnifiedFace.tsx', 'CyclingFace.tsx', 'OwnershipFace.tsx', 'DecisionFace.tsx',
      'futuresClient.ts', 'useFutures.ts', 'futuresView.ts', 'FuturesCard.tsx', 'futures.worker.ts']
      .filter((f) => { const s = read(f); return /from '[^']*pricePaths'/.test(s) && /from '[^']*monteCarlo'/.test(s); });
    expect(both, 'WALL').toEqual(['futuresRun.ts']);
  });
});
