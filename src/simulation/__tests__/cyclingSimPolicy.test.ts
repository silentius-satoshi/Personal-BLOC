import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  runCyclingSim, type CyclingInputs, type CyclingResult, type CyclingRow, type SupportPolicyInputs,
  type PolicyIgnoredReason,
} from '../cyclingSim';
import { collateralToSellForLtv, SUPPORT_EPS } from '../supportPolicy';
import { STRIKE_CURE_LTV } from '../strikeCredit';
import {
  SP_START, SP_MONTHS, SUPPORT, S0, SP_REPRO, CASH_6_USD, policyFor, supportPathFor, pathP1, pathP2, pathP3,
  pathP4, pathP5, pathP6, incomeShockP7, buildP9, a5Cases, minMultiple, cbLtvAtSupport, multiplePath, type A5Case,
} from './supportPolicyPaths';

/**
 * The support-anchored policy in the ENGINE (spec v1.2 §A3). Round synthetic figures only — this repo is public.
 *
 * ⚠ The G1 golden (`goldens/supportPolicyG1.golden.json`) is the policy-ABSENT engine at 2125cc2, captured
 * before a line of the policy existed. Regenerate it only deliberately, from the SHA in its meta. A diff to it
 * means policy-absent behaviour moved.
 *
 * ⚠ The G1 runs feed the engine the golden's STORED price path, never a recomputed P2. P2 is built with
 * Math.pow, which ECMAScript leaves implementation-approximated: its last bit differs between Node 22 (CI) and
 * Node 26 on about one input in ten, and that alone failed CI when the runs recomputed the path. The engine is
 * pure + − × ÷ (IEEE-exact on every runtime; a G1 test walks its imports to keep it so), so a stored input
 * reproduces bit for bit anywhere. The path itself is held to the store within a relative 1e-12.
 *
 * ⚠ runs[2] (P9-OFF, $4k / $6k, added in Run 1.1) is REGRESSION COVERAGE of the defense-heavy policy-OFF engine —
 * its month-end CB LTV sits on the 70% cap and the debt shift and top-up fire. It is NOT a mutant-killer: the
 * draw-test LTV never lands on or just over the cap there. The exact-at-cap pin in cyclingSim.test.ts is.
 */

const smr = SP_REPRO.strikeAprPct / 100 / 12;
const cmr = SP_REPRO.cbAprPct / 100 / 12;
/** The default stops AFTER the engine clamps: min(60, CB cap 70) and min(50, Strike cap 60). */
const CB_STOP = 0.60;
const SK_STOP = 0.50;

const on = (pricePath: number[], o: Partial<SupportPolicyInputs> = {}, extra: Partial<CyclingInputs> = {},
  support: number[] = SUPPORT): CyclingResult =>
  runCyclingSim({ ...SP_REPRO, ...extra, pricePath, supportPolicy: policyFor(support, o) });

const field = (x: CyclingRow, k: string): unknown => (x as unknown as Record<string, unknown>)[k];
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const aboveSupport = (price: number, support: number): boolean => price / support >= 1 - SUPPORT_EPS;
const insideBothCeilings = (r: CyclingResult): boolean =>
  (r.rows[0].cbCeilingHeadroomUsd ?? -1) >= 0 && (r.rows[0].strikeCeilingHeadroomUsd ?? -1) >= 0;

/** Test 16's fixture — Strike near its ceiling, Coinbase DEBT-FREE (else Coinbase liquidates at 0.65 × S before
 *  the call can be isolated — flagged), then a fall to 0.65 × support for two months. */
const CALL_SUPPORT = supportPathFor(SP_START, 2);
const CALL_PATH = [1.35 * S0, 0.65 * CALL_SUPPORT[1], 0.65 * CALL_SUPPORT[2]];
const CALL_BASE: Omit<CyclingInputs, 'pricePath'> = { ...SP_REPRO, strikeBalance: 34_000, strikeCreditLine: 40_000, cbDebt: 0 };
const callRun = (o: Partial<SupportPolicyInputs> = {}, extra: Partial<CyclingInputs> = {}): CyclingResult =>
  runCyclingSim({ ...CALL_BASE, ...extra, pricePath: CALL_PATH, supportPolicy: policyFor(CALL_SUPPORT, o) });

/** v1.1 #3's fixture — Coinbase is DOOMED at month 1 (Strike's line is nearly used and too little collateral can
 *  move), and Strike is called LATER as the price keeps falling. income = bills, so no surplus pays Strike down. */
const LIQ_SUPPORT = supportPathFor(SP_START, 4);
const LIQ_PATH = [1.35 * S0, 0.45 * LIQ_SUPPORT[1], 0.40 * LIQ_SUPPORT[2], 0.35 * LIQ_SUPPORT[3], 0.35 * LIQ_SUPPORT[4]];
const LIQ_BASE: Omit<CyclingInputs, 'pricePath'> = {
  ...SP_REPRO, income: 6_000, strikeCreditLine: 20_000, strikeBalance: 19_000, cbDebt: 41_000,
};
const liqRun = (pricePath = LIQ_PATH, o: Partial<SupportPolicyInputs> = {}): CyclingResult =>
  runCyclingSim({ ...LIQ_BASE, pricePath, supportPolicy: policyFor(supportPathFor(SP_START, pricePath.length - 1), o) });

/** v1.3 #13's fixture — one crash to 0.30 × support takes Strike over 100% LTV, so its sale takes the WHOLE
 *  collateral; Coinbase is debt-free, so nothing else moves. Every month stays below support (paused, then broken). */
const EMPTY_SUPPORT = supportPathFor(SP_START, 12);
const EMPTY_PATH = EMPTY_SUPPORT.map((s, m) => (m === 0 ? 1.35 * S0 : 0.3 * s));
const EMPTY_BASE: Omit<CyclingInputs, 'pricePath'> = { ...SP_REPRO, strikeBalance: 34_000, strikeCreditLine: 40_000, cbDebt: 0 };
const emptyRun = (): CyclingResult =>
  runCyclingSim({ ...EMPTY_BASE, pricePath: EMPTY_PATH, supportPolicy: policyFor(EMPTY_SUPPORT) });

/** The coin ledger: coins leave only by purchase in, Strike sale out, or Coinbase seizure out. ⚠ The seizure is
 *  applied AFTER its row is pushed, so a liquidation in the LAST month has not left `last.btcHeld` yet. */
function expectLedgersFoot(r: CyclingResult, inputs: CyclingInputs): void {
  const bought = r.rows.reduce((s, x) => s + (x.price > 0 ? x.btcBoughtUsd / x.price : 0), 0);
  const seized = r.liqMonth !== null && r.liqMonth < r.last.m ? (r.seizedBtc ?? 0) : 0;
  const opening = inputs.strikeCollateralBtc + inputs.cbCollateralBtc + r.openingColdBtc;
  expect(r.last.btcHeld).toBeCloseTo(opening + bought - r.totalStrikeLiquidatedBtc - seized, 8);
  expect(r.openingColdBtc + r.totalColdFromCb + r.totalColdFromStrike - r.totalColdRetrievedBtc).toBeCloseTo(r.totalColdBtc, 8);
  expect(r.openingCashUsd - r.totalCashToBillsUsd - r.totalCashToCureUsd).toBeCloseTo(r.cashLeftUsd, 8);
}

// ── Test 8 · G1 ───────────────────────────────────────────────────────────────────────────────────────────

interface GoldenRun {
  name: string; pricePath: number[]; rowKeys: string[]; rows: unknown[][]; result: Record<string, unknown>;
  /** P2 runs: the cycle's phase shift. */
  phase?: number;
  /** P9-OFF: the inputs it overrides on SP_REPRO, and the month its 0.80 × support dip starts. */
  overrides?: Partial<CyclingInputs>;
  dipStart?: number;
}
const golden = JSON.parse(
  readFileSync(new URL('./goldens/supportPolicyG1.golden.json', import.meta.url), 'utf8'),
) as { meta: { inputs: Record<string, unknown> }; runs: GoldenRun[] };

