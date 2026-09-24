/**
 * Shared fixture + price paths for the support-anchored policy (spec v1.2). NOT a test file — imported by
 * `cyclingSimPolicy.test.ts` (the gates), `supportPolicyReport.test.ts` (the A5 report) AND the faces' view tests
 * (Run 2), so the numbers the owner approves and the numbers the gates pin come from ONE definition.
 *
 * 🔴 ROUND SYNTHETIC FIGURES ONLY. This repo is public — never an owner's real position.
 *
 * The §2 wall still holds: the ENGINE never sees the power law. These builders (test code) cross it the way the
 * faces will — they build plain `number[]` paths and hand them to `runCyclingSim`.
 */
import { runCyclingSim, type CyclingInputs, type CyclingResult, type SupportPolicyInputs } from '../cyclingSim';
import { plBandAt, plConvergencePath, PL_ON_THE_LINE, daysSinceGenesis, addMonths } from '../powerLaw';
import { cycleConvergencePath } from '../cyclePath';
import { ltvOf } from '../ltv';
import { STRIKE_MAX_DRAW_LTV, STRIKE_CURE_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';
import { strikeLiqLtvOf, applyPathStress } from '../../components/Almanac/cyclingFaceView';

/** ⚠ PINNED start — an implied "today" rots. */
export const SP_START = new Date('2027-01-01T00:00:00Z');
export const SP_MONTHS = 72;

/** support[m] = the power-law floor at start + m months — exactly what a face will build (plBandAt 'floor'). */
export const supportPathFor = (start: Date, months: number): number[] =>
  Array.from({ length: months + 1 }, (_, m) => plBandAt('floor', start, m));

export const SUPPORT = supportPathFor(SP_START, SP_MONTHS);
export const S0 = SUPPORT[0];

/**
 * SP_REPRO — the spec's REPRO, renamed so it can't be confused with `cyclingSim.test.ts`'s different `REPRO`.
 * The policy-OFF arm runs it as-is (the faces' defaults: CB cap 70, Strike cap 60, sweep 30, defend on); the
 * policy-ON arm adds `supportPolicy`, under which the sweep setting is ignored.
 * ⚠ Must stay EQUAL to the G1 golden's `meta.inputs` (the golden test asserts it).
 */
export const SP_REPRO: Omit<CyclingInputs, 'pricePath'> = {
  startYear: 2027,
  strikeCollateralBtc: 1, strikeBalance: 0, strikeCreditLine: 30_000,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
  cbCollateralBtc: 1, cbDebt: 30_000,
  income: 8_000, expenses: 6_000, strikeAprPct: 13, cbAprPct: 6.27,
  cycleMonths: 1, cbLtvCapPct: 70, strikeLtvCapPct: 60, defendCbLtv: true, coldStoreBufferPct: 30,
};

/** The shipped defaults (spec §Decisions), with a support path. Overrides for a variant. */
export function policyFor(supportPath: number[], o: Partial<SupportPolicyInputs> = {}): SupportPolicyInputs {
  return {
    supportPath,
    cbStopAtSupportPct: 60,
    strikeStopAtSupportPct: 50,
    accumulateBelow: 1.5,
    payDownAbove: 2.0,
    bearBufferMonths: 12,
    openingCashUsd: 0,
    strikeCureLtv: STRIKE_CURE_LTV,
    strikePartialLiqLtv: strikeLiqLtvOf(85),   // the store default, exactly as a face will pass it
    strikeRetrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV,
    ...o,
  };
}

/** The cash-6 variant: six months of bills held in cash. */
export const CASH_6_USD = 6 * SP_REPRO.expenses;

// ── Paths. Every one starts at 1.35 × S₀ (today's multiple). ──────────────────────────────────────────────

/** P1 — Support, on the line: month 1 onward IS the support line (the alignment pin). */
export const pathP1 = (): number[] => plConvergencePath(1.35 * S0, 'floor', SP_START, SP_MONTHS, PL_ON_THE_LINE);

/** P2 — the 4-yr cycle, on the line (the face default converge). */
export const pathP2 = (phase = 0): number[] =>
  cycleConvergencePath(1.35 * S0, SP_START, SP_MONTHS, PL_ON_THE_LINE, phase);

/** P3 — slow growth: +15%/yr in dollars, so the multiple decays through 1 as support outgrows it. */
export const pathP3 = (): number[] =>
  Array.from({ length: SP_MONTHS + 1 }, (_, m) => 1.35 * S0 * Math.pow(1.15, m / 12));

/**
 * price[m] = k(m) × support[m], with k piecewise-LINEAR in the multiple between the knots and flat after the
 * last one. Month 0 is `k₀ × S₀` — for every knot list here that is 1.35 × S₀, the same number as P1/P2.
 */
export function multiplePath(knots: ReadonlyArray<readonly [number, number]>, support = SUPPORT): number[] {
  const kAt = (m: number): number => {
    for (let i = 1; i < knots.length; i++) {
      const [m0, k0] = knots[i - 1];
      const [m1, k1] = knots[i];
      if (m <= m1) return m1 === m0 ? k1 : k0 + ((k1 - k0) * (m - m0)) / (m1 - m0);
    }
    return knots[knots.length - 1][1];
  };
  return support.map((s, m) => kAt(m) * s);
}

/** P4 — weak recovery: 1.35 → 0.92 by m12, 0.92 → 0.98 by m24, → 1.2 by m48, then flat. */
export const P4_KNOTS = [[0, 1.35], [12, 0.92], [24, 0.98], [48, 1.2], [72, 1.2]] as const;
/** P5 — the wick: 1.35 → 1.0 (m10) → 0.88 (m11) → 1.0 (m12) → 1.3 by m36, then flat. Soft breaker only. */
export const P5_KNOTS = [[0, 1.35], [10, 1.0], [11, 0.88], [12, 1.0], [36, 1.3], [72, 1.3]] as const;
/** P6 — broken: 1.35 → 0.80 by m12, held to m14, → 1.0 by m30, then flat. The hard breaker trips. */
export const P6_KNOTS = [[0, 1.35], [12, 0.8], [14, 0.8], [30, 1.0], [72, 1.0]] as const;

export const pathP4 = (): number[] => multiplePath(P4_KNOTS);
export const pathP5 = (): number[] => multiplePath(P5_KNOTS);
export const pathP6 = (): number[] => multiplePath(P6_KNOTS);

/** P7 — P4's path with no income for m12–m23 (the hidden liquidity risk: credit is gone in a crash). */
export const incomeShockP7 = (income = SP_REPRO.income): number[] =>
  Array.from({ length: SP_MONTHS + 1 }, (_, m) => (m >= 12 && m <= 23 ? 0 : income));

/**
 * P8 — exponent risk. The TRUE support line is `S_b(m) = S₀ · (days(m) / days(0))^b`; the price is `path`
 * re-based onto it (its multiple of the model line, applied to the true line). The ENGINE still receives the
 * 5.82 `SUPPORT` path — that is the point: the policy is measured against the line it believes in.
 */
export function rebaseOntoExponent(path: number[], b: number): number[] {
  const d0 = daysSinceGenesis(SP_START);
  return path.map((p, m) => {
    if (m === 0) return p;
    const sb = S0 * Math.pow(daysSinceGenesis(addMonths(SP_START, m)) / d0, b);
    return (p / SUPPORT[m]) * sb;
  });
}

/** CB LTV AT SUPPORT for a row — the ceiling's own measure. */
export const cbLtvAtSupport = (r: { cbDebt: number; cbCollateralBtc: number }, support: number): number =>
  ltvOf(r.cbDebt, r.cbCollateralBtc, support);

export interface P9Build {
  path: number[];
  twin: CyclingResult;
  /** argmax over m ≥ 1 of the twin's CB LTV at support — where the dip is placed. */
  peakMonth: number;
  peakLtvAtSupport: number;
  dipStart: number;
}

/**
 * P9 — the case where the Coinbase ceiling actually FILLS (v1.2 #6). On SP_REPRO's $8k / $6k budget the draw is
 * one month of bills while purchases and support growth add room faster, so the ceiling never binds and G3
 * would pass trivially. With bills above income it fills.
 *
 * Construction (the timing is MEASURED, not guessed): run the no-crash twin (P1, policy ON, defaults) at this
 * budget; take the month its CB LTV at support peaks; dip to 0.80 × support for that month and the next; back to
 * 1.0 × support. The rule is per budget — the $8k contrast is built from its own twin.
 */
export function buildP9(income: number): P9Build {
  const p1 = pathP1();
  const twin = runCyclingSim({ ...SP_REPRO, income, pricePath: p1, supportPolicy: policyFor(SUPPORT) });
  let peakMonth = 1;
  let peakLtvAtSupport = Number.NEGATIVE_INFINITY;
  for (let m = 1; m < twin.rows.length; m++) {
    const v = cbLtvAtSupport(twin.rows[m], SUPPORT[m]);
    if (v > peakLtvAtSupport) { peakLtvAtSupport = v; peakMonth = m; }
  }
  const dipStart = Math.min(peakMonth, SP_MONTHS - 1);   // both dip months must fit in the horizon
  const path = p1.map((p, m) => (m === dipStart || m === dipStart + 1 ? 0.8 * SUPPORT[m] : p));
  return { path, twin, peakMonth, peakLtvAtSupport, dipStart };
}

export interface A5Case {
  name: string;
  /** The policy-OFF arm: the faces' shipped defaults, same world (price path, income path, budget). */
  off: CyclingInputs;
  /** The policy-ON arm: `off` + the default policy (cash 0). */
  on: CyclingInputs;
  support: number[];
}

/** Every A5 path, OFF and ON (cash 0). The report adds the cash-6 variant itself. */
export function a5Cases(): A5Case[] {
  const mk = (name: string, pricePath: number[], extra: Partial<CyclingInputs> = {}): A5Case => {
    const off: CyclingInputs = { ...SP_REPRO, ...extra, pricePath };
    return { name, off, on: { ...off, supportPolicy: policyFor(SUPPORT) }, support: SUPPORT };
  };
  const p7cash6 = mk('P7 (cash 6)', pathP4(), { incomePath: incomeShockP7() });
  p7cash6.on = { ...p7cash6.on, supportPolicy: policyFor(SUPPORT, { openingCashUsd: CASH_6_USD }) };
  return [
    mk('P1', pathP1()),
    mk('P2', pathP2(0)),
    mk('P2 (phase −4)', pathP2(-4)),
    mk('P3', pathP3()),
    mk('P4', pathP4()),
    mk('P5', pathP5()),
    mk('P6', pathP6()),
    mk('P7 (cash 0)', pathP4(), { incomePath: incomeShockP7() }),
    p7cash6,
    mk('P8 · P1 on b 5.63', rebaseOntoExponent(pathP1(), 5.63)),
    mk('P8 · P1 on b 5.96', rebaseOntoExponent(pathP1(), 5.96)),
    mk('P8 · P2 on b 5.63', rebaseOntoExponent(pathP2(0), 5.63)),
    mk('P8 · P2 on b 5.96', rebaseOntoExponent(pathP2(0), 5.96)),
    mk('P9 ($4k / $6k)', buildP9(4_000).path, { income: 4_000 }),
    mk('P9 ($8k / $6k)', buildP9(8_000).path, { income: 8_000 }),
  ];
}

/** Lowest multiple of support over the path (m ≥ 0). */
export const minMultiple = (pricePath: number[], support: number[]): number =>
  Math.min(...pricePath.map((p, m) => p / support[m]));

// ── Run 1's named fixtures — shared with the faces' view tests (Run 2), so both read ONE definition ─────────────

/** SP_REPRO + the default policy on `pricePath`, with overrides for the policy and the inputs (the gates' `on`). */
export const runPolicy = (pricePath: number[], o: Partial<SupportPolicyInputs> = {}, extra: Partial<CyclingInputs> = {},
  support: number[] = SUPPORT): CyclingResult =>
  runCyclingSim({ ...SP_REPRO, ...extra, pricePath, supportPolicy: policyFor(support, o) });

/** Test 16's fixture — Strike near its ceiling, Coinbase DEBT-FREE (else Coinbase liquidates at 0.65 × S before
 *  the call can be isolated — flagged), then a fall to 0.65 × support for two months. */
export const CALL_SUPPORT = supportPathFor(SP_START, 2);
export const CALL_PATH = [1.35 * S0, 0.65 * CALL_SUPPORT[1], 0.65 * CALL_SUPPORT[2]];
export const CALL_BASE: Omit<CyclingInputs, 'pricePath'> = { ...SP_REPRO, strikeBalance: 34_000, strikeCreditLine: 40_000, cbDebt: 0 };
export const callRun = (o: Partial<SupportPolicyInputs> = {}, extra: Partial<CyclingInputs> = {}): CyclingResult =>
  runCyclingSim({ ...CALL_BASE, ...extra, pricePath: CALL_PATH, supportPolicy: policyFor(CALL_SUPPORT, o) });

/** Test 15's opening (on P1) — BOTH legs over their ceilings at support, or "Coinbase before Strike" could not fail.
 *  CB debt $48k (not the spec's $50k): at $50k month 1 opens at 70.3% at price and the Coinbase DEBT SHIFT fires,
 *  which moves debt onto Strike and muddies the ordering. */
export const RESTORE_OPENING: Partial<CyclingInputs> = { cbDebt: 48_000, strikeCollateralBtc: 0.5, strikeBalance: 20_000 };

/** G2's scope fixture (on P1) — Coinbase opens at 75% at support with Strike's line full, so on the line the debt
 *  shift has no capacity and the top-up takes cold AT support: the Run 1 fixture that pulls cold at or above support. */
export const OVER_CEILING_COLD_OPENING: Partial<CyclingInputs> = { cbDebt: 52_000, strikeBalance: 30_000, openingColdBtc: 0.5 };

// ── the existing grids, rebuilt EXACTLY as cyclingSim.test.ts builds them (the report asserts that they are) ──────

export const GRID_REPRO: CyclingInputs = {
  startYear: 2027,
  strikeCollateralBtc: 1, strikeBalance: 20_000, strikeCreditLine: 60_000,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
  cbCollateralBtc: 1, cbDebt: 40_000,
  income: 8_000, expenses: 6_000, strikeAprPct: 13, cbAprPct: 6.2,
  cycleMonths: 1, cbLtvCapPct: 50, defendCbLtv: true, coldStoreBufferPct: 30,
  pricePath: cycleConvergencePath(100_000, new Date('2027-01-01T00:00:00Z'), 60, 1),
};
export interface GridCell { off: CyclingInputs; support: number[] }
export function faceWorldGrid(): GridCell[] {
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
export function syntheticGrid(): (GridCell & { capOff: CyclingInputs })[] {
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
export function reachGrid(): GridCell[] {
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
