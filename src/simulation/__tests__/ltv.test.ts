import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { ltvOf, ltvOfUsd } from '../ltv';
import { computeStrikeLtv } from '../strikeCredit';
import { cbMetrics } from '../cbMetrics';
import { fmtLtvPct } from '../../utils/format';

// Synthetic round figures only — this repo is public.

describe('ltvOf — THE definition', () => {
  it('the honest ratio when the collateral is priced', () => {
    expect(ltvOf(60_000, 2, 80_000)).toBeCloseTo(0.375, 12);
  });

  it('⭐ debt with NO collateral is ∞, never 0', () => {
    expect(ltvOf(60_000, 0, 80_000)).toBe(Number.POSITIVE_INFINITY);
    expect(ltvOf(60_000, -1, 80_000)).toBe(Number.POSITIVE_INFINITY);   // negative reads as none
    expect(fmtLtvPct(ltvOf(60_000, 0, 80_000), 1)).toBe('∞');
  });

  it('⭐ collateral but NO price is 0 — an unpriced position is not an unbacked one', () => {
    expect(ltvOf(60_000, 2, 0)).toBe(0);
  });

  it('nothing at all is 0 — no debt and no collateral is not the alarm', () => {
    expect(ltvOf(0, 0, 80_000)).toBe(0);
    expect(ltvOf(0, 2, 80_000)).toBe(0);
  });
});

describe('ltvOfUsd — same rule from a precomputed USD value', () => {
  it('agrees with ltvOf wherever both can be expressed', () => {
    for (const [debt, btc, price] of [[60_000, 2, 80_000], [60_000, 0, 80_000], [0, 0, 0], [60_000, 2, 0]]) {
      expect(ltvOfUsd(debt, btc * price, btc)).toBe(ltvOf(debt, btc, price));
    }
  });

  it('⭐ collateralBtc is what decides ∞ — a zero USD value alone cannot tell the two apart', () => {
    expect(ltvOfUsd(60_000, 0, 0)).toBe(Number.POSITIVE_INFINITY);   // no coins  → unbacked
    expect(ltvOfUsd(60_000, 0, 2)).toBe(0);                          // no price  → unpriced
  });
});

describe('the five former copies now agree', () => {
  it('computeStrikeLtv and cbMetrics.ltv both route through the shared rule', () => {
    expect(computeStrikeLtv(50_000, 0, 80_000)).toBe(Number.POSITIVE_INFINITY);
    expect(computeStrikeLtv(50_000, 1, 0)).toBe(0);
    expect(cbMetrics(50_000, 0, 80_000, 75).ltv).toBe(Number.POSITIVE_INFINITY);
    expect(cbMetrics(50_000, 1, 0, 75).ltv).toBe(0);
    expect(computeStrikeLtv(40_000, 1, 80_000)).toBe(ltvOf(40_000, 1, 80_000));
  });
});

describe('⭐ the rule is defined ONCE', () => {
  it('no module re-implements the LTV ternary', () => {
    // The shape is distinctive: `<= 0 ? Number.POSITIVE_INFINITY`. It must appear in ltv.ts and
    // nowhere else in PRODUCTION code. Legitimate POSITIVE_INFINITY uses (an ∞ default credit line,
    // the refinance headroom sentinel) do not match, so this catches a new COPY without flagging them.
    // ⚠ `__tests__` is excluded because THIS file necessarily contains the pattern literal, and a
    // hand-rolled expectation inside a test is not a second definition of the rule.
    const hits = execSync(
      'grep -rlE --exclude-dir=__tests__ "<= ?0 ?\\? ?Number\\.POSITIVE_INFINITY" src/ || true',
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    expect(hits, `LTV re-implemented outside ltv.ts:\n${hits.join('\n')}`).toEqual(['src/simulation/ltv.ts']);
  });
});