function expectGolden(r: CyclingResult, run: GoldenRun): void {
  const rows = r.rows.map((x) => run.rowKeys.map((k) => field(x, k)));
  expect(json(rows)).toEqual(run.rows);
  const result = Object.fromEntries(Object.keys(run.result).map((k) => [k, (r as unknown as Record<string, unknown>)[k]]));
  expect(json(result)).toEqual(run.result);
}

const NEW_ROW_FIELDS = [
  'policyZone', 'multiple', 'cbCeilingHeadroomUsd', 'strikeCeilingHeadroomUsd', 'restoreUsd', 'payDownUsd',
  'cashReserveUsd', 'cashToBillsUsd', 'cashToCureUsd', 'strikeCall', 'strikeCureColdBtc', 'strikeLiquidatedBtc',
] as const;

describe('⭐ G1 · policy absent (or invalid) ⇒ byte-identical to the HEAD engine', () => {
  it('the fixture and the paths are what the golden was captured from (paths to 1e-12 — both use Math.pow)', () => {
    expect(json(SP_REPRO)).toEqual(golden.meta.inputs);
    expect(golden.runs.map((g) => g.name)).toEqual(['P2 phase 0', 'P2 phase -4', 'P9-OFF $4k / $6k']);
    const expectPath = (path: number[], g: GoldenRun): void => {
      expect(path).toHaveLength(g.pricePath.length);
      path.forEach((p, m) => expect(Math.abs(p / g.pricePath[m] - 1), `${g.name}, m${m}`).toBeLessThan(1e-12));
    };
    const [p2a, p2b, p9] = golden.runs;
    expect([p2a.phase, p2b.phase]).toEqual([0, -4]);
    for (const g of [p2a, p2b]) expectPath(pathP2(g.phase!), g);
    // P9-OFF is P1 with 0.80 × support at its STORED dip — deliberately NOT buildP9, which runs the policy engine:
    // G1 must never depend on the thing it is guarding against.
    expect(p9.overrides).toEqual({ income: 4_000 });
    const dip = p9.dipStart!;
    expectPath(pathP1().map((p, m) => (m === dip || m === dip + 1 ? 0.8 * SUPPORT[m] : p)), p9);
    // Why it is here: the OFF engine sits on its 70% cap at month-end, defense-heavy.
    const cbLtv = p9.rowKeys.indexOf('cbLtv');
    expect(p9.rows.filter((row) => Math.abs((row[cbLtv] as number) - 0.7) < 1e-9).length).toBeGreaterThanOrEqual(10);
  });

  it('⭐ policy absent: every pre-existing row and result field equals the golden (P2 phase 0 and −4, P9-OFF)', () => {
    for (const g of golden.runs) expectGolden(runCyclingSim({ ...SP_REPRO, ...g.overrides, pricePath: g.pricePath }), g);
  });

  it('the engine is pure + − × ÷ — no implementation-approximated Math in its import graph (G1 stays exact)', () => {
    const APPROXIMATED = /Math\.(a?sinh?|a?cosh?|a?tanh?|atan2|cbrt|exp|expm1|hypot|log|log1p|log2|log10|pow)\b|\*\*/;
    // A relative import in EITHER quote style — a double-quoted import must not slip a module past the walk.
    const RELATIVE_IMPORT = /from\s*['"]\.\/(\w+)['"]/g;
    expect([...'import a from "./dq";\nimport { b } from \'./sq\';'.matchAll(RELATIVE_IMPORT)].map((m) => m[1]))
      .toEqual(['dq', 'sq']);
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const m of src.matchAll(RELATIVE_IMPORT)) walk(`${m[1]}.ts`);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(APPROXIMATED);
    };
    walk('cyclingSim.ts');
    expect([...seen]).toEqual(expect.arrayContaining(
      ['cyclingSim.ts', 'supportPolicy.ts', 'cbDefense.ts', 'runCoinbaseLoan.ts', 'ltv.ts']));
  });

  it('policy absent: the 12 new row fields and the new result fields are all neutral', () => {
    const r = runCyclingSim({ ...SP_REPRO, pricePath: pathP2(0) });
    expect(NEW_ROW_FIELDS).toHaveLength(12);
    for (const x of r.rows) {
      expect(x.policyZone).toBeNull();
      expect(x.multiple).toBeNull();
      expect(x.cbCeilingHeadroomUsd).toBeNull();
      expect(x.strikeCeilingHeadroomUsd).toBeNull();
      expect(x.strikeCall).toBe('none');
      for (const k of ['restoreUsd', 'payDownUsd', 'cashReserveUsd', 'cashToBillsUsd', 'cashToCureUsd',
        'strikeCureColdBtc', 'strikeLiquidatedBtc']) expect(field(x, k)).toBe(0);
    }
    expect(r.policyApplied).toBe(false);
    expect(r.policyIgnoredReason).toBeNull();
    expect(r.monthsInZone).toEqual({ paused: 0, accumulate: 0, hold: 0, payDown: 0, broken: 0 });
    for (const k of ['firstPausedMonth', 'firstPayDownMonth', 'modelBrokenMonth', 'firstCeilingThrottleMonth',
      'firstStrikeCallMonth', 'firstStrikeLiquidationMonth', 'firstRearmMonth'] as const) expect(r[k]).toBeNull();
    for (const k of ['strikeCallsCured', 'strikeCallsSold', 'totalStrikeLiquidatedBtc', 'totalRestoreUsd',
      'totalPayDownUsd', 'openingCashUsd', 'cashLeftUsd', 'totalCashToBillsUsd', 'totalCashToCureUsd',
      'coldRetrievedAboveSupportBtc', 'breakCount'] as const) expect(r[k]).toBe(0);
  });

  it('⭐ an INVALID policy is ignored: the same golden, policyApplied false, and the reason', () => {
    const bad = (m: number, v: number) => SUPPORT.map((s, i) => (i === m ? v : s));
    const cases: [PolicyIgnoredReason, SupportPolicyInputs][] = [
      ['supportPath', policyFor(SUPPORT.slice(0, SP_MONTHS))],
      ['supportPath', policyFor(bad(5, Number.NaN))],
      ['supportPath', policyFor(bad(5, 0))],
      ['supportPath', policyFor(bad(5, -1))],
      ['supportPath', policyFor(bad(5, Number.POSITIVE_INFINITY))],
      ['cbStop', policyFor(SUPPORT, { cbStopAtSupportPct: 0 })],
      ['cbStop', policyFor(SUPPORT, { cbStopAtSupportPct: 86 })],
      ['cbStop', policyFor(SUPPORT, { cbStopAtSupportPct: Number.NaN })],
      ['strikeStop', policyFor(SUPPORT, { strikeStopAtSupportPct: 0 })],
      ['strikeStop', policyFor(SUPPORT, { strikeStopAtSupportPct: 70 })],
      ['strikeStop', policyFor(SUPPORT, { strikeStopAtSupportPct: Number.NaN })],
      ['zones', policyFor(SUPPORT, { accumulateBelow: 0 })],
      ['zones', policyFor(SUPPORT, { accumulateBelow: 2, payDownAbove: 2 })],
      ['zones', policyFor(SUPPORT, { accumulateBelow: 2.5 })],
      ['zones', policyFor(SUPPORT, { payDownAbove: Number.NaN })],
      ['buffer', policyFor(SUPPORT, { bearBufferMonths: -1 })],
      ['buffer', policyFor(SUPPORT, { bearBufferMonths: Number.NaN })],
      ['cash', policyFor(SUPPORT, { openingCashUsd: -1 })],
      ['cash', policyFor(SUPPORT, { openingCashUsd: Number.NaN })],
      ['strikeLadder', policyFor(SUPPORT, { strikeCureLtv: 0.70 })],
      ['strikeLadder', policyFor(SUPPORT, { strikeCureLtv: 0 })],
      ['strikeLadder', policyFor(SUPPORT, { strikePartialLiqLtv: 0.70 })],
      ['strikeLadder', policyFor(SUPPORT, { strikePartialLiqLtv: 1.01 })],
      ['retrieveLtv', policyFor(SUPPORT, { strikeRetrieveMaxLtv: 0 })],
      ['retrieveLtv', policyFor(SUPPORT, { strikeRetrieveMaxLtv: 0.51 })],
      ['rearm', policyFor(SUPPORT, { breakerRearmMonths: 0 })],
      ['rearm', policyFor(SUPPORT, { breakerRearmMonths: -1 })],
      ['rearm', policyFor(SUPPORT, { breakerRearmMonths: 1.5 })],
      ['rearm', policyFor(SUPPORT, { breakerRearmMonths: Number.NaN })],
      ['rearm', policyFor(SUPPORT, { breakerRearmMonths: Number.POSITIVE_INFINITY })],
    ];
    for (const [reason, supportPolicy] of cases) {
      const r = runCyclingSim({ ...SP_REPRO, pricePath: golden.runs[0].pricePath, supportPolicy });
      expect(r.policyApplied, reason).toBe(false);
      expect(r.policyIgnoredReason, reason).toBe(reason);
      expectGolden(r, golden.runs[0]);
    }
  });

  it('a non-cycle mode ignores the policy ("mode") — identical to the same mode without one', () => {
    for (const mode of ['hold', 'clearStrike', 'clearBoth'] as const) {
      const without = runCyclingSim({ ...SP_REPRO, mode, pricePath: pathP2(0) });
      const withBad = runCyclingSim({ ...SP_REPRO, mode, pricePath: pathP2(0), supportPolicy: policyFor(SUPPORT) });
      expect(withBad.policyApplied).toBe(false);
      expect(withBad.policyIgnoredReason).toBe('mode');
      expect(withBad.rows).toEqual(without.rows);
    }
  });

  it('a CB cap of 0 leaves no effective stop (the clamp) → ignored ("cbStop"), identical to no policy', () => {
    const without = runCyclingSim({ ...SP_REPRO, cbLtvCapPct: 0, pricePath: pathP2(0) });
    const r = runCyclingSim({ ...SP_REPRO, cbLtvCapPct: 0, pricePath: pathP2(0), supportPolicy: policyFor(SUPPORT) });
    expect(r.policyIgnoredReason).toBe('cbStop');
    expect(r.rows).toEqual(without.rows);
  });
});

