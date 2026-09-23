import { describe, it, expect } from 'vitest';
import { runCyclingSim, type CyclingInputs, type CyclingResult } from '../cyclingSim';
import { SUPPORT_EPS, type PolicyState } from '../supportPolicy';
import { cycleConvergencePath } from '../cyclePath';
import { STRIKE_MAX_DRAW_LTV } from '../strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';
import { applyPathStress } from '../../components/Almanac/cyclingFaceView';
import {
  SUPPORT, SP_REPRO, CASH_6_USD, policyFor, supportPathFor, buildP9, a5Cases, minMultiple,
} from './supportPolicyPaths';

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
 * file's pinned counts — or the grid numbers below describe some other grid.
 */

// ── formatting (manual, locale-free, so the output is byte-deterministic) ─────────────────────────────────────
const usd = (n: number): string => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const btc = (n: number, dp = 4): string => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(dp)}`;
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '∞');
const mo = (m: number | null): string => (m === null ? '—' : `m${m}`);
const ZONE_LETTER: Record<PolicyState, string> = { paused: 'P', accumulate: 'A', hold: 'H', payDown: 'D', broken: 'B' };
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

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
const insideBoth = (r: CyclingResult): boolean =>
  (r.rows[0].cbCeilingHeadroomUsd ?? -1) >= 0 && (r.rows[0].strikeCeilingHeadroomUsd ?? -1) >= 0;

// ── the existing grids, rebuilt EXACTLY as cyclingSim.test.ts builds them ────────────────────────────────────
const GRID_REPRO: CyclingInputs = {
  startYear: 2027,
  strikeCollateralBtc: 1, strikeBalance: 20_000, strikeCreditLine: 60_000,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
  cbCollateralBtc: 1, cbDebt: 40_000,
  income: 8_000, expenses: 6_000, strikeAprPct: 13, cbAprPct: 6.2,
  cycleMonths: 1, cbLtvCapPct: 50, defendCbLtv: true, coldStoreBufferPct: 30,
  pricePath: cycleConvergencePath(100_000, new Date('2027-01-01T00:00:00Z'), 60, 1),
};
interface GridCell { off: CyclingInputs; support: number[] }
function faceWorldGrid(): GridCell[] {
  const path = cycleConvergencePath(100_000, new Date('2027-01-01T00:00:00Z'), 60, 1);
  const support = supportPathFor(new Date('2027-01-01T00:00:00Z'), 60);
  const out: GridCell[] = [];
  for (const cbLtvCapPct of [50, 60, 70]) {
    for (let from = 1; from <= 59; from += 2) {
      for (const lens of [0.35, 0.5, 0.65, 0.8]) {
        out.push({ off: { ...GRID_REPRO, cbLtvCapPct, strikeLtvCapPct: 60, pricePath: applyPathStress(path, from, lens) }, support });
      }
    }
  }
  return out;
}
function syntheticGrid(): (GridCell & { capOff: CyclingInputs })[] {
  const out: (GridCell & { capOff: CyclingInputs })[] = [];
  for (const strikeBalance of [0, 10_000, 20_000, 30_000, 40_000]) for (const cbDebt of [40_000, 50_000, 60_000, 70_000])
  for (const openingColdBtc of [0, 0.1, 0.2, 0.3, 0.5, 1.0]) for (const pre of [1, 3, 6]) for (const depth of [0.4, 0.5, 0.6, 0.7])
  for (const coldStoreBufferPct of [0, 30]) for (const cycleMonths of [1, 999]) {
    const capOff: CyclingInputs = {
      ...GRID_REPRO, cbLtvCapPct: 50, strikeBalance, cbDebt, openingColdBtc, coldStoreBufferPct, cycleMonths,
      pricePath: [...new Array(pre + 1).fill(100_000), ...new Array(12).fill(100_000 * depth)],
    };
    out.push({ capOff, off: { ...capOff, strikeLtvCapPct: 60 }, support: supportPathFor(new Date('2027-01-01T00:00:00Z'), pre + 12) });
  }
  return out;
}
function reachGrid(): GridCell[] {
  const path = cycleConvergencePath(100_000, new Date('2026-09-21T00:00:00Z'), 60, 1);
  const support = supportPathFor(new Date('2026-09-21T00:00:00Z'), 60);
  const out: GridCell[] = [];
  for (let from = 0; from <= 60; from++) {
    for (let k = 35; k <= 80; k++) {
      out.push({ off: { ...GRID_REPRO, startYear: 2026, strikeLtvCapPct: 60, pricePath: applyPathStress(path, from, k / 100) }, support });
    }
  }
  return out;
}

interface GridTally {
  n: number; offLiq: number; onLiq: number; offCalls: number; onCalls: number; onSales: number; onSoldBtc: number;
  offColdAboveCells: number; offColdAboveBtc: number; onColdAboveCells: number; onColdAboveBtc: number;
  medianDeltaBtc: number; inside: number; g2Violations: number; g3Scope: number; g3OnLiq: number; g3OffLiq: number;
  onAppliedAll: boolean;
}
function tallyGrid(cells: GridCell[]): GridTally {
  const t: GridTally = {
    n: cells.length, offLiq: 0, onLiq: 0, offCalls: 0, onCalls: 0, onSales: 0, onSoldBtc: 0,
    offColdAboveCells: 0, offColdAboveBtc: 0, onColdAboveCells: 0, onColdAboveBtc: 0,
    medianDeltaBtc: 0, inside: 0, g2Violations: 0, g3Scope: 0, g3OnLiq: 0, g3OffLiq: 0, onAppliedAll: true,
  };
  const deltas: number[] = [];
  for (const c of cells) {
    const off = runCyclingSim(c.off);
    const on = runCyclingSim({ ...c.off, supportPolicy: policyFor(c.support) });
    if (!on.policyApplied) t.onAppliedAll = false;
    if (off.liqMonth !== null) t.offLiq++;
    if (on.liqMonth !== null) t.onLiq++;
    if (off.strikeMarginMonth !== null) t.offCalls++;
    if (on.firstStrikeCallMonth !== null) t.onCalls++;
    if (on.strikeCallsSold > 0) t.onSales++;
    t.onSoldBtc += on.totalStrikeLiquidatedBtc;
    const offAbove = coldRetrievedAbove(off, c.support);
    if (offAbove > 1e-12) { t.offColdAboveCells++; t.offColdAboveBtc += offAbove; }
    if (on.coldRetrievedAboveSupportBtc > 1e-12) { t.onColdAboveCells++; t.onColdAboveBtc += on.coldRetrievedAboveSupportBtc; }
    deltas.push(on.last.btcHeld - off.last.btcHeld);
    if (insideBoth(on)) {
      t.inside++;
      if (on.coldRetrievedAboveSupportBtc > 0) t.g2Violations++;
      if (minMultiple(c.off.pricePath, c.support) >= 0.8 - 1e-9) {
        t.g3Scope++;
        if (on.liqMonth !== null) t.g3OnLiq++;
        if (off.liqMonth !== null) t.g3OffLiq++;
      }
    }
  }
  t.medianDeltaBtc = median(deltas);
  return t;
}

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
    out('# A5 — support-anchored policy, measured (Run 1)');
    out();
    out('Fixture SP_REPRO (round synthetic): start 2027-01-01, 72 months; Strike 1.0 ₿ / $0 / $30k line; Coinbase 1.0 ₿ / $30k;');
    out('cold 0; $8k income / $6k bills; 13% / 6.27%; cadence 1; CB cap 70; Strike cap 60; defend on. OFF = the faces\'');
    out('defaults (sweep 30). ON = the default policy (stops 60 / 50 at support, zones 1.5 / 2.0, 12-month buffer, cash 0).');
    out(`Support at start S₀ = ${usd(SUPPORT[0])}; every path opens at 1.35 × S₀ = ${usd(1.35 * SUPPORT[0])}.`);
    out();

    // ── G5 · the face defaults ──
    out('## G5 — disclosure on the face-default paths (OFF vs ON)');
    out();
    out('| Path | ₿ held OFF | ₿ held ON | cold OFF | cold ON | debt OFF | debt ON | equity OFF | equity ON |');
    out('|---|---|---|---|---|---|---|---|---|');
    for (const name of ['P1', 'P2', 'P2 (phase −4)']) {
      const r = runs.find((x) => x.c.name === name)!;
      out(`| ${name} | ${btc(r.off.last.btcHeld)} | ${btc(r.on.last.btcHeld)} | ${btc(r.off.totalColdBtc)} | ${btc(r.on.totalColdBtc)} | ${usd(r.off.last.debt)} | ${usd(r.on.last.debt)} | ${usd(r.off.last.equity)} | ${usd(adjEquity(r.on))} |`);
    }
    out();

    // ── end-of-run per path ──
    out('## Per path — end of run (OFF vs ON, cash 0; ON with 6 months of cash in brackets where it differs)');
    out();
    out('| Path | ₿ held OFF | ₿ held ON | cold OFF | cold ON | debt OFF | debt ON | equity OFF | equity ON (adj.) | CB liq OFF / ON | unfunded OFF / ON | cash left (cash 6) |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { c, off, on, on6 } of runs) {
      const alt = (a: string, b: string): string => (a === b ? a : `${a} [${b}]`);
      out(`| ${c.name} | ${btc(off.last.btcHeld)} | ${alt(btc(on.last.btcHeld), btc(on6.last.btcHeld))} | ${btc(off.totalColdBtc)} | ${alt(btc(on.totalColdBtc), btc(on6.totalColdBtc))} | ${usd(off.last.debt)} | ${alt(usd(on.last.debt), usd(on6.last.debt))} | ${usd(off.last.equity)} | ${alt(usd(adjEquity(on)), usd(adjEquity(on6)))} | ${mo(off.liqMonth)} / ${alt(mo(on.liqMonth), mo(on6.liqMonth))} | ${usd(off.totalUnfundedUsd)} / ${alt(usd(on.totalUnfundedUsd), usd(on6.totalUnfundedUsd))} | ${usd(on6.cashLeftUsd)} |`);
    }
    out();

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
    out('| Grid | cells | CB liq OFF / ON | Strike calls OFF (flag) / ON (modelled) | ON sales (cells, ₿) | cold ≥ support OFF (cells, ₿) / ON | median Δ₿ held (ON − OFF) | inside both ceilings | G2 violations | G3 scope (≥ 0.80 × S, inside) | G3 CB liq ON / OFF |');
    out('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [name, cells] of [['face-world', fw], ['synthetic single-crash', syn], ['reachability', reach]] as const) {
      const t = tallyGrid(cells);
      expect(t.onAppliedAll).toBe(true);
      out(`| ${name} | ${t.n} | ${t.offLiq} / ${t.onLiq} | ${t.offCalls} / ${t.onCalls} | ${t.onSales}, ${btc(t.onSoldBtc, 3)} | ${t.offColdAboveCells}, ${btc(t.offColdAboveBtc, 3)} / ${t.onColdAboveCells}, ${btc(t.onColdAboveBtc, 3)} | ${btc(t.medianDeltaBtc)} | ${t.inside} | ${t.g2Violations} | ${t.g3Scope} | ${t.g3OnLiq} / ${t.g3OffLiq} |`);
    }
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
});
