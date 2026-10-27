import {
  fireTimeline, withdrawalCapacity, fireTargets, type FireInputs, type FireResult, type FireCapacity,
} from '../../simulation/fire';
import { breakEvenGrowth, BREAK_EVEN_BRACKET, type FireBreakEven } from '../../simulation/fireBreakEven';
import { deriveOwnership } from '../../simulation/ownership';
import { fmtUSD, shownUsd } from '../../utils/format';
import { fireTaxRateOf, FIRE_TAX_PCT_DEFAULT, type FireFaceInputs } from '../../lib/fireInputs';
import { msYearLabel, type MsView } from './cyclingFaceView';
import { shownBtc } from './supportPolicyView';

/**
 * The FIRE face's words, figures and tones (batch 1 build 4 — the FIRE plan's Run 2, the sell lane). Pure: no React, no
 * store, no belief — the face builds the price paths (its §2 crossing) and the replays' paths (fireReplays.ts) and hands
 * this module plain arrays. It runs build 3's engine (fire.ts, fireBreakEven.ts), which it never changes.
 *
 * 🔴 The face composes NO sentence (I31): every word is here. Every figure names its path. Dollars shown are TODAY'S —
 *    nominal ÷ the row's inflation step (F8), said once. Dates come from one fixed month table, never ICU. What lasts
 *    "lasts through" the horizon's last month, never "all N years".
 * 🔴 Zero is never printed: a dollar, bitcoin or years figure that is zero, or would print as zero at its precision,
 *    prints "—" in a tile, a line, a Milestones cell and the tooltip, and no sentence states one. Rates aren't amounts.
 * 🔴 The replays and the capacity run from the face's own stop month, HELD: the number the timeline resolved on the
 *    displayed path. The capacity shown is the LOWEST of the three replays', only when all three replayed, in the
 *    owner's own spending (÷ the buffer, which stays on top), "at least" when the search's top binds (C7).
 * ⚠ D1 A′: no simulation sets or shows a figure here — the four Paths, the replays and the break-even only.
 */

// ── formatting: one month table, the display floors, today's dollars ─────────────────────────────────────────────

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Month `m` after a `yyyy-mm-dd` start, as "Oct 2046" — calendar arithmetic on the string, no time zone, never ICU. */
export function fireMonthYear(startISO: string, m: number): string {
  const y = Number(startISO.slice(0, 4)), m0 = Number(startISO.slice(5, 7)) - 1;
  const k = m0 + m;
  return `${MONTH_ABBR[((k % 12) + 12) % 12]} ${y + Math.floor(k / 12)}`;
}

/** The dash a zero prints as, everywhere a figure stands alone. */
export const NONE = '—';

/** Whole dollars, or null when the figure would print as zero (the one dust floor, `shownUsd`). */
export const usdOrNull = (v: number): string | null => (shownUsd(v) ? fmtUSD(v) : null);
/** Bitcoin to three places, or null under the display floor (`shownBtc`) — never "₿0.000". */
export const btcOrNull = (v: number): string | null => (shownBtc(v) ? `₿${v.toFixed(3)}` : null);
/** Years of funded spending to one place, or null when it would print "0.0". */
export const yearsOrNull = (v: number | null): string | null =>
  (v !== null && Number.isFinite(v) && v >= 0.05 ? `${v.toFixed(1)} years` : null);
/** A rate a year — rates aren't amounts, so 0.0% and below print as they are (a true minus sign). */
export const rateText = (g: number): string => `${g < 0 ? '−' : ''}${Math.abs(g * 100).toFixed(1)}%`;

/** Today's dollars: a row's nominal figure ÷ its inflation step (F8). */
export const todayUsd = (nominalUsd: number, inflationStep: number): number => nominalUsd / inflationStep;

// ── the inputs: the facts the face reads, the engine's inputs, the run ────────────────────────────────────────────

/** What the face reads from the store, as primitives (the parents' sums). */
export interface FireFacts {
  /** ₿ held: Strike + Coinbase + cold — the four faces' reads. */
  openingBtc: number;
  /** The cold reserve inside `openingBtc` — for the words. */
  coldBtc: number;
  /** What is owed: Coinbase's accrued balance + Strike's. */
  openingDebtUsd: number;
  /** The plan's own, a month. */
  incomeUsd: number;
  expensesUsd: number;
  /** The store's `inflationRate`, a percent — Living's input too. */
  inflationPct: number;
}

/** ₿ yours at a price: the four faces' one definition, three arguments — the engine's month 0 already holds cold. */
export function yoursAt(f: Pick<FireFacts, 'openingBtc' | 'openingDebtUsd' | 'coldBtc'>, price: number): number {
  return deriveOwnership(f.openingBtc, f.openingDebtUsd, price).yoursBtc;
}

/** The engine's inputs without the position, which is netted at the displayed path's month 0 (`fireInputsAt`). */
export interface FireEngine {
  facts: FireFacts;
  base: Omit<FireInputs, 'btc'>;
}

/** The spending the engine draws, a month: the retirement spending (the plan's expenses unless typed) with the buffer. */
export function spendWithBuffer(fi: FireFaceInputs, expensesUsd: number): number {
  return (fi.spendUsd ?? expensesUsd) * (1 + fi.bufferPct / 100);
}

