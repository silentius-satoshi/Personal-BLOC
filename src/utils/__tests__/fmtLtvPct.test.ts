import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { fmtLtvPct } from '../format';
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
      // TierCards' day-one LTV is a ratio of configured constants and cannot be non-finite.
      .filter((l) => !l.includes('TierCards'))
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