// ── Test 9 · the alignment pin + the opening row ────────────────────────────────────────────────────────

describe('the support path and the opening row', () => {
  it('⭐ alignment pin: P1 IS the support path, bit for bit, from month 1', () => {
    const p1 = pathP1();
    expect(p1[0]).toBe(1.35 * S0);
    for (let m = 1; m <= SP_MONTHS; m++) expect(p1[m]).toBe(SUPPORT[m]);
  });

  it('month 0 carries the opening zone, multiple and both headrooms — and takes no action', () => {
    const r = on(pathP1());
    const x = r.rows[0];
    expect(r.policyApplied).toBe(true);
    expect(x.policyZone).toBe('accumulate');
    expect(x.multiple).toBeCloseTo(1.35, 12);
    expect(x.cbCeilingHeadroomUsd).toBeCloseTo(S0 * CB_STOP - 30_000, 6);
    expect(x.strikeCeilingHeadroomUsd).toBeCloseTo(S0 * SK_STOP, 6);
    expect(x.strikeCall).toBe('none');
    for (const k of ['restoreUsd', 'payDownUsd', 'cashToBillsUsd', 'cashToCureUsd', 'strikeCureColdBtc',
      'strikeLiquidatedBtc', 'strikeDrawn', 'btcBoughtUsd']) expect(field(x, k)).toBe(0);
    // monthsInZone counts the plan's months (m ≥ 1), never the opening.
    expect(Object.values(r.monthsInZone).reduce((a, b) => a + b, 0)).toBe(SP_MONTHS);
  });
});

// ── Test 10 · the ceiling invariant ─────────────────────────────────────────────────────────────────────