/** The engine's inputs from the facts and the face's own inputs — no price in them, so a stress never rebuilds them. */
export function fireEngineOf(facts: FireFacts, fi: FireFaceInputs): FireEngine {
  const returnPct = fi.otherReturnPct ?? facts.inflationPct;   // follows inflation unless typed: 0% real
  return {
    facts,
    base: {
      otherUsd: fi.otherUsd,
      savingsUsd: facts.incomeUsd - facts.expensesUsd,   // signed: a gap is drawn like a withdrawal (3b)
      spendUsd: spendWithBuffer(fi, facts.expensesUsd),
      retirementIncomeUsd: fi.retirementIncomeUsd,
      stopMonth: fi.stopChoice === 'atFi' ? 'atFi' : fi.stopChoice === 'now' ? 0 : fi.stopYears * 12,
      inflation: facts.inflationPct / 100,
      otherMonthlyFactor: Math.pow(1 + returnPct / 100, 1 / 12),
      wBtc: fi.wBtcPct / 100,
      wOther: fi.wOtherPct / 100,
      taxRate: fireTaxRateOf(fi),
      basisUsdPerBtc: fi.basisUsdPerBtc,
    },
  };
}

/** The engine's inputs on one path: the position netted at its month 0. */
export function fireInputsAt(engine: FireEngine, path: readonly number[]): FireInputs {
  return { ...engine.base, btc: yoursAt(engine.facts, path[0] ?? 0) };
}

/** The face's run on its displayed path: the timeline and the break-even (which holds its own stop). */
export interface FireRun { x: FireInputs; result: FireResult; breakEven: FireBreakEven }
export function fireRunOf(engine: FireEngine, path: readonly number[]): FireRun {
  const x = fireInputsAt(engine, path);
  return { x, result: fireTimeline(x, path), breakEven: breakEvenGrowth(x, path) };
}

// ── the replays: run from the held stop; the lowest capacity, all three or none ──────────────────────────────────

export type FireCycleId = '2013' | '2017' | '2021';
/** One cycle's replayed path — structurally fireReplays.ts's output, so this module never imports the belief leaf. */
export interface ReplayPathReading { id: FireCycleId; path: number[] | null; reason: null | 'noPeak' | 'gap' }

export interface ReplayRun {
  id: FireCycleId;
  reason: null | 'noPeak' | 'gap';
  lasts: boolean;
  runOutMonth: number | null;
  capacity: FireCapacity | null;
}

/** Each replay, run from the face's stop month — HELD, passed as that number, never re-resolved on the replay. */
export function replayRunsOf(x: FireInputs, stop: number, readings: readonly ReplayPathReading[]): ReplayRun[] {
  const held: FireInputs = { ...x, stopMonth: stop };
  return readings.map((r): ReplayRun => {
    if (r.path === null) return { id: r.id, reason: r.reason ?? 'gap', lasts: false, runOutMonth: null, capacity: null };
    const t = fireTimeline(held, r.path);
    return { id: r.id, reason: null, lasts: t.lasts, runOutMonth: t.runOutMonth, capacity: withdrawalCapacity(held, r.path) };
  });
}

/** Where the price history stands for this visit. */
export type HistoryState = 'loading' | 'failed' | 'offline' | 'ready';
/** `online` is the browser's word (false only when it knows) — iOS standalone apps keep it true, so "didn't load". */
export function historyStateOf(h: { loading: boolean; error: string | null; online: boolean }): HistoryState {
  if (h.error !== null) return h.online ? 'failed' : 'offline';
  return h.loading ? 'loading' : 'ready';
}

export type CapacityReading =
  | { kind: 'shown'; usd: number; atLeast: boolean; harshest: FireCycleId }
  | { kind: 'none'; why: 'loading' | 'failed' | 'offline' | 'missing' | 'noStop' | 'stopBeyond' | 'whileWorking' | 'noSpending' | 'invalid'; missing?: FireCycleId };

/**
 * The capacity the face shows: the LOWEST of the three replays', only when all three replayed — a missing cycle could be
 * the harshest. In the owner's own spending: the engine searches the buffered spending, so its figure ÷ (1 + b ÷ 100),
 * "at least" included, and the buffer stays on top.
 * 🔴 The stop first, as the replays card reads it: with no stop month inside the horizon, or a working gap that runs out
 *    first, there is nothing to replay whatever the history — and the face then hands an EMPTY `runs`, which must never
 *    read as a cycle that couldn't be replayed.
 */
export function capacityOf(
  r: Pick<FireResult, 'valid' | 'stopMonth' | 'stopInHorizon' | 'runsOutWhileWorking'>,
  runs: readonly ReplayRun[], state: HistoryState, bufferPct: number,
): CapacityReading {
  if (!r.valid) return { kind: 'none', why: 'invalid' };
  if (r.stopMonth === null) return { kind: 'none', why: 'noStop' };
  if (!r.stopInHorizon) return { kind: 'none', why: 'stopBeyond' };
  if (r.runsOutWhileWorking) return { kind: 'none', why: 'whileWorking' };
  if (state !== 'ready') return { kind: 'none', why: state };
  const missing = runs.find((r) => r.reason !== null);
  if (missing || runs.length === 0) return { kind: 'none', why: 'missing', missing: missing?.id };
  const caps = runs.map((r) => r.capacity);
  const first = caps.find((c) => c === null || c.capacityUsd === null);
  if (first !== undefined) {
    const reason = first?.reason ?? 'invalid';
    return {
      kind: 'none',
      why: reason === 'runsOutWhileWorking' ? 'whileWorking' : reason === 'noStopMonth' ? 'noStop'
        : reason === 'stopBeyondHorizon' ? 'stopBeyond' : reason === 'noSpending' ? 'noSpending' : 'invalid',
    };
  }
  let low = 0;
  for (let i = 1; i < runs.length; i++) if ((caps[i]!.capacityUsd as number) < (caps[low]!.capacityUsd as number)) low = i;
  const c = caps[low]!;
  return { kind: 'shown', usd: (c.capacityUsd as number) / (1 + bufferPct / 100), atLeast: c.hiBinds, harshest: runs[low].id };
}

