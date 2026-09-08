import { describe, it, expect } from 'vitest';
import { runCyclingSim, CB_LIQUIDATION_PENALTY, type CyclingInputs } from '../cyclingSim';
import { cbMetrics } from '../cbMetrics';
import { CB_LLTV, CB_LIF, cbBorrowFee, CB_FEE_TIER_BREAK, cbMaxDrawForHeadroom } from '../runCoinbaseLoan';
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
    // ⚠ MOVED 48 → 45 when the Coinbase origination fee landed. Not a loosened pin — a real result:
    // every sweep now capitalises 2%, so the debt compounds off a bigger base and the 86% breach
    // arrives THREE MONTHS EARLIER on this fixture. Modelling the sweep as free understated the risk,
    // not just the cost. If this number moves again, something changed the fee or the sweep.
    const r = run({ cbLtvCapPct: 85, pricePath: flat(240) });
    expect(r.liqMonth).toBe(45);
    expect(r.seizedBtc).toBeCloseTo(3.6036, 4);
    expect(r.survivorBtc).toBeCloseTo(1.3765, 4);
    expect(r.rows[45].cbLtv).toBeGreaterThanOrEqual(CB_LLTV);   // the row shows what BREACHED
    expect(r.totalCbFees).toBeCloseTo(3329.75, 2);              // 13 sweeps, all inside the 2% tier
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

