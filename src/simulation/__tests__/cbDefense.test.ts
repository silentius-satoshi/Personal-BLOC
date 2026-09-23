import { describe, it, expect } from 'vitest';
import {
  strikeDrawCapacity, defendCbLtv, topUpToCbLtv, TOPUP_MARGIN_BUFFER,
  topUpStrikeLtv, strikeCollateralAboveLtv, CB_SURVIVAL_BUFFER, cbSurvivalCollateralBtc, cbDoomedThisMonth,
  type CbDefenseInput, type CbTopUpInput, type StrikeTopUpInput, type CbDoomInput,
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

  it('⭐ coldBtc = NaN yields fromColdBtc 0 and no NaN anywhere — the topUpStrikeLtv twin\'s guard', () => {
    // `Math.max(0, NaN)` is NaN, and `Math.min(required, NaN)` carried it into fromColdBtc → topUpBtc →
    // shortfallBtc → cbLtvAfter. Junk cold must read as an EMPTY pool, exactly as it does on the Strike side.
    const r = topUpToCbLtv({ ...TOPUP, coldBtc: NaN });
    expect(r.fromColdBtc).toBe(0);
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') expect(Number.isNaN(v), `${k} is NaN`).toBe(false);
    }
    // With cold read as empty, the Strike collateral above the buffered margin line is the only source.
    expect(r.fromStrikeBtc).toBeCloseTo(r.requiredBtc, 9);
  });
});

/**
 * Strike-side twin. Synthetic: $64,000 drawn against 0.4 ₿ at $200k is an 80% Strike LTV, so a 60% cap
 * needs 64,000 / (0.6 × 200,000) − 0.4 = 0.133333 ₿ from cold.
 */
const SK: StrikeTopUpInput = {
  strikeBalance: 64_000,
  strikeCollateralBtc: 0.4,
  price: 200_000,
  targetStrikeLtvPct: 60,
  coldBtc: 1.0,
};