// ── the words ────────────────────────────────────────────────────────────────────────────────────────────────────

export const FIRE_TITLE = 'FIRE';
export const FIRE_FRAMING = 'How many years of spending your bitcoin covers if you sell it to live, on the price path you pick.';

/** The path's name, with the band's label handed in as data (this module imports no belief). */
export function firePathName(p: { label: string; onTheLine: boolean; revertMonths: number }): string {
  const yrs = p.revertMonths / 12;
  return p.onTheLine ? `${p.label}, on the line` : `${p.label}, reverting over ${Number.isInteger(yrs) ? yrs : yrs.toFixed(1)} yr`;
}

/** The head every figure sits under: the path and its span. */
export function firePathHead(pathName: string, startISO: string, months: number): string {
  return `On ${pathName} · ${fireMonthYear(startISO, 0)} – ${fireMonthYear(startISO, Math.max(0, months - 1))}`;
}

/** "through Sep 2046" — the horizon's last month, never "all 20 years". */
export const lastMonthOf = (startISO: string, months: number): string => fireMonthYear(startISO, Math.max(0, months - 1));

export const UNDERWATER_LINE =
  'Your loans are more than your bitcoin is worth at this price: this starts you with no bitcoin of your own, the excess '
  + 'repaid from your other assets.';

/** The position today, in words — the underwater line when the loans outweigh the coins. */
export function firePositionLine(f: FireFacts, price: number, uncoveredDebtUsd: number): string[] {
  const yours = yoursAt(f, price);
  if (yours < 0) {
    const left = usdOrNull(uncoveredDebtUsd);
    return left === null ? [UNDERWATER_LINE] : [UNDERWATER_LINE, `${left} of it is more than they cover — left out of every figure here.`];
  }
  const held = btcOrNull(f.openingBtc);
  if (held === null) return ['Today you hold no bitcoin — the ₿ owned line starts when your savings buy some.'];
  const owed = usdOrNull(f.openingDebtUsd);
  const cold = btcOrNull(f.coldBtc);
  const at = usdOrNull(price);
  const heldWords = `Today: ${held} held${cold === null ? '' : ` (${cold} of it in cold storage)`}`;
  const mine = btcOrNull(yours);
  if (owed === null) return [`${heldWords}, nothing owed${at === null ? '' : `, at ${at}`}.`];
  return [`${heldWords}, ${owed} owed — ${mine === null ? 'no bitcoin' : mine} of your own${at === null ? '' : ` at ${at}`}.`];
}

export interface FireTile { key: string; label: string; value: string; sub: string; tone: 'plain' | 'good' | 'bad' }

const stopWords = (fi: FireFaceInputs): string =>
  (fi.stopChoice === 'atFi' ? 'at FI' : fi.stopChoice === 'now' ? 'now' : `in ${fi.stopYears} year${fi.stopYears === 1 ? '' : 's'}`);

