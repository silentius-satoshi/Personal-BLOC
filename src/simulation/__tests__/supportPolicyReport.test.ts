import { describe, it, expect } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { runCyclingSim, allInEquity, type CyclingInputs, type CyclingResult, type SupportPolicyInputs } from '../cyclingSim';
import { SUPPORT_EPS, type PolicyState } from '../supportPolicy';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';
import {
  SUPPORT, SP_REPRO, CASH_6_USD, policyFor, buildP9, a5Cases, minMultiple, faceWorldGrid, syntheticGrid, reachGrid,
  pathP1, pathP2, CALL_BASE, CALL_PATH, CALL_SUPPORT, type GridCell, stressFrom12, coldRuleRows, COLD_RULE_VARIANTS,
  CRASH_PLAYBOOK_VARIANTS, doubleDropRows,
} from './supportPolicyPaths';
import { ceilingLiquidationMultiple } from '../cbDefense';
import { CB_LLTV } from '../runCoinbaseLoan';

/**
 * A5 MEASUREMENT REPORT GENERATOR (spec v1.2 — committed so the numbers the owner approves are re-runnable in
 * Run 2 and any later review; only the OUTPUT is uncommitted). The normal suite SKIPS it:
 *
 *   SP_REPORT=1 npx vitest run src/simulation/__tests__/supportPolicyReport.test.ts --reporter=verbose
 *
 * prints deterministic markdown between the BEGIN/END markers. ⚠ Keep `--reporter=verbose`: with the default
 * reporter and a non-TTY stdout (a pipe, a file, CI), vitest drops the passing test's console output and the
 * report silently vanishes. The pass/fail GATES live in
 * `cyclingSimPolicy.test.ts`; this file measures and discloses. Its only assertions are FIDELITY checks: the
 * three grids are rebuilt exactly as `cyclingSim.test.ts` builds them, and the policy-OFF arm must reproduce that
 * file's pinned counts — or the grid numbers below describe some other grid; the re-arm table's break / re-arm
 * months must be the engine's own events; and all-in equity must not move when cash only replaces unpaid bills (P7).
 */

