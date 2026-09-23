import { describe, it, expect } from 'vitest';
import {
  policyZone, ceilingHeadroomUsd, sweepKeepBtc, collateralToSellForLtv, resolveStrikeCall, nextBreakerState,
  allocatePayDown, BREAKER_START, SUPPORT_EPS, HARD_BREAKER_DEPTH, HARD_BREAKER_MONTHS,
  type BreakerState, type StrikeCallInput,
} from '../supportPolicy';

/**
 * The support-anchored policy's pure leaf (spec v1.2 §A1). Round synthetic figures throughout: support
 * $100,000 unless a case says otherwise. Every case is written so it FAILS if the rule it pins is removed.
 */

const S = 100_000;

describe('policyZone — the multiple k = price / support', () => {
  it('every boundary: paused < 1 ≤ accumulate ≤ 1.5 < hold ≤ 2.0 < payDown', () => {
    const z = (price: number) => policyZone(price, S, 1.5, 2.0);
    expect(z(99_999)).toBe('paused');
    expect(z(100_000)).toBe('accumulate');
    expect(z(150_000)).toBe('accumulate');
    expect(z(150_001)).toBe('hold');
    expect(z(200_000)).toBe('hold');
    expect(z(200_001)).toBe('payDown');
  });

  it('the epsilon pair: a price computed ONTO the line is never read as below it', () => {
    expect(SUPPORT_EPS).toBe(1e-9);
    expect(policyZone(S * (1 - 1e-12), S, 1.5, 2.0)).toBe('accumulate');
    expect(policyZone(S * (1 - 1e-6), S, 1.5, 2.0)).toBe('paused');
  });

  it('junk fails SAFE — paused, i.e. no new debt', () => {
    for (const support of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(policyZone(150_000, support, 1.5, 2.0)).toBe('paused');
    }
    for (const price of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(policyZone(price, S, 1.5, 2.0)).toBe('paused');
    }
    expect(policyZone(150_000, S, Number.NaN, 2.0)).toBe('paused');
    expect(policyZone(150_000, S, 1.5, Number.NaN)).toBe('paused');
  });
});

describe('ceilingHeadroomUsd — room under the ceiling AT SUPPORT', () => {
  it('positive under the ceiling, negative over it', () => {
    expect(ceilingHeadroomUsd(50_000, 1.0, S, 0.60)).toBeCloseTo(10_000, 9);
    expect(ceilingHeadroomUsd(70_000, 1.0, S, 0.60)).toBeCloseTo(-10_000, 9);
  });

  it('non-finite or non-positive inputs → 0 (no room, nothing to restore) — never NaN', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const b of bad) {
      expect(ceilingHeadroomUsd(b, 1, S, 0.6)).toBe(0);
      expect(ceilingHeadroomUsd(50_000, b, S, 0.6)).toBe(0);
      expect(ceilingHeadroomUsd(50_000, 1, b, 0.6)).toBe(0);
      expect(ceilingHeadroomUsd(50_000, 1, S, b)).toBe(0);
    }
    expect(ceilingHeadroomUsd(50_000, 1, 0, 0.6)).toBe(0);
    expect(ceilingHeadroomUsd(50_000, 1, S, 0)).toBe(0);
  });
});