/** The six tiles, in their order. */
export function fireTiles(a: {
  run: FireRun; fi: FireFaceInputs; startISO: string; capacity: CapacityReading;
}): FireTile[] {
  const { run, fi, startISO, capacity } = a;
  const r = run.result, x = run.x;
  const n = r.months;
  const end = lastMonthOf(startISO, n);
  const row0 = r.rows[0];
  if (!r.valid || !row0) {
    const why = invalidWords(r.invalidReason);
    return ['years', 'need', 'fi', 'lasts', 'capacity', 'breakEven'].map((key) => ({
      key, label: TILE_LABEL[key as keyof typeof TILE_LABEL], value: NONE, sub: why, tone: 'plain' as const,
    }));
  }
  const nothingFunded = r.fundedUsd <= 0;
  const noSpending = !(x.spendUsd > 0);

  // 1 · years of funded spending today
  const yf = yearsOrNull(row0.yearsFunded);
  const fundedYear = usdOrNull(r.fundedUsd * 12);
  const years: FireTile = {
    key: 'years', label: TILE_LABEL.years, tone: 'plain',
    value: yf ?? NONE,
    sub: noSpending ? NO_SPENDING_TILE
      : nothingFunded ? COVERED_TILE
        : yf === null ? (row0.yearsFunded !== null && row0.yearsFunded > 0 ? LESS_THAN_A_MONTH : NOTHING_OWNED)
          : `Your coins after the tax a sale would owe, and your other assets, ÷ ${fundedYear ?? 'a year\'s funded spending'} a year.`,
  };

  // 2 · you'd need
  const needUsd = usdOrNull(row0.needUsd);
  const tradYears = fireTargets(1, 0, x.wBtc, x.wOther)?.traditionalYears ?? null;
  const sameRates = row0.needYears !== null && tradYears !== null && row0.needYears === tradYears;
  const needBtc = btcOrNull(row0.needBtc);
  const coinsWords = needBtc !== null ? `${needBtc} at today's price, beside your other assets`
    : row0.otherCoverNeed ? 'your other assets cover it — no bitcoin needed' : null;
  const yrs = (v: number | null) => (v === null ? '' : `${Number.isInteger(v) ? v : v.toFixed(1)} years of funded spending`);
  const needSub = nothingFunded || needUsd === null ? 'Nothing to fund, so nothing needed.'
    : sameRates
      ? `${yrs(row0.needYears)} at ${pctOf(x.wOther)}${coinsWords ? ` · ${coinsWords}` : ''}.`
      : `BTC-adjusted at ${pctOf(x.wBtc)} / ${pctOf(x.wOther)}: ${yrs(row0.needYears)}${usdOrNull(row0.needTraditionalUsd) ? ` · ${usdOrNull(row0.needTraditionalUsd)} at ${pctOf(x.wOther)} for all` : ''}${coinsWords ? ` · ${coinsWords}` : ''}.`;
  const need: FireTile = { key: 'need', label: TILE_LABEL.need, value: needUsd ?? NONE, sub: needSub, tone: 'plain' };

  // 3 · FI, on this path (read on the keep-working path — 3f)
  const working = fi.stopChoice === 'atFi' ? 'working until then' : 'if you worked until then';
  const fiTile: FireTile = r.fiMonth === null
    ? { key: 'fi', label: TILE_LABEL.fi, value: `Not by ${end}`, sub: 'The need isn\'t met within this horizon.', tone: 'plain' }
    : r.fiMonth === 0
      ? { key: 'fi', label: TILE_LABEL.fi, value: 'Now', sub: nothingFunded ? 'Nothing to fund.' : 'Your savings already meet the need.', tone: 'good' }
      : { key: 'fi', label: TILE_LABEL.fi, value: fireMonthYear(startISO, r.fiMonth), sub: `${(r.fiMonth / 12).toFixed(1)} years away, ${working}.`, tone: 'plain' };

  // 4 · what lasts from the stop, on this path
  let lastsTile: FireTile;
  if (r.runsOutWhileWorking && r.runOutMonth !== null) {
    lastsTile = { key: 'lasts', label: TILE_LABEL.lasts, value: `Runs out ${fireMonthYear(startISO, r.runOutMonth)}`, sub: 'Before you stop — your savings gap draws it down.', tone: 'bad' };
  } else if (r.stopMonth === null) {
    lastsTile = { key: 'lasts', label: TILE_LABEL.lasts, value: NONE, sub: `No stop month: FI doesn't come by ${end}.`, tone: 'plain' };
  } else if (!r.stopInHorizon) {
    lastsTile = { key: 'lasts', label: TILE_LABEL.lasts, value: NONE, sub: `You'd stop in ${fireMonthYear(startISO, r.stopMonth)}, after this horizon ends.`, tone: 'plain' };
  } else {
    const sub = `You stop: ${fireMonthYear(startISO, r.stopMonth)} (${stopWords(fi)}).`;
    lastsTile = r.lasts
      ? { key: 'lasts', label: TILE_LABEL.lasts, value: `Lasts through ${end}`, sub, tone: 'good' }
      : { key: 'lasts', label: TILE_LABEL.lasts, value: `Runs out ${fireMonthYear(startISO, r.runOutMonth as number)}`, sub, tone: 'bad' };
  }

  // 5 · the capacity — the lowest replay's, in the owner's own spending
  const capTile: FireTile = { key: 'capacity', label: TILE_LABEL.capacity, ...capacityTileWords(capacity, end, fi.bufferPct) };

  // 6 · the break-even
  const be = run.breakEven;
  let beTile: FireTile;
  if (be.reason === null && be.atFloor) {
    beTile = { key: 'breakEven', label: TILE_LABEL.breakEven, value: `${rateText(BREAK_EVEN_BRACKET[0])} or lower`, sub: `It lasts through ${end} even if bitcoin falls ${Math.abs(BREAK_EVEN_BRACKET[0] * 100)}% a year, steadily — the lowest growth the search tries.`, tone: 'plain' };
  } else if (be.reason === null && be.yearlyGrowth !== null) {
    beTile = { key: 'breakEven', label: TILE_LABEL.breakEven, value: `${rateText(be.yearlyGrowth)} a year`, sub: `It lasts through ${end} if bitcoin grows at least this much a year, steadily.`, tone: 'plain' };
  } else if (be.reason === 'nothingLasts') {
    beTile = { key: 'breakEven', label: TILE_LABEL.breakEven, value: `None up to ${rateText(BREAK_EVEN_BRACKET[1])}`, sub: `Even ${rateText(BREAK_EVEN_BRACKET[1])} a year, steadily, doesn't last through ${end}.`, tone: 'bad' };
  } else {
    beTile = { key: 'breakEven', label: TILE_LABEL.breakEven, value: NONE, sub: be.reason === 'noStopMonth' ? 'No stop month to test from.' : be.reason === 'stopBeyondHorizon' ? 'You stop after this horizon ends.' : invalidWords(null), tone: 'plain' };
  }
  return [years, need, fiTile, lastsTile, capTile, beTile];
}

export const TILE_LABEL = {
  years: 'Years of spending funded today',
  need: 'You\'d need',
  fi: 'FI, on this path',
  lasts: 'From your stop, on this path',
  capacity: 'Spending that lasts every replay',
  breakEven: 'Break-even growth',
} as const;

const NO_SPENDING_TILE = 'No spending to fund.';
/** Years funded that print as "—": nothing owned at all, or a little — under the 0.05-year floor, about 18 days. */
export const NOTHING_OWNED = 'No bitcoin of your own and no other assets to fund it.';
export const LESS_THAN_A_MONTH = 'Less than a month of spending funded.';
const COVERED_TILE = 'Retirement income covers your spending — nothing to fund.';
const pctOf = (w: number): string => `${Number((w * 100).toFixed(2))}%`;

function invalidWords(reason: FireResult['invalidReason']): string {
  if (reason === 'price') return 'No bitcoin price to use yet.';
  if (reason === 'path') return 'This path has no months.';
  return 'These inputs can\'t be read — check the Assumptions.';
}