describe('⭐ the ceiling invariant — debt is sized at support, whatever the price', () => {
  it('every accumulate row sits under both ceilings at support (Strike: plus that month\'s interest)', () => {
    // ⚠ The $8k / $6k budget never fills the ceiling (v1.2 #6), so on it the spec's named mutation — price for
    // support in the draw — changes nothing. The $4k / $6k budget on P2's rise is where the ceiling binds.
    let checked = 0;
    const runs = [pathP1(), pathP2(0), pathP2(-4), pathP3()].flatMap((p) => [on(p), on(p, {}, { income: 4_000 })]);
    for (const r of runs) {
      for (const x of r.rows) {
        if (x.m === 0 || x.policyZone !== 'accumulate') continue;
        expect(x.cbDebt).toBeLessThanOrEqual(x.cbCollateralBtc * SUPPORT[x.m] * CB_STOP + 1e-6);
        expect(x.strikeBalance).toBeLessThanOrEqual(x.strikeCollateralBtc * SUPPORT[x.m] * SK_STOP * (1 + smr) + 1e-6);
        // Strike is a CONDUIT, not a store (the cbAbsorb rule): an accumulate month draws only what Coinbase can
        // take back, so the refinance leaves at most a month's interest on Strike. ⚠ This clause, not the Strike
        // ceiling, is what the spec-named mutation (price for support in the draw) breaks: once the migration
        // keeps the full line's collateral at support, Strike's own ceiling is at least the line and cannot bind.
        expect(x.strikeBalance).toBeLessThanOrEqual(SP_REPRO.expenses * smr + 1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    // Non-vacuous: the ceilings actually CUT the draw somewhere in the set (the $4k runs — never the $8k ones).
    // Month-end sits a little under the line even then, because the month's purchases add room after the draw.
    expect(runs.some((r) => r.firstCeilingThrottleMonth !== null)).toBe(true);
  });
});

// ── Test 11 · G2 ────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ G2 · cold is never retrieved at or above support (openings inside both ceilings)', () => {
  it('every A5 path (P1–P9): zero cold retrieved in any month at or above support', () => {
    const runs: { name: string; r: CyclingResult; support: number[] }[] = a5Cases()
      .map((c) => ({ name: c.name, r: runCyclingSim(c.on), support: c.support }));
    // Non-vacuity (v1.2 #12): no A5 path retrieves cold BELOW support either (a finding — the policy keeps Coinbase
    // far from its defense line), so the detector is proven on test 16's fixture with seeded cold, where the
    // Strike cap's cold → Strike top-up fires below support by construction.
    runs.push({ name: 'test 16 fixture + 0.5 ₿ cold', r: callRun({}, { openingColdBtc: 0.5 }), support: CALL_SUPPORT });
    let belowSupportRetrievals = 0;
    for (const { name, r, support } of runs) {
      expect(insideBothCeilings(r), name).toBe(true);
      expect(r.coldRetrievedAboveSupportBtc, name).toBe(0);
      for (let m = 1; m < r.rows.length; m++) {
        const moved = r.rows[m].coldRetrievedBtc - r.rows[m - 1].coldRetrievedBtc;
        if (aboveSupport(r.rows[m].price, support[m])) expect(moved, `${name} m${m}`).toBe(0);
        else if (moved > 0) belowSupportRetrievals++;
      }
    }
    expect(belowSupportRetrievals).toBeGreaterThan(0);
  });

  it('an opening OVER the Coinbase ceiling can pull cold AT support — and the field counts every coin of it', () => {
    // Why G2 is scoped to openings inside both ceilings: Coinbase opens at 75% at support with Strike's line full,
    // so on the line the debt shift has no capacity and the top-up takes cold — at a price ON support.
    const r = on(pathP1(), {}, { cbDebt: 52_000, strikeBalance: 30_000, openingColdBtc: 0.5 });
    expect(r.rows[0].cbCeilingHeadroomUsd!).toBeLessThan(0);
    let atOrAbove = 0;
    for (let m = 1; m < r.rows.length; m++) {
      if (aboveSupport(r.rows[m].price, SUPPORT[m])) atOrAbove += r.rows[m].coldRetrievedBtc - r.rows[m - 1].coldRetrievedBtc;
    }
    expect(atOrAbove).toBeGreaterThan(0);
    expect(r.coldRetrievedAboveSupportBtc).toBeCloseTo(atOrAbove, 12);
  });
});

// ── Test 12 · G3 ────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ G3 · no Coinbase liquidation on a path that stays at or above 0.80 × support', () => {
  /** The spec's own synthetic stress: up to 2.8× support over 24 months, then down to 1.0× over 12. */
  const SYNTHETIC = multiplePath([[0, 1.35], [24, 2.8], [36, 1.0], [72, 1.0]]);

  it('every in-scope path survives — P6 and P9 are in scope (both bottom at exactly 0.80 × support), P3 is not', () => {
    const cases: A5Case[] = [...a5Cases(), {
      name: 'synthetic 2.8× → 1.0×', off: { ...SP_REPRO, pricePath: SYNTHETIC },
      on: { ...SP_REPRO, pricePath: SYNTHETIC, supportPolicy: policyFor(SUPPORT) }, support: SUPPORT,
    }];
    const inScope = cases.filter((c) =>
      minMultiple(c.on.pricePath, c.support) >= 0.8 - 1e-9 && insideBothCeilings(runCyclingSim(c.on)));
    const names = inScope.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'P1', 'P2', 'P4', 'P5', 'P6', 'P7 (cash 0)', 'P9 ($4k / $6k)', 'P9 ($8k / $6k)', 'synthetic 2.8× → 1.0×',
    ]));
    expect(names).not.toContain('P3');   // P3 decays to ~0.59 × support — out of scope by the gate's definition
    for (const c of inScope) expect(runCyclingSim(c.on).liqMonth, c.name).toBeNull();
  });

  it('non-vacuity: the synthetic path liquidates the strategy without its defenses; the policy never needs them', () => {
    // ⚠ FLAGGED SUBSTITUTION. The spec asks for an in-scope path whose policy-OFF twin liquidates or is called.
    // None exists on these fixtures: the face-default OFF twin's defenses hold every path ≥ 0.80 × support — the
    // spec's synthetic fallback included — but only by pulling cold it banked on the rise, ABOVE support (G2's
    // contrast). Stripping that defense stack shows the path is genuinely lethal to a price-relative plan.
    const offDefended = runCyclingSim({ ...SP_REPRO, pricePath: SYNTHETIC });
    const offBare = runCyclingSim({ ...SP_REPRO, pricePath: SYNTHETIC, defendCbLtv: false, strikeLtvCapPct: 0 });
    const policy = runCyclingSim({ ...SP_REPRO, pricePath: SYNTHETIC, supportPolicy: policyFor(SUPPORT) });
    expect(offBare.liqMonth).not.toBeNull();
    expect(offDefended.liqMonth).toBeNull();
    expect(offDefended.totalColdRetrievedBtc).toBeGreaterThan(0);
    expect(policy.liqMonth).toBeNull();
    expect(policy.firstDefenseMonth).toBeNull();          // the ceiling, not the defense stack, is what held
    expect(policy.totalColdRetrievedBtc).toBe(0);
  });

  it('P9 is a REAL test: the ceiling fills, the dip engages the Coinbase defense, and Coinbase survives', () => {
    const p9 = buildP9(4_000);
    expect(p9.twin.firstCeilingThrottleMonth).not.toBeNull();         // the ceiling fills on this budget
    const r = on(p9.path, {}, { income: 4_000 });
    expect(r.firstDefenseMonth).not.toBeNull();                      // …and the dip engages the defense
    expect(r.liqMonth).toBeNull();
  });
});

// ── Test 13 · zones drive behaviour ─────────────────────────────────────────────────────────────────────

describe('zones drive behaviour', () => {
  /** B = interest − restore − pay-down − cure cash − sale proceeds; a hold row may add at most a 2% refinance fee
   *  on the Strike balance it moved, and NO new principal (v1.1 #2 / v1.2 #10). */
  const debtBand = (prev: CyclingRow, x: CyclingRow): [number, number] => {
    const base = prev.cbDebt * cmr + prev.strikeBalance * smr - x.restoreUsd - x.payDownUsd - x.cashToCureUsd
      - x.strikeLiquidatedBtc * x.price;
    return [base, base + 0.02 * prev.strikeBalance * (1 + smr)];
  };

  it('P2 hold rows draw nothing, and total debt moves only by interest (+ a refinance fee), never new principal', () => {
    const r = on(pathP2(0));
    const hold = r.rows.filter((x) => x.m > 0 && x.policyZone === 'hold' && (r.liqMonth === null || x.m <= r.liqMonth));
    expect(hold.length).toBeGreaterThan(10);
    for (const x of hold) {
      const prev = r.rows[x.m - 1];
      expect(x.strikeDrawn).toBe(0);
      const [lo, hi] = debtBand(prev, x);
      const delta = (x.cbDebt + x.strikeBalance) - (prev.cbDebt + prev.strikeBalance);
      expect(delta).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(delta).toBeLessThanOrEqual(hi + 1e-6);
    }
  });

  it('P2 pay-down rows repay before they buy', () => {
    const r = on(pathP2(0));
    const payDown = r.rows.filter((x) => x.policyZone === 'payDown');
    expect(payDown.length).toBeGreaterThan(10);
    for (const x of payDown) {
      expect(x.strikeDrawn).toBe(0);
      if (x.btcBoughtUsd > 0) { expect(x.cbDebt).toBe(0); expect(x.strikeBalance).toBe(0); }
    }
    expect(payDown.every((x) => x.payDownUsd > 0)).toBe(true);    // debt is left throughout, so it is paying
  });

  it('paused rows (P4, P5 — P2 is never below support) draw nothing, refinance nothing, sweep nothing', () => {
    let paused = 0;
    for (const path of [pathP4(), pathP5()]) {
      const r = on(path);
      for (const x of r.rows) {
        if (x.m === 0 || x.policyZone !== 'paused') continue;
        const prev = r.rows[x.m - 1];
        expect(x.strikeDrawn).toBe(0);
        expect(x.strikeToCbBtc).toBe(0);
        expect(x.coldFromCb + x.coldFromStrike).toBe(prev.coldFromCb + prev.coldFromStrike);
        const [lo] = debtBand(prev, x);
        expect((x.cbDebt + x.strikeBalance) - (prev.cbDebt + prev.strikeBalance)).toBeCloseTo(lo, 6);
        paused++;
      }
    }
    expect(paused).toBeGreaterThan(10);
  });

  it('the draw resumes once the multiple is back at or under 1.5 (P2, after the pay-down and hold stretch)', () => {
    const r = on(pathP2(0));
    const firstPayDown = r.firstPayDownMonth!;
    const resume = r.rows.find((x) => x.m > firstPayDown && x.policyZone === 'accumulate');
    expect(resume).toBeDefined();
    expect(resume!.multiple!).toBeLessThanOrEqual(1.5);
    expect(resume!.strikeDrawn).toBeGreaterThan(0);
  });
});

// ── Test 14 · pay down to zero; the buffer is kept as collateral ────────────────────────────────────────

