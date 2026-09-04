import { describe, it, expect } from 'vitest';
import { runCyclingSim, CB_LIQUIDATION_PENALTY, type CyclingInputs } from '../cyclingSim';
import { cbMetrics } from '../cbMetrics';
import { CB_LLTV, CB_LIF } from '../runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV } from '../strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';

/**
 * Cycling strategy engine.
 *
 * ⚠ Outputs are NOT pinned to the JSX prototype this was ported from — that artifact collapsed the two
 * collateral pools, drew with no credit-line constraint, and zeroed debt on an under-collateralised
 * liquidation. Correctness here is defined by (a) agreeing with cbMetrics at t=0 and (b) the invariants
 * below. The obvious assertions — monotonicity, refinance cadence — all pass on the broken model, so the
 * starred pins are the ones that actually hold the line.
 */

const PRICE = 78_000;

/** The reference position (a real one), so the cbMetrics pin has something honest to agree with. */
const LIVE: Omit<CyclingInputs, 'pricePath' | 'cbLtvCapPct'> = {
  startYear: 2026,
  strikeCollateralBtc: 0.96589757,
  strikeBalance: 12_793.51,
  strikeCreditLine: 37_499.90,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
  strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
  cbCollateralBtc: 1.72572674,
  cbDebt: 62_292.59,
  income: 4_500,
  expenses: 4_000,
  strikeAprPct: 13,
  cbAprPct: 4.77,
  cycleMonths: 3,
};

const flat = (months: number, price = PRICE): number[] => new Array(months + 1).fill(price);
const run = (o: Partial<CyclingInputs> = {}) =>
  runCyclingSim({ ...LIVE, pricePath: flat(240), cbLtvCapPct: 50, ...o });

describe('runCyclingSim — the two collateral pools', () => {
  it('⭐ REGRESSION PIN (C3/C4): month-0 CB LTV equals cbMetrics for the same position', () => {
    // One engine, one truth. The defect this replaces divided by strike+cb collateral, reading 29.67%
    // where cbMetrics reads 46.28% — 16.6 points low, which let the cap fire late.
    const r = run();
    expect(r.rows[0].cbLtv).toBeCloseTo(cbMetrics(LIVE.cbDebt, LIVE.cbCollateralBtc, PRICE, 75).ltv, 9);
    expect(r.rows[0].cbLtv).toBeCloseTo(0.4628, 4);
  });

  it('month-0 Strike LTV divides by the Strike pool alone', () => {
    const r = run();
    expect(r.rows[0].strikeLtv).toBeCloseTo(
      LIVE.strikeBalance / (LIVE.strikeCollateralBtc * PRICE), 12);
    expect(r.rows[0].strikeLtv).toBeCloseTo(0.1698, 4);
  });

  it('⭐ btcHeld is the SUM of the two pools, and is never one of them', () => {
    // Guards the connector too: getCurrentBtcHeld() is Strike-only, so if it ever started returning the
    // whole stack, btcHeld would double-count Coinbase and this fails.
    const r = run();
    expect(r.rows[0].btcHeld).toBeCloseTo(LIVE.strikeCollateralBtc + LIVE.cbCollateralBtc, 9);
    expect(r.rows[0].strikeCollateralBtc).not.toBeCloseTo(r.rows[0].btcHeld, 6);
    expect(r.rows[0].cbCollateralBtc).not.toBeCloseTo(r.rows[0].btcHeld, 6);
  });

  it('Strike collateral is fixed and Coinbase collateral grows — purchases go to Coinbase', () => {
    const r = run({ pricePath: flat(36) });
    for (const row of r.rows) expect(row.strikeCollateralBtc).toBe(LIVE.strikeCollateralBtc);
    for (let m = 1; m < r.rows.length; m++) {
      expect(r.rows[m].cbCollateralBtc).toBeGreaterThanOrEqual(r.rows[m - 1].cbCollateralBtc);
    }
    expect(r.last.cbCollateralBtc).toBeGreaterThan(LIVE.cbCollateralBtc);
  });
});

