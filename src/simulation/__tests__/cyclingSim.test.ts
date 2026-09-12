import { describe, it, expect } from 'vitest';
import { runCyclingSim, CB_LIQUIDATION_PENALTY, type CyclingInputs } from '../cyclingSim';
import { cbMetrics } from '../cbMetrics';
import { CB_LLTV, CB_LIF, cbBorrowFee, CB_FEE_TIER_BREAK, cbMaxDrawForHeadroom, CB_PLATFORM_FEE_PCT, cbNetApr } from '../runCoinbaseLoan';
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

/**
 * SYNTHETIC reference position — round numbers, chosen to preserve the SHAPE of a real one: ~46% CB LTV
 * and ~17% Strike LTV at month 0, a $500 monthly surplus, and a Strike credit line that binds before the
 * collateral cap does. Every pinned value below is derived from THESE numbers.
 *
 * ⚠ Deliberately NOT anyone's actual position. This repo is public, and a fixture labelled "a real one"
 * publishes the owner's holdings, debts, credit line and monthly income and expenses to anyone who reads
 * the tests. Keep it synthetic. If a future pin needs a more realistic ratio, change the RATIO, not the
 * provenance.
 */
const LIVE: Omit<CyclingInputs, 'pricePath' | 'cbLtvCapPct'> = {
  startYear: 2026,
  strikeCollateralBtc: 1.0,
  strikeBalance: 13_000,
  strikeCreditLine: 38_000,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
  strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
  cbCollateralBtc: 2.0,
  cbDebt: 72_000,
  income: 6_000,
  expenses: 5_000,
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
    expect(r.rows[0].cbLtv).toBeCloseTo(0.4615, 4);   // 72_000 / (2 × 78_000)
  });

  it('month-0 Strike LTV divides by the Strike pool alone', () => {
    const r = run();
    expect(r.rows[0].strikeLtv).toBeCloseTo(
      LIVE.strikeBalance / (LIVE.strikeCollateralBtc * PRICE), 12);
    expect(r.rows[0].strikeLtv).toBeCloseTo(0.1667, 4);   // 13_000 / (1 × 78_000)
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

describe('runCyclingSim — draw ground truth (firstDrawMonth / resume)', () => {
  it('⭐ an opening LTV below the cap is NOT proof the draw runs — firstDrawMonth is', () => {
    // Opens at 46.15% against a 50% cap, so an opening-LTV proxy would say "the draw runs". Month 1
    // drops to 60k, pushing LTV over the cap before any draw: this run never draws.
    const r = run({ cbLtvCapPct: 50, pricePath: [PRICE, 60_000, 60_000, 60_000] });
    expect(r.rows[0].cbLtv).toBeLessThan(0.50);
    expect(r.firstDrawMonth).toBeNull();
    expect(r.stopMonth).toBe(1);
    expect(r.drawingResumedMonth).toBeNull();
  });

  it('records the first draw, and a resume after the draw stopped', () => {
    // Month 1 at 60k crosses the cap (no draw) → stopMonth 1; month 2 leaps to 130k and LTV falls back
    // under it → the draw runs, and this is a resume (it follows a stopped month).
    const r = run({ cbLtvCapPct: 50, pricePath: [PRICE, 60_000, 130_000, 130_000] });
    expect(r.stopMonth).toBe(1);
    expect(r.firstDrawMonth).toBe(2);
    expect(r.drawingResumedMonth).toBe(2);
  });

  it('on a run that draws from the start, firstDrawMonth is 1 and there is no resume', () => {
    const r = run({ cbLtvCapPct: 85, pricePath: flat(12) });
    expect(r.firstDrawMonth).toBe(1);
    expect(r.drawingResumedMonth).toBeNull();
    expect(r.stopMonth).toBeNull();
  });
});

describe('runCyclingSim — totalRefinancedUsd is the fee basis', () => {
  it('accumulates the cash moved and brackets the fee against it', () => {
    const r = run({ pricePath: flat(12), cbLtvCapPct: 85, cycleMonths: 3 });
    expect(r.cbFeeCount).toBeGreaterThan(0);
    expect(r.totalRefinancedUsd).toBeGreaterThan(0);
    // Every fee is at most 2% of the cash moved — the marginal rate can only be lower above the bracket.
    expect(r.totalCbFees).toBeLessThanOrEqual(r.totalRefinancedUsd * 0.02 + 1e-6);
  });
});

describe('runCyclingSim — debt-shift defense (defendCbLtv)', () => {
  const CAP = 50;
  /** A fall to 65k, held — enough to breach a 50% cap without exhausting the Strike line. */
  const moderateCrash = [78_000, 65_000, ...new Array(12).fill(65_000)];
  /** A deeper fall — the Strike line runs out and the cap cannot be fully held (breaches at 30k). */
  const hardCrash = [78_000, 60_000, 55_000, 50_000, 45_000, 30_000, ...new Array(6).fill(30_000)];
  const siM1 = LIVE.strikeBalance * LIVE.strikeAprPct / 100 / 12;

  it('⭐ OFF by default — defendCbLtv false is byte-identical to the pre-defense engine', () => {
    const a = run({ pricePath: flat(24), cbLtvCapPct: CAP });
    const b = run({ pricePath: flat(24), cbLtvCapPct: CAP, defendCbLtv: false });
    expect(a.rows).toEqual(b.rows);
    expect(a.totalRefinancedUsd).toBe(b.totalRefinancedUsd);
    expect(a.firstDefenseMonth).toBeNull();
    expect(a.defenseCount).toBe(0);
    expect(a.defenseExhaustedMonth).toBeNull();
  });

  it('⭐ pays CB down to the cap when a fall breaches it, and holds it there', () => {
    const r = run({ pricePath: moderateCrash, cbLtvCapPct: CAP, defendCbLtv: true, cycleMonths: 999 });
    expect(r.firstDefenseMonth).toBe(1);
    expect(r.defenseExhaustedMonth).toBeNull();
    expect(r.rows[1].cbLtvPreDefense!).toBeGreaterThan(CAP / 100);
    expect(r.defenseCount).toBeGreaterThan(0);
    expect(r.totalDefenseDrawnUsd).toBeGreaterThan(0);
    for (const x of r.rows) expect(x.cbLtv).toBeLessThanOrEqual(CAP / 100 + 1e-6);
  });

  it('⭐ capacity-limited: fills the remaining Strike headroom once, then stops (no over-draw)', () => {
    const line = 15_000;
    const r = run({ pricePath: hardCrash, cbLtvCapPct: CAP, defendCbLtv: true, cycleMonths: 999, strikeCreditLine: line });
    // m=1: the only draw, sized to leave the Strike balance exactly on the line...
    expect(r.rows[1].strikeBalance).toBeCloseTo(line, 6);
    expect(r.rows[1].defenseDrawnUsd).toBeCloseTo(line - (LIVE.strikeBalance + siM1), 4);
    expect(r.defenseExhaustedMonth).not.toBeNull();
    expect(r.rows[r.defenseExhaustedMonth!].defenseShortfallUsd).toBeGreaterThan(0);
    // ...and once capitalized interest pushes the balance past the line, no further defense is drawn.
    expect(r.rows.slice(2).reduce((s, x) => s + x.defenseDrawnUsd, 0)).toBe(0);
  });

  it('⭐ round trip: the refinance shifts the debt BACK to Coinbase (headroom-capped) as price recovers', () => {
    // V-shape: fall to 60k (defense fires), then recover through 100k/120k (the sweep shifts back).
    const v = [78_000, 60_000, 60_000, 100_000, 120_000, 140_000, ...new Array(6).fill(150_000)];
    const r = run({ pricePath: v, cbLtvCapPct: CAP, defendCbLtv: true, cycleMonths: 1 });
    expect(r.firstDefenseMonth).toBe(1);
    // The cap is never exceeded at any point — the defense and the capped sweep are two halves of one rule.
    for (const x of r.rows) expect(x.cbLtv).toBeLessThanOrEqual(CAP / 100 + 1e-6);
    // Debt went to Strike on the fall, and came back to Coinbase on the recovery.
    expect(r.rows[3].cbDebt).toBeGreaterThan(r.rows[2].cbDebt);
    expect(r.rows[3].strikeBalance).toBeLessThan(r.rows[2].strikeBalance);
    expect(r.totalRefinancedUsd).toBeGreaterThan(0);
  });

  it('defense is cycle-only — hold / clearStrike / clearBoth are untouched by the flag', () => {
    for (const mode of ['hold', 'clearStrike', 'clearBoth'] as const) {
      const a = run({ mode, pricePath: flat(24), cbLtvCapPct: CAP });
      const b = run({ mode, pricePath: flat(24), cbLtvCapPct: CAP, defendCbLtv: true });
      expect(a.rows).toEqual(b.rows);
      expect(b.defenseCount).toBe(0);
    }
  });

  it('never defends once liquidated', () => {
    const r = run({ pricePath: hardCrash, cbLtvCapPct: CAP, defendCbLtv: true, cycleMonths: 999, strikeCreditLine: 20_000 });
    expect(r.defenseCount).toBeGreaterThan(0);      // it did defend before the line filled
    expect(r.liqMonth).not.toBeNull();
    for (let m = r.liqMonth!; m < r.rows.length; m++) expect(r.rows[m].defenseDrawnUsd).toBe(0);
  });
});

describe('runCyclingSim — sweep cascade + emergency top-up', () => {
  const geo = (months: number, annualPct: number) =>
    Array.from({ length: months + 1 }, (_, i) => PRICE * Math.pow(1 + annualPct / 100 / 12, i));

  it('⭐ the migration is tied to the sweep — with the sweep off the Strike collateral stays fixed', () => {
    const rising = geo(120, 25);
    const off = run({ pricePath: rising, cbLtvCapPct: 50, cycleMonths: 1 });
    expect(off.totalStrikeToCbBtc).toBe(0);
    for (const x of off.rows) expect(x.strikeCollateralBtc).toBe(LIVE.strikeCollateralBtc);
  });

  it('⭐ cascade: the Strike surplus migrates to Coinbase at the cadence, then the CB sweep moves it to cold', () => {
    const rising = geo(120, 25);
    const r = run({ pricePath: rising, cbLtvCapPct: 50, cycleMonths: 1, coldStoreBufferPct: 30 });
    expect(r.totalStrikeToCbBtc).toBeGreaterThan(0);
    expect(r.last.strikeCollateralBtc).toBeLessThan(LIVE.strikeCollateralBtc);
    // The migrated coins are attributed to Strike when the CB leg sweeps them on.
    expect(r.totalColdFromStrike).toBeGreaterThan(0);
    for (const x of r.rows) {
      expect(x.strikeCollateralBtc + x.cbCollateralBtc + x.coldBtc).toBeCloseTo(x.btcHeld, 9);
    }
  });

  it('the migration never takes Strike below the stressed line + margin requirement', () => {
    const rising = geo(120, 25);
    const r = run({ pricePath: rising, cbLtvCapPct: 50, cycleMonths: 1, coldStoreBufferPct: 30 });
    const migrating = r.rows.filter((x) => x.strikeToCbBtc > 0);
    expect(migrating.length).toBeGreaterThan(0);
    for (const x of migrating) {
      const stressed = x.price * 0.7;   // 1 − the 30% buffer
      const keep = Math.max(
        LIVE.strikeCreditLine / (stressed * LIVE.strikeMaxDrawLtv),
        x.strikeBalance / (LIVE.strikeMarginLtv * stressed),
      );
      expect(x.strikeCollateralBtc).toBeCloseTo(keep, 6);
    }
  });

  it('⭐ the emergency top-up drains cold first, then the last-resort line backing', () => {
    // A long rise builds a reserve; a deep crash then exhausts the Strike line and forces the top-up.
    const peak = geo(72, 30)[72];
    const path = [...geo(72, 30), ...new Array(36).fill(peak * 0.15)];
    const r = run({ pricePath: path, cbLtvCapPct: 50, cycleMonths: 1, coldStoreBufferPct: 30, defendCbLtv: true });
    expect(r.firstTopUpMonth).not.toBeNull();
    expect(r.totalTopUpBtc).toBeGreaterThan(0);
    expect(r.totalColdRetrievedBtc).toBeGreaterThan(0);
    expect(r.totalTopUpFromStrikeBtc).toBeGreaterThan(0);
    // Cold is drained before Strike: the first Strike-funded top-up cannot precede the first cold retrieval.
    const firstRetrieved = r.rows.find((x) => x.coldRetrievedBtc > 0)!;
    const firstFromStrike = r.rows.find((x) => x.topUpFromStrikeBtc > 0)!;
    expect(firstFromStrike.m).toBeGreaterThanOrEqual(firstRetrieved.m);
    // Pools always sum to btcHeld, and the NET-cold invariant holds across retrievals.
    for (const x of r.rows) {
      expect(x.strikeCollateralBtc + x.cbCollateralBtc + x.coldBtc).toBeCloseTo(x.btcHeld, 9);
      expect(x.coldFromCb + x.coldFromStrike - x.coldRetrievedBtc).toBeCloseTo(x.coldBtc, 9);
    }
  });

  it('the top-up is cycle-mode-only and never runs post-liquidation', () => {
    const hold = run({ mode: 'hold', pricePath: flat(24), coldStoreBufferPct: 30, defendCbLtv: true });
    expect(hold.totalTopUpBtc).toBe(0);
    const peak = geo(72, 30)[72];
    const path = [...geo(72, 30), ...new Array(36).fill(peak * 0.1)];
    const r = run({ pricePath: path, cbLtvCapPct: 50, cycleMonths: 1, coldStoreBufferPct: 30, defendCbLtv: true });
    if (r.liqMonth !== null) {
      // The breaching row may still show the top-up attempted BEFORE the breach check (same as the shift);
      // any month AFTER the seizure must not top up.
      for (let m = r.liqMonth + 1; m < r.rows.length; m++) {
        expect(r.rows[m].topUpBtc).toBe(0);
      }
    }
  });
});

describe('runCyclingSim — the Strike credit line is a hard constraint', () => {
  it('⭐ exhausts the line at month 5 on bills $5,000 / cycle 12, and income covers the rest', () => {
    const r = run({ cycleMonths: 12, cbLtvCapPct: 85 });
    expect(r.creditExhaustedMonth).toBe(5);
    // line 38_000 − balance 34_120.12 = 3_879.88 drawable, so the bill is short by the remainder
    expect(r.rows[5].strikeShortfall).toBeCloseTo(1_120.12, 2);
    expect(r.rows[4].strikeShortfall).toBe(0);
    expect(r.rows[6].strikeDrawn).toBe(0);          // fully exhausted thereafter
    expect(r.rows[6].strikeShortfall).toBe(LIVE.expenses);
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
    expect(bought(4)).toBeCloseTo(LIVE.income / PRICE, 9);                    // unconstrained
    expect(bought(7)).toBeCloseTo(Math.max(0, LIVE.income - LIVE.expenses) / PRICE, 9); // exhausted
    expect(bought(7)).toBeLessThan(bought(4));
  });
});

describe('runCyclingSim — liquidation is terminal, and honest', () => {
  it('⭐ seizes at CB_LIF and reports the survivor', () => {
    // ⚠ These absolutes are tied to the SYNTHETIC fixture and were re-derived when it replaced the
    // real position — a fixture change, not a behaviour change. The standing FINDING behind this pin is
    // unchanged: the Coinbase origination fee capitalises on every sweep, so the debt compounds off a
    // bigger base and the 86% breach arrives EARLIER than a fee-free model claims. Modelling the sweep
    // as free understates the risk, not just the cost. If these move again without the fixture moving,
    // something changed the fee or the sweep.
    const r = run({ cbLtvCapPct: 85, pricePath: flat(240) });
    expect(r.liqMonth).toBe(57);
    expect(r.seizedBtc).toBeCloseTo(5.2192, 4);
    expect(r.survivorBtc).toBeCloseTo(1.5885, 4);
    expect(r.rows[57].cbLtv).toBeGreaterThanOrEqual(CB_LLTV);   // the row shows what BREACHED
    expect(r.totalCbFees).toBeCloseTo(4142.92, 2);              // 16 sweeps, all inside the 2% tier
    // ⭐ Re-derive the seizure from the breaching row rather than trusting the absolutes above: Morpho
    // takes debt × CB_LIF worth of COINBASE collateral, and nothing else.
    const brk = r.rows[57];
    expect(r.seizedBtc).toBeCloseTo(Math.min(brk.cbCollateralBtc, (brk.cbDebt * CB_LIF) / brk.price), 9);
    expect(r.survivorBtc).toBeCloseTo(
      brk.strikeCollateralBtc + (brk.cbCollateralBtc - r.seizedBtc!) + brk.coldBtc, 9);
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
    // Draw at $78,000, then crash to $25,000: 1 ₿ of Strike collateral backs only $25,000.
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
    const r = run({ mode: 'hold', income: 3_000, expenses: 5_000, pricePath: flat(24) });
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
    const r = run({ mode: 'clearStrike', strikeBalance: 2_000, pricePath: flat(12) });
    expect(r.rows[1].strikeBalance).toBeLessThan(2_000);            // retiring
    expect(r.rows[1].cbCollateralBtc).toBeCloseTo(LIVE.cbCollateralBtc, 9);  // nothing bought yet
    const bought = r.rows.find((row) => row.cbCollateralBtc > LIVE.cbCollateralBtc);
    expect(bought).toBeDefined();
    expect(r.last.strikeBalance).toBe(0);                            // the sweep lands on exact zero
  });

  it('clearBoth retires Strike, then Coinbase, then buys — one at a time', () => {
    const r = run({ mode: 'clearBoth', strikeBalance: 600, cbDebt: 2_000, pricePath: flat(12) });
    expect(r.rows[1].strikeBalance).toBeLessThan(600);
    expect(r.rows[1].cbDebt).toBeLessThan(2_000);                    // both legs got paid
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
    const r = run({ income: 3_000, expenses: 5_000, cbLtvCapPct: 50, pricePath: flat(36) });
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

  it('zero collateral is unsafe without producing NaN', () => {
    const r = runCyclingSim({
      ...LIVE, pricePath: flat(12), cbLtvCapPct: 50, cbCollateralBtc: 0, strikeCollateralBtc: 0,
    });
    for (const row of r.rows) {
      expect(Number.isNaN(row.cbLtv)).toBe(false);
      expect(Number.isNaN(row.strikeLtv)).toBe(false);
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

  describe('cold-storage sweep (coldStoreBufferPct)', () => {
    // Price regimes matter more than any other input here, so the block builds its own paths rather
    // than leaning on `flat` alone. No powerLaw import — the engine's §2 wall applies to its tests too.
    const geo = (months: number, annualPct: number): number[] =>
      Array.from({ length: months + 1 }, (_, i) => PRICE * Math.pow(1 + annualPct / 100 / 12, i));
    const RISING = { pricePath: geo(240, 25), cbLtvCapPct: 70, cycleMonths: 1 };
    const FLAT   = { pricePath: flat(240),    cbLtvCapPct: 70, cycleMonths: 1 };
    const FALLING= { pricePath: geo(240, -30), cbLtvCapPct: 70, cycleMonths: 1 };
    /** Months where a given LEG actually moved coins. The cumulative fields are not enough (a positive
     *  value persists forever), and the two legs fire on different months — a Strike-only month says
     *  nothing about where cbLtv sits, which is exactly the confusion this helper exists to prevent. */
    const movedBy = (r: ReturnType<typeof run>, key: 'coldBtc' | 'coldFromCb' | 'coldFromStrike') =>
      r.rows.filter((x, i) => i > 0 && x[key] > r.rows[i - 1][key] + 1e-12);

    it('OFF by default — absent, undefined, 0 and junk are byte-identical to the old engine', () => {
      const off = run(RISING);
      for (const v of [undefined, 0, -5, NaN] as (number | undefined)[]) {
        const r = run({ ...RISING, coldStoreBufferPct: v });
        expect(r.totalColdBtc).toBe(0);
        expect(r.firstColdMonth).toBeNull();
        expect(r.last.btcHeld).toBeCloseTo(off.last.btcHeld, 10);
        expect(r.last.cbCollateralBtc).toBeCloseTo(off.last.cbCollateralBtc, 10);
        expect(r.rows.every((x) => x.coldBtc === 0)).toBe(true);
      }
    });

    it('⭐ the buffer is a SURVIVABLE DRAWDOWN — a sweeping month lands cbLtv on CB_LLTV × (1 − buffer)', () => {
      // The knob's whole justification: 60% LTV IS a 30% buffer, and saying it the second way is what
      // makes the risk legible. Buffers here are all TIGHTER than the cap, so the clamp is not in play.
      for (const buffer of [30, 50, 70]) {
        const r = run({ ...RISING, coldStoreBufferPct: buffer });
        const floor = CB_LLTV * (1 - buffer / 100);
        // ⚠ COINBASE-leg months only. The Strike leg fires on its own schedule and does not touch cbLtv.
        const ms = movedBy(r, 'coldFromCb');
        expect(ms.length).toBeGreaterThan(0);
        for (const x of ms) expect(x.cbLtv).toBeCloseTo(floor, 6);
      }
    });

    it('⭐⭐ THE CLAMP: the sweep can never be looser than the draw cap', () => {
      // Without it a 1% buffer implies an 85.1% floor and the sweep silently undoes the CB LTV STOP,
      // stripping collateral to a level the cap already calls too risky to BORROW at. Measured on a
      // −30%/yr path, unclamped, that moved liquidation from month 13 to month 2.
      // Every buffer looser than (1 − cap/CB_LLTV) must behave EXACTLY like that boundary buffer.
      const capPct = 70;
      const boundary = (1 - capPct / 100 / CB_LLTV) * 100;   // ≈ 18.6% for a 70 cap
      const atBoundary = run({ ...RISING, cbLtvCapPct: capPct, coldStoreBufferPct: boundary });
      for (const looser of [0.5, 1, 5, 10, 15]) {
        const r = run({ ...RISING, cbLtvCapPct: capPct, coldStoreBufferPct: looser });
        // ⚠ The CB leg only. The Strike leg reads the RAW buffer (its constraint is the credit line, not
        // the CB draw cap), so its totals legitimately differ across these buffers.
        expect(r.totalColdFromCb).toBeCloseTo(atBoundary.totalColdFromCb, 6);
      }
      // ...and a COINBASE-leg month then sits on the CAP, not on the (looser) raw floor.
      const r1 = run({ ...RISING, cbLtvCapPct: capPct, coldStoreBufferPct: 1 });
      for (const x of movedBy(r1, 'coldFromCb')) expect(x.cbLtv).toBeCloseTo(capPct / 100, 6);
    });

    it('⭐ tighter buffer → starts LATER, banks LESS', () => {
      const b30 = run({ ...RISING, coldStoreBufferPct: 30 });
      const b50 = run({ ...RISING, coldStoreBufferPct: 50 });
      const b70 = run({ ...RISING, coldStoreBufferPct: 70 });
      expect(b30.firstColdMonth!).toBeLessThan(b50.firstColdMonth!);
      expect(b50.firstColdMonth!).toBeLessThan(b70.firstColdMonth!);
      expect(b30.totalColdBtc).toBeGreaterThan(b50.totalColdBtc);
      expect(b50.totalColdBtc).toBeGreaterThan(b70.totalColdBtc);
    });

    it('⭐⭐ FREE on a RISING path — it relocates bitcoin, it does not destroy it', () => {
      // Purchases follow INCOME, not collateral, and a de-levering position never needs the swept coins
      // back, so drawing is untouched. This is what makes the feature worth having at all.
      const off = run(RISING);
      for (const buffer of [30, 50, 70]) {
        const on = run({ ...RISING, coldStoreBufferPct: buffer });
        expect(on.last.btcHeld).toBeCloseTo(off.last.btcHeld, 6);
        expect(on.totalColdBtc).toBeGreaterThan(0);
        expect(on.last.cbCollateralBtc).toBeLessThan(off.last.cbCollateralBtc);   // it MOVED
      }
    });

    it('⚠⚠ NOT free on a FALLING path — it pulls liquidation FORWARD, and the test says so', () => {
      // The honest counterweight to the test above. Swept collateral is gone, so a falling price finds a
      // smaller base. An earlier version of this engine claimed the sweep "can never cause a liquidation";
      // it was wrong, and this pins the correction so nobody restores the claim.
      const off = run(FALLING);
      const on  = run({ ...FALLING, coldStoreBufferPct: 20 });
      expect(off.liqMonth).not.toBeNull();
      expect(on.liqMonth).not.toBeNull();
      expect(on.liqMonth!).toBeLessThan(off.liqMonth!);
    });

    it('the FLAT path is the in-between case — the clamp keeps it from getting worse', () => {
      // With the floor clamped to the cap, no buffer makes a flat run liquidate earlier than not sweeping.
      const off = run(FLAT);
      for (let b = 1; b <= 95; b += 7) {
        const on = run({ ...FLAT, coldStoreBufferPct: b });
        const a = on.liqMonth ?? Number.MAX_SAFE_INTEGER;
        const o = off.liqMonth ?? Number.MAX_SAFE_INTEGER;
        expect(a, `buffer ${b} made a flat run liquidate earlier`).toBeGreaterThanOrEqual(o);
      }
    });

    it('⭐ cold storage is NOT SEIZED — the seizure reaches the Coinbase pool only', () => {
      const on = run({ ...FALLING, coldStoreBufferPct: 20 });
      expect(on.liqMonth).not.toBeNull();
      const liqRow = on.rows[on.liqMonth!];
      expect(liqRow.coldBtc).toBeGreaterThan(0);
      expect(on.seizedBtc!).toBeLessThanOrEqual(liqRow.cbCollateralBtc + 1e-9);
      expect(on.survivorBtc!).toBeGreaterThanOrEqual(liqRow.coldBtc - 1e-9);
    });

    it('the three pools always sum to btcHeld — no bitcoin invented or lost', () => {
      for (const cfg of [RISING, FLAT, FALLING]) {
        const r = run({ ...cfg, coldStoreBufferPct: 40 });
        for (const x of r.rows) {
          expect(x.strikeCollateralBtc + x.cbCollateralBtc + x.coldBtc).toBeCloseTo(x.btcHeld, 9);
        }
      }
    });

    it('cold BTC never enters an LTV denominator', () => {
      const r = run({ ...RISING, coldStoreBufferPct: 40 });
      for (const x of r.rows) {
        if (x.cbCollateralBtc > 0 && x.price > 0) {
          expect(x.cbLtv).toBeCloseTo(x.cbDebt / (x.cbCollateralBtc * x.price), 9);
        }
        if (x.strikeCollateralBtc > 0 && x.price > 0) {
          expect(x.strikeLtv).toBeCloseTo(x.strikeBalance / (x.strikeCollateralBtc * x.price), 9);
        }
      }
    });

    it('⭐⭐ the CASCADE — a FIXED credit line needs ever less collateral as price rises', () => {
      // The Coinbase leg frees collateral because the LOAN de-levers. The Strike surplus is freed for a
      // different reason entirely: `strikeCreditLine` is a fixed DOLLAR amount that never grows with
      // price, so the collateral required to support the whole line shrinks as price rises. On a rising
      // path most of the Strike pledge ends up idle — pledged, earning nothing, still with a custodian.
      // The migration moves it to the CB pool first, and the CB leg then sweeps the excess on to cold.
      const r = run({ ...RISING, coldStoreBufferPct: 30 });
      expect(r.totalColdFromStrike).toBeGreaterThan(0);
      expect(r.last.strikeCollateralBtc).toBeLessThan(LIVE.strikeCollateralBtc);
      // The origins are independent and always account for the whole pool, net of top-up retrievals.
      expect(r.totalColdFromCb + r.totalColdFromStrike - r.totalColdRetrievedBtc).toBeCloseTo(r.totalColdBtc, 9);
      for (const x of r.rows) expect(x.coldFromCb + x.coldFromStrike - x.coldRetrievedBtc).toBeCloseTo(x.coldBtc, 9);
    });

    it('⭐ the Strike leg NEVER sweeps below what the full credit line needs at the stressed price', () => {
      // The invariant that keeps the strategy fundable: after any sweep, a drop of `buffer` must still
      // leave enough collateral to draw the ENTIRE line. Otherwise the sweep quietly starves the bills.
      for (const buffer of [20, 30, 50]) {
        const r = run({ ...RISING, coldStoreBufferPct: buffer });
        for (const x of r.rows) {
          if (x.m === 0 || x.postLiquidation) continue;
          const stressed = x.price * (1 - buffer / 100);
          const keepForLine = LIVE.strikeCreditLine / (stressed * LIVE.strikeMaxDrawLtv);
          expect(x.strikeCollateralBtc + 1e-9).toBeGreaterThanOrEqual(Math.min(keepForLine, LIVE.strikeCollateralBtc));
        }
      }
    });

    it('⭐ the Strike leg never breaches the margin-call LTV at the stressed price', () => {
      const buffer = 30;
      const r = run({ ...RISING, coldStoreBufferPct: buffer });
      for (const x of r.rows) {
        if (x.m === 0 || x.postLiquidation || x.strikeBalance <= 0) continue;
        const stressed = x.price * (1 - buffer / 100);
        const stressedLtv = x.strikeBalance / (x.strikeCollateralBtc * stressed);
        expect(stressedLtv).toBeLessThanOrEqual(LIVE.strikeMarginLtv + 1e-9);
      }
    });

    it('Strike collateral is never swept when the sweep is off', () => {
      const off = run(RISING);
      expect(off.totalColdFromStrike).toBe(0);
      for (const x of off.rows) expect(x.strikeCollateralBtc).toBeCloseTo(LIVE.strikeCollateralBtc, 12);
    });

    it('monotonic (no top-up in this run): cold storage only ever grows, and the total matches the last row', () => {
      const r = run({ ...RISING, coldStoreBufferPct: 45 });
      for (let i = 1; i < r.rows.length; i++) {
        expect(r.rows[i].coldBtc).toBeGreaterThanOrEqual(r.rows[i - 1].coldBtc - 1e-12);
      }
      expect(r.rows[r.rows.length - 1].coldBtc).toBeCloseTo(r.totalColdBtc, 9);
      expect(r.rows[0].coldBtc).toBe(0);   // month 0 is the opening position, never a sweep
    });
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

    it('⭐ cbNetApr: Coinbase\'s platform fee sits ON TOP of the Morpho market rate', () => {
      // Reproduces the owner's own borrow screen (Sept 2026): Morpho variable 4.71% + 1.5% platform fee
      // = the 6.21% "Net APR" Coinbase displayed. Plain addition, not a compounding of the two.
      expect(CB_PLATFORM_FEE_PCT).toBe(1.5);
      expect(cbNetApr(4.71)).toBeCloseTo(6.21, 10);
      // The direction matters: net is always MORE expensive than the market rate. A regression that
      // SUBTRACTED (confusing this with Morpho's own `netBorrowApy`, which is net of rewards) fails here.
      expect(cbNetApr(5)!).toBeGreaterThan(5);
      expect(cbNetApr(null)).toBeNull();
      expect(cbNetApr(NaN)).toBeNull();
    });

    it('⭐ the platform fee is a real cost, not a rounding error', () => {
      // 1.5pt on the APR, everything else held, on a run that does NOT liquidate. Unlike the APR sweep
      // (which the draw cap absorbs into less accumulation), this one is unavoidable: it applies to
      // every dollar of debt for every month the debt exists.
      const market = run({ pricePath: flat(36), cbLtvCapPct: 50, cycleMonths: 1, cbAprPct: 4.71 });
      const actual = run({ pricePath: flat(36), cbLtvCapPct: 50, cycleMonths: 1, cbAprPct: 6.21 });
      expect(actual.totalCbInterest).toBeGreaterThan(market.totalCbInterest);
      expect(actual.last.debt).toBeGreaterThan(market.last.debt);
      // ~$4.2k more interest over 3 years on this position, and it lands on the debt.
      expect(actual.totalCbInterest - market.totalCbInterest).toBeGreaterThan(4_000);
      // ⚠ The ORIGINATION fee is untouched by the APR — different fee, different trigger.
      expect(actual.totalCbFees).toBeCloseTo(market.totalCbFees, 6);
    });

    it('⭐⭐ the platform fee pulls LIQUIDATION forward — the part that is not just a cost', () => {
      // The headline result. On the stress fixture (cap 85, flat price, monthly sweeps) the 1.5pt spread
      // moves the 86% breach ELEVEN months earlier. Modelling the loan at Morpho's market rate does not
      // just understate the bill; it tells the owner the liquidation is further away than it is.
      // ⚠ The month numbers are fixture-bound; the ORDERING below is the finding.
      const market = run({ pricePath: flat(60), cbLtvCapPct: 85, cycleMonths: 1, cbAprPct: 4.71 });
      const actual = run({ pricePath: flat(60), cbLtvCapPct: 85, cycleMonths: 1, cbAprPct: 6.21 });
      expect(market.liqMonth).toBe(58);
      expect(actual.liqMonth).toBe(47);
      expect(actual.liqMonth!).toBeLessThan(market.liqMonth!);
      // Less collateral is seized only because the breach happens before as much BTC was accumulated —
      // that is a WORSE outcome, not a better one. The survivor stack is smaller too.
      expect(actual.survivorBtc!).toBeLessThan(market.survivorBtc!);
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
