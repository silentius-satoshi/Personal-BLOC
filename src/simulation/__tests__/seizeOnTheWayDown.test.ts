import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  runCyclingSim, supportPolicyResolution,
  type CyclingInputs, type CyclingResult, type SupportPolicyInputs, type PolicyIgnoredReason,
} from '../cyclingSim';
import { CB_LLTV, CB_LIF, cbLiquidationPrice } from '../runCoinbaseLoan';
import { cbMetrics, cbSeizurePrice } from '../cbMetrics';
import { ltvOf } from '../ltv';
import {
  SUPPORT, S0, SP_REPRO, CASH_6_USD, V2_DEFAULTS, policyFor, pathP2, a5Cases, coldRuleRows, doubleDropRows,
  faceWorldGrid, syntheticGrid, reachGrid,
} from './supportPolicyPaths';

/**
 * Policy v2 (BL6) — MORPHO SEIZES ON THE WAY DOWN. Round synthetic figures only — this repo is public.
 *
 * Under the support policy the Coinbase loan carried from last month-end is read — after this month's interest — at
 * THIS month's price, before any monthly action: at or past 86% the price crossed the line during the month, and Morpho
 * seized it there, at the liquidation price. `seizeOnTheWayDown: false` is the month-end reading the rule replaces —
 * TEST-ONLY (the grep in cyclingSim.test.ts keeps it out of every component); this file compares the two.
 *
 * ⚠ ONE STREAMING PASS. The spec's grids, at both settings — the engine fixtures' policy (`policyFor`, 60 · 1.5 / 2.0 ·
 * 12) and Policy v2's C1 (`V2_DEFAULTS`, the faces' defaults) — are run ONCE, in `beforeAll`. Each run is checked and
 * dropped: only counters and the first few violation labels are kept (holding ~30k results would cost gigabytes). Each
 * `it` then asserts its own slice, so a broken rule still goes red at the test that names it. The switch flips (I4, I5)
 * run on a stride (EXTRA); the policy-off arm is the same at both settings, so it runs once.
 */

const MONTH_END = { seizeOnTheWayDown: false } as const;
const SETTINGS: readonly (readonly [string, Partial<SupportPolicyInputs>])[] = [
  ['the fixtures\' policy', {}],
  ['C1 (V2_DEFAULTS)', { ...V2_DEFAULTS }],
];
/** The switch flips run on every input of the small sets and on every Nth of the large ones. Reach cells 0 and 4 — both
 *  month-0 seizures with a Coinbase leftover — are on the stride, so Strike-first's month-0 moves stay reachable. */
const EXTRA = { doubleDrops: 4, reach: 4, synthetic: 16 } as const;
const KEEP = 5;

interface SweepCase { label: string; inputs: CyclingInputs; extra: boolean }

function sweepCases(o: Partial<SupportPolicyInputs>): SweepCase[] {
  const out: SweepCase[] = [];
  const over = (i: CyclingInputs, x: Partial<SupportPolicyInputs> = {}): CyclingInputs =>
    ({ ...i, supportPolicy: { ...i.supportPolicy!, ...o, ...x } });
  for (const c of a5Cases()) {
    out.push({ label: `a5 ${c.name}`, inputs: over(c.on), extra: true });
    out.push({ label: `a5 ${c.name} · cash 6`, inputs: over(c.on, { openingCashUsd: CASH_6_USD }), extra: true });
  }
  for (const row of coldRuleRows()) {
    for (const seed of [0, 0.5]) {
      out.push({ label: `rows ${row.name} · seed ${seed}`, inputs: { ...over(row.on), openingColdBtc: seed }, extra: true });
    }
  }
  doubleDropRows().forEach((d, i) => out.push({ label: d.name, inputs: over(d.on), extra: i % EXTRA.doubleDrops === 0 }));
  faceWorldGrid().forEach((c, i) => out.push({
    label: `face-world #${i}`, inputs: { ...c.off, supportPolicy: policyFor(c.support, o) }, extra: true,
  }));
  syntheticGrid().forEach((c, i) => {
    for (const [arm, inputs] of [['', c.off], [' (cap off)', c.capOff]] as const) {
      out.push({
        label: `synthetic #${i}${arm}`, inputs: { ...inputs, supportPolicy: policyFor(c.support, o) },
        extra: i % EXTRA.synthetic === 0,
      });
    }
  });
  reachGrid().forEach((c, i) => out.push({
    label: `reach #${i}`, inputs: { ...c.off, supportPolicy: policyFor(c.support, o) }, extra: i % EXTRA.reach === 0,
  }));
  return out;
}