/** The capacity's value and sub-line, for the tile. */
function capacityTileWords(c: CapacityReading, end: string, bufferPct: number): { value: string; sub: string; tone: FireTile['tone'] } {
  if (c.kind === 'shown') {
    const usd = usdOrNull(c.usd);
    const buffer = bufferPct > 0 ? ` Your ${Number(bufferPct.toFixed(1))}% buffer is kept on top.` : '';
    if (usd === null) return { value: NONE, sub: `No spending lasts every replay through ${end}.${buffer}`, tone: 'bad' };
    return {
      value: c.atLeast ? `At least ${usd} a month` : `${usd} a month`,
      sub: `The lowest of the 2013, 2017 and 2021 replays, through ${end}.${buffer}`,
      tone: 'plain',
    };
  }
  return { value: NONE, sub: CAPACITY_NONE[c.why](c.missing), tone: 'plain' };
}

const CAPACITY_NONE: Record<Extract<CapacityReading, { kind: 'none' }>['why'], (missing?: FireCycleId) => string> = {
  loading: () => 'Waiting for the price history.',
  failed: () => 'The price history didn\'t load.',
  offline: () => 'Offline — the replays need the price history.',
  missing: (id) => `The ${id ?? 'one'} bear couldn't be replayed from this history.`,
  noStop: () => 'No stop month to replay from.',
  stopBeyond: () => 'You stop after this horizon ends.',
  whileWorking: () => 'It runs out before you stop working.',
  noSpending: () => 'No spending to test.',
  invalid: () => 'These inputs can\'t be read.',
};

// ── the replays card ─────────────────────────────────────────────────────────────────────────────────────────────

export const REPLAYS_TITLE = 'If a 2013, 2017 or 2021 bear began the day you stopped working';
export const REPLAYS_INFO =
  'Each replay starts at the price on the day you stop working, wherever the cycle is — harsh on purpose. Month by month '
  + 'it follows that cycle\'s fall from its top in the app\'s price history, then the trend from wherever it ended. The '
  + 'history is sampled every 4 days, so its tops and month-ends sit a few days from the daily ones: a replay can read a '
  + 'little milder or a little harsher than on daily prices, and the month it runs out can move by several months.';

export interface ReplaysView { state: string | null; lines: string[]; capacity: string | null; breakEven: string | null }

/** The card's words: the state line when there is nothing to replay, else a line a cycle, the capacity, the break-even. */
export function replaysCard(a: {
  run: FireRun; runs: readonly ReplayRun[]; history: HistoryState; capacity: CapacityReading; startISO: string; bufferPct: number;
}): ReplaysView {
  const r = a.run.result;
  const end = lastMonthOf(a.startISO, r.months);
  const breakEven = breakEvenLine(a.run.breakEven, end);
  if (!r.valid) return { state: invalidWords(r.invalidReason), lines: [], capacity: null, breakEven: null };
  if (r.stopMonth === null) {
    return {
      state: `At FI: on this path FI doesn't come by ${end}, so there's no stop month — nothing to read for what lasts, the `
        + 'replays, the capacity or the break-even. To see them, choose Now or In years, or a longer horizon or another path.',
      lines: [], capacity: null, breakEven: null,
    };
  }
  if (!r.stopInHorizon) {
    return {
      state: `You'd stop in ${fireMonthYear(a.startISO, r.stopMonth)}, after this horizon ends (${end}) — nothing to read from `
        + 'the stop; try a longer horizon.',
      lines: [], capacity: null, breakEven: null,
    };
  }
  if (r.runsOutWhileWorking && r.runOutMonth !== null) {
    return {
      state: `On this path your savings gap runs it out in ${fireMonthYear(a.startISO, r.runOutMonth)}, before you stop working `
        + '— so there\'s nothing for the replays to test.',
      lines: [], capacity: null, breakEven,
    };
  }
  if (a.history === 'loading') return { state: 'Loading the price history — the replays and the capacity need it.', lines: [], capacity: null, breakEven };
  if (a.history === 'failed') return { state: 'The price history didn\'t load, so there are no replays and no capacity this visit.', lines: [], capacity: null, breakEven };
  if (a.history === 'offline') return { state: 'Offline — the replays need the price history, which isn\'t kept on this device.', lines: [], capacity: null, breakEven };
  const lines = a.runs.map((x) => {
    if (x.reason === 'noPeak') return `${x.id}: no top in this price history — not replayed.`;
    if (x.reason === 'gap') return `${x.id}: a gap in the price history after its top — not replayed.`;
    return x.lasts || x.runOutMonth === null ? `${x.id} bear: lasts through ${end}.` : `${x.id} bear: runs out in ${fireMonthYear(a.startISO, x.runOutMonth)}.`;
  });
  return { state: null, lines, capacity: capacityLine(a.capacity, a.bufferPct), breakEven };
}

function capacityLine(c: CapacityReading, bufferPct: number): string {
  const buffer = bufferPct > 0 ? ` Your ${Number(bufferPct.toFixed(1))}% buffer is kept on top.` : '';
  if (c.kind === 'shown') {
    const usd = usdOrNull(c.usd);
    if (usd === null) return `No spending lasts all three replays.${buffer}`;
    return c.atLeast
      ? `Spending that lasts all three: at least ${usd} a month (today's dollars) — twice your spending still lasts.${buffer}`
      : `Spending that lasts all three: ${usd} a month (today's dollars) — the ${c.harshest} bear is the harshest.${buffer}`;
  }
  if (c.why === 'missing') return `No capacity: the ${c.missing ?? 'one'} bear couldn't be replayed, and it might be the harshest.`;
  return `No capacity: ${CAPACITY_NONE[c.why]().replace(/^./, (s) => s.toLowerCase())}`;
}