describe('pay-down goes to ZERO, and the buffer is kept as Coinbase COLLATERAL', () => {
  it('P2 at $16k / $6k: debt reaches exactly 0, then each sweep leaves exactly 12 × bills of room at support', () => {
    // ⚠ FLAGGED VARIANT. On REPRO's $8k / $6k the pay-down stretch (m21–m35) clears only ~$21k of ~$105k, so the
    // spec's premise (cbDebt === 0 on P2) is unreachable there. Same P2 path, a surplus big enough to clear it.
    const r = on(pathP2(0), {}, { income: 16_000 });
    const cleared = r.rows.filter((x, m) => m > 0 && x.policyZone === 'payDown' && x.cbDebt === 0
      && x.strikeBalance === 0 && x.coldFromCb + x.coldFromStrike > r.rows[m - 1].coldFromCb + r.rows[m - 1].coldFromStrike);
    expect(cleared.length).toBeGreaterThan(0);
    for (const x of cleared) {
      expect(x.cbCollateralBtc).toBeCloseTo((12 * SP_REPRO.expenses) / (SUPPORT[x.m] * CB_STOP), 8);
      expect(x.cbCeilingHeadroomUsd!).toBeCloseTo(12 * SP_REPRO.expenses, 4);
    }
  });
});

// ── Test 15 · restore ───────────────────────────────────────────────────────────────────────────────────

describe('restore — a leg over its ceiling is repaid first, Coinbase before Strike', () => {
  // ⚠ FLAGGED: Strike is over its ceiling too, or "Coinbase before Strike" could not fail. CB debt $48k (not the
  // spec's $50k): at $50k month 1 opens at 70.3% at price and the Coinbase DEBT SHIFT fires, which moves debt onto
  // Strike and muddies the ordering this test is about.
  const RESTORE = { cbDebt: 48_000, strikeCollateralBtc: 0.5, strikeBalance: 20_000 };

  it('month 1: no draw, the whole surplus goes to Coinbase, Strike only accrues interest', () => {
    const r = on(pathP1(), {}, RESTORE);
    expect(r.rows[0].cbCeilingHeadroomUsd!).toBeLessThan(0);
    expect(r.rows[0].strikeCeilingHeadroomUsd!).toBeLessThan(0);
    const x = r.rows[1];
    expect(x.strikeDrawn).toBe(0);
    expect(x.defenseDrawnUsd).toBe(0);
    expect(x.restoreUsd).toBeCloseTo(2_000, 9);
    expect(x.btcBoughtUsd).toBe(0);
    expect(x.cbDebt).toBeCloseTo(48_000 * (1 + cmr) - 2_000, 6);
    expect(x.strikeBalance).toBeCloseTo(20_000 * (1 + smr), 6);
  });

  it('it never draws while either leg is over its ceiling at the decision point', () => {
    const r = on(pathP1(), {}, RESTORE);
    let restoring = 0;
    for (let m = 1; m < r.rows.length; m++) {
      const prev = r.rows[m - 1];
      const x = r.rows[m];
      if (x.restoreUsd > 0) restoring++;
      if (x.strikeDrawn > 0) {
        expect(prev.cbDebt * (1 + cmr)).toBeLessThanOrEqual(prev.cbCollateralBtc * SUPPORT[m] * CB_STOP + 1e-6);
        expect(prev.strikeBalance).toBeLessThanOrEqual(prev.strikeCollateralBtc * SUPPORT[m] * SK_STOP + 1e-6);
      }
    }
    expect(restoring).toBeGreaterThanOrEqual(2);
    expect(r.firstDrawMonth).not.toBeNull();      // and it does come back to drawing
  });
});

// ── Test 16 · the Strike call in the engine ─────────────────────────────────────────────────────────────

describe('⭐ the Strike margin call is MODELLED — cure or sale', () => {
  const preCall = (): { bal: number; coll: number; price: number } =>
    ({ bal: 34_000 * (1 + smr), coll: 1, price: CALL_PATH[1] });

  it('no cash, no cold → sold down to 65%, exactly collateralToSellForLtv of the pre-call position', () => {
    const r = callRun();
    const x = r.rows[1];
    const { bal, coll, price } = preCall();
    expect(x.policyZone).toBe('paused');
    expect(x.strikeCall).toBe('sold');
    expect(x.strikeLiquidatedBtc).toBeCloseTo(collateralToSellForLtv(bal, coll, price, STRIKE_CURE_LTV), 12);
    expect(x.strikeLtv).toBeCloseTo(STRIKE_CURE_LTV, 9);
    expect(r.firstStrikeCallMonth).toBe(1);
    expect(r.firstStrikeLiquidationMonth).toBe(1);
    expect(r.strikeCallsSold).toBe(1);
    expect(r.strikeMarginMonth).toBeNull();          // M1: read AFTER the call resolves, and it ends at 65%
    expectLedgersFoot(r, { ...CALL_BASE, pricePath: CALL_PATH });
  });

  it('six months of cash → cured with cash, nothing sold, cold untouched', () => {
    const r = callRun({ openingCashUsd: CASH_6_USD });
    const x = r.rows[1];
    const { bal, coll, price } = preCall();
    expect(x.strikeCall).toBe('cured');
    expect(x.cashToCureUsd).toBeCloseTo(bal - STRIKE_CURE_LTV * coll * price, 6);
    expect(x.strikeLiquidatedBtc).toBe(0);
    expect(x.strikeCureColdBtc).toBe(0);
    expect(r.strikeCallsCured).toBe(1);
    expect(r.cashLeftUsd).toBeCloseTo(CASH_6_USD - x.cashToCureUsd, 6);
  });

  it('modelStrikeLiquidation: false → the call is only FLAGGED, exactly as the HEAD engine flags it (M1)', () => {
    const r = callRun({ modelStrikeLiquidation: false });
    expect(r.rows.every((x) => x.strikeLiquidatedBtc === 0 && x.strikeCall === 'none')).toBe(true);
    expect(r.strikeMarginMonth).toBe(1);
    expect(r.rows[1].strikeLtv).toBeGreaterThanOrEqual(SP_REPRO.strikeMarginLtv);
  });

  it('⭐ no phantom sales: a sale that EMPTIES Strike is its last call — restore repays the debt left (v1.3 #13)', () => {
    const r = emptyRun();
    const x = r.rows[1];
    const preBal = x.strikeBalance + x.strikeLiquidatedBtc * x.price;            // the proceeds retired it 1:1
    expect(preBal / (EMPTY_BASE.strikeCollateralBtc * x.price)).toBeGreaterThan(1);   // the premise: over 100%
    expect(x.strikeCall).toBe('soldImmediate');
    expect(x.strikeLiquidatedBtc).toBe(EMPTY_BASE.strikeCollateralBtc);           // the WHOLE collateral …
    expect(x.strikeCollateralBtc).toBe(0);                                         // … so Strike is empty
    for (const y of r.rows.slice(2)) expect(y.strikeCall, `m${y.m}`).toBe('none');  // nothing left to sell
    expect(r.strikeCallsSold).toBe(1);
    expect(r.firstStrikeLiquidationMonth).toBe(1);
    expect(r.totalStrikeLiquidatedBtc).toBe(EMPTY_BASE.strikeCollateralBtc);
    expect(r.strikeMarginMonth).toBe(1);   // M1's exception: the sale left a deficiency (unsecured → LTV ∞)
    // The deficiency is unsecured debt; the restore rule repays it from surplus until it is gone.
    let restoring = 0;
    for (let m = 2; m < r.rows.length; m++) {
      const prev = r.rows[m - 1];
      const y = r.rows[m];
      if (prev.strikeBalance === 0) { expect(y.restoreUsd, `m${m}`).toBe(0); continue; }
      expect(y.restoreUsd, `m${m}`).toBeGreaterThan(0);
      expect(y.strikeBalance).toBeCloseTo(prev.strikeBalance * (1 + smr) - y.restoreUsd - y.payDownUsd, 6);
      restoring++;
    }
    expect(restoring).toBeGreaterThan(1);
    expect(r.last.strikeBalance).toBe(0);
    expectLedgersFoot(r, { ...EMPTY_BASE, pricePath: EMPTY_PATH });
  });

  it('with the Strike cap off, a call is cured from COLD before the sale (1.857 coins saved per cold coin)', () => {
    const r = callRun({}, { strikeLtvCapPct: 0, openingColdBtc: 0.1 });
    const x = r.rows[1];
    expect(x.strikeCall).toBe('sold');
    expect(x.strikeCureColdBtc).toBeCloseTo(0.1, 12);
    expect(x.strikeLiquidatedBtc).toBeGreaterThan(0);
    expectLedgersFoot(r, { ...CALL_BASE, strikeLtvCapPct: 0, openingColdBtc: 0.1, pricePath: CALL_PATH });
  });
});

