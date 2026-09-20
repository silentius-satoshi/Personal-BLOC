import { describe, it, expect } from 'vitest';
import {
  strikeDrawCapacity, defendCbLtv, topUpToCbLtv, TOPUP_MARGIN_BUFFER,
  type CbDefenseInput, type CbTopUpInput,
} from '../cbDefense';

/**
 * Debt-shift defense math. Synthetic fixture (this repo is public): 72k CB debt against 2 ₿ at $48k is a
 * 75% CB LTV, so a 70% cap needs a $4,800 paydown; Strike holds 1 ₿, $9,300 drawn, a 50% max-draw line.
 */
const BASE: CbDefenseInput = {
  cbDebt: 72_000,
  cbCollateralBtc: 2.0,
  strikeCollateralBtc: 1.0,
  strikeBalance: 9_300,
  price: 48_000,
  targetCbLtvPct: 70,
  creditLine: Number.POSITIVE_INFINITY,
  maxDrawLtv: 0.5,
  marginLtv: 0.7,
};

describe('strikeDrawCapacity', () => {
  it('is min(creditLine, collateral × price × maxDrawLtv) − drawn, floored at 0', () => {
    expect(strikeDrawCapacity(1, 9_300, 48_000, 0.5, Number.POSITIVE_INFINITY)).toBeCloseTo(14_700, 6);
    expect(strikeDrawCapacity(1, 9_300, 48_000, 0.5, 12_000)).toBeCloseTo(2_700, 6);   // line binds
    expect(strikeDrawCapacity(1, 30_000, 48_000, 0.5, 100_000)).toBe(0);               // already past the cap
  });

  it('guards zero collateral / zero price / negative drawn without NaN', () => {
    expect(strikeDrawCapacity(0, 5_000, 48_000, 0.5)).toBe(0);
    expect(strikeDrawCapacity(1, 5_000, 0, 0.5)).toBe(0);
    expect(strikeDrawCapacity(1, -5_000, 48_000, 0.5)).toBeCloseTo(24_000, 6);   // negative drawn → full cap
  });
});