describe('topUpStrikeLtv — cold → Strike, the Strike cap\'s only source', () => {
  it('⭐ requiredBtc is balance / (target × price) − collateral, and the cold pays it', () => {
    const r = topUpStrikeLtv(SK);
    expect(r.requiredBtc).toBeCloseTo(64_000 / (0.6 * 200_000) - 0.4, 12);
    expect(r.fromColdBtc).toBeCloseTo(r.requiredBtc, 12);
    expect(r.shortfallBtc).toBe(0);
    expect(r.fullyDefended).toBe(true);
    expect(r.targetStrikeLtv).toBeCloseTo(0.6, 12);
    expect(r.strikeLtvAfter).toBeCloseTo(0.6, 9);
  });

  it('already at or under the target: nothing moves', () => {
    const r = topUpStrikeLtv({ ...SK, strikeBalance: 40_000 });   // 50% < 60%
    expect(r.requiredBtc).toBe(0);
    expect(r.fromColdBtc).toBe(0);
    expect(r.fullyDefended).toBe(true);
  });

  it('a zero or negative price returns 0 — never NaN', () => {
    for (const price of [0, -50_000]) {
      const r = topUpStrikeLtv({ ...SK, price });
      expect(r.requiredBtc).toBe(0);
      expect(r.fromColdBtc).toBe(0);
      expect(Number.isNaN(r.strikeLtvAfter)).toBe(false);
    }
  });

  it('⭐ coldBtc = NaN yields fromColdBtc 0, not NaN (Math.max(0, NaN) is NaN — the standing trap)', () => {
    expect(Math.max(0, NaN)).toBeNaN();   // why the guard is Number.isFinite, not Math.max
    for (const coldBtc of [NaN, -1, Number.NEGATIVE_INFINITY]) {
      const r = topUpStrikeLtv({ ...SK, coldBtc });
      expect(r.fromColdBtc).toBe(0);
      expect(r.shortfallBtc).toBeCloseTo(r.requiredBtc, 12);
      expect(r.fullyDefended).toBe(false);
    }
  });

  it('cold shorter than required → a shortfall, and not fully defended', () => {
    const r = topUpStrikeLtv({ ...SK, coldBtc: 0.05 });
    expect(r.fromColdBtc).toBe(0.05);
    expect(r.shortfallBtc).toBeCloseTo(r.requiredBtc - 0.05, 12);
    expect(r.shortfallBtc).toBeGreaterThan(0);
    expect(r.fullyDefended).toBe(false);
    expect(r.strikeLtvAfter).toBeGreaterThan(0.6);
  });

  it('⭐ strikeLtvAfter is ∞ for a balance with NO collateral — never a flattering 0%', () => {
    const r = topUpStrikeLtv({ ...SK, strikeBalance: 10_000, strikeCollateralBtc: 0, coldBtc: 0 });
    expect(r.requiredBtc).toBeGreaterThan(0);
    expect(r.strikeLtvAfter).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('topUpToCbLtv — the Strike floor (strikeFloorLtv)', () => {
  /** Drains Strike: 200k of debt needs far more than Strike can give, and cold is empty, so
   *  fromStrikeBtc lands exactly on the bound. 9,300 drawn against 2 ₿ at $48k. */
  const DRAIN: CbTopUpInput = { ...TOPUP, cbDebt: 200_000, coldBtc: 0, strikeCollateralBtc: 2 };
  const strikeLtvAfter = (fromStrikeBtc: number) => 9_300 / ((2 - fromStrikeBtc) * 48_000);

  it('⭐ a floor at 0.60 bounds the grab at 60%, not at the 66.5% margin bound', () => {
    const floored = topUpToCbLtv({ ...DRAIN, strikeFloorLtv: 0.60 });
    const bare = topUpToCbLtv(DRAIN);
    expect(floored.shortfallBtc).toBeGreaterThan(0);                 // genuinely drained
    expect(strikeLtvAfter(floored.fromStrikeBtc)).toBeCloseTo(0.60, 9);
    expect(strikeLtvAfter(bare.fromStrikeBtc)).toBeCloseTo(0.70 * (1 - TOPUP_MARGIN_BUFFER), 9);
    expect(floored.fromStrikeBtc).toBeLessThan(bare.fromStrikeBtc);
  });

  it('⭐ absent changes nothing: undefined / 0 / a floor looser than the margin bound are all byte-identical', () => {
    // The half that stops this parameter silently retightening the shipped CB defense on every face.
    const bare = topUpToCbLtv(DRAIN);
    for (const strikeFloorLtv of [undefined, 0, -0.5, NaN, 0.9]) {
      expect(topUpToCbLtv({ ...DRAIN, strikeFloorLtv })).toStrictEqual(bare);
    }
  });
});

describe('strikeCollateralAboveLtv — what Strike can spare above a bound', () => {
  it('the worked example: 1 ₿ backing $30,000 at a 60% bound spares 0.5 ₿', () => {
    expect(strikeCollateralAboveLtv(1, 30_000, 100_000, 0.6)).toBeCloseTo(0.5, 12);
  });

  it('a balance already above the bound spares nothing', () => {
    expect(strikeCollateralAboveLtv(1, 80_000, 100_000, 0.6)).toBe(0);
  });

  it('a non-positive price or bound spares nothing — never NaN', () => {
    expect(strikeCollateralAboveLtv(1, 30_000, 0, 0.6)).toBe(0);
    expect(strikeCollateralAboveLtv(1, 30_000, -1, 0.6)).toBe(0);
    expect(strikeCollateralAboveLtv(1, 30_000, 100_000, 0)).toBe(0);
    expect(strikeCollateralAboveLtv(1, 30_000, 100_000, NaN)).toBe(0);
  });

  it('a negative balance counts as none — the whole pledge is spare', () => {
    expect(strikeCollateralAboveLtv(1, -5_000, 100_000, 0.6)).toBe(1);
  });
});

describe('cbSurvivalCollateralBtc — the collateral Coinbase needs to stay alive', () => {
  it('⭐ the worked example: max(0, debt / (lltv × (1 − buffer) × price) − collateral)', () => {
    // $50,000 against 1 ₿ at $45k with Morpho's 86% and a 5% buffer → 50,000 / 36,765 − 1 = 0.359989 ₿.
    expect(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86)).toBeCloseTo(50_000 / (0.86 * 0.95 * 45_000) - 1, 12);
    expect(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86)).toBeCloseTo(0.359989, 6);
  });

  it('CB_SURVIVAL_BUFFER is its own export and is the default buffer', () => {
    expect(CB_SURVIVAL_BUFFER).toBe(0.05);
    expect(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86))
      .toBe(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86, CB_SURVIVAL_BUFFER));
    // The parameter is honoured — buffer 0 asks only for the ACTUAL liquidation line.
    expect(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86, 0)).toBeCloseTo(50_000 / (0.86 * 45_000) - 1, 12);
  });

  it('already safe → 0', () => {
    expect(cbSurvivalCollateralBtc(30_000, 1, 100_000, 0.86)).toBe(0);
  });

  it('a zero or negative price → 0, never NaN or ∞', () => {
    expect(cbSurvivalCollateralBtc(50_000, 1, 0, 0.86)).toBe(0);
    expect(cbSurvivalCollateralBtc(50_000, 1, -45_000, 0.86)).toBe(0);
  });

  it('NaN / ∞ inputs never produce NaN', () => {
    const bad = [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const b of bad) {
      for (const r of [
        cbSurvivalCollateralBtc(b, 1, 45_000, 0.86),
        cbSurvivalCollateralBtc(50_000, b, 45_000, 0.86),
        cbSurvivalCollateralBtc(50_000, 1, b, 0.86),
        cbSurvivalCollateralBtc(50_000, 1, 45_000, b),
        cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86, b),
      ]) {
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // ── stopLtv: the need is capped at what reaching the Coinbase STOP takes ─────────────────────────────
  // Above an 81.7% stop (0.86 × 0.95) the CB top-up only aims at the stop, so reserving cold for the
  // survival line would claim coins the top-up never takes. The target is the LOOSER of the two lines.
  const LINE = 0.86 * (1 - CB_SURVIVAL_BUFFER);

  it('⭐ (b) a stop at or below the survival line returns exactly the 5-arg value', () => {
    const fiveArg = cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86);
    for (const stop of [0.5, 0.7, 0.81, LINE]) {
      expect(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86, CB_SURVIVAL_BUFFER, stop)).toBe(fiveArg);
    }
  });

  it('⭐ (c) a stop above the line agrees with topUpToCbLtv on "BTC to reach an LTV"', () => {
    // The two leaves must share one answer: the collateral that lands Coinbase exactly on the stop.
    for (const stop of [0.82, 0.84, 0.85]) {
      const need = cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86, CB_SURVIVAL_BUFFER, stop);
      const required = topUpToCbLtv({
        cbDebt: 50_000, cbCollateralBtc: 1, price: 45_000, targetCbLtvPct: stop * 100,
        coldBtc: 0, strikeCollateralBtc: 0, strikeBalance: 0, marginLtv: 0.7,
      }).requiredBtc;
      expect(need).toBeGreaterThan(0);
      expect(need).toBeCloseTo(required, 12);
      expect(need).toBeLessThan(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86));   // the cap bites
    }
  });

  it('⭐ (d) a junk or zero stop falls back to the survival line — never NaN, never looser', () => {
    const fiveArg = cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86);
    for (const stop of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0.5]) {
      expect(cbSurvivalCollateralBtc(50_000, 1, 45_000, 0.86, CB_SURVIVAL_BUFFER, stop)).toBe(fiveArg);
    }
  });
});