describe('runCyclingSim — mode (S1): hold / clearStrike / clearBoth', () => {
  it('defaults to cycle — a pre-S1 call site is byte-identical', () => {
    const a = run({ mode: 'cycle', pricePath: flat(24), cbLtvCapPct: 50 });
    const b = run({ pricePath: flat(24), cbLtvCapPct: 50 });   // no mode key at all
    expect(a.rows).toEqual(b.rows);
    expect(a.stopMonth).toBe(b.stopMonth);
    expect(a.baselineEquity).toBe(b.baselineEquity);
  });

  it('⭐ hold IS the never-draw baseline — the strategy is the comparator (C3 self-reference)', () => {
    // btcHeld in hold = strikeColl + cbColl0 + Σ surplus/price, which is exactly the baseline's baseBtc.
    // A view must therefore NOT present "hold vs baseline" as a win/lose — it is the same curve twice.
    const r = run({ mode: 'hold', pricePath: flat(60) });
    expect(r.last.btcHeld).toBeCloseTo(r.baselineBtc, 9);
    const surplus = LIVE.income - LIVE.expenses;
    expect(r.last.btcHeld).toBeCloseTo(
      LIVE.strikeCollateralBtc + LIVE.cbCollateralBtc + (60 * surplus) / PRICE, 9);
  });

  it('⭐ C1: hold with expenses > income leaves btcHeld flat and draws no debt — the deficit is funded by nothing', () => {
    // The deliberate approximation: no coins sold, no draw — the bills are simply not funded. The debt
    // grows ONLY at the existing rates. Surface it in the view; never model it away silently.
    const r = run({ mode: 'hold', income: 3_000, expenses: 4_000, pricePath: flat(24) });
    const open = r.rows[0];
    for (const row of r.rows) {
      expect(row.btcHeld).toBeCloseTo(open.btcHeld, 9);               // flat — nothing sold, nothing bought
      expect(row.strikeDrawn).toBe(0);
      expect(row.strikeShortfall).toBe(0);
      expect(row.cbCollateralBtc).toBeCloseTo(open.cbCollateralBtc, 9);
    }
    const smr = LIVE.strikeAprPct / 100 / 12, cmr = LIVE.cbAprPct / 100 / 12;
    expect(r.last.debt).toBeCloseTo(
      LIVE.strikeBalance * (1 + smr) ** 24 + LIVE.cbDebt * (1 + cmr) ** 24, 6);
  });

  it('clearStrike retires Strike before any purchase lands', () => {
    const r = run({ mode: 'clearStrike', strikeBalance: 500, pricePath: flat(12) });
    expect(r.rows[1].strikeBalance).toBeLessThan(500);              // retiring
    expect(r.rows[1].cbCollateralBtc).toBeCloseTo(LIVE.cbCollateralBtc, 9);  // nothing bought yet
    const bought = r.rows.find((row) => row.cbCollateralBtc > LIVE.cbCollateralBtc);
    expect(bought).toBeDefined();
    expect(r.last.strikeBalance).toBe(0);                            // the sweep lands on exact zero
  });

  it('clearBoth retires Strike, then Coinbase, then buys — one at a time', () => {
    const r = run({ mode: 'clearBoth', strikeBalance: 300, cbDebt: 500, pricePath: flat(12) });
    expect(r.rows[1].strikeBalance).toBeLessThan(300);
    expect(r.rows[1].cbDebt).toBeLessThan(500);                      // both legs got paid
    expect(r.rows[1].cbCollateralBtc).toBeCloseTo(LIVE.cbCollateralBtc, 9);  // cash exhausted
    expect(r.last.strikeBalance).toBe(0);
    expect(r.last.cbDebt).toBe(0);                                   // cbDebt swept too (sub-cent residual)
    const bought = r.rows.find((row) => row.cbCollateralBtc > LIVE.cbCollateralBtc);
    expect(bought).toBeDefined();                                    // buying resumes after both are clear
  });

  it('non-cycle modes never set stopMonth / creditExhaustedMonth — there is no draw to stop', () => {
    const r = run({ mode: 'clearBoth', cbLtvCapPct: 50, pricePath: flat(12) });
    expect(r.stopMonth).toBeNull();
    expect(r.creditExhaustedMonth).toBeNull();
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

  describe('Coinbase origination fee — charged on EVERY borrow, capitalised', () => {
    it('cbBorrowFee: marginal brackets, 2% under the break and 1% above', () => {
      expect(cbBorrowFee(4_000, 0)).toBeCloseTo(80, 6);
      expect(cbBorrowFee(4_000, 300_000)).toBeCloseTo(40, 6);
      // straddling: 5k in the 2% tier + 5k in the 1% tier
      expect(cbBorrowFee(10_000, CB_FEE_TIER_BREAK - 5_000)).toBeCloseTo(150, 6);
    });

    it('cbBorrowFee guards: zero/negative/non-finite never inject NaN', () => {
      for (const [a, b] of [[0, 0], [-1, 0], [NaN, 0], [1_000, NaN]] as [number, number][]) {
        expect(Number.isFinite(cbBorrowFee(a, b))).toBe(true);
      }
      expect(cbBorrowFee(0, 50_000)).toBe(0);
    });

    it('⭐ every refinance pays it, and it is ADDED TO PRINCIPAL (so it compounds)', () => {
      const withFees = run({ pricePath: flat(24), cbLtvCapPct: 85, cycleMonths: 1 });
      expect(withFees.cbFeeCount).toBeGreaterThan(0);
      expect(withFees.totalCbFees).toBeGreaterThan(0);
      // A sweep of S at a sub-$250k balance adds S + 2%·S, never just S.
      const noSweep = run({ pricePath: flat(24), cbLtvCapPct: 85, cycleMonths: 999 });
      expect(noSweep.cbFeeCount).toBe(0);
      expect(noSweep.totalCbFees).toBe(0);
      expect(withFees.last.debt).toBeGreaterThan(0);
    });

    it('⭐ the fee is roughly cadence-NEUTRAL — it is a % of volume, not per-transaction', () => {
      // This is why monthly sweeping stayed the right default after the fee landed: a longer cadence
      // pays the same 2% on a bigger pile, PLUS more Strike interest that also gets fee'd.
      const monthly = run({ pricePath: flat(60), cbLtvCapPct: 85, cycleMonths: 1 });
      const quarterly = run({ pricePath: flat(60), cbLtvCapPct: 85, cycleMonths: 3 });
      expect(monthly.cbFeeCount).toBeGreaterThan(quarterly.cbFeeCount);
      const ratio = quarterly.totalCbFees / monthly.totalCbFees;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.15);          // same order — never a 3x saving from batching
      expect(quarterly.totalStrikeInterest).toBeGreaterThan(monthly.totalStrikeInterest);
    });

    it('cbMaxDrawForHeadroom is the exact inverse of cbBorrowFee', () => {
      // Used by runAdvisor's reverse rotation to fill TO an LTV target without the capitalised fee
      // breaching it. Round-trip on both tiers and across the break.
      for (const [headroom, balance] of [
        [1_020, 0],
        [10_000, 0],
        [2_000, 249_000],        // straddles the $250k break
        [50_000, 400_000],       // wholly in the 1% tier
        [255_000, 0],            // exactly the tier-1 ceiling grossed up
      ] as [number, number][]) {
        const d = cbMaxDrawForHeadroom(headroom, balance);
        expect(d + cbBorrowFee(d, balance)).toBeCloseTo(headroom, 6);
      }
      expect(cbMaxDrawForHeadroom(1_020, 0)).toBeCloseTo(1_000, 6);
      // Guards, same shape as cbBorrowFee's.
      for (const [h, b] of [[0, 0], [-1, 0], [NaN, 0], [1_000, NaN]] as [number, number][]) {
        expect(cbMaxDrawForHeadroom(h, b)).toBe(0);
      }
    });
  });
});