// ── Test 17 · migration ─────────────────────────────────────────────────────────────────────────────────

describe('migration keeps the FULL line at support, and obeys Strike\'s retrieval rules', () => {
  it('on P2 every month keeps strikeColl ≥ max(line, balance) / (0.5 × support)', () => {
    const r = on(pathP2(0));
    expect(r.totalStrikeToCbBtc).toBeGreaterThan(0);
    for (const x of r.rows) {
      const keep = Math.max(SP_REPRO.strikeCreditLine, x.strikeBalance) / (SK_STOP * SUPPORT[x.m]);
      expect(x.strikeCollateralBtc).toBeGreaterThanOrEqual(keep - 1e-9);
    }
  });

  it('no migration while Strike LTV is over 40% — it waits until the refinance brings it under', () => {
    // Month 1 at 1.01 × support, so the 40% rule is the ONLY thing that can block the move: before it, Strike
    // sits at 40.6% (over 40%); after it, the kept collateral would sit at 48.4% (under the 50% line). On the line
    // itself (price = support) the after-move LTV lands exactly on 50% and blocks it too — a masked fixture.
    const path = pathP1();
    path[1] = 1.01 * SUPPORT[1];
    const r = on(path, {}, { strikeBalance: 29_000 });
    const bal = 29_000 * (1 + smr);                                       // month 1 cannot draw (Coinbase can't absorb)
    const keep = Math.max(SP_REPRO.strikeCreditLine, bal) / (SK_STOP * SUPPORT[1]);
    expect(r.rows[1].strikeDrawn).toBe(0);
    expect(bal / (1 * path[1])).toBeGreaterThan(0.40);                   // the premise: over 40% before …
    expect(bal / (keep * path[1])).toBeLessThan(0.5);                     // … and under the 50% line after
    expect(r.rows[1].strikeToCbBtc).toBe(0);
    expect(r.rows.slice(2, 6).some((x) => x.strikeToCbBtc > 0)).toBe(true);   // …then it runs
  });

  it('nor when the move would leave Strike at or over its 50% draw line (the other half of the retrieval rule)', () => {
    // With a Strike stop at support of 60%, the kept collateral can sit above 50% at a price just over support. Here
    // Strike is at 22.5% before the move (well inside 40%), so only the "< 50% after" half can block it.
    const path = pathP1();
    path[1] = 1.1 * SUPPORT[1];
    const r = on(path, { strikeStopAtSupportPct: 60 }, { strikeCollateralBtc: 2, strikeBalance: 35_000 });
    const bal = 35_000 * (1 + smr);
    const keep = Math.max(SP_REPRO.strikeCreditLine, bal) / (0.60 * SUPPORT[1]);
    expect(r.rows[1].policyZone).toBe('accumulate');
    expect(bal / (2 * path[1])).toBeLessThanOrEqual(0.40);               // the premise: inside 40% before …
    expect(bal / (keep * path[1])).toBeGreaterThanOrEqual(0.5);           // … but at or over 50% after
    expect(r.rows[1].strikeToCbBtc).toBe(0);
  });

  it('none in the month after a cold → Strike move (Strike\'s 60-day hold)', () => {
    // A one-month dip to 0.65 × support fires the Strike cap's cold → Strike top-up; the multiple is back at 1.35
    // the next month, so migration WOULD run — the hold is the only thing stopping it.
    const support = supportPathFor(SP_START, 4);
    const path = [1.35 * S0, 0.65 * support[1], 1.35 * support[2], 1.35 * support[3], 1.35 * support[4]];
    const r = runCyclingSim({ ...CALL_BASE, openingColdBtc: 0.5, pricePath: path, supportPolicy: policyFor(support) });
    expect(r.rows[1].strikeTopUpBtc).toBeGreaterThan(0);
    expect(r.rows[2].policyZone).toBe('accumulate');
    expect(r.rows[2].strikeLtv).toBeLessThanOrEqual(0.40);
    expect(r.rows[2].strikeToCbBtc).toBe(0);
    expect(r.rows[3].strikeToCbBtc).toBeGreaterThan(0);
  });
});

// ── Test 18 · the refinance never breaks the ceiling ────────────────────────────────────────────────────

describe('the refinance never breaks the Coinbase ceiling, fee included', () => {
  it('every refinance month ends at or under the ceiling at support', () => {
    let refinances = 0;
    const runs = [pathP1(), pathP2(0), pathP3()].flatMap((p) => [on(p), on(p, {}, { income: 4_000 })]);
    for (const r of runs) {
      for (let m = 1; m < r.rows.length; m++) {
        const x = r.rows[m];
        if (x.cbDebt - r.rows[m - 1].cbDebt * (1 + cmr) <= 1e-6) continue;   // CB debt only grows by a refinance
        refinances++;
        expect(x.cbDebt).toBeLessThanOrEqual(x.cbCollateralBtc * SUPPORT[m] * CB_STOP + 1e-6);
      }
    }
    expect(refinances).toBeGreaterThan(50);
  });
});

// ── Test 19 · the breakers ──────────────────────────────────────────────────────────────────────────────

describe('the breakers', () => {
  it('P6: broken at the SECOND consecutive month-end below 0.9 × support, then latched — no draw, sweep, refinance, migration', () => {
    const path = pathP6();
    const k = path.map((p, m) => p / SUPPORT[m]);
    const second = k.findIndex((v, m) => m >= 2 && v < 0.9 - SUPPORT_EPS && k[m - 1] < 0.9 - SUPPORT_EPS);
    const r = on(path);
    expect(r.modelBrokenMonth).toBe(second);
    for (const x of r.rows.slice(second)) {
      const prev = r.rows[x.m - 1];
      expect(x.policyZone).toBe('broken');
      expect(x.strikeDrawn).toBe(0);
      expect(x.strikeToCbBtc).toBe(0);
      expect(x.coldFromCb + x.coldFromStrike).toBe(prev.coldFromCb + prev.coldFromStrike);
      expect(x.cbDebt - prev.cbDebt * (1 + cmr)).toBeLessThanOrEqual(1e-6);
    }
    expect(r.monthsInZone.broken).toBe(SP_MONTHS - second + 1);
  });

  it('P5: the one-month wick to 0.88 × support pauses but never breaks', () => {
    const r = on(pathP5());
    expect(r.modelBrokenMonth).toBeNull();
    expect(r.firstPausedMonth).toBe(11);
    expect(r.rows[12].policyZone).toBe('accumulate');
  });
});

// ── v1.3 #14 · the breaker re-arm (opt-in; no default) ──────────────────────────────────────────────────