describe('sweepKeepBtc — what the sweep must leave on Coinbase', () => {
  it('(debt + buffer) / (support × stop)', () => {
    expect(sweepKeepBtc(30_000, 60_000, S, 0.60)).toBeCloseTo(1.5, 12);
  });

  it('debt and buffer both 0 → 0', () => {
    expect(sweepKeepBtc(0, 0, S, 0.60)).toBe(0);
  });

  it('junk → +Infinity: a sweep must fail SAFE (keep everything)', () => {
    expect(sweepKeepBtc(30_000, 60_000, 0, 0.6)).toBe(Number.POSITIVE_INFINITY);
    expect(sweepKeepBtc(30_000, 60_000, Number.NaN, 0.6)).toBe(Number.POSITIVE_INFINITY);
    expect(sweepKeepBtc(30_000, 60_000, S, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(sweepKeepBtc(Number.NaN, 60_000, S, 0.6)).toBe(Number.POSITIVE_INFINITY);
    expect(sweepKeepBtc(30_000, Number.NaN, S, 0.6)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('collateralToSellForLtv — a sale down to the target (sold coins retire debt 1:1)', () => {
  it('70% → 14.2857% of the collateral; 85% → 57.1429%', () => {
    expect(collateralToSellForLtv(70_000, 1.0, S, 0.65)).toBeCloseTo(0.142857142857, 12);
    expect(collateralToSellForLtv(85_000, 1.0, S, 0.65)).toBeCloseTo(0.571428571429, 12);
  });

  it('at or under the target → 0', () => {
    expect(collateralToSellForLtv(65_000, 1.0, S, 0.65)).toBe(0);
    expect(collateralToSellForLtv(50_000, 1.0, S, 0.65)).toBe(0);
  });

  it('LTV above 100% clamps to the whole collateral (the rest is a deficiency)', () => {
    expect(collateralToSellForLtv(120_000, 1.0, S, 0.65)).toBe(1.0);
  });

  it('junk → 0, never NaN', () => {
    expect(collateralToSellForLtv(70_000, 1.0, 0, 0.65)).toBe(0);
    expect(collateralToSellForLtv(Number.NaN, 1.0, S, 0.65)).toBe(0);
    expect(collateralToSellForLtv(70_000, 1.0, S, 1)).toBe(0);
  });
});

describe('⭐ resolveStrikeCall — cash, then cold, then a sale; ≥ 85% is sold at once', () => {
  const base: StrikeCallInput = {
    strikeBalance: 72_000, strikeCollateralBtc: 1.0, price: S,
    callLtv: 0.70, cureLtv: 0.65, partialLiqLtv: 0.85, cashUsd: 0, coldBtc: 0,
  };

  it('a · cash cures it: 7,000 repaid, balance 65,000', () => {
    const r = resolveStrikeCall({ ...base, cashUsd: 10_000 });
    expect(r.state).toBe('cured');
    expect(r.cureCashUsd).toBeCloseTo(7_000, 9);
    expect(r.cureColdBtc).toBe(0);
    expect(r.soldBtc).toBe(0);
    expect(r.balanceAfter).toBeCloseTo(65_000, 9);
    expect(r.collateralAfter).toBe(1.0);
  });

  it('b · cash, then cold, then a sale down to exactly 65%', () => {
    const r = resolveStrikeCall({ ...base, cashUsd: 3_000, coldBtc: 0.05 });
    expect(r.state).toBe('sold');
    expect(r.cureCashUsd).toBeCloseTo(3_000, 9);
    expect(r.cureColdBtc).toBeCloseTo(0.05, 12);
    expect(r.soldBtc).toBeCloseTo(0.0214286, 7);
    expect(r.balanceAfter).toBeCloseTo(66_857.14, 2);
    expect(r.collateralAfter).toBeCloseTo(1.0285714, 7);
    expect(r.balanceAfter / (r.collateralAfter * S)).toBeCloseTo(0.65, 12);
  });

  it('c · at ≥ 85% the sale is immediate — cash AND cold are untouched (no cure window)', () => {
    const r = resolveStrikeCall({ ...base, strikeBalance: 86_000, cashUsd: 10_000, coldBtc: 0.5 });
    expect(r.state).toBe('soldImmediate');
    expect(r.cureCashUsd).toBe(0);
    expect(r.cureColdBtc).toBe(0);
    expect(r.soldBtc).toBeCloseTo(0.6, 12);
    expect(r.balanceAfter).toBeCloseTo(26_000, 6);
    expect(r.collateralAfter).toBeCloseTo(0.4, 12);
  });

  it('d · exactly at the call (≥) is resolved; one dollar under it is not', () => {
    const at = resolveStrikeCall({ ...base, strikeBalance: 70_000 });
    expect(at.state).toBe('sold');
    expect(at.soldBtc).toBeCloseTo(0.142857142857, 12);
    const under = resolveStrikeCall({ ...base, strikeBalance: 69_999 });
    expect(under).toEqual({
      state: 'none', cureCashUsd: 0, cureColdBtc: 0, soldBtc: 0, balanceAfter: 69_999, collateralAfter: 1.0,
    });
  });

  it('e · cash FIRST — with enough cash, cold is never touched', () => {
    const r = resolveStrikeCall({ ...base, cashUsd: 7_000, coldBtc: 0.1 });
    expect(r.state).toBe('cured');
    expect(r.cureCashUsd).toBeCloseTo(7_000, 9);
    expect(r.cureColdBtc).toBe(0);
    expect(r.soldBtc).toBe(0);
  });

  it('NaN cash / cold read as empty — a plain sale, and no NaN anywhere', () => {
    const r = resolveStrikeCall({ ...base, cashUsd: Number.NaN, coldBtc: Number.NaN });
    expect(r.state).toBe('sold');
    expect(r.cureCashUsd).toBe(0);
    expect(r.cureColdBtc).toBe(0);
    expect(r.soldBtc).toBeCloseTo(0.2, 12);           // (72,000 − 65,000) / 35,000
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
  });
});

describe('nextBreakerState — 2 consecutive month-ends below 0.9 × support, then LATCHED', () => {
  const step = (multiples: number[]): BreakerState[] => {
    const out: BreakerState[] = [];
    let s = BREAKER_START;
    multiples.forEach((k, i) => { s = nextBreakerState(s, k * S, S, i + 1); out.push(s); });
    return out;
  };

  it('the constants', () => {
    expect(HARD_BREAKER_DEPTH).toBe(0.10);
    expect(HARD_BREAKER_MONTHS).toBe(2);
  });

  it('[0.89, 0.89] → broken at the second, and it says which month', () => {
    const s = step([0.89, 0.89]);
    expect(s[0].broken).toBe(false);
    expect(s[0].monthsBelow).toBe(1);
    expect(s[1]).toEqual({ monthsBelow: 2, broken: true, brokenMonth: 2 });
  });

  it('[0.89, 0.91, 0.89] → not broken (consecutive means consecutive)', () => {
    const s = step([0.89, 0.91, 0.89]);
    expect(s.every((x) => !x.broken)).toBe(true);
    expect(s[1].monthsBelow).toBe(0);
  });

  it('once broken it STAYS broken through a recovery (the latch)', () => {
    const s = step([0.85, 0.85, 1.2, 1.5, 2.0]);
    expect(s.slice(1).every((x) => x.broken && x.brokenMonth === 2)).toBe(true);
  });

  it('a price computed exactly ONTO 0.9 × support is not below it', () => {
    expect(step([0.9, 0.9]).every((x) => x.monthsBelow === 0)).toBe(true);
  });

  it('junk carries the previous state (no information, never NaN)', () => {
    const one = nextBreakerState(BREAKER_START, 0.85 * S, S, 1);
    expect(nextBreakerState(one, Number.NaN, S, 2)).toEqual(one);
    expect(nextBreakerState(one, 0.85 * S, 0, 2)).toEqual(one);
  });
});

describe('allocatePayDown — Strike first (13%), then Coinbase', () => {
  it('(10k, 6k, 20k) → 6k to Strike, 4k to Coinbase, nothing left', () => {
    expect(allocatePayDown(10_000, 6_000, 20_000)).toEqual({ toStrikeUsd: 6_000, toCbUsd: 4_000, leftUsd: 0 });
  });

  it('(30k, 6k, 20k) → both cleared, 4k left to buy with', () => {
    expect(allocatePayDown(30_000, 6_000, 20_000)).toEqual({ toStrikeUsd: 6_000, toCbUsd: 20_000, leftUsd: 4_000 });
  });

  it('junk and negatives → zeros, never NaN', () => {
    expect(allocatePayDown(Number.NaN, 6_000, 20_000)).toEqual({ toStrikeUsd: 0, toCbUsd: 0, leftUsd: 0 });
    expect(allocatePayDown(10_000, Number.NaN, -5)).toEqual({ toStrikeUsd: 0, toCbUsd: 0, leftUsd: 10_000 });
  });
});