/** The break-even in a sentence — the yardstick, never a path (R3). */
export function breakEvenLine(be: FireBreakEven, end: string): string | null {
  if (be.reason === null && be.atFloor) {
    return `It lasts through ${end} even if bitcoin falls ${Math.abs(BREAK_EVEN_BRACKET[0] * 100)}% a year, steadily — the lowest growth the search tries.`;
  }
  if (be.reason === null && be.yearlyGrowth !== null) {
    return `On this path it lasts through ${end} as long as bitcoin grows at least ${rateText(be.yearlyGrowth)} a year, steadily.`;
  }
  if (be.reason === 'nothingLasts') return `Even ${rateText(BREAK_EVEN_BRACKET[1])} a year, steadily, doesn't last through ${end}.`;
  return null;
}

// ── the chart ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CHART_TITLE = '₿ you own and ₿ you\'d need';
export const CHART_OWNED = '₿ owned, selling';
export const CHART_NEEDED = '₿ needed';
export const CHART_EMPTY = 'Nothing to draw on this path.';
export const CHART_GAP_NOTE =
  'Where a line breaks there is nothing to draw: no bitcoin owned, or none needed because your other assets cover the need.';

export interface FirePoint {
  m: number;
  label: string;
  /** null = a gap, never 0 — a zero would draw to the floor of the log axis. */
  owned: number | null;
  needed: number | null;
  /** The tooltip's other lines, today's dollars. */
  portfolio: string;
  price: string;
}

/** One point a month; a value under the display floor is a gap (the Decision chart's rule). */
export function fireChartPoints(r: FireResult, startISO: string): FirePoint[] {
  return r.rows.map((row) => ({
    m: row.m,
    label: fireMonthYear(startISO, row.m),
    owned: shownBtc(row.btc) ? row.btc : null,
    needed: shownBtc(row.needBtc) ? row.needBtc : null,
    portfolio: usdOrNull(todayUsd(row.portfolioUsd, row.inflationStep)) ?? NONE,
    price: usdOrNull(todayUsd(row.priceUsd, row.inflationStep)) ?? NONE,
  }));
}

/** The log axis's domain: every plotted value, 20% below the lowest and 25% above the highest; null with nothing to draw. */
export function fireChartDomain(points: readonly FirePoint[]): [number, number] | null {
  let lo = Number.POSITIVE_INFINITY, hi = 0;
  for (const p of points) {
    for (const v of [p.owned, p.needed]) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) && hi > 0 ? [lo * 0.8, hi * 1.25] : null;
}

/** True when either line has a gap inside the horizon — the gap note shows. */
export const chartHasGap = (points: readonly FirePoint[]): boolean => points.some((p) => p.owned === null || p.needed === null);

/** The tooltip's lines for one point — "—" for a zero. */
export function fireTooltipLines(p: FirePoint): { name: string; value: string }[] {
  return [
    { name: CHART_OWNED, value: p.owned === null ? NONE : `₿${p.owned.toFixed(3)}` },
    { name: CHART_NEEDED, value: p.needed === null ? NONE : `₿${p.needed.toFixed(3)}` },
    { name: 'Portfolio, today\'s dollars', value: p.portfolio },
    { name: 'Price, today\'s dollars', value: p.price },
  ];
}

/** The stop month's marker on the chart. */
export const stopMarkerLabel = (stop: number | null, months: number): string | null => (stop !== null && stop < months ? 'Stop' : null);

/** The time axis: a tick every few years, from month 0 — at most seven. */
export function fireYearTicks(months: number): number[] {
  const n = Math.max(0, Math.floor(months));
  const step = 12 * Math.max(1, Math.ceil(n / 12 / 6));
  const out: number[] = [];
  for (let m = 0; m < n; m += step) out.push(m);
  return out;
}
/** A time tick's label: the month's year. */
export const fireYearTick = (startISO: string, m: number): string => fireMonthYear(startISO, m).slice(4);
/** A ₿ tick's label, abbreviated (`.claude/rules/charts.md`): two significant digits. */
export const fireBtcTick = (v: number): string => (v >= 100 ? v.toFixed(0) : String(Number(v.toPrecision(2))));

// ── under the chart: the inspected month, the anchor, the stress, today's dollars ────────────────────────────────

/** The inspected month on this path, in words — no zero stated. */
export function inspectedLine(r: FireResult, monthIdx: number, startISO: string): string | null {
  const row = r.rows[monthIdx];
  if (!row) return null;
  const owned = btcOrNull(row.btc);
  const needed = btcOrNull(row.needBtc);
  const yf = yearsOrNull(row.yearsFunded);
  const parts = [
    owned === null ? 'no bitcoin of your own' : `${owned} owned`,
    needed === null ? 'no bitcoin needed' : `${needed} needed`,
    ...(yf === null ? [] : [`${yf} of spending funded`]),
  ];
  return `${fireMonthYear(startISO, monthIdx)} on this path: ${parts.join(' · ')}.`;
}

/** The held anchor beside spot, while a stress holds it. */
export function anchoredLine(anchorPrice: number, livePrice: number, drift: number, held: boolean): string | null {
  if (!held) return null;
  const a = usdOrNull(anchorPrice), l = usdOrNull(livePrice);
  if (a === null || l === null) return null;
  return `Anchored ${a} · spot ${l} ${drift >= 0 ? '+' : '−'}${Math.abs(drift * 100).toFixed(1)}%`;
}

/** The stress in a line: "Price −30% from Oct 2027 on." — null at 1×. */
export function stressLine(lens: number, monthIdx: number, startISO: string): string | null {
  if (lens === 1) return null;
  return `Price ${lens > 1 ? '+' : '−'}${Math.abs((lens - 1) * 100).toFixed(0)}% from ${fireMonthYear(startISO, monthIdx)} on.`;
}