describe('runCyclingSim — the refinance loop and the stop', () => {
  it('refinance zeroes the Strike balance exactly on the cadence', () => {
    const r = run({ pricePath: flat(24), cycleMonths: 3, cbLtvCapPct: 85 });
    for (let m = 3; m <= 24; m += 3) expect(r.rows[m].strikeBalance).toBe(0);
    expect(r.rows[2].strikeBalance).toBeGreaterThan(0);
    expect(r.rows[4].strikeBalance).toBeGreaterThan(0);
  });

  it('the CB cap stops drawing once, and never un-stops', () => {
    const r = run({ cbLtvCapPct: 50 });
    expect(r.stopMonth).toBe(4);
    for (let m = r.stopMonth!; m < r.rows.length; m++) expect(r.rows[m].strikeDrawn).toBe(0);
  });

  it('⭐ the default cap (50%) survives 20 years without liquidating — the face\'s own claim', () => {
    // If this fails, the face's default view argues against the strategy it is demonstrating.
    const r = run({ cbLtvCapPct: 50, pricePath: flat(240) });
    expect(r.liqMonth).toBeNull();
    expect(r.deficiencyUsd).toBeNull();
  });
});

describe('runCyclingSim — the Strike credit line is a hard constraint', () => {
  it('⭐ exhausts the line at month 6 on bills $4,000 / cycle 12, and income covers the rest', () => {
    const r = run({ cycleMonths: 12, cbLtvCapPct: 85 });
    expect(r.creditExhaustedMonth).toBe(6);
    expect(r.rows[6].strikeShortfall).toBeCloseTo(661.24, 2);
    expect(r.rows[5].strikeShortfall).toBe(0);
    expect(r.rows[7].strikeDrawn).toBe(0);          // fully exhausted thereafter
    expect(r.rows[7].strikeShortfall).toBe(LIVE.expenses);
  });

  it('a draw never exceeds the headroom under min(credit line, collateral × price × max-draw LTV)', () => {
    // The constraint binds the DRAW, not the balance: interest still capitalises on top of a maxed line
    // — and can carry it past the ceiling — exactly as a real facility behaves. What must hold is that a
    // draw never exceeds the headroom, so once the balance is at or over the line, nothing more is drawn.
    const r = run({ cycleMonths: 12, cbLtvCapPct: 85, pricePath: flat(60) });
    const ceiling = Math.min(LIVE.strikeCreditLine, LIVE.strikeCollateralBtc * PRICE * STRIKE_MAX_DRAW_LTV);
    let sawMaxedOut = false;
    for (let m = 1; m < r.rows.length; m++) {
      const headroom = Math.max(0, ceiling - r.rows[m - 1].strikeBalance);
      expect(r.rows[m].strikeDrawn).toBeLessThanOrEqual(headroom + 1e-6);
      if (headroom === 0) { sawMaxedOut = true; expect(r.rows[m].strikeDrawn).toBe(0); }
    }
    expect(sawMaxedOut).toBe(true);   // the fixture actually reaches the line
  });

  it('conserves the bill: drawn + shortfall === expenses in every drawing month', () => {
    const r = run({ cycleMonths: 12, cbLtvCapPct: 85, pricePath: flat(60) });
    for (let m = 1; m < r.rows.length; m++) {
      const row = r.rows[m];
      if (row.strikeDrawn > 0 || row.strikeShortfall > 0) {
        expect(row.strikeDrawn + row.strikeShortfall).toBeCloseTo(LIVE.expenses, 9);
      }
    }
  });

  it('a shortfall buys fewer sats — income covered the bill instead', () => {
    const r = run({ cycleMonths: 12, cbLtvCapPct: 85, pricePath: flat(24) });
    const bought = (m: number) => r.rows[m].cbCollateralBtc - r.rows[m - 1].cbCollateralBtc;
    expect(bought(5)).toBeCloseTo(LIVE.income / PRICE, 9);                    // unconstrained
    expect(bought(7)).toBeCloseTo(Math.max(0, LIVE.income - LIVE.expenses) / PRICE, 9); // exhausted
    expect(bought(7)).toBeLessThan(bought(5));
  });
});

