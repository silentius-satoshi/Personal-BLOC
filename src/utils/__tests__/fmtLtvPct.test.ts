import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmtLtvPct, fmtPpDelta } from '../format';
import { describeDayEvent } from '../../components/Daily/dailyView';
import { customTierReading } from '../../components/Collateral/TierCards';
import { diffScenarios } from '../../simulation/scenarioDiff';
import type { SafetyViewInputs } from '../../simulation/safetyView';
import type { DayEvent } from '../../simulation/types';
import { computeStrikeLtv } from '../../simulation/strikeCredit';
import { cbMetrics } from '../../simulation/cbMetrics';
import { computeLiquidationAnalysis, CB_LLTV } from '../../simulation/runCoinbaseLoan';

// ⚠ The identifier tail is [A-Za-z0-9_]*, NOT [a-zA-Z]*. The narrower class silently missed every
// snake_case LTV — `cb_ltv_now * 100).toFixed(1)` walked straight through it, and four such lines sat in
// LiqSimulator reporting 0.0% for an unbacked loan while this guard reported clean. The optional spaces
// around `*` are belt: a reformat must not create a new hole either.
const OPEN_CODED_LTV = '[Ll]tv[A-Za-z0-9_]* ?\\* ?100\\)\\.toFixed';

/**
 * ⚠ REGRESSION GUARD. `computeStrikeLtv`, `cbMetrics` and `computeLiquidationAnalysis` deliberately
 * return POSITIVE_INFINITY for debt with no collateral — returning 0 there rendered the worst possible
 * state as perfectly safe. But `(x * 100).toFixed(1)` on a non-finite number silently produces the
 * string "Infinity%", and that shipped in the Safety Dashboard, Simple Mode, the Liquidation Modeler,
 * the Ledger face and the Monthly Playbook while only the two Almanac faces were guarded.
 */