interface Tally {
  runs: number;
  /** I1 — the rule fired (seized on the way down) / did not (the whole run equals its month-end reading). */
  fired: number; unchanged: number;
  /** Where the month-end reading liquidated a fired run: the same month, later, or never (a seizure it hid). */
  sameMonth: number; later: number; hidden: number;
  firedAtMonth1: number;
  /** I3 — liquidations at the opening (the month-end reading) and in month 1 or later (always on the way down). */
  monthZero: number; monthOnePlus: number;
  /** I4 — runs each retired switch moves under the month-end reading; Strike-first's moves at a month-0 seizure. */
  movedD: number; movedFutility: number; movedStrikeFirst: number; strikeFirstMonth0: number;
  /** I5 — `false` (the month-end reading) differs from absent; a policy-off run opens a month past 86%. */
  falseDiffers: number; offPastLltv: number;
}
const tally = (): Tally => ({
  runs: 0, fired: 0, unchanged: 0, sameMonth: 0, later: 0, hidden: 0, firedAtMonth1: 0, monthZero: 0, monthOnePlus: 0,
  movedD: 0, movedFutility: 0, movedStrikeFirst: 0, strikeFirstMonth0: 0, falseDiffers: 0, offPastLltv: 0,
});

type Kind = 'kill' | 'seizure' | 'price' | 'monthOn' | 'retire' | 'absent';
interface Sweep { bySettings: [string, Tally][]; first: Record<Kind, string[]>; count: Record<Kind, number> }

/** Does a run (the month-end reading) carry its loan into a month at or past 86% at that month's price, before any
 *  liquidation? — the month the rule WOULD seize, were it not gated on the policy (M1's target). */
function opensPastLltv(r: CyclingResult, i: CyclingInputs): boolean {
  const cmr = i.cbAprPct / 100 / 12;
  for (let m = 1; m < r.rows.length; m++) {
    if (r.liqMonth !== null && m > r.liqMonth) return false;
    const prev = r.rows[m - 1];
    const debt = prev.cbDebt + prev.cbDebt * cmr;
    const price = r.rows[m].price;
    if (debt > 0 && prev.cbCollateralBtc > 0 && price > 0 && ltvOf(debt, prev.cbCollateralBtc, price) >= CB_LLTV) return true;
  }
  return false;
}

