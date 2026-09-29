import { describe, it, expect } from 'vitest';
import { crashPlaybook, type CrashPlaybookInput, type CrashPlaybookResult } from '../crashPlaybook';
import { ceilingLiquidationMultiple } from '../cbDefense';
import { CB_LLTV } from '../runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';

/**
 * The crash playbook as a pure function (crash playbook Run 1). Round synthetic figures only — this repo is public.
 *
 * BASE: price $80k at support $100k (k = 0.8, inside [0.6/0.86, 1)), Coinbase $60k on 1 ₿ (75%, over its 70% line,
 * alive — 75% is under 86%), Strike $8k on 1 ₿ (10% — it releases down to just under 50%), a $40k line, no cold.
 * The engine ≡ crashPlaybook parity (Strike cap off) is pinned in cyclingSimPolicy.test.ts.
 */
const BASE: CrashPlaybookInput = {
  price: 80_000, support: 100_000, cbDebt: 60_000, cbCollateralBtc: 1, strikeBalance: 8_000, strikeCollateralBtc: 1,
  strikeCreditLine: 40_000, coldBtc: 0, targetCbLtvPct: 70, cbStopAtSupport: 0.6, lltv: CB_LLTV,
  maxDrawLtv: STRIKE_MAX_DRAW_LTV, marginLtv: STRIKE_MARGIN_CALL_LTV, retrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV,
  strikeInHold: false,
};

const kinds = (r: CrashPlaybookResult): string[] => r.steps.map((s) => s.kind);
const stepBtc = (r: CrashPlaybookResult, kind: 'coldToCoinbase' | 'strikeToCoinbase'): number =>
  r.steps.reduce((s, x) => s + (x.kind === kind ? x.btc : 0), 0);
const shiftUsd = (r: CrashPlaybookResult): number =>
  r.steps.reduce((s, x) => s + (x.kind === 'shiftToStrike' ? x.usd : 0), 0);

/** Coins and debt are conserved: every step moves value between the three pools / two debts, never creates it. */
function expectConserved(input: CrashPlaybookInput, r: CrashPlaybookResult): void {
  const a = r.after;
  expect(a.cbCollateralBtc + a.strikeCollateralBtc + a.coldBtc)
    .toBeCloseTo(input.cbCollateralBtc + input.strikeCollateralBtc + input.coldBtc, 12);
  expect(a.cbDebt + a.strikeBalance).toBeCloseTo(input.cbDebt + input.strikeBalance, 6);
  expect(a.cbCollateralBtc).toBeCloseTo(input.cbCollateralBtc + stepBtc(r, 'coldToCoinbase') + stepBtc(r, 'strikeToCoinbase'), 12);
  expect(a.cbDebt).toBeCloseTo(input.cbDebt - shiftUsd(r), 6);
  for (const v of Object.values(a)) expect(Number.isNaN(v)).toBe(false);
}