describe('runCyclingSim — liquidation is terminal, and honest', () => {
  it('⭐ seizes at CB_LIF and reports the survivor', () => {
    const r = run({ cbLtvCapPct: 85, pricePath: flat(240) });
    expect(r.liqMonth).toBe(48);
    expect(r.seizedBtc).toBeCloseTo(3.7647, 4);
    expect(r.survivorBtc).toBeCloseTo(1.3884, 4);
    expect(r.rows[48].cbLtv).toBeGreaterThanOrEqual(CB_LLTV);   // the row shows what BREACHED
  });

  it('postLiquidation is true AT liqMonth (the seizure happens within that row) and after', () => {
    const r = run({ cbLtvCapPct: 85, pricePath: flat(240) });
    expect(r.rows[r.liqMonth! - 1].postLiquidation).toBe(false);
    expect(r.rows[r.liqMonth!].postLiquidation).toBe(true);
    for (let m = r.liqMonth!; m < r.rows.length; m++) expect(r.rows[m].postLiquidation).toBe(true);
  });

  it('drawing never resumes after a liquidation', () => {
    const r = run({ cbLtvCapPct: 85, pricePath: flat(240) });
    for (let m = r.liqMonth!; m < r.rows.length; m++) expect(r.rows[m].strikeDrawn).toBe(0);
  });

  it('exactly at 86% the collateral covers the debt — no deficiency', () => {
    // 2.0 ₿ × $78,000 = $156,000; 86% of that is $134,160.
    const r = runCyclingSim({
      ...LIVE, pricePath: flat(1), cbLtvCapPct: 50, cbCollateralBtc: 2.0, cbDebt: 134_160,
    });
    expect(r.liqMonth).toBe(0);
    expect(r.seizedBtc).toBeCloseTo(1.7954, 4);
    expect(r.deficiencyUsd).toBeNull();
    expect(r.rows[1].cbDebt).toBeCloseTo(0, 6);   // month 1 opens on the survivor
  });

  it('⭐ REGRESSION PIN: an under-collateralised seizure PRESERVES the deficiency', () => {
    // 1.0 ₿ × $78,000 = $78,000 against $93,600 of debt (120% LTV). Repaying in full would need
    // 1.2526 ₿ — there is only 1.0. Both facilities are full-recourse, so zeroing the debt here would
    // silently erase $18,876 and show a clean survivor that does not exist.
    const r = runCyclingSim({
      ...LIVE, pricePath: flat(1), cbLtvCapPct: 50, cbCollateralBtc: 1.0, cbDebt: 93_600,
    });
    expect(r.seizedBtc).toBeCloseTo(1.0, 9);                      // the min() binds — all of it
    // repaid = seized × price ÷ CB_LIF = 78,000 × 0.958 = 74,724 → 93,600 − 74,724 = 18,876
    expect(r.deficiencyUsd).toBeCloseTo(93_600 - PRICE / CB_LIF, 6);
    expect(r.deficiencyUsd).toBeCloseTo(18_876, 2);
    // ...and it keeps accruing, because a deficiency is still debt.
    expect(r.rows[1].cbDebt).toBeCloseTo(r.deficiencyUsd! * (1 + LIVE.cbAprPct / 100 / 12), 6);
  });

  it('derives the liquidation penalty from CB_LIF rather than a literal', () => {
    expect(CB_LIQUIDATION_PENALTY).toBeCloseTo(0.04384, 5);
  });
});

describe('runCyclingSim — the Strike margin-call signal', () => {
  it('stays silent at a flat price (the draw cap keeps Strike LTV at or under 50%)', () => {
    expect(run({ cbLtvCapPct: 85, pricePath: flat(60) }).strikeMarginMonth).toBeNull();
  });

  it('fires when the price falls far enough under a drawn balance', () => {
    // Draw at $78,000, then crash to $25,000: 0.96589757 ₿ backs only ~$24,147.
    const path = [...flat(2), ...new Array(4).fill(25_000)];
    const r = runCyclingSim({ ...LIVE, pricePath: path, cbLtvCapPct: 85, cycleMonths: 12 });
    expect(r.strikeMarginMonth).not.toBeNull();
    expect(r.rows[r.strikeMarginMonth!].strikeLtv).toBeGreaterThanOrEqual(STRIKE_MARGIN_CALL_LTV);
  });
});