function runSweep(): Sweep {
  const first = { kill: [], seizure: [], price: [], monthOn: [], retire: [], absent: [] } as Record<Kind, string[]>;
  const count = { kill: 0, seizure: 0, price: 0, monthOn: 0, retire: 0, absent: 0 } as Record<Kind, number>;
  const note = (k: Kind, label: string): void => {
    count[k] += 1;
    if (first[k].length < KEEP) first[k].push(label);
  };
  const bySettings: [string, Tally][] = [];
  SETTINGS.forEach(([name, o], s) => {
    const t = tally();
    for (const { label: caseLabel, inputs, extra } of sweepCases(o)) {
      const label = `${name} · ${caseLabel}`;
      const on = runCyclingSim(inputs);
      const me = runCyclingSim({ ...inputs, ...MONTH_END });
      t.runs += 1;
      const L = on.liqMonth;

      // ── I1 · the kill criterion, and I2 · the seizure itself ──
      if (on.seizedOnTheWayDown === true && L !== null) {
        t.fired += 1;
        if (L === 1) t.firedAtMonth1 += 1;
        if (!isDeepStrictEqual(on.rows.slice(0, L), me.rows.slice(0, L)) || (me.liqMonth !== null && me.liqMonth < L)) {
          note('kill', `${label} (fired m${L}, month-end ${me.liqMonth})`);
        }
        if (me.liqMonth === L) t.sameMonth += 1;
        else if (me.liqMonth === null) t.hidden += 1;
        else t.later += 1;
        if (!isDeepStrictEqual(on, me)) t.falseDiffers += 1;
        const prev = on.rows[L - 1];
        const row = on.rows[L];
        const cmr = inputs.cbAprPct / 100 / 12;
        const debt = prev.cbDebt + prev.cbDebt * cmr;   // the engine's own ops: `ci = cbDebt * cmr; cbDebt += ci`
        const at = `${label} m${L}`;
        if (on.seizurePriceUsd !== cbLiquidationPrice(debt, prev.cbCollateralBtc)) note('price', at);
        if (!(on.seizurePriceUsd !== null && on.seizurePriceUsd > row.price)) note('seizure', `${at}: not above the month's price`);
        if (!(Math.abs((on.seizedBtc ?? Number.NaN) - CB_LIF * CB_LLTV * prev.cbCollateralBtc) <= 1e-12)) {
          note('seizure', `${at}: seized ${on.seizedBtc}`);
        }
        if (on.deficiencyUsd !== null) note('seizure', `${at}: deficiency ${on.deficiencyUsd}`);
        if (row.cbDebt !== 0) note('seizure', `${at}: debt ${row.cbDebt}`);
        if (row.strikeDrawn !== 0 || row.refinancedUsd !== 0 || row.topUpBtc !== 0 || row.defenseDrawnUsd !== 0
          || row.strikeToCbBtc !== 0 || row.sweptToColdBtc !== 0) note('seizure', `${at}: the month acted`);
        const survivor = prev.strikeCollateralBtc + (prev.cbCollateralBtc - (on.seizedBtc ?? 0)) + prev.coldBtc;
        if (on.survivorBtc === null || !(Math.abs(on.survivorBtc - survivor) <= 1e-12)) note('seizure', `${at}: survivor`);
      } else {
        t.unchanged += 1;
        if (!isDeepStrictEqual(on, me)) note('kill', `${label} (did not fire, yet differs)`);
      }

      // ── I3 · month 1 on: every liquidation is on the way down, with no deficiency and NOTHING left owing on Coinbase
      //    from the seizure on (a residue would accrue there); month 0 is the month-end reading ──
      if (L !== null && L >= 1) {
        t.monthOnePlus += 1;
        if (on.seizedOnTheWayDown !== true || on.deficiencyUsd !== null || on.rows.slice(L).some((x) => x.cbDebt !== 0)) {
          note('monthOn', `${label} m${L}`);
        }
      } else if (L === 0) {
        t.monthZero += 1;
        const p0 = inputs.pricePath[0];
        if (on.seizedOnTheWayDown !== false || on.seizurePriceUsd !== (p0 > 0 ? p0 : null)) note('monthOn', `${label} m0`);
      }

      if (!extra) continue;
      const flip = (x: Partial<CyclingInputs>): CyclingResult => runCyclingSim({ ...inputs, ...x });
      // ── I4 · under the rule the doom gate and the futility check change nothing, and Strike-first only a month-0
      //    seizure's leftover; each DOES move runs under the month-end reading ──
      if (!isDeepStrictEqual(flip({ doomGateCbTopUp: false }), on)) note('retire', `${label}: the doom gate`);
      if (!isDeepStrictEqual(flip({ cbFutilityCheck: false }), on)) note('retire', `${label}: the futility check`);
      if (!isDeepStrictEqual(flip({ strikeFirstAfterLiquidation: false }), on)) {
        if (on.liqMonth === 0) t.strikeFirstMonth0 += 1;
        else note('retire', `${label}: Strike first (liq ${on.liqMonth})`);
      }
      if (!isDeepStrictEqual(flip({ ...MONTH_END, doomGateCbTopUp: false }), me)) t.movedD += 1;
      if (!isDeepStrictEqual(flip({ ...MONTH_END, cbFutilityCheck: false }), me)) t.movedFutility += 1;
      if (!isDeepStrictEqual(flip({ ...MONTH_END, strikeFirstAfterLiquidation: false }), me)) t.movedStrikeFirst += 1;
      // ── I5 · absent ≡ on under the policy; the policy-off engine ignores the switch (the same at both settings) ──
      if (!isDeepStrictEqual(flip({ seizeOnTheWayDown: true }), on)) note('absent', `${label}: absent ≠ true`);
      if (s === 0) {
        const off: CyclingInputs = { ...inputs, supportPolicy: undefined };
        const offAbsent = runCyclingSim(off);
        for (const v of [true, false]) {
          if (!isDeepStrictEqual(runCyclingSim({ ...off, seizeOnTheWayDown: v }), offAbsent)) {
            note('absent', `${caseLabel}, policy off: ${v} ≠ absent`);
          }
        }
        if (opensPastLltv(offAbsent, off)) t.offPastLltv += 1;
      }
    }
    bySettings.push([name, t]);
  });
  return { bySettings, first, count };
}