describe('crashPlaybook — the orders', () => {
  it('none — Coinbase at or under its line', () => {
    const r = crashPlaybook({ ...BASE, cbDebt: 50_000 });           // 62.5% ≤ 70%
    expect(r.order).toBe('none');
    expect(r.steps).toEqual([]);
    expect(r.shortfallBtc).toBe(0);
    expect(r.doomed).toBe(false);
    expect(r.after.cbDebt).toBe(50_000);
  });

  it('⭐ topUpFirst — a full top-up from released Strike collateral records NO shift step', () => {
    expect(BASE.price / BASE.support).toBeGreaterThanOrEqual(ceilingLiquidationMultiple(0.6, CB_LLTV));   // premise: in the band
    const r = crashPlaybook(BASE);
    expect(r.order).toBe('topUpFirst');
    expect(kinds(r)).toEqual(['strikeToCoinbase']);
    expect(stepBtc(r, 'strikeToCoinbase')).toBeCloseTo(60_000 / (0.7 * 80_000) - 1, 12);   // 0.0714 ₿
    expect(r.shortfallBtc).toBe(0);
    expect(r.after.cbLtv).toBeCloseTo(0.7, 12);
    expectConserved(BASE, r);
  });

  it('topUpFirst — cold first, then Strike collateral; plenty of cold moves cold only', () => {
    const some = crashPlaybook({ ...BASE, coldBtc: 0.05 });
    expect(kinds(some)).toEqual(['coldToCoinbase', 'strikeToCoinbase']);
    expect(stepBtc(some, 'coldToCoinbase')).toBe(0.05);
    expect(stepBtc(some, 'strikeToCoinbase')).toBeCloseTo(60_000 / (0.7 * 80_000) - 1 - 0.05, 12);
    expectConserved({ ...BASE, coldBtc: 0.05 }, some);
    const plenty = crashPlaybook({ ...BASE, coldBtc: 1 });
    expect(kinds(plenty)).toEqual(['coldToCoinbase']);
    expect(plenty.shortfallBtc).toBe(0);
    expectConserved({ ...BASE, coldBtc: 1 }, plenty);
  });

  it('⭐ shiftFirst below the depth — the shift goes first even with collateral Strike would release', () => {
    const input = { ...BASE, price: 60_000 };                        // k 0.6 < 0.6977
    const r = crashPlaybook(input);
    expect(r.order).toBe('shiftFirst');
    expect(r.doomed).toBe(false);
    expect(kinds(r)).toEqual(['shiftToStrike']);
    expect(shiftUsd(r)).toBeCloseTo(18_000, 6);                     // 60,000 − 0.7 × 60,000
    expect(r.shortfallBtc).toBe(0);
    expectConserved(input, r);
  });

  it('shiftFirst at or above support', () => {
    const input = { ...BASE, price: 110_000, cbDebt: 80_000 };       // k 1.1; 72.7%
    const r = crashPlaybook(input);
    expect(r.order).toBe('shiftFirst');
    expect(kinds(r)).toEqual(['shiftToStrike']);
    expect(shiftUsd(r)).toBeCloseTo(3_000, 6);
    expectConserved(input, r);
  });

  it('⭐ doomed → shift first, and the fallback never pours into a Coinbase still doomed after the shift', () => {
    // Coinbase 93.75% needs 0.09 ₿ to clear 86%; Strike is at 45% (over 40% — it releases nothing), and 0.02 ₿ of cold
    // can't cover it. After the $4k shift Coinbase still needs 0.032 ₿ — more than the cold — so it stays doomed.
    const input = { ...BASE, cbDebt: 75_000, strikeBalance: 36_000, coldBtc: 0.02 };
    const r = crashPlaybook(input);
    expect(r.doomed).toBe(true);
    expect(r.order).toBe('shiftFirst');
    expect(kinds(r)).toEqual(['shiftToStrike']);
    expect(shiftUsd(r)).toBeCloseTo(4_000, 6);                      // the line's remaining capacity
    expect(r.after.coldBtc).toBe(0.02);                             // the cold stays out of a doomed Coinbase
    expect(r.shortfallBtc).toBeGreaterThan(0);
    expectConserved(input, r);
  });
});

describe('crashPlaybook — Strike\'s release rules', () => {
  it('⭐ Strike over 40% releases nothing: no Strike step, the shift covers the rest', () => {
    const input = { ...BASE, strikeBalance: 36_000 };                 // 45%
    const r = crashPlaybook(input);
    expect(r.order).toBe('topUpFirst');
    expect(kinds(r)).toEqual(['shiftToStrike']);
    expect(shiftUsd(r)).toBeCloseTo(4_000, 6);
    expect(r.shortfallBtc).toBe(0);
    expectConserved(input, r);
  });

  it('⭐ inside the 60-day hold, nothing leaves Strike', () => {
    const input = { ...BASE, strikeInHold: true };
    const r = crashPlaybook(input);
    expect(kinds(r)).toEqual(['shiftToStrike']);
    expect(shiftUsd(r)).toBeCloseTo(4_000, 6);
    expectConserved(input, r);
  });

  it('⭐ a binding release leaves Strike just UNDER 50%, never on the line', () => {
    const input = { ...BASE, cbCollateralBtc: 3, cbDebt: 204_000, strikeBalance: 16_000 };
    const r = crashPlaybook(input);
    expect(stepBtc(r, 'strikeToCoinbase')).toBeGreaterThan(0.59);
    expect(r.after.strikeLtv).toBeLessThan(0.5);
    expect(r.after.strikeLtv).toBeCloseTo(0.5, 8);
  });
});