describe('defendCbLtv — pay Coinbase down to the cap with a Strike draw', () => {
  it('⭐ the worked example: 75% → 70% costs a $4,800 paydown', () => {
    const r = defendCbLtv(BASE);
    expect(r.paydownNeededUsd).toBeCloseTo(4_800, 6);
    expect(r.capacityUsd).toBeCloseTo(14_700, 6);
    expect(r.drawUsd).toBeCloseTo(4_800, 6);
    expect(r.shortfallUsd).toBe(0);
    expect(r.fullyDefended).toBe(true);
    expect(r.cbLtvAfter).toBeCloseTo(0.70, 9);
  });

  it('reports the post-shift Strike position and the reversal price', () => {
    const r = defendCbLtv(BASE);
    expect(r.cbDebtAfter).toBeCloseTo(67_200, 6);
    expect(r.skLtvAfter).toBeCloseTo(14_100 / 48_000, 9);                        // 29.375%
    expect(r.skMarginCallPriceAfter).toBeCloseTo(14_100 / (1 * 0.7), 6);         // $20,142.86
    expect(r.recoveryPrice).toBeCloseTo(48_000, 6);                              // LTV = cap at the current price
  });

  it('⭐ capacity-limited: pays what Strike can, reports the shortfall, does not over-draw', () => {
    const r = defendCbLtv({ ...BASE, strikeBalance: 22_000 });                  // capacity 2,000
    expect(r.capacityUsd).toBeCloseTo(2_000, 6);
    expect(r.drawUsd).toBeCloseTo(2_000, 6);
    expect(r.shortfallUsd).toBeCloseTo(2_800, 6);
    expect(r.fullyDefended).toBe(false);
    expect(r.cbDebtAfter).toBeCloseTo(70_000, 6);
    expect(r.cbLtvAfter).toBeCloseTo(70_000 / 96_000, 9);
    expect(r.recoveryPrice).toBeGreaterThan(BASE.price);                        // needs a rise to reverse
  });

  it('the credit line binds before the 50% collateral cap when it is lower', () => {
    const r = defendCbLtv({ ...BASE, creditLine: 12_000 });                     // capacity 2,700
    expect(r.drawUsd).toBeCloseTo(2_700, 6);
    expect(r.shortfallUsd).toBeCloseTo(2_100, 6);
  });

  it('at/below the cap nothing is needed (fullyDefended true, draw 0)', () => {
    const r = defendCbLtv({ ...BASE, cbDebt: 60_000 });                         // 62.5% CB LTV
    expect(r.paydownNeededUsd).toBe(0);
    expect(r.drawUsd).toBe(0);
    expect(r.fullyDefended).toBe(true);
  });

  it('guards zero collateral / zero price without NaN — debt still needs the whole paydown', () => {
    const zeroColl = defendCbLtv({ ...BASE, cbCollateralBtc: 0 });
    expect(zeroColl.paydownNeededUsd).toBeCloseTo(72_000, 6);
    expect(zeroColl.drawUsd).toBeCloseTo(14_700, 6);
    expect(zeroColl.shortfallUsd).toBeCloseTo(57_300, 6);
    expect(Number.isNaN(zeroColl.cbLtvAfter)).toBe(false);

    const zeroPrice = defendCbLtv({ ...BASE, price: 0 });
    expect(zeroPrice.capacityUsd).toBe(0);
    expect(zeroPrice.drawUsd).toBe(0);
    // ⚠ Still 0 AFTER routing skLtvAfter through ltvOf: at price 0 with POSITIVE collateral the
    // `coll <= 0` arm is false, so it falls through to 0. Unchanged, and deliberately so.
    expect(zeroPrice.skLtvAfter).toBe(0);
    expect(Number.isNaN(zeroPrice.recoveryPrice)).toBe(false);
  });

  it('⭐ skLtvAfter routes through ltvOf — Strike debt with NO collateral is ∞, never 0', () => {
    // The contract this module's header promises: one LTV definition the engine, both faces' stress
    // readout and the Emergency Console share. A `skValue > 0 ? … : 0` fallback reported the WORST
    // position in the app — $50,000 drawn against nothing — as perfectly safe, while its own neighbour
    // cbLtvAfter reported ∞ for the same shape. No consumer renders it yet; fix it before one does.
    const r = defendCbLtv({
      cbDebt: 100_000, cbCollateralBtc: 2, strikeCollateralBtc: 0, strikeBalance: 50_000,
      price: 50_000, targetCbLtvPct: 70, creditLine: 100_000, maxDrawLtv: 0.5, marginLtv: 0.85,
    });
    expect(r.capacityUsd).toBe(0);            // no collateral → no headroom → nothing was drawn
    expect(r.skLtvAfter).toBe(Number.POSITIVE_INFINITY);
    expect(r.cbLtvAfter).toBeCloseTo(1.0, 9); // the neighbour it must agree with in shape
  });
});

/**
 * Emergency collateral top-up. Same fixture shape: 72k debt, 2 ₿ CB collateral, $48k price, a 70% stop —
 * so restoring the stop needs 0.142857 ₿. The cold reserve is the first source; Strike is the last resort,
 * bounded a TOPUP_MARGIN_BUFFER inside its 70% margin line — 9,300 drawn keeps 9,300/(0.665×48k) =
 * 0.291353 ₿ of collateral, not the 0.276786 the bare margin would allow.
 */
const TOPUP: CbTopUpInput = {
  cbDebt: 72_000,
  cbCollateralBtc: 2.0,
  price: 48_000,
  targetCbLtvPct: 70,
  coldBtc: 0.5,
  strikeCollateralBtc: 1.0,
  strikeBalance: 9_300,
  marginLtv: 0.7,
};