let sweep: Sweep;
beforeAll(() => { sweep = runSweep(); }, 300_000);

const sum = (k: keyof Tally): number => sweep.bySettings.reduce((a, [, t]) => a + t[k], 0);
const expectNone = (k: Kind): void => expect(sweep.first[k], `${sweep.count[k]} ${k} violations`).toEqual([]);

/** Comments stripped — a comment may NAME a formula; only code is checked. */
const code = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('⭐ Policy v2 — Morpho seizes on the way down (seizeOnTheWayDown)', () => {
  it('absent ≡ on under the policy; the policy-off engine ignores the switch (I5)', () => {
    expectNone('absent');
    // Non-vacuous: the switch matters under the policy (the month-end reading differs from absent on every fired
    // run) — and some policy-off run carries its loan into a month past 86%, where an ungated rule WOULD seize.
    expect(sum('falseDiffers')).toBeGreaterThan(0);
    expect(sum('offPastLltv')).toBeGreaterThan(0);
  });

  it('⭐ KILL CRITERION — the rule moves no run before the month it fires (I1)', () => {
    // A run the rule does not fire on deep-equals its month-end reading; one it fires on at L is identical through
    // L − 1, and the month-end reading never liquidated it EARLIER.
    expectNone('kill');
    for (const [name, t] of sweep.bySettings) {
      // Non-vacuous: fired runs, the seizures the month-end reading hid, and runs the rule leaves alone all occur.
      expect(t.fired, `${name}: fired`).toBeGreaterThan(0);
      expect(t.hidden, `${name}: hidden`).toBeGreaterThan(0);
      expect(t.unchanged, `${name}: unchanged`).toBeGreaterThan(0);
      expect(t.sameMonth, `${name}: liquidated the same month at month-end`).toBeGreaterThan(0);
      expect(t.later, `${name}: liquidated later at month-end`).toBeGreaterThan(0);
      expect(t.fired + t.unchanged).toBe(t.runs);
    }
  });

  it('⭐ the seizure — at the liquidation price, after the interest, before any action; 0.898 of the pool, debt exactly 0 (I2)', () => {
    // seizurePriceUsd === cbLiquidationPrice(the carried debt after its interest, the carried pool), above the month's
    // price; seizedBtc = CB_LIF × CB_LLTV × the pool; no deficiency; the row's debt is 0; the row draws, refinances,
    // tops up, shifts, migrates and sweeps nothing; survivorBtc is the pools right after the seizure.
    expectNone('price');
    expectNone('seizure');
    expect(sum('fired')).toBeGreaterThan(0);
    expect(sum('firedAtMonth1')).toBeGreaterThan(0);   // month 1 is reached too
  });

  it('⭐ month 1 on — every liquidation is on the way down, with no deficiency and nothing left owing; month 0 is the month-end reading (I3)', () => {
    expectNone('monthOn');
    expect(sum('monthOnePlus')).toBeGreaterThan(0);
    expect(sum('monthZero')).toBeGreaterThan(0);       // an opening already past 86% — reach's deep month-0 stresses
  });

  it('⭐ what the rule retires — the doom gate and the futility check change no run; Strike-first only a month-0 seizure (I4)', () => {
    // A doomed month opens past 86% at its price, so the rule seizes it first; a seizure on the way down repays the
    // loan in full (CB_LIF × CB_LLTV < 1), so only a month-0 seizure leaves Strike-first a Coinbase leftover.
    expectNone('retire');
    // Non-vacuous: each one DOES move runs under the month-end reading — and Strike-first a month-0 seizure here.
    expect(sum('movedD')).toBeGreaterThan(0);
    expect(sum('movedFutility')).toBeGreaterThan(0);
    expect(sum('movedStrikeFirst')).toBeGreaterThan(0);
    expect(sum('strikeFirstMonth0')).toBeGreaterThan(0);
  });

  it('⭐ ONE seizure price — cbMetrics and the engine both call cbLiquidationPrice; neither keeps its own expression (I6)', () => {
    const metrics = code('../cbMetrics.ts');
    const engine = code('../cyclingSim.ts');
    expect(metrics).toMatch(/\bcbLiquidationPrice\(/);
    expect(metrics).not.toMatch(/\bCB_LLTV\b/);                          // the expression's own ingredient
    expect(engine).toMatch(/\bcbLiquidationPrice\(cbDebt, cbColl\)/);
    expect(engine).not.toMatch(/\(\s*cbColl\s*\*\s*CB_LLTV\s*\)/);
    // One expression, three readers: cbMetrics().liqPrice, cbSeizurePrice and the engine's seizure.
    for (const [debt, coll] of [[60_000, 2], [10_000, 0.5], [0, 1], [5_000, 0]] as const) {
      expect(cbMetrics(debt, coll, 50_000, 75).liqPrice, `${debt} on ${coll}`).toBe(cbLiquidationPrice(debt, coll));
    }
    expect(cbLiquidationPrice(60_000, 2)).toBeCloseTo(60_000 / (2 * 0.86), 9);
    expect(cbLiquidationPrice(5_000, 0)).toBe(0);
    expect(cbSeizurePrice({ cbDebt: 60_000, cbCollateralBtc: 2, postLiquidation: false })).toBe(cbLiquidationPrice(60_000, 2));
    expectNone('price');                                                   // every fired run, across the sweep
    expect(sum('fired')).toBeGreaterThan(0);
  });

  it('the month-end seizure — a covered pool repays in full ($0 owed after); a short pool keeps its real deficiency (I8)', () => {
    // The face-world grid, policy OFF — the month-end reading. When the pool covered the debt, the old round trip
    // (need = debt × CB_LIF ÷ price, then need × price ÷ CB_LIF back) could leave a float residue that the faces
    // printed as "$0 of debt survives". Recomputed here from the breaching row (pushed pre-seizure), so the cells it
    // hits are found by what they are, never by index.
    const oldResidue = (debt: number, price: number): number => debt - (((debt * CB_LIF) / price) * price) / CB_LIF;
    const seized = faceWorldGrid().map((c, i) => ({ i, r: runCyclingSim(c.off) }))
      .filter(({ r }) => r.liqMonth !== null && r.liqMonth > 0);
    let covered = 0;
    let residueProne = 0;
    for (const { i, r } of seized) {
      const L = r.liqMonth!;
      const row = r.rows[L];
      if (!(r.seizedBtc! < row.cbCollateralBtc)) continue;          // a short pool: its deficiency is real
      covered += 1;
      if (oldResidue(row.cbDebt, row.price) > 0) residueProne += 1;
      expect(r.deficiencyUsd, `cell ${i}`).toBeNull();
      if (L + 1 < r.rows.length) expect(r.rows[L + 1].cbDebt, `cell ${i}`).toBe(0);   // $0 owed after — exactly
    }
    // Non-vacuous: covered month-end seizures occur, and the old round trip leaves a residue on some of them. WHICH cells
    // depends on the platform's last-bit floating point (at the commit before Policy v2: 7 on one machine, 8 on another),
    // so they are found by computing the round trip, never by index.
    expect(covered).toBeGreaterThan(0);
    expect(residueProne).toBeGreaterThan(0);
    for (const { i, r } of seized) {                                 // read at month-end, at the month's price
      expect(r.seizedOnTheWayDown, `cell ${i}`).toBe(false);
      expect(r.seizurePriceUsd, `cell ${i}`).toBe(r.rows[r.liqMonth!].price);
    }
    // Reach cell 0, policy ON: month 0 is the month-end reading at the opening price — and its pool was short.
    const s = reachGrid()[0];
    const m0 = runCyclingSim({ ...s.off, supportPolicy: policyFor(s.support) });
    expect(m0.liqMonth).toBe(0);
    expect(m0.seizedBtc).toBe(m0.rows[0].cbCollateralBtc);           // the whole pool …
    expect(m0.deficiencyUsd!).toBeCloseTo(6_470, 0);                 // … and the debt it couldn't cover survives
    expect(m0.rows[1].cbDebt).toBeGreaterThan(m0.deficiencyUsd!);    // still debt — it accrues
    expect(m0.seizedOnTheWayDown).toBe(false);
    expect(m0.seizurePriceUsd).toBe(s.off.pricePath[0]);
  });

  it('⭐ the resolution equals the run — every reason reached, and the answers pinned (I7)', () => {
    // ⚠ The run and supportPolicyResolution share ONE function, so "equals the run" stays green when that function
    // changes (F10) — the answers are pinned too.
    const P = pathP2(0);
    const base: CyclingInputs = { ...SP_REPRO, pricePath: P, supportPolicy: policyFor(SUPPORT) };
    const pol = (o: Partial<SupportPolicyInputs>): CyclingInputs => ({ ...base, supportPolicy: policyFor(SUPPORT, o) });
    const bad = (m: number, v: number): number[] => SUPPORT.map((x, i) => (i === m ? v : x));
    const cases: [string, CyclingInputs][] = [
      ['absent', { ...SP_REPRO, pricePath: P }],
      ['applied', base],
      ['mode hold', { ...base, mode: 'hold' }],
      ['mode clearBoth', { ...base, mode: 'clearBoth' }],
      ['support too short', { ...base, supportPolicy: policyFor(SUPPORT.slice(0, 10)) }],
      ['support NaN', { ...base, supportPolicy: policyFor(bad(5, Number.NaN)) }],
      ['support 0', { ...base, supportPolicy: policyFor(bad(5, 0)) }],
      ['cb stop 0', pol({ cbStopAtSupportPct: 0 })],
      ['cb stop 86', pol({ cbStopAtSupportPct: 86 })],
      ['CB cap 0', { ...base, cbLtvCapPct: 0 }],
      ['strike stop 70', pol({ strikeStopAtSupportPct: 70 })],
      ['strike stop NaN', pol({ strikeStopAtSupportPct: Number.NaN })],
      ['zones equal', pol({ accumulateBelow: 2, payDownAbove: 2 })],
      ['zones NaN', pol({ payDownAbove: Number.NaN })],
      ['buffer −1', pol({ bearBufferMonths: -1 })],
      ['cash NaN', pol({ openingCashUsd: Number.NaN })],
      ['cure 0.70', pol({ strikeCureLtv: 0.70 })],
      ['retrieve 0.51', pol({ strikeRetrieveMaxLtv: 0.51 })],
      ['re-arm 1.5', pol({ breakerRearmMonths: 1.5 })],
      ['re-arm 0', pol({ breakerRearmMonths: 0 })],
      ['empty path, one-month support', { ...SP_REPRO, pricePath: [], supportPolicy: policyFor([S0]) }],
      ['empty path, two-month support', { ...SP_REPRO, pricePath: [], supportPolicy: policyFor([S0, S0]) }],
      ...[0.01, 0.50, 0.70, 0.71, 0.85].map((x): [string, CyclingInputs] =>
        [`Strike liquidation ${Math.round(x * 100)}%`, pol({ strikePartialLiqLtv: x })]),
      ['Strike cap 68 (clamped)', { ...base, strikeLtvCapPct: 68 }],
    ];
    const reached = new Set<string>();
    for (const [label, inputs] of cases) {
      const r = runCyclingSim(inputs);
      expect(supportPolicyResolution(inputs), label)
        .toEqual({ policyApplied: r.policyApplied, policyIgnoredReason: r.policyIgnoredReason });
      reached.add(inputs.supportPolicy === undefined ? 'absent' : r.policyApplied ? 'applied' : r.policyIgnoredReason!);
    }
    const EVERY: Record<PolicyIgnoredReason, true> = {
      mode: true, supportPath: true, cbStop: true, strikeStop: true, zones: true, buffer: true, cash: true,
      strikeLadder: true, retrieveLtv: true, rearm: true,
    };
    expect([...reached].sort()).toEqual([...Object.keys(EVERY), 'absent', 'applied'].sort());

    // ⭐ The answers, pinned.
    const answer = (i: CyclingInputs) => supportPolicyResolution(i);
    const APPLIED = { policyApplied: true, policyIgnoredReason: null };
    expect(answer(base)).toEqual(APPLIED);
    expect(answer({ ...SP_REPRO, pricePath: P })).toEqual({ policyApplied: false, policyIgnoredReason: null });
    // An empty path runs as [0] — one month — so a one-month support applies and a longer one does not.
    expect(answer({ ...SP_REPRO, pricePath: [], supportPolicy: policyFor([S0]) })).toEqual(APPLIED);
    expect(answer({ ...SP_REPRO, pricePath: [], supportPolicy: policyFor([S0, S0]) }))
      .toEqual({ policyApplied: false, policyIgnoredReason: 'supportPath' });
    // Strike's liquidation LTV must sit above its 70% margin call: 1 / 50 / 70% are refused, 71 / 85% apply.
    for (const x of [0.01, 0.50, 0.70]) {
      expect(answer(pol({ strikePartialLiqLtv: x })), `${x}`).toEqual({ policyApplied: false, policyIgnoredReason: 'strikeLadder' });
    }
    for (const x of [0.71, 0.85]) expect(answer(pol({ strikePartialLiqLtv: x })), `${x}`).toEqual(APPLIED);
  });

  it('resolveSupportPolicy has ONE caller — resolveRunPolicy, shared by the run and supportPolicyResolution', () => {
    const engine = code('../cyclingSim.ts');
    expect(engine).toMatch(/function resolveRunPolicy\(/);
    expect([...engine.matchAll(/\bresolveSupportPolicy\(/g)]).toHaveLength(2);   // its definition, and the one call
    const body = engine.slice(engine.indexOf('function resolveRunPolicy('), engine.indexOf('export function supportPolicyResolution('));
    expect(body).toMatch(/\bresolveSupportPolicy\(/);
    expect([...engine.matchAll(/\bresolveRunPolicy\(/g)]).toHaveLength(3);       // its definition, the run, the export
  });
});