// ── formatting (manual, locale-free, so the output is byte-deterministic) ─────────────────────────────────────
const usd = (n: number): string => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const btc = (n: number, dp = 4): string => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(dp)}`;
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '∞');
const mo = (m: number | null): string => (m === null ? '—' : `m${m}`);
const moList = (ms: number[]): string => (ms.length === 0 ? '—' : ms.map((m) => `m${m}`).join(', '));
const ZONE_LETTER: Record<PolicyState, string> = { paused: 'P', accumulate: 'A', hold: 'H', payDown: 'D', broken: 'B' };
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const medianMo = (xs: number[]): string => (xs.length === 0 ? '—' : `m${median(xs)}`);

/** Cold pulled OUT of cold storage in months at or above support — for an OFF run, measured from its rows. */
function coldRetrievedAbove(r: CyclingResult, support: number[]): number {
  let t = 0;
  for (let m = 1; m < r.rows.length; m++) {
    if (r.rows[m].price / support[m] >= 1 - SUPPORT_EPS) t += r.rows[m].coldRetrievedBtc - r.rows[m - 1].coldRetrievedBtc;
  }
  return t;
}
/** Peak LTV at price with its month, through the liquidation row (pre-seizure). */
function peak(r: CyclingResult, key: 'cbLtv' | 'strikeLtv'): { v: number; m: number } {
  const last = r.liqMonth ?? r.rows.length - 1;
  let best = { v: Number.NEGATIVE_INFINITY, m: 0 };
  for (const x of r.rows.slice(0, last + 1)) if (x[key] > best.v) best = { v: x[key], m: x.m };
  return best;
}
const flaggedCallMonths = (r: CyclingResult): number => r.rows.filter((x) => x.strikeLtv >= STRIKE_MARGIN_CALL_LTV).length;
/** The verdict-adjusted equity: a cash cure lowered the debt with money from OUTSIDE the loop (spec §A3). */
const adjEquity = (r: CyclingResult): number => r.last.equity - r.totalCashToCureUsd;
// ALL-IN EQUITY is the engine's `allInEquity` — ONE definition, shared with the faces' verdict: money from outside the
// loop is never a gain, and a bill nobody paid is never free. equity − unpaid bills − cash spent on bills − cash spent
// on cures. The OFF arm holds no reserve, so its last two terms are 0.
const insideBoth = (r: CyclingResult): boolean =>
  (r.rows[0].cbCeilingHeadroomUsd ?? -1) >= 0 && (r.rows[0].strikeCeilingHeadroomUsd ?? -1) >= 0;
/** Break and re-arm months, read off the zone strip (row 0 is the opening and is never 'broken'). */
function breakerEvents(r: CyclingResult): { breaks: number[]; rearms: number[] } {
  const breaks: number[] = [];
  const rearms: number[] = [];
  for (let m = 1; m < r.rows.length; m++) {
    const was = r.rows[m - 1].policyZone === 'broken';
    const is = r.rows[m].policyZone === 'broken';
    if (is && !was) breaks.push(m);
    if (was && !is) rearms.push(m);
  }
  return { breaks, rearms };
}

/** The opt-in breaker re-arm settings measured (null = latched, the shipped behaviour). No default is chosen here. */
const REARMS = [null, 3, 6, 12] as const;
type Rearm = (typeof REARMS)[number];
const rearmLabel = (n: Rearm): string => (n === null ? 'latched' : `${n}`);
const withPolicy = (c: CyclingInputs, o: Partial<SupportPolicyInputs>): CyclingInputs =>
  ({ ...c, supportPolicy: { ...c.supportPolicy!, ...o } });

// ── the existing grids live in supportPolicyPaths.ts (rebuilt EXACTLY as cyclingSim.test.ts builds them; the
// fidelity asserts below prove it) — shared with the faces' exhaustive neverDraws test.

/** One re-arm setting across a grid. Scalars only — keeping every cell's full result would hold ~1M rows. */
interface RearmTally {
  broken: number; firstBreaks: number[]; rearmed: number; firstRearms: number[]; breaks: number;
  liq: number; liqMonths: number[]; held: number[]; debt: number[]; allIn: number[];
  unfundedSum: number; unfundedCells: number; peakCb: number[]; g2Violations: number; g3OnLiq: number;
}
const newRearmTally = (): RearmTally => ({
  broken: 0, firstBreaks: [], rearmed: 0, firstRearms: [], breaks: 0, liq: 0, liqMonths: [], held: [], debt: [],
  allIn: [], unfundedSum: 0, unfundedCells: 0, peakCb: [], g2Violations: 0, g3OnLiq: 0,
});
function noteRearm(t: RearmTally, r: CyclingResult, inside: boolean, inScope: boolean): void {
  if (r.modelBrokenMonth !== null) { t.broken++; t.firstBreaks.push(r.modelBrokenMonth); }
  if (r.firstRearmMonth !== null) { t.rearmed++; t.firstRearms.push(r.firstRearmMonth); }
  t.breaks += r.breakCount;
  if (r.liqMonth !== null) { t.liq++; t.liqMonths.push(r.liqMonth); }
  t.held.push(r.last.btcHeld);
  t.debt.push(r.last.debt);
  t.allIn.push(allInEquity(r));
  t.unfundedSum += r.totalUnfundedUsd;
  if (r.totalUnfundedUsd > 0) t.unfundedCells++;
  t.peakCb.push(peak(r, 'cbLtv').v);
  if (inside && r.coldRetrievedAboveSupportBtc > 0) t.g2Violations++;
  if (inScope && r.liqMonth !== null) t.g3OnLiq++;
}

interface GridTally {
  n: number; offLiq: number; onLiq: number; noSalesLiq: number; offCalls: number; onCalls: number; noSalesCalls: number;
  onSales: number; onSoldBtc: number;
  offColdAboveCells: number; offColdAboveBtc: number; onColdAboveCells: number; onColdAboveBtc: number;
  medianDeltaBtc: number; medianDeltaNoSalesBtc: number; inside: number; g2Violations: number; g3Scope: number;
  g3OnLiq: number; g3OffLiq: number; onAppliedAll: boolean;
  rearm: Map<Rearm, RearmTally>;
}
function tallyGrid(cells: GridCell[]): GridTally {
  const t: GridTally = {
    n: cells.length, offLiq: 0, onLiq: 0, noSalesLiq: 0, offCalls: 0, onCalls: 0, noSalesCalls: 0, onSales: 0, onSoldBtc: 0,
    offColdAboveCells: 0, offColdAboveBtc: 0, onColdAboveCells: 0, onColdAboveBtc: 0,
    medianDeltaBtc: 0, medianDeltaNoSalesBtc: 0, inside: 0, g2Violations: 0, g3Scope: 0, g3OnLiq: 0, g3OffLiq: 0,
    onAppliedAll: true, rearm: new Map(REARMS.map((n) => [n, newRearmTally()])),
  };
  const deltas: number[] = [];
  const deltasNoSales: number[] = [];
  for (const c of cells) {
    const withP = (o: Partial<SupportPolicyInputs> = {}): CyclingInputs => ({ ...c.off, supportPolicy: policyFor(c.support, o) });
    const off = runCyclingSim(c.off);
    const on = runCyclingSim(withP());
    // "ON, sales not modelled": the policy with Strike's call only FLAGGED, like the OFF arm — so ON − OFF isolates
    // the policy from the new sale accounting (v1.3 #17).
    const onNoSales = runCyclingSim(withP({ modelStrikeLiquidation: false }));
    if (!on.policyApplied || !onNoSales.policyApplied) t.onAppliedAll = false;
    if (off.liqMonth !== null) t.offLiq++;
    if (on.liqMonth !== null) t.onLiq++;
    if (onNoSales.liqMonth !== null) t.noSalesLiq++;
    if (off.strikeMarginMonth !== null) t.offCalls++;
    if (on.firstStrikeCallMonth !== null) t.onCalls++;
    if (onNoSales.strikeMarginMonth !== null) t.noSalesCalls++;
    if (on.strikeCallsSold > 0) t.onSales++;
    t.onSoldBtc += on.totalStrikeLiquidatedBtc;
    const offAbove = coldRetrievedAbove(off, c.support);
    if (offAbove > 1e-12) { t.offColdAboveCells++; t.offColdAboveBtc += offAbove; }
    if (on.coldRetrievedAboveSupportBtc > 1e-12) { t.onColdAboveCells++; t.onColdAboveBtc += on.coldRetrievedAboveSupportBtc; }
    deltas.push(on.last.btcHeld - off.last.btcHeld);
    deltasNoSales.push(onNoSales.last.btcHeld - off.last.btcHeld);
    const inside = insideBoth(on);
    const inScope = inside && minMultiple(c.off.pricePath, c.support) >= 0.8 - 1e-9;
    if (inside) {
      t.inside++;
      if (on.coldRetrievedAboveSupportBtc > 0) t.g2Violations++;
      if (inScope) {
        t.g3Scope++;
        if (on.liqMonth !== null) t.g3OnLiq++;
        if (off.liqMonth !== null) t.g3OffLiq++;
      }
    }
    for (const n of REARMS) {
      const r = n === null ? on : runCyclingSim(withP({ breakerRearmMonths: n }));
      noteRearm(t.rearm.get(n)!, r, inside, inScope);
    }
  }
  t.medianDeltaBtc = median(deltas);
  t.medianDeltaNoSalesBtc = median(deltasNoSales);
  return t;
}

// ── COLD RULES BELOW SUPPORT (spec: cold rules measurement v1) — D the doom gate; C retired (the crash playbook) ───────
// D is TEST-ONLY (adopted, default on). Every run is POLICY ON (it is policy-only) and on the PRE-PLAYBOOK order.

type ColdVariant = (typeof COLD_RULE_VARIANTS)[number][0];
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
/** Signed ₿ — a "+" only when the figure rounds to something (never "+0.0000"). */
const sBtc = (n: number, dp = 4): string => `${n >= 0.5 * 10 ** -dp ? '+' : ''}${btc(n, dp)}`;
const sUsd = (n: number): string => `${n >= 0.5 ? '+' : ''}${usd(n)}`;

/** One grid × seed × variant — scalars only. The comparison fields are against `base` on the same cell and seed. */
interface ColdTally {
  n: number; liq: number; calls: number; saleCells: number; soldBtc: number; coldUsed: number; intoDoomed: number;
  shifted: number; skInterest: number; held: number[]; deltas: number[]; better: number; worse: number;
  inScope: number; g2: number;
  liqChanged: number; survToLiq: number[]; liqToSurv: number[]; salesChanged: number;
  deficiencyUp: number; deficiencyUpUsd: number; allInBetter: number; allInWorse: number; allInDeltaUsd: number;
  /** Σ of the all-in LOSSES only (cells worse by more than 50¢) — so a loss can be named apart from the net. */
  allInLossUsd: number;
}
const newColdTally = (): ColdTally => ({
  n: 0, liq: 0, calls: 0, saleCells: 0, soldBtc: 0, coldUsed: 0, intoDoomed: 0, shifted: 0, skInterest: 0, held: [],
  deltas: [], better: 0, worse: 0, inScope: 0, g2: 0, liqChanged: 0, survToLiq: [], liqToSurv: [], salesChanged: 0,
  deficiencyUp: 0, deficiencyUpUsd: 0, allInBetter: 0, allInWorse: 0, allInDeltaUsd: 0, allInLossUsd: 0,
});
/** Coins handed to Coinbase in the month it was liquidated — cold AND Strike collateral: the size of the problem D
 *  addresses (a top-up that could have saved that month would have). */
const intoDoomedBtc = (r: CyclingResult): number =>
  r.liqMonth === null ? 0 : r.rows[r.liqMonth].topUpFromColdBtc + r.rows[r.liqMonth].topUpFromStrikeBtc;
function noteCold(t: ColdTally, r: CyclingResult, base: CyclingResult): void {
  t.n++;
  if (r.liqMonth !== null) t.liq++;
  if (r.firstStrikeCallMonth !== null) t.calls++;
  if (r.strikeCallsSold > 0) t.saleCells++;
  t.soldBtc += r.totalStrikeLiquidatedBtc;
  t.coldUsed += r.totalColdRetrievedBtc;
  t.intoDoomed += intoDoomedBtc(r);
  t.shifted += r.totalDefenseDrawnUsd;
  t.skInterest += r.totalStrikeInterest;
  t.held.push(r.last.btcHeld);
  const d = r.last.btcHeld - base.last.btcHeld;
  t.deltas.push(d);
  if (d > 1e-9) t.better++;
  if (d < -1e-9) t.worse++;
  if (insideBoth(base)) { t.inScope++; if (r.coldRetrievedAboveSupportBtc > 0) t.g2++; }
  if (r.liqMonth !== base.liqMonth) {
    t.liqChanged++;
    if (base.liqMonth === null) t.survToLiq.push(r.liqMonth!);
    else if (r.liqMonth === null) t.liqToSurv.push(base.liqMonth);
  }
  if (r.strikeCallsSold !== base.strikeCallsSold
    || Math.abs(r.totalStrikeLiquidatedBtc - base.totalStrikeLiquidatedBtc) > 1e-9) t.salesChanged++;
  const defUp = (r.deficiencyUsd ?? 0) - (base.deficiencyUsd ?? 0);
  if (defUp > 0.5) { t.deficiencyUp++; t.deficiencyUpUsd += defUp; }
  const a = allInEquity(r) - allInEquity(base);
  if (a > 0.5) t.allInBetter++;
  if (a < -0.5) { t.allInWorse++; t.allInLossUsd += a; }
  t.allInDeltaUsd += a;
}
/** One run against a reference run, per cell: ₿ held and all-in equity, better / worse, and the all-in Σ. */
interface VsTally { btcBetter: number; btcWorse: number; allInBetter: number; allInWorse: number; allInDeltaUsd: number }
const newVsTally = (): VsTally => ({ btcBetter: 0, btcWorse: 0, allInBetter: 0, allInWorse: 0, allInDeltaUsd: 0 });
function noteVs(t: VsTally, r: CyclingResult, ref: CyclingResult): void {
  const d = r.last.btcHeld - ref.last.btcHeld;
  if (d > 1e-9) t.btcBetter++;
  if (d < -1e-9) t.btcWorse++;
  const a = allInEquity(r) - allInEquity(ref);
  if (a > 0.5) t.allInBetter++;
  if (a < -0.5) t.allInWorse++;
  t.allInDeltaUsd += a;
}
const fmtVs = (v: VsTally): string => `₿ ${v.btcBetter} / ${v.btcWorse} · all-in ${v.allInBetter} / ${v.allInWorse} (Σ ${sUsd(v.allInDeltaUsd)})`;

/** Every variant on every cell — each with its OWN inputs (base is the explicit pre-adoption order, not the default);
 *  `seed` null keeps the grid's own `openingColdBtc`. */
function tallyColdGrid(cells: GridCell[], seed: number | null): { t: Map<ColdVariant, ColdTally> } {
  const out = new Map<ColdVariant, ColdTally>(COLD_RULE_VARIANTS.map(([name]) => [name, newColdTally()]));
  for (const c of cells) {
    const inputs: CyclingInputs = {
      ...c.off, supportPolicy: policyFor(c.support), ...(seed === null ? {} : { openingColdBtc: seed }),
    };
    const runs = new Map<ColdVariant, CyclingResult>(
      COLD_RULE_VARIANTS.map(([name, v]): [ColdVariant, CyclingResult] => [name, runCyclingSim({ ...inputs, ...v })]));
    const base = runs.get('base')!;
    for (const [name] of COLD_RULE_VARIANTS) noteCold(out.get(name)!, runs.get(name)!, base);
  }
  return { t: out };
}

// ── THE CRASH PLAYBOOK (spec: crash playbook v1, Run 1) — pre / R / playbook / anyDepth, all POLICY ON ─────────────────
// Four runs per cell, scalars only; three comparisons. The depth gate is ceilingLiquidationMultiple(cbStop, CB_LLTV).

type PlaybookVariant = (typeof CRASH_PLAYBOOK_VARIANTS)[number][0];
const PB_PAIRS = [['R vs pre', 'R', 'pre'], ['playbook vs R', 'playbook', 'R'], ['anyDepth vs R', 'anyDepth', 'R']] as const;
type PbPairName = (typeof PB_PAIRS)[number][0];
/** One run's scalars — all a cell keeps. */
interface PbStats {
  btc: number; allIn: number; liq: number | null; sales: number; soldBtc: number; shifted: number; skInt: number;
  outOfStrike: number; intoDoomed: number; lostInCb: number; g2: boolean; coldMonths: number;
}
const pbStats = (r: CyclingResult): PbStats => ({
  btc: r.last.btcHeld, allIn: allInEquity(r), liq: r.liqMonth, sales: r.strikeCallsSold, soldBtc: r.totalStrikeLiquidatedBtc,
  shifted: r.totalDefenseDrawnUsd, skInt: r.totalStrikeInterest, outOfStrike: r.totalTopUpFromStrikeBtc,
  intoDoomed: intoDoomedBtc(r),
  // Coins topped into Coinbase at or before the month it was liquidated — all of them went with the seizure.
  lostInCb: r.liqMonth === null ? 0 : sum(r.rows.slice(0, r.liqMonth + 1).map((x) => x.topUpBtc)),
  g2: insideBoth(r) && r.coldRetrievedAboveSupportBtc > 0,
  coldMonths: sum(r.rows.map((x) => x.coldBtc)),
});
interface PbCell {
  label: string; k1: number | null; f1: number | null;
  stats: Record<PlaybookVariant, PbStats>; changed: Record<PbPairName, boolean>;
}
function runPbCell(label: string, inputs: CyclingInputs, f1: number | null = null, k1: number | null = null): PbCell {
  const runs = new Map<PlaybookVariant, CyclingResult>(
    CRASH_PLAYBOOK_VARIANTS.map(([name, v]): [PlaybookVariant, CyclingResult] => [name, runCyclingSim({ ...inputs, ...v })]));
  const stats = Object.fromEntries([...runs].map(([n, r]) => [n, pbStats(r)])) as Record<PlaybookVariant, PbStats>;
  const changed = Object.fromEntries(PB_PAIRS.map(([p, a, b]) => [p, !isDeepStrictEqual(runs.get(a), runs.get(b))])) as
    Record<PbPairName, boolean>;
  return { label, f1, k1, stats, changed };
}
interface PbTally {
  n: number; changed: number; btcBetter: number; btcWorse: number; btcDelta: number;
  allInBetter: number; allInWorse: number; allInDelta: number; allInLoss: number;
  survToLiq: number; liqToSurv: number; salesChanged: number; coldChanged: number;
  refShifted: number; vShifted: number; refSkInt: number; vSkInt: number; refOut: number; vOut: number;
  refInto: number; vInto: number; refLost: number; vLost: number; refG2: number; vG2: number; refCold: number; vCold: number;
  btcWorseCells: string[]; allInWorseCells: string[];
}
function tallyPb(cells: PbCell[], pair: PbPairName): PbTally {
  const [, vName, refName] = PB_PAIRS.find(([p]) => p === pair)!;
  const t: PbTally = {
    n: 0, changed: 0, btcBetter: 0, btcWorse: 0, btcDelta: 0, allInBetter: 0, allInWorse: 0, allInDelta: 0, allInLoss: 0,
    survToLiq: 0, liqToSurv: 0, salesChanged: 0, coldChanged: 0, refShifted: 0, vShifted: 0, refSkInt: 0, vSkInt: 0,
    refOut: 0, vOut: 0, refInto: 0, vInto: 0, refLost: 0, vLost: 0, refG2: 0, vG2: 0, refCold: 0, vCold: 0,
    btcWorseCells: [], allInWorseCells: [],
  };
  for (const c of cells) {
    const v = c.stats[vName];
    const ref = c.stats[refName];
    t.n++;
    if (c.changed[pair]) t.changed++;
    const d = v.btc - ref.btc;
    if (d > 1e-9) t.btcBetter++;
    if (d < -1e-9) { t.btcWorse++; t.btcWorseCells.push(`${c.label} (${sBtc(d)})`); }
    t.btcDelta += d;
    const a = v.allIn - ref.allIn;
    if (a > 0.5) t.allInBetter++;
    if (a < -0.5) { t.allInWorse++; t.allInLoss += a; t.allInWorseCells.push(`${c.label} (${sUsd(a)})`); }
    t.allInDelta += a;
    if (ref.liq === null && v.liq !== null) t.survToLiq++;
    if (ref.liq !== null && v.liq === null) t.liqToSurv++;
    if (v.sales !== ref.sales || Math.abs(v.soldBtc - ref.soldBtc) > 1e-9) t.salesChanged++;
    if (Math.abs(v.coldMonths - ref.coldMonths) > 1e-9) t.coldChanged++;
    t.refShifted += ref.shifted; t.vShifted += v.shifted;
    t.refSkInt += ref.skInt; t.vSkInt += v.skInt;
    t.refOut += ref.outOfStrike; t.vOut += v.outOfStrike;
    t.refInto += ref.intoDoomed; t.vInto += v.intoDoomed;
    t.refLost += ref.lostInCb; t.vLost += v.lostInCb;
    if (ref.g2) t.refG2++;
    if (v.g2) t.vG2++;
    t.refCold += ref.coldMonths; t.vCold += v.coldMonths;
  }
  return t;
}
const arrow = (a: string, b: string): string => (a === b ? a : `${a} → ${b}`);
const pbRow = (set: string, pair: PbPairName, t: PbTally): string =>
  `| ${set} | ${pair} | ${t.n} | ${t.changed} | ${t.btcBetter} / ${t.btcWorse} (${sBtc(t.btcDelta, 3)}) | ${t.allInBetter} / ${t.allInWorse} (Σ ${sUsd(t.allInDelta)} · loss ${usd(t.allInLoss)}) | ${t.survToLiq} | ${t.liqToSurv} | ${t.salesChanged} | ${arrow(usd(t.refShifted), usd(t.vShifted))} | ${arrow(usd(t.refSkInt), usd(t.vSkInt))} | ${arrow(btc(t.refOut, 3), btc(t.vOut, 3))} | ${arrow(btc(t.refInto, 3), btc(t.vInto, 3))} | ${arrow(btc(t.refLost, 3), btc(t.vLost, 3))} | ${arrow(`${t.refG2}`, `${t.vG2}`)} | ${arrow(btc(t.refCold, 1), btc(t.vCold, 1))} |`;
const listCells = (xs: string[], cap = 12): string =>
  (xs.length === 0 ? 'none' : `${xs.slice(0, cap).join(' · ')}${xs.length > cap ? ` · … (+${xs.length - cap} more)` : ''}`);

describe.runIf(!!process.env.SP_REPORT)('A5 — support-anchored policy measurement report', () => {
  it('prints the report (and checks the grids are the grids)', () => {
    const lines: string[] = [];
    const out = (s = ''): void => { lines.push(s); };
    const cases = a5Cases();
    const runs = cases.map((c) => {
      const cash6: CyclingInputs = { ...c.on, supportPolicy: { ...c.on.supportPolicy!, openingCashUsd: CASH_6_USD } };
      return { c, off: runCyclingSim(c.off), on: runCyclingSim(c.on), on6: runCyclingSim(cash6) };
    });

    out('<!-- SP_REPORT BEGIN -->');
    out('# A5 — support-anchored policy, measured (Run 1.1)');
    out();
    out('Fixture SP_REPRO (round synthetic): start 2027-01-01, 72 months; Strike 1.0 ₿ / $0 / $30k line; Coinbase 1.0 ₿ / $30k;');
    out('cold 0; $8k income / $6k bills; 13% / 6.27%; cadence 1; CB cap 70; Strike cap 60; defend on. OFF = the faces\'');
    out('defaults (sweep 30). ON = the default policy (stops 60 / 50 at support, zones 1.5 / 2.0, 12-month buffer, cash 0).');
    out(`Support at start S₀ = ${usd(SUPPORT[0])}; every path opens at 1.35 × S₀ = ${usd(1.35 * SUPPORT[0])}.`);
    out('All-in equity = equity − unpaid bills − cash spent on bills − cash spent on cures.');
    out();

    // ── G5 · the face defaults ──
    out('## G5 — disclosure on the face-default paths (OFF vs ON)');
    out();
    out('| Path | ₿ held OFF | ₿ held ON | cold OFF | cold ON | debt OFF | debt ON | equity OFF | equity ON | all-in equity OFF | all-in equity ON |');
    out('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const name of ['P1', 'P2', 'P2 (phase −4)']) {
      const r = runs.find((x) => x.c.name === name)!;
      out(`| ${name} | ${btc(r.off.last.btcHeld)} | ${btc(r.on.last.btcHeld)} | ${btc(r.off.totalColdBtc)} | ${btc(r.on.totalColdBtc)} | ${usd(r.off.last.debt)} | ${usd(r.on.last.debt)} | ${usd(r.off.last.equity)} | ${usd(adjEquity(r.on))} | ${usd(allInEquity(r.off))} | ${usd(allInEquity(r.on))} |`);
    }
    out();

    // ── end-of-run per path ──
    out('## Per path — end of run (OFF vs ON, cash 0; ON with 6 months of cash in brackets where it differs)');
    out();
    out('| Path | ₿ held OFF | ₿ held ON | cold OFF | cold ON | debt OFF | debt ON | equity OFF | equity ON (adj.) | all-in equity OFF | all-in equity ON | CB liq OFF / ON | unfunded OFF / ON | cash left (cash 6) |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { c, off, on, on6 } of runs) {
      const alt = (a: string, b: string): string => (a === b ? a : `${a} [${b}]`);
      out(`| ${c.name} | ${btc(off.last.btcHeld)} | ${alt(btc(on.last.btcHeld), btc(on6.last.btcHeld))} | ${btc(off.totalColdBtc)} | ${alt(btc(on.totalColdBtc), btc(on6.totalColdBtc))} | ${usd(off.last.debt)} | ${alt(usd(on.last.debt), usd(on6.last.debt))} | ${usd(off.last.equity)} | ${alt(usd(adjEquity(on)), usd(adjEquity(on6)))} | ${usd(allInEquity(off))} | ${alt(usd(allInEquity(on)), usd(allInEquity(on6)))} | ${mo(off.liqMonth)} / ${alt(mo(on.liqMonth), mo(on6.liqMonth))} | ${usd(off.totalUnfundedUsd)} / ${alt(usd(on.totalUnfundedUsd), usd(on6.totalUnfundedUsd))} | ${usd(on6.cashLeftUsd)} |`);
    }
    out();
    out('Equity alone ignores unpaid bills; compare the arms on all-in equity.');
    out();
    // FIDELITY: on P7 the cash only replaces bills that would otherwise go unpaid (no Strike call there), so cash 0
    // and cash 6 must print the same all-in equity — or the definition is counting outside money as a gain.
    const p7c0 = runs.find((x) => x.c.name === 'P7 (cash 0)')!.on;
    const p7c6 = runs.find((x) => x.c.name === 'P7 (cash 6)')!.on;
    expect(p7c6.totalCashToBillsUsd).toBeGreaterThan(0);   // non-vacuous: the cash did pay bills
    expect(usd(allInEquity(p7c0))).toBe(usd(allInEquity(p7c6)));
    expect(Math.abs(allInEquity(p7c0) - allInEquity(p7c6))).toBeLessThan(1e-6);

    // ── risk: peaks, calls, cold above support ──
    out('## Per path — how close to a line (peak LTV at price, with its month) and the Strike leg');
    out();
    out('| Path | peak CB OFF | peak CB ON | peak Strike OFF | peak Strike ON | Strike calls OFF (flagged months) | Strike calls ON (cured / sold, ₿ sold) | strikeMarginMonth OFF / ON | cold retrieved ≥ support OFF / ON |');
    out('|---|---|---|---|---|---|---|---|---|');
    for (const { c, off, on } of runs) {
      const pcOff = peak(off, 'cbLtv'); const pcOn = peak(on, 'cbLtv');
      const psOff = peak(off, 'strikeLtv'); const psOn = peak(on, 'strikeLtv');
      out(`| ${c.name} | ${pct(pcOff.v)} ${mo(pcOff.m)} | ${pct(pcOn.v)} ${mo(pcOn.m)} | ${pct(psOff.v)} ${mo(psOff.m)} | ${pct(psOn.v)} ${mo(psOn.m)} | ${flaggedCallMonths(off)} | ${on.strikeCallsCured} / ${on.strikeCallsSold}, ${btc(on.totalStrikeLiquidatedBtc)} | ${mo(off.strikeMarginMonth)} / ${mo(on.strikeMarginMonth)} | ${btc(coldRetrievedAbove(off, c.support))} / ${btc(on.coldRetrievedAboveSupportBtc)} |`);
    }
    out();

    // ── zones ──
    out('## Per path — zones (ON). A accumulate · H hold · D pay down · P paused · B broken; m0 → m72');
    out();
    out('| Path | min multiple | zone strip | months A / H / D / P / B | first paused | broken | first ceiling throttle | credit exhausted | first defense | CB LTV just before it |');
    out('|---|---|---|---|---|---|---|---|---|---|');
    for (const { c, on } of runs) {
      const strip = on.rows.map((x) => ZONE_LETTER[x.policyZone!]).join('');
      const z = on.monthsInZone;
      const pre = on.firstDefenseMonth !== null ? pct(on.rows[on.firstDefenseMonth].cbLtvPreDefense ?? Number.NaN) : '—';
      out(`| ${c.name} | ${minMultiple(c.on.pricePath, c.support).toFixed(3)} | \`${strip}\` | ${z.accumulate} / ${z.hold} / ${z.payDown} / ${z.paused} / ${z.broken} | ${mo(on.firstPausedMonth)} | ${mo(on.modelBrokenMonth)} | ${mo(on.firstCeilingThrottleMonth)} | ${mo(on.creditExhaustedMonth)} | ${mo(on.firstDefenseMonth)} | ${pre} |`);
    }
    out();

    // ── P9's construction ──
    out('## P9 — where the dip lands (measured from each budget\'s no-crash twin)');
    out();
    out('| Budget | twin peak CB LTV at support | at month | twin first ceiling throttle | dip months (0.80 × S) |');
    out('|---|---|---|---|---|');
    for (const income of [4_000, 8_000]) {
      const b = buildP9(income);
      out(`| ${usd(income)} / ${usd(SP_REPRO.expenses)} | ${pct(b.peakLtvAtSupport)} | ${mo(b.peakMonth)} | ${mo(b.twin.firstCeilingThrottleMonth)} | m${b.dipStart}–m${b.dipStart + 1} |`);
    }
    out();

    // ── every Strike call ──
    out('## Every modelled Strike call on an A5 path (ON arm, cash 0 and cash 6)');
    out();
    const calls: string[] = [];
    for (const { c, on, on6 } of runs) {
      for (const [tag, r] of [['cash 0', on], ['cash 6', on6]] as const) {
        for (const x of r.rows) {
          if (x.strikeCall === 'none') continue;
          const preBal = x.strikeBalance + x.cashToCureUsd + x.strikeLiquidatedBtc * x.price;
          const preColl = x.strikeCollateralBtc - x.strikeCureColdBtc + x.strikeLiquidatedBtc;
          const shifted = r.rows.slice(0, x.m + 1).reduce((s, y) => s + y.defenseDrawnUsd, 0);
          calls.push(`| ${c.name} (${tag}) | ${mo(x.m)} | ${x.multiple!.toFixed(3)} | ${pct(preBal / (preColl * x.price))} | ${x.strikeCall} (cash ${usd(x.cashToCureUsd)}, cold ${btc(x.strikeCureColdBtc)}, sold ${btc(x.strikeLiquidatedBtc)}) | ${shifted > 0 ? `Coinbase debt shifted onto Strike so far: ${usd(shifted)}` : 'price fall on Strike\'s own balance'} |`);
        }
      }
    }
    if (calls.length === 0) out('None. No A5 path — P9 included — takes Strike to its 70% call under the policy.');
    else { out('| Path | month | multiple | LTV before | resolution | cause |'); out('|---|---|---|---|---|---|'); calls.forEach((l) => out(l)); }
    out();

    // ── sensitivity ──
    out('## Sensitivity — CB stop at support × bear buffer (ON, cash 0)');
    out();
    out('| Path | CB stop | buffer (months) | ₿ held | cold | peak CB LTV (month) | CB liq |');
    out('|---|---|---|---|---|---|---|');
    const sens: [string, CyclingInputs][] = [
      ['P2', runs.find((x) => x.c.name === 'P2')!.c.on],
      ['P9 ($4k / $6k)', runs.find((x) => x.c.name === 'P9 ($4k / $6k)')!.c.on],
    ];
    for (const [name, base] of sens) {
      for (const cbStopAtSupportPct of [50, 60, 70]) {
        for (const bearBufferMonths of [6, 12]) {
          const r = runCyclingSim({ ...base, supportPolicy: policyFor(SUPPORT, { cbStopAtSupportPct, bearBufferMonths }) });
          const p = peak(r, 'cbLtv');
          out(`| ${name} | ${cbStopAtSupportPct}% | ${bearBufferMonths} | ${btc(r.last.btcHeld)} | ${btc(r.totalColdBtc)} | ${pct(p.v)} ${mo(p.m)} | ${mo(r.liqMonth)} |`);
        }
      }
    }
    out();

    // ── breaker re-arm (v1.3 #14): measured before any default changes ──
    out('## Breaker re-arm — latched vs 3 / 6 / 12 month-ends at or above support (ON, cash 0; no default is set)');
    out();
    out('| Path | re-arm | ₿ held | debt | unfunded | equity (adj.) | all-in equity | CB liq | peak CB LTV | breaks | re-arms | G2 | G3 |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const name of ['P3', 'P6', 'P9 ($4k / $6k)']) {
      const run = runs.find((x) => x.c.name === name)!;
      const minK = minMultiple(run.c.on.pricePath, run.c.support);
      for (const n of REARMS) {
        const r = n === null ? run.on : runCyclingSim(withPolicy(run.c.on, { breakerRearmMonths: n }));
        const ev = breakerEvents(r);
        // FIDELITY: the months printed are the engine's own events.
        expect(ev.breaks.length, `${name} ${rearmLabel(n)}`).toBe(r.breakCount);
        expect(ev.breaks[0] ?? null).toBe(r.modelBrokenMonth);
        expect(ev.rearms[0] ?? null).toBe(r.firstRearmMonth);
        const inside = insideBoth(r);
        const g2 = inside ? (r.coldRetrievedAboveSupportBtc === 0 ? '✓' : `✗ ${btc(r.coldRetrievedAboveSupportBtc)}`) : 'n/a (opens over a ceiling)';
        const g3 = inside && minK >= 0.8 - 1e-9 ? (r.liqMonth === null ? '✓' : `✗ ${mo(r.liqMonth)}`) : `n/a (min ${minK.toFixed(2)} × S)`;
        const p = peak(r, 'cbLtv');
        out(`| ${name} | ${rearmLabel(n)} | ${btc(r.last.btcHeld)} | ${usd(r.last.debt)} | ${usd(r.totalUnfundedUsd)} | ${usd(adjEquity(r))} | ${usd(allInEquity(r))} | ${mo(r.liqMonth)} | ${pct(p.v)} ${mo(p.m)} | ${moList(ev.breaks)} | ${moList(ev.rearms)} | ${g2} | ${g3} |`);
      }
    }
    out();

    // ── grids ──
    out('## The three existing grids, policy OFF (the shipped arm) vs ON');
    out();
    const fw = faceWorldGrid();
    const syn = syntheticGrid();
    const reach = reachGrid();
    expect(fw).toHaveLength(360);
    expect(syn).toHaveLength(5_760);
    expect(reach).toHaveLength(2_806);
    // FIDELITY: the OFF arm must reproduce cyclingSim.test.ts's pins, or these are different grids.
    expect(fw.filter((c) => runCyclingSim(c.off).strikeMarginMonth !== null)).toHaveLength(82);
    expect(reach.filter((c) => runCyclingSim(c.off).strikeMarginMonth !== null)).toHaveLength(920);
    const earlier = syn.filter((c) =>
      (runCyclingSim(c.off).liqMonth ?? Number.POSITIVE_INFINITY) < (runCyclingSim(c.capOff).liqMonth ?? Number.POSITIVE_INFINITY));
    expect(earlier).toHaveLength(0);
    const tallies = ([['face-world', fw], ['synthetic single-crash', syn], ['reachability', reach]] as const)
      .map(([name, cells]) => ({ name, t: tallyGrid(cells) }));
    out('"ON no-sales" is the policy with Strike\'s call only flagged, as in the OFF arm — so its Δ₿ isolates the policy from the sale accounting.');
    out();
    out('| Grid | cells | CB liq OFF / ON / ON no-sales | Strike calls OFF (flag) / ON (modelled) / ON no-sales (flag) | ON sales (cells, ₿) | cold ≥ support OFF (cells, ₿) / ON | median Δ₿ held (ON − OFF) | median Δ₿ held (ON no-sales − OFF) | inside both ceilings | G2 violations | G3 scope (≥ 0.80 × S, inside) | G3 CB liq ON / OFF |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { name, t } of tallies) {
      expect(t.onAppliedAll).toBe(true);
      out(`| ${name} | ${t.n} | ${t.offLiq} / ${t.onLiq} / ${t.noSalesLiq} | ${t.offCalls} / ${t.onCalls} / ${t.noSalesCalls} | ${t.onSales}, ${btc(t.onSoldBtc, 3)} | ${t.offColdAboveCells}, ${btc(t.offColdAboveBtc, 3)} / ${t.onColdAboveCells}, ${btc(t.onColdAboveBtc, 3)} | ${btc(t.medianDeltaBtc)} | ${btc(t.medianDeltaNoSalesBtc)} | ${t.inside} | ${t.g2Violations} | ${t.g3Scope} | ${t.g3OnLiq} / ${t.g3OffLiq} |`);
    }
    out();
    out('### Breaker re-arm across the grids (ON, cash 0)');
    out();
    out('| Grid | re-arm | broken cells (median first break) | re-armed cells (median first re-arm) | Σ breaks | CB liq cells (median month) | median ₿ held | median debt | median all-in equity | unfunded Σ (cells > 0) | peak CB LTV median / max | G2 violations | G3 in-scope CB liq |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { name, t } of tallies) {
      for (const n of REARMS) {
        const r = t.rearm.get(n)!;
        out(`| ${name} | ${rearmLabel(n)} | ${r.broken} (${medianMo(r.firstBreaks)}) | ${r.rearmed} (${medianMo(r.firstRearms)}) | ${r.breaks} | ${r.liq} (${medianMo(r.liqMonths)}) | ${btc(median(r.held))} | ${usd(median(r.debt))} | ${usd(median(r.allIn))} | ${usd(r.unfundedSum)} (${r.unfundedCells}) | ${pct(median(r.peakCb))} / ${pct(Math.max(...r.peakCb))} | ${r.g2Violations} | ${r.g3OnLiq} |`);
      }
    }
    out();

    // ── real cold (spec v1): the owner's reserve seeded into the cold pool ──
    out('## Real cold — the owner\'s reserve seeded into the cold pool (seed 0 vs 0.5 ₿; policy OFF / ON)');
    out();
    out('Cold used = cold drawn back out by any defense. Cold used ≥ support: ON = the policy\'s own field (its G2 promise —');
    out('0 in every ON row); OFF = the same measure read off the rows (the policy field is 0 by construction there) — OFF rows');
    out('may be above 0 and are reported, not flagged. Strike sales are modelled only under the policy.');
    out();
    out('| Row | arm | seed ₿ | cold used | cold used ≥ support | Strike ₿ sold | CB liq | ₿ held − seed |');
    out('|---|---|---|---|---|---|---|---|');
    const coldRows: { name: string; off: CyclingInputs; on: CyclingInputs; support: number[] }[] = [
      ...cases.map((c) => ({ name: c.name, off: c.off, on: c.on, support: c.support })),
      ...[0.6, 0.5, 0.4].flatMap((f) => (['P1', 'P2'] as const).map((p) => {
        const off: CyclingInputs = { ...SP_REPRO, pricePath: stressFrom12(p === 'P1' ? pathP1() : pathP2(0), f) };
        return { name: `${p} × ${f} from m12`, off, on: { ...off, supportPolicy: policyFor(SUPPORT) }, support: SUPPORT };
      })),
      {
        name: 'CALL fixture', off: { ...CALL_BASE, pricePath: CALL_PATH },
        on: { ...CALL_BASE, pricePath: CALL_PATH, supportPolicy: policyFor(CALL_SUPPORT) }, support: CALL_SUPPORT,
      },
    ];
    for (const row of coldRows) {
      for (const [arm, inputs] of [['OFF', row.off], ['ON', row.on]] as const) {
        for (const seed of [0, 0.5]) {
          const r = runCyclingSim({ ...inputs, openingColdBtc: seed });
          const above = arm === 'ON' ? r.coldRetrievedAboveSupportBtc : coldRetrievedAbove(r, row.support);
          const sold = arm === 'ON' ? btc(r.totalStrikeLiquidatedBtc) : '— (flag only)';
          out(`| ${row.name} | ${arm} | ${seed} | ${btc(r.totalColdRetrievedBtc)} | ${btc(above)} | ${sold} | ${mo(r.liqMonth)} | ${btc(r.last.btcHeld - seed)} |`);
        }
      }
    }
    out();
    // The doomed top-up: under the policy the emergency Coinbase top-up IS doom-gated now (D, adopted, default on). The
    // doom-gate-off arm (`doomGateCbTopUp: false`) stays beside it, so the table still shows the problem D fixed: the
    // reserve going into a loan liquidated in the same month anyway. Both arms repay Strike first after the liquidation.
    out('### The doomed top-up — P1 × 0.35 from m12, policy ON (the doom gate off vs the default)');
    out();
    out('| arm | seed ₿ | CB liq | cold into that month\'s top-up | seized | ₿ held | ₿ held − seed |');
    out('|---|---|---|---|---|---|---|');
    for (const seed of [0, 0.5]) {
      for (const [arm, o] of [['doom gate off (test-only)', { doomGateCbTopUp: false }], ['default (doom gate on)', {}]] as const) {
        const r = runCyclingSim({
          ...SP_REPRO, pricePath: stressFrom12(pathP1(), 0.35), supportPolicy: policyFor(SUPPORT), openingColdBtc: seed, ...o,
        });
        const into = r.liqMonth !== null ? r.rows[r.liqMonth].topUpFromColdBtc : 0;
        out(`| ${arm} | ${seed} | ${mo(r.liqMonth)} | ${btc(into)} | ${btc(r.seizedBtc ?? 0)} | ${btc(r.last.btcHeld)} | ${btc(r.last.btcHeld - seed)} |`);
      }
    }
    out();
    out('Both arms repay Strike first after the liquidation (the adopted default).');
    out();

    // ── findings with measured numbers ──
    out('## Findings (measured)');
    out();
    const p2 = runs.find((x) => x.c.name === 'P2')!.on;
    const firstD = p2.firstPayDownMonth!;
    let lastD = firstD;
    while (lastD + 1 < p2.rows.length && p2.rows[lastD + 1].policyZone === 'payDown') lastD++;
    const debtIn = p2.rows[firstD - 1].debt;
    const debtOut = p2.rows[lastD].debt;
    const repaid = p2.rows.slice(firstD, lastD + 1).reduce((s, x) => s + x.payDownUsd, 0);
    out(`- **Pay-down on REPRO:** P2's first pay-down stretch (m${firstD}–m${lastD}) repays ${usd(repaid)} of the ${usd(debtIn)} it enters with; debt leaves the stretch at ${usd(debtOut)} (interest ran on the rest).`);
    const p1 = runs.find((x) => x.c.name === 'P1')!.on;
    const accRooms = p1.rows.filter((x) => x.m > 0 && x.m < (p1.firstColdMonth ?? 73)).map((x) => x.cbCeilingHeadroomUsd!);
    out(`- **When cold starts (P1, all accumulate):** the first sweep is ${mo(p1.firstColdMonth)}. Before it, Coinbase's room at support ranges ${usd(Math.min(...accRooms))}–${usd(Math.max(...accRooms))} — inside its ceiling, but under the ${usd(12 * SP_REPRO.expenses)} buffer the sweep keeps.`);
    const p2Cold = (zone: PolicyState): number => p2.rows.filter((x, m) => m > 0 && x.policyZone === zone)
      .reduce((s, x) => s + (x.coldFromCb + x.coldFromStrike) - (p2.rows[x.m - 1].coldFromCb + p2.rows[x.m - 1].coldFromStrike), 0);
    out(`- **Where cold builds on P2:** swept in accumulate ${btc(p2Cold('accumulate'))} ₿ · hold ${btc(p2Cold('hold'))} ₿ · pay-down ${btc(p2Cold('payDown'))} ₿ (first sweep ${mo(p2.firstColdMonth)}).`);
    const inScope = runs.filter(({ c, on }) => minMultiple(c.on.pricePath, c.support) >= 0.8 - 1e-9 && insideBoth(on));
    const offRetr = inScope.filter(({ c, off }) => coldRetrievedAbove(off, c.support) > 1e-12)
      .map(({ c, off }) => `${c.name} ${btc(coldRetrievedAbove(off, c.support), 3)}`);
    out(`- **G3's in-scope paths:** ${inScope.length}; the OFF arm liquidates on ${inScope.filter(({ off }) => off.liqMonth !== null).length} and is called on ${inScope.filter(({ off }) => off.strikeMarginMonth !== null).length}. It survives by pulling cold above support on: ${offRetr.length ? offRetr.join(' · ') : 'none'} (₿).`);
    const belowAny = runs.filter(({ c, on }) => {
      for (let m = 1; m < on.rows.length; m++) {
        if (on.rows[m].price / c.support[m] < 1 - SUPPORT_EPS && on.rows[m].coldRetrievedBtc > on.rows[m - 1].coldRetrievedBtc) return true;
      }
      return false;
    }).map(({ c }) => c.name);
    out(`- **Cold retrieved BELOW support on any A5 path (ON):** ${belowAny.length ? belowAny.join(', ') : 'none'}.`);
    const p9 = runs.find((x) => x.c.name === 'P9 ($4k / $6k)')!;
    out(`- **P9 ($4k):** ON peak CB LTV ${pct(peak(p9.on, 'cbLtv').v)} (${mo(peak(p9.on, 'cbLtv').m)}), first defense ${mo(p9.on.firstDefenseMonth)}, broken ${mo(p9.on.modelBrokenMonth)}, unfunded after the break ${usd(p9.on.totalUnfundedUsd)}.`);
    out('<!-- SP_REPORT END -->');

    console.log(lines.join('\n'));
  }, 300_000);

  // ── the cold-rules measurement — its own block, so it can be run and read alone (`-t "cold rules"`) ──
  it('prints the cold rules measurement (D doom gate, on the pre-playbook order; C retired; policy ON)', () => {
    const lines: string[] = [];
    const out = (s = ''): void => { lines.push(s); };
    out('<!-- SP_REPORT COLD RULES BEGIN -->');
    out('# Cold rules below support — D (doom gate, ADOPTED), measured; C retired');
    out();
    out('Every run is policy ON and on the PRE-PLAYBOOK order: Strike\'s release rules off and no top-up before the shift.');
    out('C (cold before the debt shift) is RETIRED — the crash playbook supersedes it (its own block, `-t "crash playbook"`).');
    out('The variants are EXPLICIT: base = the pre-adoption order (the doom gate off); D = the doom gate on (it skips the');
    out('emergency Coinbase top-up in a month Coinbase is doomed, asked after the shift). ⚠ Every run also repays STRIKE');
    out('FIRST after a Coinbase liquidation, now in EVERY zone (the adopted default), so base\'s numbers moved from the');
    out('measurement wherever a post-liquidation deficiency exists.');
    out('Δ₿ = ₿ held at the end − base\'s (same cell, same seed); better / worse = Δ₿ > 1e-9 / < −1e-9. ₿ into a doomed CB =');
    out('cold + Strike collateral topped into Coinbase in its liquidation month. G2 counts cells that open inside both');
    out('ceilings and pull cold at or above support — it must be 0.');
    out();

    // ── grids ──
    const grids: [string, GridCell[], (number | null)[]][] = [
      ['face-world', faceWorldGrid(), [0, 0.5]],
      ['synthetic single-crash', syntheticGrid(), [null]],
      ['reachability', reachGrid(), [0, 0.5]],
    ];
    out('## Grids');
    out();
    out('| Grid | seed ₿ | variant | cells | CB liq cells | Strike call cells | Strike sales (cells, ₿) | Σ cold used ₿ | Σ ₿ into a doomed CB | Σ debt shifted | Σ Strike interest | better / worse | Σ Δ₿ · median Δ₿ | G2 violations (in scope) |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const tallies: { grid: string; seed: string; t: Map<ColdVariant, ColdTally> }[] = [];
    for (const [grid, cells, seeds] of grids) {
      for (const seed of seeds) {
        const { t } = tallyColdGrid(cells, seed);
        const seedLabel = seed === null ? 'own (0–1.0)' : `${seed}`;
        tallies.push({ grid, seed: seedLabel, t });
        for (const [name] of COLD_RULE_VARIANTS) {
          const x = t.get(name)!;
          const vs = name === 'base' ? '—' : `${x.better} / ${x.worse}`;
          const dl = name === 'base' ? '—' : `${sBtc(sum(x.deltas))} · ${sBtc(median(x.deltas))}`;
          out(`| ${grid} | ${seedLabel} | ${name} | ${x.n} | ${x.liq} | ${x.calls} | ${x.saleCells}, ${btc(x.soldBtc, 3)} | ${btc(x.coldUsed, 3)} | ${btc(x.intoDoomed, 3)} | ${usd(x.shifted)} | ${usd(x.skInterest)} | ${vs} | ${dl} | ${x.g2} (of ${x.inScope}) |`);
        }
      }
    }
    out();

    // ── rows ──
    out('## Rows — the A5 paths, P1 / P2 × 0.6 / 0.5 / 0.4 / 0.35 from m12, and the CALL fixture');
    out();
    out('One value = both variants agree; otherwise base / D.');
    out();
    out('| Row | seed ₿ | CB liq | Strike ₿ sold | cold used ₿ | debt shifted | Strike interest | ₿ held − seed |');
    out('|---|---|---|---|---|---|---|---|');
    const both = (xs: string[]): string => (xs.every((x) => x === xs[0]) ? xs[0] : xs.join(' / '));
    // Rows against base (₿, all-in, liquidations, sales).
    const rowTally = new Map<ColdVariant, { worse: number; allInWorse: number; liq: number; sales: number; intoDoomed: string[] }>(
      COLD_RULE_VARIANTS.map(([name]) => [name, { worse: 0, allInWorse: 0, liq: 0, sales: 0, intoDoomed: [] }]));
    for (const row of coldRuleRows()) {
      for (const seed of [0, 0.5]) {
        const rs = COLD_RULE_VARIANTS.map(([, v]) => runCyclingSim({ ...row.on, ...v, openingColdBtc: seed }));
        COLD_RULE_VARIANTS.forEach(([name], i) => {
          const r = rs[i];
          const t = rowTally.get(name)!;
          if (r.last.btcHeld - rs[0].last.btcHeld < -1e-9) t.worse++;
          if (allInEquity(r) - allInEquity(rs[0]) < -0.5) t.allInWorse++;
          if (r.liqMonth !== rs[0].liqMonth) t.liq++;
          if (Math.abs(r.totalStrikeLiquidatedBtc - rs[0].totalStrikeLiquidatedBtc) > 1e-9) t.sales++;
          if (intoDoomedBtc(r) > 0) t.intoDoomed.push(`${row.name} (seed ${seed}) ${btc(intoDoomedBtc(r), 3)}`);
        });
        out(`| ${row.name} | ${seed} | ${both(rs.map((r) => mo(r.liqMonth)))} | ${both(rs.map((r) => btc(r.totalStrikeLiquidatedBtc)))} | ${both(rs.map((r) => btc(r.totalColdRetrievedBtc)))} | ${both(rs.map((r) => usd(r.totalDefenseDrawnUsd)))} | ${both(rs.map((r) => usd(r.totalStrikeInterest)))} | ${both(rs.map((r) => btc(r.last.btcHeld - seed)))} |`);
      }
    }
    out();

    // ── findings ──
    out('## Findings (measured) — §4 v1.1 applied mechanically; the owner decides');
    out();
    for (const { grid, seed, t } of tallies) {
      const d = t.get('D')!;
      out(`- **D · ${grid} · seed ${seed}:** worse ${d.worse} · CB liquidation changed ${d.liqChanged} · Strike sales changed ${d.salesChanged} · better ${d.better} (Σ Δ₿ ${sBtc(sum(d.deltas))}) · deficiency added ${d.deficiencyUp} cells (Σ ${usd(d.deficiencyUpUsd)}) · all-in equity better / worse ${d.allInBetter} / ${d.allInWorse} (Σ ${sUsd(d.allInDeltaUsd)}) · Σ Strike interest base → D ${usd(t.get('base')!.skInterest)} → ${usd(d.skInterest)}.`);
    }
    const dRows = rowTally.get('D')!;
    out(`- **D · rows:** ₿ worse ${dRows.worse} · all-in worse ${dRows.allInWorse} · CB liquidation changed ${dRows.liq} · Strike sales changed ${dRows.sales}.`);
    for (const name of ['base', 'D'] as const) {
      const into = rowTally.get(name)!.intoDoomed;
      out(`- **₿ into a doomed CB · rows · ${name}:** ${into.length ? into.join(' · ') : 'none'}.`);
    }
    // §4 v1.1 — D: ₿ held decides; all-in may only lose on the grid that never recovers (synthetic), and it is named.
    const all = (name: ColdVariant, k: 'worse' | 'liqChanged' | 'salesChanged'): number =>
      tallies.reduce((s, { t }) => s + t.get(name)![k], 0);
    const noRecovery = (grid: string): boolean => grid === 'synthetic single-crash';
    const dBtcWorse = all('D', 'worse') + dRows.worse;
    const dLiqChanged = all('D', 'liqChanged') + dRows.liq;
    const dSalesChanged = all('D', 'salesChanged') + dRows.sales;
    const recoveringAllInWorse = tallies.filter(({ grid }) => !noRecovery(grid))
      .map(({ grid, seed, t }) => ({ label: `${grid} · seed ${seed}`, n: t.get('D')!.allInWorse }));
    const dRecoveringWorse = recoveringAllInWorse.reduce((s, x) => s + x.n, 0) + dRows.allInWorse;
    const named = tallies.filter(({ grid }) => noRecovery(grid))
      .map(({ seed, t }) => `synthetic · seed ${seed}: ${t.get('D')!.allInWorse} cells, Σ loss ${sUsd(t.get('D')!.allInLossUsd)} (net Σ ${sUsd(t.get('D')!.allInDeltaUsd)})`);
    const dPass = dBtcWorse === 0 && dLiqChanged === 0 && dSalesChanged === 0 && dRecoveringWorse === 0;
    out(`- **§4 v1.1 · D:** ${dPass ? 'PASS' : 'FAIL'} — ₿ worse ${dBtcWorse} (grids + rows) · liquidations changed ${dLiqChanged} · sales changed ${dSalesChanged} · all-in worse on the recovering grids — ${recoveringAllInWorse.map((x) => `${x.label}: ${x.n}`).join(', ')}; rows: ${dRows.allInWorse} · all-in loss allowed and named (no recovery): ${named.join('; ')}.`);
    out('<!-- SP_REPORT COLD RULES END -->');

    console.log(lines.join('\n'));
  }, 300_000);

  // ── repayment after a Coinbase liquidation — its own block (`-t "repayment"`) ──
  it('prints the repayment measurement (Strike first after a Coinbase liquidation, off vs on; policy ON)', () => {
    const lines: string[] = [];
    const out = (s = ''): void => { lines.push(s); };
    out('<!-- SP_REPORT REPAYMENT BEGIN -->');
    out('# Repayment after a Coinbase liquidation — Strike first (the adopted default) vs Coinbase first');
    out();
    out('Every run is policy ON and on the crash-playbook order (the defaults). Strike first now covers EVERY zone after a');
    out('liquidation (P3, crash playbook Run 1): off = Coinbase first — after a liquidation, the restore and the pay-down pay');
    out('the Coinbase leftover first, in every zone; on = the default: Strike first, the leftover after it. Each with the doom');
    out('gate (D) off and on; on is compared with off per cell (₿ held > 1e-9, all-in equity > 50¢). The deficiency is the debt a seizure');
    out('left — it does not depend on the order. CB debt left = a liquidated cell still owing Coinbase at the end; months to');
    out('clear = from the liquidation to the deficiency repaid, over the cells that clear. D − base = §4 v1.1\'s check, under');
    out('each order.');
    out();
    out('| Grid | seed ₿ | D | cells changed | ₿ better / worse | all-in better / worse (Σ) | Σ Strike interest off → on | Strike sale cells off → on | Σ deficiency at liquidation | CB debt left at end (cells) off → on | median months to clear off → on | D − base, off order | D − base, on order |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const grids: [string, GridCell[], (number | null)[]][] = [
      ['face-world', faceWorldGrid(), [0, 0.5]],
      ['synthetic single-crash', syntheticGrid(), [null]],
      ['reachability', reachGrid(), [0, 0.5]],
    ];
    /** Months from the liquidation until the deficiency is repaid (null: none, or never cleared within the run). */
    const monthsToClear = (r: CyclingResult): number | null => {
      if (r.liqMonth === null || !((r.deficiencyUsd ?? 0) > 0)) return null;
      for (let m = r.liqMonth + 1; m < r.rows.length; m++) if (r.rows[m].cbDebt < 0.005) return m - r.liqMonth;
      return null;
    };
    const leftAtEnd = (r: CyclingResult): boolean => r.liqMonth !== null && r.last.cbDebt > 0.5;
    const moCount = (xs: number[]): string => (xs.length === 0 ? '—' : `${median(xs)} mo`);
    interface Pair {
      changed: number; vs: VsTally; skOff: number; skOn: number; salesOff: number; salesOn: number;
      defOff: number; defOn: number; leftOff: number; leftOn: number; clearOff: number[]; clearOn: number[];
      /** All-in-worse cells in which Strike first AVOIDED a Strike sale — the kept coins, at a no-recovery price, are
       *  worth only what the sale retired, and the interest on that debt is the loss. */
      allInWorseAvoidedSale: number;
    }
    const newPair = (): Pair => ({
      changed: 0, vs: newVsTally(), skOff: 0, skOn: 0, salesOff: 0, salesOn: 0, defOff: 0, defOn: 0,
      leftOff: 0, leftOn: 0, clearOff: [], clearOn: [], allInWorseAvoidedSale: 0,
    });
    const notePair = (p: Pair, off: CyclingResult, on: CyclingResult): void => {
      if (!isDeepStrictEqual(on, off)) p.changed++;
      noteVs(p.vs, on, off);
      if (allInEquity(on) - allInEquity(off) < -0.5 && off.strikeCallsSold > 0 && on.strikeCallsSold === 0) p.allInWorseAvoidedSale++;
      p.skOff += off.totalStrikeInterest;
      p.skOn += on.totalStrikeInterest;
      if (off.strikeCallsSold > 0) p.salesOff++;
      if (on.strikeCallsSold > 0) p.salesOn++;
      p.defOff += off.deficiencyUsd ?? 0;
      p.defOn += on.deficiencyUsd ?? 0;
      if (leftAtEnd(off)) p.leftOff++;
      if (leftAtEnd(on)) p.leftOn++;
      const co = monthsToClear(off);
      const cn = monthsToClear(on);
      if (co !== null) p.clearOff.push(co);
      if (cn !== null) p.clearOn.push(cn);
    };
    const allPairs: { label: string; p: Pair }[] = [];
    for (const [grid, cells, seeds] of grids) {
      for (const seed of seeds) {
        const byD = { off: newPair(), on: newPair() };
        const dVsBaseOff = newVsTally();
        const dVsBaseOn = newVsTally();
        for (const c of cells) {
          const inputs: CyclingInputs = {
            ...c.off, supportPolicy: policyFor(c.support), ...(seed === null ? {} : { openingColdBtc: seed }),
          };
          const run = (d: boolean, strikeFirst: boolean): CyclingResult =>
            runCyclingSim({ ...inputs, doomGateCbTopUp: d, strikeFirstAfterLiquidation: strikeFirst });
          const baseOff = run(false, false);
          const baseOn = run(false, true);
          const dOff = run(true, false);
          const dOn = run(true, true);
          notePair(byD.off, baseOff, baseOn);
          notePair(byD.on, dOff, dOn);
          noteVs(dVsBaseOff, dOff, baseOff);
          noteVs(dVsBaseOn, dOn, baseOn);
        }
        const seedLabel = seed === null ? 'own (0–1.0)' : `${seed}`;
        for (const [dLabel, p] of [['off', byD.off], ['on', byD.on]] as const) {
          // FIDELITY: the seizure happens before the order can act, so the deficiency cannot depend on it.
          expect(Math.abs(p.defOn - p.defOff), `${grid} · seed ${seedLabel} · D ${dLabel}`).toBeLessThan(1e-6);
          allPairs.push({ label: `${grid} · seed ${seedLabel} · D ${dLabel}`, p });
          const dCols = dLabel === 'on' ? `${fmtVs(dVsBaseOff)} | ${fmtVs(dVsBaseOn)}` : '— | —';
          out(`| ${grid} | ${seedLabel} | ${dLabel} | ${p.changed} | ${p.vs.btcBetter} / ${p.vs.btcWorse} | ${p.vs.allInBetter} / ${p.vs.allInWorse} (Σ ${sUsd(p.vs.allInDeltaUsd)}) | ${usd(p.skOff)} → ${usd(p.skOn)} | ${p.salesOff} → ${p.salesOn} | ${usd(p.defOff)} | ${p.leftOff} → ${p.leftOn} | ${moCount(p.clearOff)} → ${moCount(p.clearOn)} | ${dCols} |`);
        }
      }
    }
    out();
    out('## Findings (measured)');
    out();
    const btcWorse = allPairs.reduce((s, { p }) => s + p.vs.btcWorse, 0);
    const allInWorse = allPairs.filter(({ p }) => p.vs.allInWorse > 0);
    const worseN = allInWorse.reduce((s, { p }) => s + p.vs.allInWorse, 0);
    const worseAvoided = allInWorse.reduce((s, { p }) => s + p.allInWorseAvoidedSale, 0);
    out(`- **Strike first never loses ₿:** ₿ worse in ${btcWorse} cells across every grid, seed and D setting.`);
    out(`- **Its all-in losses:** ${worseN} cell-runs (${allInWorse.map(({ label, p }) => `${label} ${p.vs.allInWorse}`).join(', ') || 'none'}); ${worseAvoided} of them are cells where Strike first AVOIDED a Strike sale — the coins it kept are worth, at a no-recovery price, only what the sale retired, and the interest on that debt is the loss.`);
    out('<!-- SP_REPORT REPAYMENT END -->');

    console.log(lines.join('\n'));
  }, 300_000);

  // ── the crash playbook — its own block (`-t "crash playbook"`) ──
  it('prints the crash playbook measurement (pre / R / playbook / anyDepth; policy ON, the new repayment order)', () => {
    const lines: string[] = [];
    const out = (s = ''): void => { lines.push(s); };
    const depth = ceilingLiquidationMultiple(0.6, CB_LLTV);
    out('<!-- SP_REPORT CRASH PLAYBOOK BEGIN -->');
    out('# The crash playbook — Strike\'s release rules, top up first above the liquidation depth, measured');
    out();
    out('Every run is policy ON and on the NEW repayment order (Strike first after a Coinbase liquidation, in every zone).');
    out(`The variants: pre = the adopted order before the playbook (the release rules off, no top-up before the shift);`);
    out(`R = Strike's release rules alone (≤ 40% before, < 50% after, no move within 60 days of a deposit); playbook = the`);
    out(`defaults (R + top up first, between the depth ${depth.toFixed(4)} × support and support); anyDepth = top up first at`);
    out('every depth below support (measured, rejected). Better / worse: ₿ held > 1e-9; all-in equity > 50¢. Values in the');
    out('Σ columns read reference → variant. ₿ into a doomed CB = coins topped into Coinbase in its liquidation month; ₿ lost');
    out('in CB = coins topped in at or before it. G2 = cells that open inside both ceilings and pull cold at or above support.');
    out('₿-months in cold = Σ of each month-end cold balance.');
    out();

    // ── the sets ──
    const gridSets: [string, GridCell[], (number | null)[]][] = [
      ['face-world', faceWorldGrid(), [0, 0.5]],
      ['synthetic', syntheticGrid(), [null]],
      ['reachability', reachGrid(), [0, 0.5]],
    ];
    const sets: { name: string; recovering: boolean; grid: boolean; cells: PbCell[] }[] = [];
    for (const [grid, cells, seeds] of gridSets) {
      for (const seed of seeds) {
        const seedLabel = seed === null ? 'own seeds' : `seed ${seed}`;
        sets.push({
          name: `${grid}, ${seedLabel}`, recovering: grid !== 'synthetic', grid: true,
          cells: cells.map((c, i) => runPbCell(`${grid} #${i} (${seedLabel})`, {
            ...c.off, supportPolicy: policyFor(c.support), ...(seed === null ? {} : { openingColdBtc: seed }),
          })),
        });
      }
    }
    sets.push({
      name: 'rows', recovering: true, grid: false,
      cells: coldRuleRows().flatMap((row) => [0, 0.5].map((seed) =>
        runPbCell(`${row.name} · seed ${seed}`, { ...row.on, openingColdBtc: seed }))),
    });
    const drops = doubleDropRows().map((d) => runPbCell(d.name, d.on, d.f1, d.on.pricePath[12] / d.support[12]));
    sets.push({ name: 'double drops', recovering: false, grid: false, cells: drops });

    out('## Sets');
    out();
    out('| Set | Comparison | cells | changed | ₿ better / worse (Σ Δ₿) | all-in better / worse (Σ · loss) | survival → liquidated | liquidated → survival | Strike-sale cells changed | Σ debt shifted | Σ Strike interest | Σ ₿ out of Strike by a defense | ₿ into a doomed CB | ₿ lost in CB | G2 | ₿-months in cold |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const tallies = new Map<string, Map<PbPairName, PbTally>>();
    for (const set of sets) {
      const m = new Map<PbPairName, PbTally>(PB_PAIRS.map(([p]) => [p, tallyPb(set.cells, p)]));
      tallies.set(set.name, m);
      for (const [p] of PB_PAIRS) out(pbRow(set.name, p, m.get(p)!));
    }
    out();
    const gridCells = sets.filter((x) => x.grid).flatMap((x) => x.cells);
    out(`## All grids (${gridCells.length} cells)`);
    out();
    out('| Set | Comparison | cells | changed | ₿ better / worse (Σ Δ₿) | all-in better / worse (Σ · loss) | survival → liquidated | liquidated → survival | Strike-sale cells changed | Σ debt shifted | Σ Strike interest | Σ ₿ out of Strike by a defense | ₿ into a doomed CB | ₿ lost in CB | G2 | ₿-months in cold |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const allGrids = new Map<PbPairName, PbTally>(PB_PAIRS.map(([p]) => [p, tallyPb(gridCells, p)]));
    for (const [p] of PB_PAIRS) out(pbRow('all grids', p, allGrids.get(p)!));
    out();

    // ── double drops by first-leg depth ──
    out('## Double drops by first-leg depth — anyDepth vs R');
    out();
    out(`k1 = month 12's price ÷ support. The depth gate is ${depth.toFixed(4)}: a loss whose first leg sits below it is one the gate prevents.`);
    out();
    out('| f1 | rows | ₿ better / worse | Σ gain ₿ | Σ loss ₿ | losses with k1 below the depth |');
    out('|---|---|---|---|---|---|');
    for (const f1 of [0.7, 0.6, 0.5, 0.4]) {
      const cs = drops.filter((c) => c.f1 === f1);
      let better = 0;
      let worse = 0;
      let gain = 0;
      let loss = 0;
      let deeper = 0;
      for (const c of cs) {
        const d = c.stats.anyDepth.btc - c.stats.R.btc;
        if (d > 1e-9) { better++; gain += d; }
        if (d < -1e-9) { worse++; loss += d; if ((c.k1 ?? 1) < depth) deeper++; }
      }
      out(`| ${f1} | ${cs.length} | ${better} / ${worse} | ${sBtc(gain, 3)} | ${btc(loss, 3)} | ${deeper} of ${worse} |`);
    }
    out();

    // ── custody ──
    out('## Custody — ₿-months in cold, R → playbook');
    out();
    out('| Set | R | playbook | change | cells changed |');
    out('|---|---|---|---|---|');
    for (const set of sets) {
      const t = tallies.get(set.name)!.get('playbook vs R')!;
      const change = t.refCold > 0 ? `${(((t.vCold - t.refCold) / t.refCold) * 100).toFixed(2)}%` : '—';
      out(`| ${set.name} | ${btc(t.refCold, 1)} | ${btc(t.vCold, 1)} | ${change} | ${t.coldChanged} |`);
    }
    out();

    // ── invariants — bugs, not §4 outcomes ──
    out('## Invariants under the playbook (bugs, not §4 outcomes)');
    out();
    let broken = false;
    for (const set of sets) {
      const g2 = set.cells.filter((c) => c.stats.playbook.g2).map((c) => c.label);
      const into = set.cells.filter((c) => c.stats.playbook.intoDoomed > 0)
        .map((c) => `${c.label} ${btc(c.stats.playbook.intoDoomed, 4)}`);
      const intoSum = sum(set.cells.map((c) => c.stats.playbook.intoDoomed));
      out(`- **${set.name}:** G2 violations ${g2.length} · ₿ into a doomed Coinbase ${btc(intoSum, 4)}.`);
      if (g2.length > 0 || into.length > 0) {
        broken = true;
        out(`  - **STOP — invariant broken.** G2 cells: ${listCells(g2)}; ₿ into a doomed Coinbase: ${listCells(into)}.`);
      }
    }
    out(broken ? '- **STOP — invariant broken** (see above).' : '- Both invariants hold on every set.');
    out();

    // ── §4 v1.1, applied mechanically ──
    out('## §4 v1.1 — applied mechanically');
    out();
    const across = (pair: PbPairName, pick: (t: PbTally) => number, filter: (s: (typeof sets)[number]) => boolean = () => true): number =>
      sets.filter(filter).reduce((acc, set) => acc + pick(tallies.get(set.name)!.get(pair)!), 0);
    const pbBtcWorse = across('playbook vs R', (t) => t.btcWorse);
    const pbAllInBlocking = across('playbook vs R', (t) => t.allInWorse, (s) => s.name !== 'synthetic, own seeds');
    const synth = tallies.get('synthetic, own seeds')!.get('playbook vs R')!;
    out(`- **playbook vs R:** ${pbBtcWorse === 0 && pbAllInBlocking === 0 ? 'PASS' : 'FAIL'} — ₿ worse ${pbBtcWorse} (every set) · all-in worse outside the synthetic grid ${pbAllInBlocking} · all-in on the synthetic grid (no recovery, named): ${synth.allInWorse} worse (Σ loss ${usd(synth.allInLoss)}) · liquidations changed ${across('playbook vs R', (t) => t.survToLiq + t.liqToSurv)} · sale cells changed ${across('playbook vs R', (t) => t.salesChanged)}.`);
    const adBtcWorse = across('anyDepth vs R', (t) => t.btcWorse);
    const adAllInBlocking = across('anyDepth vs R', (t) => t.allInWorse, (s) => s.name !== 'synthetic, own seeds');
    const adDeeper = drops.filter((c) => c.stats.anyDepth.btc - c.stats.R.btc < -1e-9 && (c.k1 ?? 1) < depth).length;
    const adDropWorse = tallies.get('double drops')!.get('anyDepth vs R')!.btcWorse;
    out(`- **anyDepth vs R:** ${adBtcWorse === 0 && adAllInBlocking === 0 ? 'PASS' : 'FAIL'} (expected FAIL — the reason for the gate) — ₿ worse ${adBtcWorse}: ${sets.map((set) => `${set.name} ${tallies.get(set.name)!.get('anyDepth vs R')!.btcWorse}`).join(', ')} · of the double-drop losses, ${adDeeper} of ${adDropWorse} start below the depth · all-in worse outside the synthetic grid ${adAllInBlocking} · ₿-worse cells: ${listCells(sets.flatMap((set) => tallies.get(set.name)!.get('anyDepth vs R')!.btcWorseCells), 8)}.`);
    out('- **R vs pre — a correction, not a decision** (the engine now obeys Strike\'s release rules). Its cost, by set:');
    for (const set of sets) {
      const t = tallies.get(set.name)!.get('R vs pre')!;
      out(`  - ${set.name}: ₿ ${t.btcBetter} / ${t.btcWorse} (${sBtc(t.btcDelta, 3)}) · all-in ${t.allInBetter} / ${t.allInWorse} (Σ ${sUsd(t.allInDelta)}) · survival → liquidated ${t.survToLiq} · liquidated → survival ${t.liqToSurv} · sale cells changed ${t.salesChanged}.`);
    }
    out('<!-- SP_REPORT CRASH PLAYBOOK END -->');

    console.log(lines.join('\n'));
  }, 600_000);
});