describe('topUpToCbLtv — grow the CB denominator, cold first', () => {
  it('⭐ the worked example: 0.142857 ₿ restores the 70% stop from cold alone', () => {
    const r = topUpToCbLtv(TOPUP);
    expect(r.requiredBtc).toBeCloseTo(72_000 / (0.7 * 48_000) - 2, 9);
    expect(r.fromColdBtc).toBeCloseTo(r.requiredBtc, 9);
    expect(r.fromStrikeBtc).toBe(0);
    expect(r.topUpBtc).toBeCloseTo(r.requiredBtc, 9);
    expect(r.shortfallBtc).toBe(0);
    expect(r.fullyDefended).toBe(true);
    expect(r.cbLtvAfter).toBeCloseTo(0.70, 9);
  });

  it('⭐ only touches Strike AFTER cold is exhausted — and never past the margin line', () => {
    const required = 72_000 / (0.7 * 48_000) - 2;
    const r = topUpToCbLtv({ ...TOPUP, coldBtc: 0.05 });
    expect(r.fromColdBtc).toBe(0.05);
    expect(r.fromStrikeBtc).toBeCloseTo(required - 0.05, 9);
    expect(r.topUpBtc).toBeCloseTo(required, 9);
    expect(r.fullyDefended).toBe(true);
  });

  it('reports the shortfall when both sources run dry', () => {
    // Strike collateral 0.28 ₿ against the 0.291353 the BUFFERED bound needs (9,300 / (0.665 × 48k)) →
    // NOTHING available; cold empty. Pre-buffer this fixture yielded a 0.003214 sliver taken right up to
    // the call line. ⚠ Zero is the CORRECT answer for a leg already inside the buffer: that sliver bought
    // almost nothing and triggered the margin call in the same month.
    const r = topUpToCbLtv({ ...TOPUP, coldBtc: 0, strikeCollateralBtc: 0.28 });
    expect(r.fromColdBtc).toBe(0);
    expect(r.fromStrikeBtc).toBe(0);
    expect(r.shortfallBtc).toBeGreaterThan(0);
    expect(r.fullyDefended).toBe(false);
    expect(r.cbLtvAfter).toBeGreaterThan(0.70);
  });

  it('⭐ the Strike source stops a buffer SHORT of the margin line, never on it', () => {
    // Drain it: require far more than Strike can give, so fromStrikeBtc === strikeAvailable exactly.
    // Bounding at marginLtv itself landed Strike EXACTLY on its call line, so cyclingSim's
    // `strikeLtv >= strikeMarginLtv` fired the same month — a second liquidation, not a last resort.
    const r = topUpToCbLtv({ ...TOPUP, cbDebt: 200_000, coldBtc: 0, strikeCollateralBtc: 2, marginLtv: 0.85 });
    const strikeCollAfter = 2 - r.fromStrikeBtc;
    const strikeLtvAfter = 9_300 / (strikeCollAfter * 48_000);
    expect(r.shortfallBtc).toBeGreaterThan(0);                       // genuinely exhausted
    expect(strikeLtvAfter).toBeCloseTo(0.85 * (1 - TOPUP_MARGIN_BUFFER), 9);
    expect(strikeLtvAfter).toBeLessThan(0.85);                       // ⚠ the whole point
  });

  it('at/below the stop nothing moves', () => {
    const r = topUpToCbLtv({ ...TOPUP, cbDebt: 60_000 });   // 62.5% LTV
    expect(r.requiredBtc).toBe(0);
    expect(r.topUpBtc).toBe(0);
    expect(r.fullyDefended).toBe(true);
  });

  it('guards zero price / zero margin without NaN', () => {
    const zeroPrice = topUpToCbLtv({ ...TOPUP, price: 0 });
    expect(zeroPrice.requiredBtc).toBe(0);
    expect(zeroPrice.topUpBtc).toBe(0);
    expect(Number.isNaN(zeroPrice.cbLtvAfter)).toBe(false);

    const zeroMargin = topUpToCbLtv({ ...TOPUP, coldBtc: 0, marginLtv: 0 });
    expect(zeroMargin.fromStrikeBtc).toBe(0);
    expect(zeroMargin.shortfallBtc).toBeGreaterThan(0);
  });
});