describe('runCyclingSim — the no-draw baseline', () => {
  it('reads the SAME price path (or the verdict compares two different worlds)', () => {
    // A rising path buys fewer sats per dollar than a flat one, so the baseline BTC must differ — proof
    // it consumed the array rather than recomputing a price of its own.
    const rising = flat(60).map((p, m) => p * (1 + m * 0.01));
    const a = run({ pricePath: flat(60), cbLtvCapPct: 85 });
    const b = run({ pricePath: rising, cbLtvCapPct: 85 });
    expect(b.baselineBtc).toBeLessThan(a.baselineBtc);
    expect(b.baselineEquity).not.toBeCloseTo(a.baselineEquity, 2);
  });

  it('accrues each leg at its own rate and buys only the surplus', () => {
    const r = run({ pricePath: flat(12), cbLtvCapPct: 85 });
    const surplus = LIVE.income - LIVE.expenses;
    expect(r.baselineBtc).toBeCloseTo(
      LIVE.strikeCollateralBtc + LIVE.cbCollateralBtc + (12 * surplus) / PRICE, 9);
    const expectedDebt = LIVE.cbDebt * (1 + LIVE.cbAprPct / 100 / 12) ** 12
      + LIVE.strikeBalance * (1 + LIVE.strikeAprPct / 100 / 12) ** 12;
    expect(r.baselineEquity).toBeCloseTo(r.baselineBtc * PRICE - expectedDebt, 6);
  });
});

describe('runCyclingSim — guards', () => {
  it('income <= expenses buys nothing once drawing stops, and never goes negative', () => {
    const r = run({ income: 3_000, expenses: 4_000, cbLtvCapPct: 50, pricePath: flat(36) });
    for (let m = r.stopMonth!; m < r.rows.length; m++) {
      expect(r.rows[m].cbCollateralBtc).toBeCloseTo(r.rows[r.stopMonth!].cbCollateralBtc, 9);
    }
    for (const row of r.rows) expect(row.cbCollateralBtc).toBeGreaterThanOrEqual(0);
  });

  it('an empty price path yields one usable row, no NaN', () => {
    const r = runCyclingSim({ ...LIVE, pricePath: [], cbLtvCapPct: 50 });
    expect(r.rows).toHaveLength(1);
    expect(Number.isNaN(r.rows[0].cbLtv)).toBe(false);
    expect(r.rows[0].cbLtv).toBe(0);
    expect(Number.isNaN(r.baselineEquity)).toBe(false);
  });

  it('zero collateral on either leg divides by nothing', () => {
    // Note this position DOES liquidate — with no Strike collateral there is no line to draw on, so the
    // surplus buys a sliver of CB collateral that is instantly underwater against the existing debt.
    // That is correct; what matters here is that nothing goes NaN or Infinite on the way.
    const r = runCyclingSim({
      ...LIVE, pricePath: flat(12), cbLtvCapPct: 50, cbCollateralBtc: 0, strikeCollateralBtc: 0,
    });
    for (const row of r.rows) {
      expect(Number.isFinite(row.cbLtv)).toBe(true);
      expect(Number.isFinite(row.strikeLtv)).toBe(true);
      expect(Number.isFinite(row.equity)).toBe(true);
      expect(Number.isFinite(row.btcHeld)).toBe(true);
    }
    expect(Number.isFinite(r.seizedBtc ?? 0)).toBe(true);
    expect(r.seizedBtc ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('a debt-free position never liquidates', () => {
    const r = runCyclingSim({
      ...LIVE, pricePath: flat(24), cbLtvCapPct: 85, cbDebt: 0, strikeBalance: 0,
    });
    expect(r.liqMonth).toBeNull();
    expect(r.seizedBtc).toBeNull();
    expect(r.deficiencyUsd).toBeNull();
  });

  it('a zero-length cycle cannot divide by zero', () => {
    const r = run({ cycleMonths: 0, pricePath: flat(12), cbLtvCapPct: 85 });
    expect(r.rows.every((row) => Number.isFinite(row.debt))).toBe(true);
  });
});