describe('fmtLtvPct', () => {
  it('formats finite fractions as percentages', () => {
    expect(fmtLtvPct(0)).toBe('0.0%');
    expect(fmtLtvPct(0.4615)).toBe('46.2%');
    expect(fmtLtvPct(0.86)).toBe('86.0%');
    expect(fmtLtvPct(0.5, 0)).toBe('50%');
  });

  it('⭐ renders an unbacked position as ∞, never the string "Infinity%"', () => {
    expect(fmtLtvPct(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(fmtLtvPct(Number.POSITIVE_INFINITY)).not.toContain('Infinity');
  });

  it('unknown (NaN / −Infinity) reads as an em dash, never 0%', () => {
    // "—" and "0.0%" mean opposite things to someone reading a safety gauge.
    expect(fmtLtvPct(NaN)).toBe('—');
    expect(fmtLtvPct(Number.NEGATIVE_INFINITY)).toBe('—');
  });

  it('⭐ the three engine sources really do emit Infinity — this guard is not hypothetical', () => {
    expect(computeStrikeLtv(5_000, 0, 80_000)).toBe(Number.POSITIVE_INFINITY);
    expect(cbMetrics(5_000, 0, 80_000, 75).ltv).toBe(Number.POSITIVE_INFINITY);
    const a = computeLiquidationAnalysis(100_000, 0.5, 50_000, 100_000 / (0.5 * CB_LLTV));
    expect(a.scenarios[0].newLtv).toBe(Number.POSITIVE_INFINITY);
    for (const v of [
      computeStrikeLtv(5_000, 0, 80_000),
      cbMetrics(5_000, 0, 80_000, 75).ltv,
      a.scenarios[0].newLtv,
    ]) {
      expect(fmtLtvPct(v)).toBe('∞');
    }
  });

  it('⭐ no component re-implements the formatter — one definition app-wide', () => {
    // The original defect was a second copy in cyclingFaceView while five other surfaces used the raw
    // pattern. Fails if anyone open-codes `(<something>ltv * 100).toFixed(...)` in a component again.
    const hits = execSync(
      `grep -rnE "${OPEN_CODED_LTV}" src/components/ || true`,
      { cwd: process.cwd(), encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      // TierCards' constant tiers (`TIERS`, a configured ratio) cannot be non-finite — that line alone. Sweep 3 (A4-6):
      // the exemption was file-wide, and the Custom tier's computed LTV walked through it ("0.0%" for expenses on ₿0).
      .filter((l) => !(l.includes('TierCards') && l.includes('(ltv * 100).toFixed(0)')))
      // CyclingFace guards with Number.isFinite before building a chart datum.
      .filter((l) => !l.includes('Number.isFinite'))
      // MonthlyLogSection's ltvFieldValue is an EDITABLE field value parsed back with parseFloat —
      // it must stay numeric, so it guards to '0' rather than rendering '∞'.
      .filter((l) => !l.includes('ltvFieldValue') && !l.includes('ltvFieldNumber'));
    expect(hits, `open-coded LTV formatting:\n${hits.join('\n')}`).toEqual([]);
  });

  it('⭐ the widened pattern catches snake_case and squished spacing, not a non-LTV', () => {
    const re = new RegExp(OPEN_CODED_LTV);
    expect(re.test('(cb_ltv_now * 100).toFixed(1)')).toBe(true);
    expect(re.test('(sk_ltv_at_T * 100).toFixed(1)')).toBe(true);
    expect(re.test('(currentCbLtv * 100).toFixed(1)')).toBe(true);
    expect(re.test('(cbLtv*100).toFixed(2)')).toBe(true);
    expect(re.test('(someTotal * 100).toFixed(0)')).toBe(false);
  });
});

/** Sweep 3 — three LTVs the guard couldn't see (a local `pct(frac)` and a file-wide exemption), each on the state that
 *  broke it. Synthetic round figures. No changed string prints NaN, Infinity, undefined or "$-". */
const BROKEN = /NaN|Infinity|undefined|\$-/;

describe('⭐ Sweep 3 — open-coded LTVs through fmtLtvPct (A4-4, A4-5, A4-6)', () => {
  it('⭐ DAILY READING (A4-4) — a Strike balance on no collateral reads ∞, live and after a reload (JSON stores ∞ as null)', () => {
    const ev = {
      id: 'r1', ts: 1, date: '2026-06-10', kind: 'balanceReading',
      reading: { strikeBal: 1_000, strikeLtv: Number.POSITIVE_INFINITY, cbBal: 5_000, cbLtv: Number.POSITIVE_INFINITY, price: 100_000 },
    } as unknown as DayEvent;
    const live = describeDayEvent(ev).detail;
    const reloaded = describeDayEvent(JSON.parse(JSON.stringify(ev)) as DayEvent).detail;
    expect([live, reloaded], 'DAILY READING ∞ both ways').toEqual([
      'Strike $1,000.00 (∞ LTV) · CB $5,000.00 (∞ LTV)', 'Strike $1,000.00 (∞ LTV) · CB $5,000.00 (∞ LTV)',
    ]);
    // A real reading reads as before; nothing owed on nothing is no ∞.
    const ok = { ...ev, reading: { strikeBal: 12_000, strikeLtv: 0.12, price: 100_000 } } as unknown as DayEvent;
    expect(describeDayEvent(ok).detail).toBe('Strike $12,000.00 (12.0% LTV)');
    const none = { ...ev, reading: { strikeBal: 0, strikeLtv: 0, price: 100_000 } } as unknown as DayEvent;
    expect(describeDayEvent(none).detail).toBe('Strike $0.00 (0.0% LTV)');
    for (const s of [live, reloaded]) expect(s).not.toMatch(BROKEN);
  });

  it('⭐ SCENARIO (A4-5) — no Strike collateral: "∞ → ∞ —", never "Infinity% → Infinity% NaNpp"', () => {
    const base: SafetyViewInputs = {
      advisorActualBlocBalance: 1_000, creditLine: 10_000, currentBtcHeld: 0, btcPrice: 100_000,
      strikeLiquidationLtvPct: 85, hasCbLoan: false, cbLoanBalance: 0, cbAprPct: 0, cbLoanBalanceAsOf: null,
      cbCollateralBtc: 0, cbLtvTriggerPct: 75, cbLiquidationPrice: 0,
    };
    const d = diffScenarios(base, base);
    expect(d.strikeLtv.from, 'SCENARIO premise: the engine emits ∞').toBe(Number.POSITIVE_INFINITY);
    const row = `${fmtLtvPct(d.strikeLtv.from)} → ${fmtLtvPct(d.strikeLtv.to)} ${fmtPpDelta(d.strikeLtv.delta, 'pp')}`;
    const crash = `Crash LTV ${fmtLtvPct(d.crashLtv.from)} → ${fmtLtvPct(d.crashLtv.to)}`;
    expect([row, crash]).toEqual(['∞ → ∞ —', 'Crash LTV ∞ → ∞']);
    expect([fmtPpDelta(Number.POSITIVE_INFINITY, 'pp'), fmtPpDelta(Number.NaN), fmtPpDelta(0.012, 'pp'), fmtPpDelta(0)])
      .toEqual(['—', '—', '+1.2pp', '+0.0']);
    for (const s of [row, crash]) expect(s).not.toMatch(BROKEN);
    // The face reads them — its local pct and pp are gone.
    const face = readFileSync(join(process.cwd(), 'src/components/Almanac/ScenarioFace.tsx'), 'utf8');
    expect(face, 'SCENARIO no local formatter').not.toMatch(/const (pct|pp) =/);
    expect(face).toContain("fmtPpDelta(dim.delta, 'pp')");
  });

  it('⭐ CUSTOM TIER (A4-6) — expenses drawn on ₿0 are ∞, "Liquidated" — never "0.0%", "Safe"', () => {
    const zero = customTierReading(3_500, 0, 100_000);
    expect([zero.dayOneText, zero.crashText, zero.label]).toEqual(['∞', '∞', 'Liquidated']);
    // A priced position reads exactly as before (the same ratio; the crash keeps its Math.ceil).
    const priced = customTierReading(1_000, 0.5, 16_000);
    expect([priced.dayOneText, priced.crashText])
      .toEqual([fmtLtvPct(1_000 / (0.5 * 16_000)), `${Math.ceil((1_000 / (0.5 * 16_000) / 0.20) * 100)}%`]);
    // Nothing drawn is no debt, whatever the collateral.
    expect(customTierReading(0, 0, 100_000)).toMatchObject({ dayOneText: '0.0%', crashText: '0%', label: 'Safe' });
    for (const s of [zero.dayOneText, zero.crashText]) expect(s).not.toMatch(BROKEN);
  });
});