describe('the breaker re-arm — opt-in, latched when absent (v1.3 #14)', () => {
  const withPolicy = (c: CyclingInputs, o: Partial<SupportPolicyInputs>): CyclingInputs =>
    ({ ...c, supportPolicy: { ...c.supportPolicy!, ...o } });
  /** price[m] = k[m] × support[m]; the last multiple holds to the end of the horizon. */
  const kPath = (ks: number[]): number[] => SUPPORT.map((s, m) => (m < ks.length ? ks[m] : ks[ks.length - 1]) * s);

  it('absent ≡ undefined ≡ a re-arm that can never fire — the WHOLE result, on every A5 path', () => {
    let latched = 0;
    for (const c of a5Cases()) {
      const absent = runCyclingSim(c.on);
      if (absent.modelBrokenMonth !== null) latched++;
      expect(runCyclingSim(withPolicy(c.on, { breakerRearmMonths: undefined })), c.name).toEqual(absent);
      expect(runCyclingSim(withPolicy(c.on, { breakerRearmMonths: SP_MONTHS + 1 })), c.name).toEqual(absent);
    }
    expect(latched).toBeGreaterThan(0);   // non-vacuous: some paths break (P3, P6, P9), so the latch is exercised
  });

  it('P6: re-arms on exactly the Nth month-end at or above support — not N − 1 — and that month acts on its zone', () => {
    const path = pathP6();
    const latched = on(path);
    const broke = latched.modelBrokenMonth!;
    // The first month-end back at or above support after the break; P6 then stays ON the line to the end.
    const back = path.findIndex((p, m) => m > broke && aboveSupport(p, SUPPORT[m]));
    expect(path.slice(back).every((p, i) => aboveSupport(p, SUPPORT[back + i]))).toBe(true);
    for (const n of [3, 6]) {
      const r = on(path, { breakerRearmMonths: n });
      const rearm = back + n - 1;
      expect(r.firstRearmMonth, `N ${n}`).toBe(rearm);
      expect(r.rows[rearm - 1].policyZone).toBe('broken');
      expect(r.rows[rearm].policyZone).toBe('accumulate');
      expect(r.rows.slice(0, rearm)).toEqual(latched.rows.slice(0, rearm));   // nothing leaks before it fires
      expect(r.modelBrokenMonth).toBe(broke);
      expect(r.breakCount).toBe(1);
      expect(r.monthsInZone.broken).toBe(rearm - broke);
      expect(r.rows.slice(rearm).some((x) => x.strikeDrawn > 0)).toBe(true);   // and the draw resumes
    }
    expect(latched.breakCount).toBe(1);
    expect(latched.firstRearmMonth).toBeNull();
  });

  it('a month-end below support resets the count', () => {
    // Broken at m3; at support m4–m5; m6 dips to 0.95 × S (below support, above the breaker's 0.9); then back.
    const dip = on(kPath([1.35, 1.2, 0.85, 0.85, 1.0, 1.0, 0.95, 1.0, 1.0, 1.0, 1.1]), { breakerRearmMonths: 3 });
    expect(dip.modelBrokenMonth).toBe(3);
    expect(dip.firstRearmMonth).toBe(9);
    expect(dip.rows[8].policyZone).toBe('broken');
    expect(dip.rows[9].policyZone).not.toBe('broken');
    // The same path without the dip re-arms at m6: the dip is what moved it.
    const noDip = on(kPath([1.35, 1.2, 0.85, 0.85, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1]), { breakerRearmMonths: 3 });
    expect(noDip.firstRearmMonth).toBe(6);
  });

  it('a second break after a re-arm: breakCount 2, and the FIRST break stays modelBrokenMonth', () => {
    const r = on(kPath([1.35, 1.2, 0.85, 0.85, 1.0, 1.0, 1.0, 1.2, 0.85, 0.85, 1.0, 1.0, 1.0, 1.2]), { breakerRearmMonths: 3 });
    expect(r.breakCount).toBe(2);
    expect(r.modelBrokenMonth).toBe(3);
    expect(r.firstRearmMonth).toBe(6);
    // The second break latches again, until another N month-ends at or above support.
    expect(r.rows.slice(9, 12).every((x) => x.policyZone === 'broken')).toBe(true);
    expect(r.rows[12].policyZone).not.toBe('broken');
    expect(r.monthsInZone.broken).toBe(6);
  });

  it('G2, G3 and G4 still hold on every A5 path with N = 6 — and the re-arm actually engages', () => {
    let rearmed = 0;
    for (const c of a5Cases()) {
      const inputs = withPolicy(c.on, { breakerRearmMonths: 6 });
      const r = runCyclingSim(inputs);
      expect(insideBothCeilings(r), c.name).toBe(true);
      expect(r.coldRetrievedAboveSupportBtc, c.name).toBe(0);                                   // G2
      for (let m = 1; m < r.rows.length; m++) {
        if (aboveSupport(r.rows[m].price, c.support[m])) {
          expect(r.rows[m].coldRetrievedBtc - r.rows[m - 1].coldRetrievedBtc, `${c.name} m${m}`).toBe(0);
        }
      }
      if (minMultiple(inputs.pricePath, c.support) >= 0.8 - 1e-9) expect(r.liqMonth, c.name).toBeNull();   // G3
      expectLedgersFoot(r, inputs);                                                             // G4
      if (r.firstRearmMonth !== null) {
        rearmed++;
        expect(r.rows, c.name).not.toEqual(runCyclingSim(c.on).rows);
      }
    }
    expect(rearmed).toBeGreaterThan(0);
  });

  it('layered, not duplicated: one trip rule, and the engine reaches the breaker ONLY through the wrapper', () => {
    const leaf = readFileSync(new URL('../supportPolicy.ts', import.meta.url), 'utf8');
    const from = leaf.indexOf('export function nextRearmableBreakerState');
    expect(from).toBeGreaterThan(0);
    const wrapper = leaf.slice(from, leaf.indexOf('\n}\n', from) + 2);
    expect(wrapper).toMatch(/nextBreakerState\(/);      // it DELEGATES the trip …
    expect(wrapper).not.toMatch(/HARD_BREAKER_/);       // … and never re-implements it
    const engine = readFileSync(new URL('../cyclingSim.ts', import.meta.url), 'utf8');
    expect(engine).toMatch(/\bnextRearmableBreakerState\b/);
    expect(engine).not.toMatch(/\bnextBreakerState\b/);
    expect(engine).not.toMatch(/(?<![A-Z_])BREAKER_START\b/);
  });
});

// ── Test 20 · G4 ────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ G4 · the coin, cold and cash ledgers foot on every path', () => {
  it('every A5 path (ON arm, cash 0 and cash 6) plus the call, cold-cure and liquidation fixtures', () => {
    const runs: { r: CyclingResult; inputs: CyclingInputs }[] = [];
    for (const c of a5Cases()) {
      runs.push({ r: runCyclingSim(c.on), inputs: c.on });
      const cash6: CyclingInputs = { ...c.on, supportPolicy: { ...c.on.supportPolicy!, openingCashUsd: CASH_6_USD } };
      runs.push({ r: runCyclingSim(cash6), inputs: cash6 });
    }
    runs.push({ r: callRun(), inputs: { ...CALL_BASE, pricePath: CALL_PATH } });
    runs.push({ r: callRun({ openingCashUsd: CASH_6_USD }), inputs: { ...CALL_BASE, pricePath: CALL_PATH } });
    const coldCure: CyclingInputs = { ...CALL_BASE, strikeLtvCapPct: 0, openingColdBtc: 0.1, pricePath: CALL_PATH };
    runs.push({ r: callRun({}, { strikeLtvCapPct: 0, openingColdBtc: 0.1 }), inputs: coldCure });
    runs.push({ r: liqRun(), inputs: { ...LIQ_BASE, pricePath: LIQ_PATH } });
    runs.push({ r: emptyRun(), inputs: { ...EMPTY_BASE, pricePath: EMPTY_PATH } });
    for (const { r, inputs } of runs) expectLedgersFoot(r, inputs);
    // Every modelled call MOVED something — cure cash, cure cold or coins sold. A call that moves nothing is a
    // phantom (v1.3 #13): an emptied Strike has nothing left to sell.
    for (const { r } of runs) {
      for (const x of r.rows) {
        if (x.strikeCall === 'none') continue;
        expect(x.cashToCureUsd > 0 || x.strikeCureColdBtc > 0 || x.strikeLiquidatedBtc > 0, `m${x.m} ${x.strikeCall}`).toBe(true);
      }
    }
    // Non-vacuity: every ledger term actually moves somewhere in the set.
    expect(runs.some(({ r }) => r.totalStrikeLiquidatedBtc > 0)).toBe(true);
    expect(runs.some(({ r }) => r.rows.some((x) => x.strikeCureColdBtc > 0))).toBe(true);
    expect(runs.some(({ r }) => r.totalCashToBillsUsd > 0)).toBe(true);
    expect(runs.some(({ r }) => r.totalCashToCureUsd > 0)).toBe(true);
    expect(runs.some(({ r }) => r.liqMonth !== null && r.liqMonth < r.last.m)).toBe(true);
  });
});