/** Said once on the face (F8). */
export const dollarsNote = (inflationPct: number): string =>
  `Dollars here are today's: each month's figure ÷ inflation since today (${Number(inflationPct.toFixed(2))}% a year, stepped yearly).`;

// ── the "Stop working" card ──────────────────────────────────────────────────────────────────────────────────────

export const STOP_CARD = {
  title: 'Stop working',
  choices: [
    { key: 'atFi', label: 'At FI' },
    { key: 'now', label: 'Now' },
    { key: 'years', label: 'In years' },
  ],
  years: 'Years from now',
  spend: 'Spending in retirement, a month',
  assumptions: 'Assumptions',
  otherUsd: 'Other investable assets',
  retirementIncome: 'Retirement income, a month',
  retirementIncomeHint: 'From the day you stop; a pension that starts later reads as starting then.',
  buffer: 'Spending buffer, %',
  bufferHint: 'Added on top of the spending.',
  wBtc: 'Withdrawal rate — bitcoin, % a year',
  wOther: 'Withdrawal rate — other assets, % a year',
  ratesHint: '4% for both until you type a bitcoin rate; the break-even shows what a higher one assumes.',
  otherReturn: 'Other assets\' return, % a year',
  otherReturnHint: 'Follows inflation until you type one: no growth beyond it.',
  tax: 'Tax on what you sell, % of the gain',
  taxHint: `Living's ${FIRE_TAX_PCT_DEFAULT}% until you type one.`,
  basis: 'Your average cost, $ a coin',
  basisHint: '0 uses the price today: no gain is taxed on the coins you hold now — if you bought lower, type your cost.',
  inflation: 'Inflation, % a year',
  inflationHint: 'The Living tab uses this too.',
  reset: 'Reset to defaults',
  resetHint: 'Your inputs here go back to their defaults; inflation is shared with the Living tab and stays.',
  device: 'These inputs stay on this device: they don\'t sync and aren\'t in a backup — a restore won\'t bring them back, '
    + 'and "Reset local data & re-sync" clears them.',
} as const;

/** The spending field's hint: it follows the plan's expenses until typed. */
export function spendHint(expensesUsd: number, typed: boolean): string {
  if (typed) return 'Your own figure — the plan\'s expenses no longer set it.';
  const e = usdOrNull(expensesUsd);
  return e === null ? 'Follows your plan\'s monthly expenses until you type one.' : `Follows your plan's monthly expenses (${e}) until you type one.`;
}

// ── the scale card (F2: years of funded spending, no names) ──────────────────────────────────────────────────────

export const SCALE_TITLE = 'Years of spending funded';
export const SCALE_NONE = 'Nothing to fund, so there is no scale to read.';
export interface FireScaleView {
  max: number;
  you: { at: number; label: string } | null;
  marks: { at: number; label: string }[];
  ariaLabel: string;
  caption: string;
}

/** You-are-here and the need's mark — one at equal rates, two once a bitcoin rate is typed. Null with nothing funded. */
export function fireScale(run: FireRun): FireScaleView | null {
  const row0 = run.result.rows[0];
  if (!run.result.valid || !row0 || row0.needYears === null) return null;
  const x = run.x;
  const trad = fireTargets(1, 0, x.wBtc, x.wOther)?.traditionalYears ?? null;
  if (trad === null) return null;
  const btcAdj = row0.needYears;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const marks = btcAdj === trad
    ? [{ at: trad, label: `The need: ${fmt(trad)} years at ${pctOf(x.wOther)}` }]
    : [
      { at: btcAdj, label: `BTC-adjusted: ${fmt(btcAdj)} years at ${pctOf(x.wBtc)} / ${pctOf(x.wOther)}` },
      { at: trad, label: `At ${pctOf(x.wOther)} for all: ${fmt(trad)} years` },
    ];
  const yf = yearsOrNull(row0.yearsFunded);
  const you = yf === null ? null : { at: row0.yearsFunded as number, label: `You: ${yf}` };
  const max = Math.max(...marks.map((m) => m.at), you?.at ?? 0) * 1.2;
  const none = row0.yearsFunded !== null && row0.yearsFunded > 0 ? 'You: less than a month' : 'You: nothing funded yet';
  const caption = [you?.label ?? none, ...marks.map((m) => m.label)].join(' · ');
  return { max, you, marks, ariaLabel: `${SCALE_TITLE}. ${caption}.`, caption };
}

// ── the Milestones ───────────────────────────────────────────────────────────────────────────────────────────────

/** The table's columns less Year, in its order — the face's literal headers, which milestones.test reads. */
export const MS_COLS_FIRE = ['Price', '₿ owned', 'Other assets', 'Portfolio', 'Years funded', '₿ needed'] as const;
/** The switch table's views: a partition of the table's columns less Year, in the table's order. */
export const MS_VIEWS_FIRE: readonly MsView[] = [
  { key: 'btc', name: '₿', label: 'Bitcoin', cols: ['₿ owned', '₿ needed'] },
  { key: 'usd', name: '$', label: 'Dollars', cols: ['Price', 'Other assets', 'Portfolio'] },
  { key: 'years', name: 'Years', label: 'Years of spending funded', cols: ['Years funded'] },
];
export const MS_LABEL = 'Milestones';
export const MS_SWITCH_LABEL = 'Milestones figures';
export const MS_YEAR_HEAD = 'Year';