describe('crashPlaybook — the fallback and the dust drop', () => {
  it('⭐ the fallback runs only for the shift\'s shortfall — cold after a short shift', () => {
    // Below the depth: the line ($30k) has $5k of room, the shift falls $13k short, cold covers the rest.
    const input = { ...BASE, price: 60_000, strikeBalance: 25_000, strikeCreditLine: 30_000, coldBtc: 0.5 };
    const r = crashPlaybook(input);
    expect(r.order).toBe('shiftFirst');
    expect(kinds(r)).toEqual(['shiftToStrike', 'coldToCoinbase']);
    expect(shiftUsd(r)).toBeCloseTo(5_000, 6);
    expect(stepBtc(r, 'coldToCoinbase')).toBeCloseTo(55_000 / (0.7 * 60_000) - 1, 12);   // 0.3095 ₿
    expect(r.shortfallBtc).toBe(0);
    expectConserved(input, r);
    // A shift that restores the line leaves the cold alone.
    const noNeed = crashPlaybook({ ...BASE, price: 60_000, coldBtc: 0.5 });
    expect(kinds(noNeed)).toEqual(['shiftToStrike']);
  });

  it('⭐ the dust drop — after a binding release, a sub-half-cent shift is no step, and the line reads unheld', () => {
    // Coinbase $204k on 3 ₿ (85%); Strike $16k on 1 ₿ releases 0.6 ₿ — short of the 0.643 ₿ need. The line has room,
    // but Strike now sits a hair under 50%, so the shift could draw only ~$0.00002.
    const input = { ...BASE, cbCollateralBtc: 3, cbDebt: 204_000, strikeBalance: 16_000 };
    const r = crashPlaybook(input);
    expect(r.order).toBe('topUpFirst');
    expect(kinds(r)).toEqual(['strikeToCoinbase']);
    expect(r.shortfallBtc).toBeCloseTo(204_000 / (0.7 * 80_000) - r.after.cbCollateralBtc, 12);
    expect(r.shortfallBtc).toBeGreaterThan(0.04);
    expect(r.after.cbDebt).toBe(204_000);
    expectConserved(input, r);
  });
});

describe('crashPlaybook — shortfall, junk', () => {
  it('shortfallBtc > 0 exactly when the line does not hold (clear of the float boundary)', () => {
    const cases: CrashPlaybookInput[] = [
      BASE, { ...BASE, coldBtc: 0.05 }, { ...BASE, price: 60_000 }, { ...BASE, cbDebt: 75_000, strikeBalance: 36_000 },
      { ...BASE, strikeBalance: 36_000 }, { ...BASE, price: 60_000, strikeBalance: 25_000, strikeCreditLine: 30_000, coldBtc: 0.5 },
      { ...BASE, cbCollateralBtc: 3, cbDebt: 204_000, strikeBalance: 16_000 },
    ];
    for (const c of cases) {
      const r = crashPlaybook(c);
      const over = r.after.cbLtv > 0.7 + 1e-9;
      expect(r.shortfallBtc > 0, JSON.stringify(c)).toBe(over);
    }
  });

  it('junk → none, never NaN', () => {
    const bads: Partial<CrashPlaybookInput>[] = [
      { price: 0 }, { price: -1 }, { support: 0 }, { targetCbLtvPct: 0 }, { price: NaN }, { cbDebt: Infinity },
      { coldBtc: NaN }, { strikeCreditLine: -Infinity }, { cbStopAtSupport: NaN }, { retrieveMaxLtv: NaN },
    ];
    for (const b of bads) {
      const r = crashPlaybook({ ...BASE, ...b });
      expect(r.order, JSON.stringify(b)).toBe('none');
      expect(r.steps).toEqual([]);
      expect(r.shortfallBtc).toBe(0);
    }
  });
});