describe('cbDoomedThisMonth — the futility check', () => {
  /** Exact arithmetic: 0.5 × 100,000 = 50,000, so $100,000 against 1 ₿ needs exactly 1 ₿ more to clear
   *  a 50% line. No Strike collateral, so "possible" is the cold alone. */
  const EXACT: CbDoomInput = {
    cbDebt: 100_000, cbCollateralBtc: 1, price: 100_000, lltv: 0.5,
    coldBtc: 1, strikeCollateralBtc: 0, strikeBalance: 0, marginLtv: 0.7,
  };

  it('⭐ the boundary: exactly enough is not doomed, one sat short is', () => {
    expect(cbDoomedThisMonth(EXACT)).toBe(false);
    expect(cbDoomedThisMonth({ ...EXACT, coldBtc: 1 - 1e-8 })).toBe(true);
  });

  it('Strike collateral above the margin bound counts toward what is possible', () => {
    // 0.5 cold + 0.5 spare Strike (balance 0 → the whole pledge) = exactly enough.
    expect(cbDoomedThisMonth({ ...EXACT, coldBtc: 0.5, strikeCollateralBtc: 0.5 })).toBe(false);
    expect(cbDoomedThisMonth({ ...EXACT, coldBtc: 0.5, strikeCollateralBtc: 0.5 - 1e-8 })).toBe(true);
  });

  it('⭐ the Strike bound is marginLtv × (1 − TOPUP_MARGIN_BUFFER), NOT the Strike cap', () => {
    // 1 ₿ backing $30,600 at $100k: at the 66.5% margin bound it spares 0.539850 ₿ (possible 1.04 ≥ 1),
    // at a 60% cap only 0.49 (possible 0.99 < 1). Reading the cap would declare this savable month doomed.
    const x = { ...EXACT, coldBtc: 0.5, strikeCollateralBtc: 1, strikeBalance: 30_600 };
    expect(0.5 + strikeCollateralAboveLtv(1, 30_600, 100_000, 0.6)).toBeLessThan(1);
    expect(cbDoomedThisMonth(x)).toBe(false);
  });

  it('⭐ buffer 0 is deliberate — it asks about the ACTUAL liquidation line, not the survival line', () => {
    // 1.05 ₿ clears the 50% line (needs 1.0) but not the buffered one (needs 1.105).
    expect(cbSurvivalCollateralBtc(100_000, 1, 100_000, 0.5)).toBeGreaterThan(1.05);
    expect(cbDoomedThisMonth({ ...EXACT, coldBtc: 1.05 })).toBe(false);
  });

  it('a zero, negative or junk price — or any junk input — is never doomed, and never throws', () => {
    expect(cbDoomedThisMonth({ ...EXACT, coldBtc: 0, price: 0 })).toBe(false);
    expect(cbDoomedThisMonth({ ...EXACT, coldBtc: 0, price: -1 })).toBe(false);
    for (const k of Object.keys(EXACT) as (keyof CbDoomInput)[]) {
      for (const bad of [NaN, Number.POSITIVE_INFINITY]) {
        expect(cbDoomedThisMonth({ ...EXACT, coldBtc: 0, [k]: bad })).toBe(false);
      }
    }
  });
});