/** The rows: every 12th month strictly below the horizon, its last month, and the stop, FI and run-out months, flagged. */
export function fireMilestoneMonths(r: FireResult): number[] {
  const n = r.rows.length;   // the rows, not `months`: a refused run reports its path's length with no rows
  const set = new Set<number>();
  for (let m = 12; m < n; m += 12) set.add(m);
  if (n > 0) set.add(n - 1);
  for (const e of [r.stopMonth, r.fiMonth, r.runOutMonth]) if (e !== null && e >= 0 && e < n) set.add(e);
  return [...set].sort((a, b) => a - b);
}

/** One cell and one row — structurally MilestoneSwitchTable's, so this module imports no component. */
export interface FireMsCell { label: string; value: string; color?: string }
export interface FireMsRow { month: number; year: string; flags: { text: string }[]; turn: string | null; cells: FireMsCell[]; post: boolean }

/** A row's six cells — today's dollars, "—" for a zero. */
export function fireMilestoneCells(r: FireResult, m: number): FireMsCell[] {
  const row = r.rows[m];
  const d = (v: number) => usdOrNull(todayUsd(v, row.inflationStep)) ?? NONE;
  return [
    { label: 'Price', value: d(row.priceUsd) },
    { label: '₿ owned', value: btcOrNull(row.btc) ?? NONE, color: 'var(--btc)' },
    { label: 'Other assets', value: d(row.otherUsd) },
    { label: 'Portfolio', value: d(row.portfolioUsd) },
    { label: 'Years funded', value: yearsOrNull(row.yearsFunded)?.replace(' years', '') ?? NONE },
    { label: '₿ needed', value: btcOrNull(row.needBtc) ?? NONE },
  ];
}

/** The Milestones rows, for the table and the switch table alike. */
export function fireMilestoneRows(r: FireResult, startISO: string): FireMsRow[] {
  return fireMilestoneMonths(r).map((m) => {
    const flags = [
      ...(r.stopMonth === m && r.stopInHorizon ? [{ text: 'stop' }] : []),
      ...(r.fiMonth === m ? [{ text: 'FI' }] : []),
      ...(r.runOutMonth === m ? [{ text: 'runs out' }] : []),
    ];
    return {
      month: m,
      year: msYearLabel(m),
      flags,
      turn: flags.length > 0 ? fireMonthYear(startISO, m) : null,
      cells: fireMilestoneCells(r, m),
      post: r.rows[m].phase === 'depleted',
    };
  });
}

// ── the model card, the credits, the disclaimer ─────────────────────────────────────────────────────────────────

export const MODEL_TITLE = 'How this works';
export const MODEL_LIMITS_TITLE = 'What it leaves out';
export const REPLAYS_INFO_LABEL = 'About the replays';

/** The dock's own words: its panels' labels and readouts. */
export const DOCK_WORDS = {
  month: 'Inspect month',
  stress: 'Price stress',
  stressAria: 'Price stress multiplier',
  asModeled: 'as modeled',
  path: 'Price path',
  horizon: 'Horizon',
  onTheLine: 'On the line',
  timing: '4-yr cycle timing',
  minYears: '1 yr',
  maxYears: '20 yr',
} as const;
/** The 4-yr path's name — the bands' come from PL_BAND_LABEL, in the face. */
export const FOUR_YEAR_LABEL = '4-yr cycle';
/** "Back to reverting (4 yr)" — the chip that leaves "on the line". */
export const revertChipLabel = (revertMonths: number): string => `Back to reverting (${horizonDisplay(revertMonths)})`;
/** A span in years: "20 yr", "1.5 yr". */
export function horizonDisplay(months: number): string {
  const y = months / 12;
  return `${Number.isInteger(y) ? y : y.toFixed(1)} yr`;
}
export const MODEL_RULES: readonly string[] = [
  'Funded spending is your spending in retirement less your retirement income, from the month you stop; with a buffer, the buffer is added on top.',
  'The need is a year of funded spending ÷ the withdrawal rate — the BTC-adjusted need weights bitcoin\'s share at its own rate, so at 4% and 4% the two needs are the same.',
  'The scale is years of funded spending: your coins after the tax selling them would owe, plus your other assets, ÷ a year\'s funded spending.',
  'FI is the first whole month your savings meet the need, read as if you kept working; "At FI" stops work that month.',
  'Each month you draw, your other assets grow a month and pay first; bitcoin is sold for the rest.',
  'Each sale pays Living\'s tax on what it gains over your average cost — a pool your savings add to and your sales draw down. Unless you type your own cost, the coins you hold today start at today\'s price.',
  'Inflation steps your spending and the need up once a year; every dollar here is shown in today\'s dollars.',
  'A replay follows a past bear\'s fall from its top, month by month, from the day you stop working, then the trend from wherever it ended.',
  'The break-even is the lowest steady yearly growth that still lasts the horizon — a yardstick for the belief behind a withdrawal rate, never a path.',
];
export const MODEL_LIMITS: readonly string[] = [
  'The tax is on bitcoin sold only — other assets are drawn untaxed.',
  'The loans netted today are repaid untaxed.',
  'Retirement income counts from the month you stop, so a pension or Social Security that starts later reads as starting then.',
  'Retirement income beyond your spending isn\'t invested.',
  'If your loans outweigh your coins, any debt your other assets can\'t cover is left out.',
];
export const MODEL_CREDITS = [
  { text: 'The approach follows FIRE BTC\'s Compass', href: 'https://calc.firebtc.io/' },
  { text: 'Price paths: Giovanni Santostasi\'s log-log power law, as on the Power Law face.', href: null },
] as const;

export const FIRE_DISCLAIMER = {
  lead: 'A pattern, not a forecast.',
  body: 'These are figures on a path you pick, never a recommendation. Not financial advice.',
} as const;