// ── Test 21 · incomePath ────────────────────────────────────────────────────────────────────────────────

describe('incomePath (TEST-ONLY)', () => {
  it('a constant path ≡ no path — policy off and on', () => {
    const flat = new Array(SP_MONTHS + 1).fill(SP_REPRO.income);
    expect(runCyclingSim({ ...SP_REPRO, pricePath: pathP2(0), incomePath: flat }))
      .toEqual(runCyclingSim({ ...SP_REPRO, pricePath: pathP2(0) }));
    expect(on(pathP2(0), {}, { incomePath: flat })).toEqual(on(pathP2(0)));
  });

  it('P7, no cash: the shock months leave bills unfunded', () => {
    const r = on(pathP4(), {}, { incomePath: incomeShockP7() });
    for (let m = 12; m <= 23; m++) expect(r.rows[m].unfundedUsd).toBeGreaterThan(0);
    expect(r.totalUnfundedUsd).toBeGreaterThan(0);
  });

  it('P7, six months of cash: cash pays the bills until it runs out, then they go unfunded', () => {
    const r = on(pathP4(), { openingCashUsd: CASH_6_USD }, { incomePath: incomeShockP7() });
    for (let m = 12; m <= 17; m++) {
      expect(r.rows[m].cashToBillsUsd).toBeCloseTo(SP_REPRO.expenses, 9);
      expect(r.rows[m].unfundedUsd).toBe(0);
    }
    for (let m = 18; m <= 23; m++) expect(r.rows[m].unfundedUsd).toBeCloseTo(SP_REPRO.expenses, 9);
    expect(r.cashLeftUsd).toBeCloseTo(0, 9);
    expect(r.totalCashToBillsUsd).toBeCloseTo(CASH_6_USD, 9);
  });

  it('the never-draw baseline uses the same income path', () => {
    const path = pathP4();
    const incomes = incomeShockP7();
    const r = on(path, {}, { incomePath: incomes });
    let base = SP_REPRO.strikeCollateralBtc + SP_REPRO.cbCollateralBtc;
    for (let m = 1; m <= SP_MONTHS; m++) base += Math.max(0, incomes[m] - SP_REPRO.expenses) / path[m];
    expect(r.baselineBtc).toBeCloseTo(base, 12);
    expect(r.baselineBtc).toBeLessThan(on(path).baselineBtc);
  });
});

// ── Test 22 · the engine clamps ─────────────────────────────────────────────────────────────────────────

describe('a stop at support can never exceed its leg\'s defense line (the engine clamps)', () => {
  it('CB stop 80 under a CB cap of 70 runs exactly as 70', () => {
    expect(on(pathP2(0), { cbStopAtSupportPct: 80 }).rows).toEqual(on(pathP2(0), { cbStopAtSupportPct: 70 }).rows);
  });

  it('Strike stop 58 under a Strike cap of 55 runs exactly as 55', () => {
    const a = on(pathP2(0), { strikeStopAtSupportPct: 58 }, { strikeLtvCapPct: 55 });
    const b = on(pathP2(0), { strikeStopAtSupportPct: 55 }, { strikeLtvCapPct: 55 });
    expect(a.rows).toEqual(b.rows);
  });
});

// ── v1.1 #1 / v1.2 #9 · the two draw causes ─────────────────────────────────────────────────────────────

describe('the draw causes stay separate (v1.1 #1)', () => {
  it('a policy throttle sets firstCeilingThrottleMonth and leaves creditExhaustedMonth null (P9\'s $4k twin)', () => {
    const twin = buildP9(4_000).twin;
    expect(twin.firstCeilingThrottleMonth).not.toBeNull();
    expect(twin.creditExhaustedMonth).toBeNull();
  });

  it('Strike\'s OWN line running short sets creditExhaustedMonth, never the throttle', () => {
    // A $5k line can never fund a $6k bill, while Coinbase always has room for $5k: one cause, the whole run.
    const r = on(pathP1(), {}, { strikeCreditLine: 5_000 });
    expect(r.creditExhaustedMonth).toBe(1);
    expect(r.firstCeilingThrottleMonth).toBeNull();
    expect(r.firstDrawMonth).toBe(1);
  });

  it('each field records its OWN first month when both causes occur', () => {
    // ⚠ FIXTURE-BOUND. Strike opens fully drawn ($30k): month 1 it is Strike's own line; the month-1 refinance
    // then leaves Strike a balance Coinbase has no room to absorb, so month 2 the CEILING cuts the draw.
    const r = on(pathP1(), {}, { strikeBalance: 30_000 });
    expect(r.creditExhaustedMonth).toBe(1);
    expect(r.firstCeilingThrottleMonth).toBe(2);
  });

  it('both are silent after a Coinbase liquidation, even in an accumulate month (v1.2 #9)', () => {
    // Liquidated at month 1; one month under 0.9 × support does not break the model, so month 2 is accumulate
    // again with Strike's line all but used.
    const support = supportPathFor(SP_START, 3);
    const r = runCyclingSim({
      ...LIQ_BASE, pricePath: [1.35 * S0, 0.45 * support[1], 1.2 * support[2], 1.2 * support[3]],
      supportPolicy: policyFor(support),
    });
    expect(r.liqMonth).toBe(1);
    expect(r.rows[2].policyZone).toBe('accumulate');
    expect(r.creditExhaustedMonth).toBeNull();
    expect(r.firstCeilingThrottleMonth).toBeNull();
  });
});

// ── v1.1 #3 · Strike is a separate facility ─────────────────────────────────────────────────────────────

describe('a Coinbase liquidation does not end Strike (v1.1 #3)', () => {
  it('Coinbase is seized at month 1, Strike is called and SOLD later — and the coin ledger foots', () => {
    const r = liqRun();
    expect(r.liqMonth).toBe(1);
    const sold = r.rows.filter((x) => x.strikeLiquidatedBtc > 0);
    expect(sold.length).toBeGreaterThan(0);
    expect(sold[0].m).toBeGreaterThan(r.liqMonth!);
    expect(r.firstStrikeLiquidationMonth).toBe(sold[0].m);
    expectLedgersFoot(r, { ...LIQ_BASE, pricePath: LIQ_PATH });
  });
});

// ── P9's construction is measured, not guessed ──────────────────────────────────────────────────────────

describe('P9 — the dip lands where the twin\'s Coinbase LTV at support peaks', () => {
  it('the dip months are the twin\'s argmax and the month after; everything else is the support line', () => {
    const p9 = buildP9(4_000);
    const ltvs = p9.twin.rows.map((x) => cbLtvAtSupport(x, SUPPORT[x.m]));
    expect(Math.max(...ltvs.slice(1))).toBe(p9.peakLtvAtSupport);
    expect(ltvs.indexOf(p9.peakLtvAtSupport)).toBe(p9.peakMonth);
    for (let m = 1; m <= SP_MONTHS; m++) {
      const dip = m === p9.dipStart || m === p9.dipStart + 1;
      expect(p9.path[m]).toBe(dip ? 0.8 * SUPPORT[m] : SUPPORT[m]);
    }
  });
});
