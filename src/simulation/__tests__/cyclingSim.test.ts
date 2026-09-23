import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import {
  runCyclingSim, CB_LIQUIDATION_PENALTY, effectiveStrikeCapPct, type CyclingInputs, type CyclingResult,
} from '../cyclingSim';
import { cbSurvivalCollateralBtc } from '../cbDefense';
// The Strike-cap block reproduces the FACES' world, so it deliberately builds the faces' own paths.
// (The §2 wall restricts the ENGINE module; the cold-sweep block below keeps its own synthetic regimes.)
import { cycleConvergencePath } from '../cyclePath';
import { plConvergencePath } from '../powerLaw';
import { applyPathStress } from '../../components/Almanac/cyclingFaceView';
import { modeConstraints } from '../../components/Almanac/ownershipFaceView';
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

  it('⭐ byte-identical only when BOTH are off — no sweep AND no defense means no migration', () => {
    // The migration runs for `coldOn || defend`. This run passes neither, so the Strike pledge is frozen
    // exactly as the pre-cascade engine left it. That is the byte-identical guarantee; the companion test
    // below pins the other half (defense alone is enough to move it).
    const rising = geo(120, 25);
    const off = run({ pricePath: rising, cbLtvCapPct: 50, cycleMonths: 1 });
    expect(off.totalStrikeToCbBtc).toBe(0);
    for (const x of off.rows) expect(x.strikeCollateralBtc).toBe(LIVE.strikeCollateralBtc);
  });

  it('⭐ the cascade runs for the DEFENSE alone — sweep off, defend on, collateral still migrates', () => {
    // The migration's own justification is a defense one: the freed collateral is CB headroom that lets
    // more cheap debt refinance under the stop. Gating it on the sweep meant a user who turned the sweep
    // off silently lost it. ⚠ Non-vacuous by construction — keepForLine (38,000 / (price × 0.5) = 0.974 ₿
    // at the opening price) already sits below the 1.0 ₿ pledge, and falls further as price rises.
    const rising = geo(120, 25);
    const r = run({ pricePath: rising, cbLtvCapPct: 50, cycleMonths: 1, defendCbLtv: true });
    expect(r.totalStrikeToCbBtc).toBeGreaterThan(0);
    expect(r.last.strikeCollateralBtc).toBeLessThan(LIVE.strikeCollateralBtc);
    // With the sweep off the coins stop at Coinbase — nothing goes on to cold, and the pools still balance.
    expect(r.totalColdBtc).toBe(0);
    for (const x of r.rows) {
      expect(x.strikeCollateralBtc + x.cbCollateralBtc + x.coldBtc).toBeCloseTo(x.btcHeld, 9);
    }
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

describe('runCyclingSim — openingColdBtc seeds the pool with the owner\'s REAL reserve', () => {
  /** Deep enough that the Strike line runs out and the shift leaves a shortfall — which is the only thing
   *  that calls the top-up, and therefore the only thing that can spend the seed. Sweep OFF throughout, so
   *  every cold figure here comes from the seed and nothing else. */
  const hardCrash = [78_000, 60_000, 55_000, 50_000, 45_000, 30_000, ...new Array(6).fill(30_000)];
  const CRASH = { pricePath: hardCrash, cbLtvCapPct: 50, defendCbLtv: true, cycleMonths: 999, strikeCreditLine: 20_000 };

  it('⭐ omitted is 0, and an explicit 0 is byte-identical to omitting it', () => {
    const omitted = run({ pricePath: flat(60), cbLtvCapPct: 50 });
    const zero = run({ pricePath: flat(60), cbLtvCapPct: 50, openingColdBtc: 0 });
    expect(omitted.openingColdBtc).toBe(0);
    expect(zero.rows).toEqual(omitted.rows);
    expect(zero.baselineBtc).toBe(omitted.baselineBtc);
    // Junk seeds degrade to 0 the same way coldStoreBufferPct does — never NaN in a pool figure.
    for (const bad of [-5, NaN, Infinity] as number[]) {
      const r = run({ pricePath: flat(60), cbLtvCapPct: 50, openingColdBtc: bad });
      expect(r.openingColdBtc).toBe(0);
      expect(r.rows).toEqual(omitted.rows);
    }
  });

  it('⭐ the seed is SPENT by the emergency top-up — and it survives a crash that liquidates without it', () => {
    // Before this input the engine's cold pool started at 0, so topUpToCbLtv's documented "cold reserve
    // FIRST" could only ever spend coins the simulation itself had swept — while deriveOwnership was
    // already counting the owner's real reserve. The two disagreed about whether that reserve exists.
    const unseeded = run(CRASH);
    const seeded = run({ ...CRASH, openingColdBtc: 0.75 });
    expect(unseeded.totalColdRetrievedBtc).toBe(0);            // nothing to spend without a seed
    expect(seeded.firstTopUpMonth).toBe(1);                    // the top-up is what reaches for it
    expect(seeded.totalColdRetrievedBtc).toBeCloseTo(0.75, 9); // ...and it needed the WHOLE reserve
    expect(seeded.totalColdBtc).toBeCloseTo(0, 9);             // drained, so the pool nets to zero
    // The invariant: a reserve can only ever push liquidation later, never earlier.
    expect(unseeded.liqMonth).not.toBeNull();
    expect(seeded.liqMonth ?? Number.MAX_SAFE_INTEGER).toBeGreaterThan(unseeded.liqMonth!);
    // ⚠ FIXTURE-BOUND absolutes: on this crash the unseeded run breaches at month 5 and 0.75 ₿ of real
    // reserve removes the breach from the horizon outright. The ORDERING above is the finding.
    expect(unseeded.liqMonth).toBe(5);
    expect(seeded.liqMonth).toBeNull();
  });

  it('the cold ledger still foots: opening + fromCb + fromStrike − retrieved === totalColdBtc', () => {
    const r = run({ ...CRASH, openingColdBtc: 0.75 });
    expect(r.openingColdBtc).toBe(0.75);
    expect(r.openingColdBtc + r.totalColdFromCb + r.totalColdFromStrike - r.totalColdRetrievedBtc)
      .toBeCloseTo(r.totalColdBtc, 9);
    // And per row — the running pool never invents or loses a coin either.
    for (const x of r.rows) {
      expect(0.75 + x.coldFromCb + x.coldFromStrike - x.coldRetrievedBtc).toBeCloseTo(x.coldBtc, 9);
      expect(x.strikeCollateralBtc + x.cbCollateralBtc + x.coldBtc).toBeCloseTo(x.btcHeld, 9);
    }
  });

  it('⭐ the never-draw BASELINE gets the seed too — the owner holds that reserve either way', () => {
    // Omitting it would credit the strategy with coins it never earned, inflating the verdict by exactly
    // the seed. The baseline's own comment says it compares against "the untouched opening position", and
    // an unpledged reserve is part of that position.
    const unseeded = run({ pricePath: flat(60), cbLtvCapPct: 50 });
    const seeded = run({ pricePath: flat(60), cbLtvCapPct: 50, openingColdBtc: 0.75 });
    expect(seeded.baselineBtc - unseeded.baselineBtc).toBeCloseTo(0.75, 12);
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

  it('⭐ a liquidation ENDS the Coinbase loop — no refinance and no cascade migration after the seizure', () => {
    // A V-path: a crash liquidates Coinbase at month 4 with the debt-shift defense holding ~$29k on Strike,
    // then the price recovers to $150k. Before the gate, the refinance re-borrowed that Strike balance on
    // Coinbase every month after the seizure (and the cascade migration moved Strike collateral in), building
    // a NEW Coinbase loan the one-shot breach check could never liquidate.
    const V = [78_000, 78_000, 60_000, 45_000, 30_000, 30_000, 30_000, 30_000, 60_000, 90_000, 120_000,
      ...new Array(13).fill(150_000)];
    const cfg = { pricePath: V, cbLtvCapPct: 50, defendCbLtv: true, coldStoreBufferPct: 30, cycleMonths: 1 };
    const r = run(cfg);
    const cmr = LIVE.cbAprPct / 100 / 12;
    expect(r.liqMonth).toBe(4);                                        // ⚠ fixture-bound
    const L = r.liqMonth!;
    expect(r.rows[L].strikeBalance).toBeGreaterThan(20_000);           // non-vacuous: debt WAS left on Strike
    for (let m = L + 1; m < r.rows.length; m++) {
      expect(r.rows[m].strikeToCbBtc, `migration at month ${m}`).toBe(0);
      expect(r.rows[m].cbDebt, `a Coinbase borrow at month ${m}`)
        .toBeLessThanOrEqual(r.rows[m - 1].cbDebt * (1 + cmr) + 1e-6);   // interest only, never a re-borrow
    }
    // The engine is causal, so the run cut off at the seizure paid every fee the full run may pay.
    const upToSeizure = run({ ...cfg, pricePath: V.slice(0, L + 1) });
    expect(r.cbFeeCount).toBe(upToSeizure.cbFeeCount);
    expect(r.totalCbFees).toBe(upToSeizure.totalCbFees);
    expect(r.totalRefinancedUsd).toBe(upToSeizure.totalRefinancedUsd);
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
    // than leaning on `flat` alone. No powerLaw paths in THIS block — its regimes are synthetic on purpose
    // (the Strike-cap block imports the real ones, because it reproduces the faces' world).
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

/**
 * The spec's reproduction — round synthetic figures: 1.0 ₿ on each venue, $20k Strike / $40k Coinbase, a
 * $60k line, 13% / 6.2%, $8k income against $6k expenses, cadence 1, defense on, sweep 30, CB cap 50.
 * ⚠ startDate PINNED at 2027-01-01Z — an implied "today" rots. The spec's §A3 table was measured from a
 * 2026-09-21 start, which is the ONLY reason its margin call reads month 46 where this one reads 43: a
 * different phase of the same 4-yr cycle, same behaviour.
 */
const REPRO: CyclingInputs = {
  startYear: 2027,
  strikeCollateralBtc: 1, strikeBalance: 20_000, strikeCreditLine: 60_000,
  strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV, strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
  cbCollateralBtc: 1, cbDebt: 40_000,
  income: 8_000, expenses: 6_000, strikeAprPct: 13, cbAprPct: 6.2,
  cycleMonths: 1, cbLtvCapPct: 50, defendCbLtv: true, coldStoreBufferPct: 30,
  pricePath: cycleConvergencePath(100_000, new Date('2027-01-01T00:00:00Z'), 60, 1),
};

describe('runCyclingSim — Strike LTV cap (strikeLtvCapPct) + the Coinbase survival guard', () => {
  /** A single crash at month 1: no refinance (cadence 999), no sweep, 0.3 ₿ of real reserve. */
  const CRASH: Omit<CyclingInputs, 'pricePath'> = {
    ...REPRO, cycleMonths: 999, coldStoreBufferPct: 0, strikeBalance: 32_000, cbDebt: 50_000,
    openingColdBtc: 0.3, strikeLtvCapPct: 60,
  };
  /** Fixture C — $45k: Coinbase can live only if Strike gives way. */
  const FIXTURE_C: CyclingInputs = { ...CRASH, pricePath: [100_000, 45_000] };
  /** Fixture D — $30k: Coinbase is doomed THIS MONTH whatever Strike does, while the reserve alone can
   *  still hold Strike at its cap. The futility check's reason to exist. */
  const FIXTURE_D: CyclingInputs = { ...CRASH, strikeBalance: 18_400, pricePath: [100_000, 30_000] };
  const peakSk = (r: CyclingResult) => Math.max(...r.rows.map((x) => x.strikeLtv));
  const NEW_ROW_FIELDS = ['strikeTopUpBtc', 'strikeReserveBtc', 'strikeTopUpShortfallBtc', 'strikeReserveCutBtc'] as const;

  it('⭐ 5 · the reproduction, both directions: called at month 43 with the cap off, never at 60', () => {
    const off = runCyclingSim(REPRO);
    const on = runCyclingSim({ ...REPRO, strikeLtvCapPct: 60 });
    expect(off.strikeMarginMonth).toBe(43);
    expect(on.strikeMarginMonth).toBeNull();
    // Held AT the cap, not merely under the call — the descent plateaus at exactly 60%.
    expect(peakSk(off)).toBeGreaterThan(STRIKE_MARGIN_CALL_LTV);
    expect(peakSk(on)).toBeCloseTo(0.60, 9);
    expect(on.firstStrikeTopUpMonth).not.toBeNull();
    expect(on.strikeTopUpExhaustedMonth).toBeNull();
    expect(on.liqMonth).toBeNull();
  });

  it('⭐ 6 · the cold ledger still foots with the Strike top-up inside it', () => {
    const r = runCyclingSim({ ...REPRO, strikeLtvCapPct: 60 });
    expect(r.totalStrikeTopUpBtc).toBeGreaterThan(0);   // guard: the Strike top-up actually fired
    expect(r.openingColdBtc + r.totalColdFromCb + r.totalColdFromStrike - r.totalColdRetrievedBtc)
      .toBeCloseTo(r.totalColdBtc, 9);
    for (const x of r.rows) {
      expect(r.openingColdBtc + x.coldFromCb + x.coldFromStrike - x.coldRetrievedBtc).toBeCloseTo(x.coldBtc, 9);
    }
    // Both top-ups draw on ONE retrieval counter.
    expect(r.totalColdRetrievedBtc).toBeCloseTo(r.totalTopUpFromColdBtc + r.totalStrikeTopUpBtc, 12);
  });

  it('7 · coins are conserved — the top-up MOVES bitcoin, it never mints it', () => {
    const r = runCyclingSim({ ...REPRO, strikeLtvCapPct: 60 });
    expect(r.liqMonth).toBeNull();                      // no seizure in the way
    expect(r.totalStrikeTopUpBtc).toBeGreaterThan(0);
    const bought = r.rows.reduce((sum, x) => sum + (x.price > 0 ? x.btcBoughtUsd / x.price : 0), 0);
    expect(r.last.btcHeld)
      .toBeCloseTo(REPRO.strikeCollateralBtc + REPRO.cbCollateralBtc + r.openingColdBtc + bought, 9);
  });

  it('⭐ 8 · off ⇒ byte-identical — absent / 0 / −5 / NaN / ∞ — and pinned to the pre-feature engine', () => {
    const absent = runCyclingSim(REPRO);
    for (const v of [0, -5, NaN, Number.POSITIVE_INFINITY]) {
      expect(runCyclingSim({ ...REPRO, strikeLtvCapPct: v }).rows).toEqual(absent.rows);
    }
    for (const x of absent.rows) for (const k of NEW_ROW_FIELDS) expect(x[k]).toBe(0);
    expect(absent.firstStrikeTopUpMonth).toBeNull();
    expect(absent.strikeTopUpExhaustedMonth).toBeNull();
    expect(absent.totalStrikeTopUpBtc).toBe(0);
    expect(absent.firstSurvivalYieldMonth).toBeNull();
    // ⭐ THE HEAD GOLDEN — the UNMODIFIED engine (HEAD 0322128) on this exact fixture, captured before a
    // line of this feature was written. `absent ≡ 0` above cannot see a leak that moves both runs
    // alike; these can. (Verified identical on Node 22 — CI's version — and Node 26.)
    expect(absent.strikeMarginMonth).toBe(43);
    expect(absent.liqMonth).toBeNull();
    expect(absent.rows).toHaveLength(61);
    expect(absent.last.btcHeld).toBeCloseTo(3.9194251711551873, 9);
    expect(absent.totalColdBtc).toBeCloseTo(1.7402271853714832, 9);
    expect(absent.last.equity).toBeCloseTo(1389607.8827326794, 4);
    expect(absent.totalTopUpBtc).toBeCloseTo(0.905376292993461, 9);
    expect(absent.totalDefenseDrawnUsd).toBeCloseTo(58985.317884110904, 4);
    expect(absent.totalStrikeToCbBtc).toBeCloseTo(0.6279504246050729, 9);
    expect(absent.totalColdRetrievedBtc).toBeCloseTo(0.905376292993461, 9);
    expect(peakSk(absent)).toBeCloseTo(0.796667046754635, 9);
  });

  it('8 · twins — the two TEST-ONLY flags default ON, and each is non-vacuous where it binds', () => {
    // cbSurvivalGuard on fixture C (where the guard binds)...
    const cAbsent = runCyclingSim(FIXTURE_C);
    expect(cAbsent.rows).toEqual(runCyclingSim({ ...FIXTURE_C, cbSurvivalGuard: true }).rows);
    expect(cAbsent.rows).not.toEqual(runCyclingSim({ ...FIXTURE_C, cbSurvivalGuard: false }).rows);
    // ...and cbFutilityCheck on fixture D (where the futility check binds).
    const dAbsent = runCyclingSim(FIXTURE_D);
    expect(dAbsent.rows).toEqual(runCyclingSim({ ...FIXTURE_D, cbFutilityCheck: true }).rows);
    expect(dAbsent.rows).not.toEqual(runCyclingSim({ ...FIXTURE_D, cbFutilityCheck: false }).rows);
  });

  it('⭐ 9 · the adversarial grid: the cap never makes Coinbase worse, and the call is gone in all 36', () => {
    let n = 0, engaged = 0, contested = 0;
    for (const cbDebt of [50_000, 60_000, 70_000, 80_000]) {
      for (const openingColdBtc of [0, 0.05, 0.2]) {
        for (const cbLtvCapPct of [50, 60, 70]) {
          n++;
          const off = runCyclingSim({ ...REPRO, cbDebt, openingColdBtc, cbLtvCapPct });
          const on = runCyclingSim({ ...REPRO, cbDebt, openingColdBtc, cbLtvCapPct, strikeLtvCapPct: 60 });
          if (off.liqMonth === null) expect(on.liqMonth).toBeNull();
          else if (on.liqMonth !== null) expect(on.liqMonth).toBeGreaterThanOrEqual(off.liqMonth);
          expect(off.strikeMarginMonth).not.toBeNull();
          expect(on.strikeMarginMonth).toBeNull();
          if (on.rows.some((x) => x.strikeReserveBtc > 0)) engaged++;
          // ⚠ Contested = a Strike reserve held back in a month the CB top-up ALSO ran — the only months
          // in which the reserve could have starved Coinbase. Without these the invariant is vacuous.
          if (on.rows.some((x) => x.strikeReserveBtc > 0 && x.topUpBtc > 0)) contested++;
        }
      }
    }
    expect(n).toBe(36);
    expect(engaged).toBe(36);
    expect(contested).toBe(36);
  });

  it('10 · the clamp bites: a cap of 90 runs as 66.5 (0.70 × 0.95), peaking at 0.665 — not 0.797', () => {
    expect(effectiveStrikeCapPct(90, STRIKE_MARGIN_CALL_LTV)).toBeCloseTo(66.5, 9);
    const c90 = runCyclingSim({ ...REPRO, strikeLtvCapPct: 90 });
    const c665 = runCyclingSim({ ...REPRO, strikeLtvCapPct: 66.5 });
    expect(c90.rows).toEqual(c665.rows);
    expect(peakSk(c90)).toBeCloseTo(0.665, 9);           // unclamped, 90 would never bind below the 0.797 peak
    expect(c90.strikeMarginMonth).toBeNull();
  });

  it('effectiveStrikeCapPct: off for absent / 0 / negative / non-finite, and the requested cap under the ceiling', () => {
    for (const v of [undefined, 0, -5, NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveStrikeCapPct(v, STRIKE_MARGIN_CALL_LTV)).toBe(0);
    }
    expect(effectiveStrikeCapPct(60, STRIKE_MARGIN_CALL_LTV)).toBe(60);
    expect(effectiveStrikeCapPct(50, STRIKE_MARGIN_CALL_LTV)).toBe(50);
  });

  it('11 · empty pool, armed cap: nothing moves, and the exhaustion month IS the first breach', () => {
    // ⚠ Synthetic — on the real sweep-off path the cadence migration keeps more Strike collateral and the
    // cap is never breached, so a natural fixture passes vacuously. No defense, no sweep, no reserve: the
    // draw walks Strike to its 50% line at $100k, then a fall to $75k lifts it over the cap.
    const r = runCyclingSim({
      ...REPRO, defendCbLtv: false, coldStoreBufferPct: 0, openingColdBtc: 0, cycleMonths: 999, cbLtvCapPct: 85,
      strikeLtvCapPct: 60, pricePath: [...new Array(8).fill(100_000), ...new Array(6).fill(75_000)],
    });
    const firstBreach = r.rows.findIndex((x) => x.strikeLtv > 0.60);
    expect(firstBreach).toBe(8);
    expect(r.strikeTopUpExhaustedMonth).toBe(firstBreach);
    expect(r.rows.every((x) => x.strikeTopUpBtc === 0)).toBe(true);
    expect(r.totalStrikeTopUpBtc).toBe(0);
    expect(r.firstStrikeTopUpMonth).toBeNull();
  });

  it('⭐ A1 · fixture B pins BOTH halves of the reservation — the cold AND the collateral floor', () => {
    // $50k: Coinbase needs a top-up, Strike needs 0.078 ₿ to sit at 60%, and 0.3 ₿ of cold must cover
    // both. Drop the cold reserve and Coinbase takes the coins; drop the floor and it takes the
    // collateral instead. Either way Strike ends above 60%. No spec test caught either deletion.
    const r = runCyclingSim({ ...CRASH, pricePath: [100_000, 50_000] });
    const x = r.rows[1];
    expect(x.strikeReserveBtc).toBeGreaterThan(0);
    expect(x.topUpBtc).toBeGreaterThan(0);                                          // contested
    expect(x.topUpFromColdBtc).toBeCloseTo(0.3 - x.strikeReserveBtc, 12);           // handed cold − reserve
    expect(x.topUpFromStrikeBtc).toBe(0);                                           // the floor held
    expect(x.strikeTopUpBtc).toBeCloseTo(x.strikeReserveBtc, 12);                   // the reserve went to Strike
    expect(x.strikeLtv).toBeCloseTo(0.60, 9);
    expect(r.strikeTopUpExhaustedMonth).toBeNull();
    expect(r.firstSurvivalYieldMonth).toBeNull();
    expect(r.liqMonth).toBeNull();
    // ⚠ FIXTURE-BOUND: the reserve and the resulting CB LTV on this crash.
    expect(x.strikeReserveBtc).toBeCloseTo(0.078222, 6);
    expect(x.cbLtv).toBeCloseTo(0.7966, 4);
  });

  it('⭐ A2 · fixture C — the survival guard: Strike gives way so Coinbase lives', () => {
    const guarded = runCyclingSim(FIXTURE_C);
    const specV1 = runCyclingSim({ ...FIXTURE_C, cbSurvivalGuard: false });
    const capOff = runCyclingSim({ ...FIXTURE_C, strikeLtvCapPct: 0 });
    // The spec-v1 reservation liquidates Coinbase to keep Strike at 60%...
    expect(specV1.liqMonth).toBe(1);
    expect(specV1.rows[1].strikeLtv).toBeCloseTo(0.60, 9);
    expect(specV1.rows[1].cbLtv).toBeCloseTo(0.9742, 4);
    // ...the guard cuts the reserve, drops the floor, and Coinbase survives — Strike is called instead.
    expect(guarded.liqMonth).toBeNull();
    expect(guarded.firstSurvivalYieldMonth).toBe(1);
    expect(guarded.rows[1].strikeReserveCutBtc).toBeCloseTo(0.198025, 6);
    expect(guarded.rows[1].strikeReserveBtc).toBe(0);
    expect(guarded.strikeMarginMonth).toBe(1);
    // Coinbase is exactly where it would be with the cap off — the guard hands back everything.
    expect(guarded.rows[1].cbLtv).toBe(capOff.rows[1].cbLtv);
    expect(guarded.rows[1].cbLtv).toBeCloseTo(0.8307, 4);
    expect(capOff.liqMonth).toBeNull();
  });

  it('⭐ M1 · the floor stands exactly while cold alone can keep Coinbase alive — and drops one sat under', () => {
    // A fixture where Strike needs NO reserve (the debt shift leaves it at 50%), so only the FLOOR is in
    // play: kept → the CB grab stops at the 60% cap; dropped → it goes on to the 66.5% margin bound.
    // income = expenses, so a non-drawing month buys nothing and Coinbase's collateral stays at 1 ₿.
    const base: CyclingInputs = {
      ...CRASH, strikeBalance: 10_000, income: 6_000, expenses: 6_000, openingColdBtc: 0, pricePath: [100_000, 45_000],
    };
    const probe = runCyclingSim(base);
    expect(probe.rows[1].strikeReserveBtc).toBe(0);                 // no reserve: the floor alone decides
    const survivalBtc = cbSurvivalCollateralBtc(probe.rows[1].cbDebt, 1, 45_000, CB_LLTV);
    expect(survivalBtc).toBeGreaterThan(0);
    const above = runCyclingSim({ ...base, openingColdBtc: survivalBtc + 1e-8 });
    const below = runCyclingSim({ ...base, openingColdBtc: survivalBtc - 1e-8 });
    expect(above.firstSurvivalYieldMonth).toBeNull();
    expect(above.rows[1].strikeLtv).toBeCloseTo(0.60, 9);
    expect(below.firstSurvivalYieldMonth).toBe(1);
    expect(below.rows[1].strikeLtv).toBeCloseTo(STRIKE_MARGIN_CALL_LTV * 0.95, 9);
    for (const r of [above, below]) expect(r.liqMonth).toBeNull();
  });

  it('⭐ the guard acts ONLY in a month the CB top-up runs — no phantom "gave way" on a healthy stop', () => {
    // CB cap 85, above the 81.7% survival line: Coinbase sits at 83% — inside its own stop, so there is
    // no debt shift, no shortfall and no CB top-up — while Strike (64.7%) wants the cold. Ungated, the
    // guard would cut the reserve here and report a yield that handed nothing to anyone.
    const r = runCyclingSim({ ...CRASH, cbLtvCapPct: 85, cbDebt: 43_000, openingColdBtc: 0.05, pricePath: [100_000, 50_000] });
    const x = r.rows[1];
    expect(x.defenseShortfallUsd).toBe(0);
    expect(x.topUpBtc).toBe(0);
    expect(x.cbLtv).toBeGreaterThan(CB_LLTV * 0.95);        // the guard WOULD bind, if it ran
    expect(r.firstSurvivalYieldMonth).toBeNull();
    expect(r.rows.every((row) => row.strikeReserveCutBtc === 0)).toBe(true);
    expect(x.strikeTopUpBtc).toBeCloseTo(0.05, 12);         // the whole reserve went to Strike
    expect(r.liqMonth).toBeNull();
  });

  it('⭐ above an 81.7% stop the guard reserves only what reaching the STOP takes — no phantom yield', () => {
    // CB stop 84, a crash to $59,100: Coinbase opens month 1 at ~85% — over its stop, under the 86% line (not
    // doomed) — with a dry Strike line, so the shift falls short and the CB top-up runs. Strike sits at ~64%
    // and wants 0.083 ₿ of the 0.1 ₿ cold. income = expenses, so no purchase moves either LTV.
    // The top-up only aims at the STOP, so Coinbase takes just the to-stop need. Sizing the reserve cut
    // against the 81.7% survival line claimed coins it never took, and reported "Strike gave way to keep
    // Coinbase alive" in a month where Strike still got its whole need.
    const price = 59_100;
    const r = runCyclingSim({
      ...CRASH, cbLtvCapPct: 84, income: 6_000, expenses: 6_000, strikeBalance: 38_000, openingColdBtc: 0.1,
      pricePath: [100_000, price],
    });
    const x = r.rows[1];
    const toStop = x.cbDebt / (0.84 * price) - 1;                      // collateral 1 ₿ before the top-up
    const strikeNeed = x.strikeBalance / (0.60 * price) - 1;           // Strike collateral 1 ₿ before it
    // The premise, stated with the OLD rule: the survival-line need leaves less spare cold than Strike wants.
    expect(cbSurvivalCollateralBtc(x.cbDebt, 1, price, CB_LLTV)).toBeGreaterThan(0.1 - strikeNeed);
    expect(0.1 - toStop).toBeGreaterThanOrEqual(strikeNeed);           // ...but the stop's need does not
    expect(x.defenseShortfallUsd).toBeGreaterThan(0);                  // the guard's gate is open
    expect(x.topUpBtc).toBeGreaterThan(0);                             // and the CB top-up ran
    // No yield, nothing cut, the reserve is the whole Strike need.
    expect(r.firstSurvivalYieldMonth).toBeNull();
    expect(r.rows.every((row) => row.strikeReserveCutBtc === 0)).toBe(true);
    expect(x.strikeReserveBtc).toBeCloseTo(strikeNeed, 12);
    // Coin movement is what it always was: Coinbase gets the to-stop need, Strike its whole need.
    expect(x.topUpFromColdBtc).toBeCloseTo(toStop, 12);
    expect(x.topUpFromStrikeBtc).toBe(0);
    expect(x.strikeTopUpBtc).toBeCloseTo(strikeNeed, 12);
    expect(x.cbLtv).toBeCloseTo(0.84, 12);
    expect(x.strikeLtv).toBeCloseTo(0.60, 12);
    expect(r.liqMonth).toBeNull();
    expect(r.strikeMarginMonth).toBeNull();
  });

  /** One (base, arm) pair of runs per case; `off` and `v1` are arm-independent and computed once. */
  const ARMS = [['guard-only', { cbFutilityCheck: false }], ['guard+F1', {}]] as const;
  const strikeWorse = (g: CyclingResult, u: CyclingResult) =>
    (g.strikeMarginMonth !== null && (u.strikeMarginMonth === null || g.strikeMarginMonth < u.strikeMarginMonth))
    || g.totalStrikeTopUpBtc < u.totalStrikeTopUpBtc - 1e-12;
  const cbEarlier = (r: CyclingResult, off: CyclingResult) =>
    (r.liqMonth ?? Number.POSITIVE_INFINITY) < (off.liqMonth ?? Number.POSITIVE_INFINITY);
  interface Tally { cbEarlier: number; yielded: number; survived: number; died: number; strikeWorse: number; futile: number; calls: number }
  function tallyGrid(cases: CyclingInputs[]) {
    const out: Record<'unguarded' | 'guard-only' | 'guard+F1', Tally> = {
      unguarded: { cbEarlier: 0, yielded: 0, survived: 0, died: 0, strikeWorse: 0, futile: 0, calls: 0 },
      'guard-only': { cbEarlier: 0, yielded: 0, survived: 0, died: 0, strikeWorse: 0, futile: 0, calls: 0 },
      'guard+F1': { cbEarlier: 0, yielded: 0, survived: 0, died: 0, strikeWorse: 0, futile: 0, calls: 0 },
    };
    for (const cfg of cases) {
      const off = runCyclingSim({ ...cfg, strikeLtvCapPct: 0 });
      const v1 = runCyclingSim({ ...cfg, cbSurvivalGuard: false });
      const note = (t: Tally, r: CyclingResult) => {
        if (cbEarlier(r, off)) t.cbEarlier++;
        if (r.strikeMarginMonth !== null) t.calls++;
        if (r.firstSurvivalYieldMonth === null) return;
        t.yielded++;
        if (r.liqMonth === null) { t.survived++; return; }
        t.died++;
        if (strikeWorse(r, v1)) { t.strikeWorse++; if (r.liqMonth === v1.liqMonth) t.futile++; }
      };
      note(out.unguarded, v1);
      for (const [tag, arm] of ARMS) note(out[tag], runCyclingSim({ ...cfg, ...arm }));
    }
    return out;
  }

  it('⭐⭐ A3 · the faces\' world (360) and the synthetic crashes (5,760): three arms, counts pinned', () => {
    // A3 GRID — the Cycling face's world: the 4-yr path from 2027-01-01Z, CB cap 50/60/70 × a stress lens
    // engaged at month 1, 3, …, 59 × factor 0.35/0.5/0.65/0.8, Strike cap 60. A silent drift in any count
    // must break the build; the unguarded arm is what keeps the guarded pins from passing vacuously.
    const path = cycleConvergencePath(100_000, new Date('2027-01-01T00:00:00Z'), 60, 1);
    const faceWorld: CyclingInputs[] = [];
    for (const cbLtvCapPct of [50, 60, 70]) {
      for (let from = 1; from <= 59; from += 2) {
        for (const lens of [0.35, 0.5, 0.65, 0.8]) {
          faceWorld.push({ ...REPRO, cbLtvCapPct, strikeLtvCapPct: 60, pricePath: applyPathStress(path, from, lens) });
        }
      }
    }
    expect(faceWorld).toHaveLength(360);
    const g = tallyGrid(faceWorld);
    // Coinbase liquidated EARLIER than with the cap off: spec v1 24 → guard 14 → guard + F1 14.
    expect([g.unguarded.cbEarlier, g['guard-only'].cbEarlier, g['guard+F1'].cbEarlier]).toEqual([24, 14, 14]);
    // ⚠ guard-only strikeWorse/futile and the calls moved with the terminal-liquidation fix (the refinance no
    // longer moves a post-seizure Strike balance onto Coinbase, so it stays on Strike and can reach its call).
    // Every Coinbase count is unchanged.
    expect(g['guard-only']).toMatchObject({ yielded: 108, survived: 26, died: 82, strikeWorse: 29, futile: 21 });
    expect(g['guard+F1']).toMatchObject({ yielded: 59, survived: 26, died: 33, strikeWorse: 13, futile: 5 });
    expect([g.unguarded.calls, g['guard-only'].calls, g['guard+F1'].calls]).toEqual([80, 97, 82]);

    // SYNTHETIC SINGLE-CRASH GRID — 5 Strike balances × 4 CB debts × 6 cold seeds × 3 pre-crash spans ×
    // 4 depths × sweep on/off × cadence 1/999, CB cap 50, Strike cap 60 vs off.
    let n = 0;
    const synEarlier = { unguarded: 0, 'guard-only': 0, 'guard+F1': 0 };
    for (const strikeBalance of [0, 10_000, 20_000, 30_000, 40_000]) for (const cbDebt of [40_000, 50_000, 60_000, 70_000])
    for (const openingColdBtc of [0, 0.1, 0.2, 0.3, 0.5, 1.0]) for (const pre of [1, 3, 6]) for (const depth of [0.4, 0.5, 0.6, 0.7])
    for (const coldStoreBufferPct of [0, 30]) for (const cycleMonths of [1, 999]) {
      n++;
      const cfg: CyclingInputs = {
        ...REPRO, cbLtvCapPct: 50, strikeBalance, cbDebt, openingColdBtc, coldStoreBufferPct, cycleMonths,
        pricePath: [...new Array(pre + 1).fill(100_000), ...new Array(12).fill(100_000 * depth)],
      };
      const off = runCyclingSim(cfg);
      if (cbEarlier(runCyclingSim({ ...cfg, strikeLtvCapPct: 60, cbSurvivalGuard: false }), off)) synEarlier.unguarded++;
      for (const [tag, arm] of ARMS) if (cbEarlier(runCyclingSim({ ...cfg, strikeLtvCapPct: 60, ...arm }), off)) synEarlier[tag]++;
    }
    expect(n).toBe(5_760);
    expect(synEarlier).toEqual({ unguarded: 526, 'guard-only': 0, 'guard+F1': 0 });
  }, 60_000);

  it('A4 · on the Support path (the shipped default frame) the cap is a no-op', () => {
    const support: CyclingInputs = {
      ...REPRO, cbLtvCapPct: 70, pricePath: plConvergencePath(100_000, 'floor', new Date('2027-01-01T00:00:00Z'), 60, 1),
    };
    const off = runCyclingSim(support);
    const on = runCyclingSim({ ...support, strikeLtvCapPct: 60 });
    expect(on.rows).toEqual(off.rows);
    expect(on.firstStrikeTopUpMonth).toBeNull();
    expect(on.firstSurvivalYieldMonth).toBeNull();
    expect(peakSk(off)).toBeLessThan(0.60);             // why: Strike never reaches the cap on this path
  });

  it('⭐⭐ A5 · the reachability grid (2,806): three arms, and the C6 yield the faces must be able to show', () => {
    // The faces' exact inputs (the Playwright seed, today = 2026-09-21): 4-yr path, CB cap 50, cadence 1,
    // sweep 30, Strike cap 60 × a stress lens engaged at month 0–60 × factor 0.35–0.80 in steps of 0.01.
    const path = cycleConvergencePath(100_000, new Date('2026-09-21T00:00:00Z'), 60, 1);
    const reach: CyclingInputs[] = [];
    for (let from = 0; from <= 60; from++) {
      for (let k = 35; k <= 80; k++) {
        reach.push({ ...REPRO, startYear: 2026, strikeLtvCapPct: 60, pricePath: applyPathStress(path, from, k / 100) });
      }
    }
    expect(reach).toHaveLength(2_806);
    const g = tallyGrid(reach);
    expect([g.unguarded.cbEarlier, g['guard-only'].cbEarlier, g['guard+F1'].cbEarlier]).toEqual([158, 94, 94]);
    // ⚠ Same terminal-liquidation moves as A3 (guard-only strikeWorse/futile + calls); Coinbase counts unchanged.
    expect(g['guard-only']).toMatchObject({ yielded: 704, survived: 249, died: 455, strikeWorse: 96, futile: 70 });
    expect(g['guard+F1']).toMatchObject({ yielded: 395, survived: 249, died: 146, strikeWorse: 44, futile: 18 });
    expect([g.unguarded.calls, g['guard-only'].calls, g['guard+F1'].calls]).toEqual([858, 968, 920]);
    // ⭐ C6: scrub to month 8, then stress to 0.50 — the guard yields in month 8 and Coinbase SURVIVES.
    const c6 = runCyclingSim({ ...REPRO, startYear: 2026, strikeLtvCapPct: 60, pricePath: applyPathStress(path, 8, 0.5) });
    expect(c6.firstSurvivalYieldMonth).toBe(8);
    expect(c6.liqMonth).toBeNull();
    expect(c6.strikeMarginMonth).toBeNull();
  }, 60_000);

  it('⭐ A6 · fixture D — the futility check: no yield when Coinbase dies this month whatever Strike does', () => {
    const withF1 = runCyclingSim(FIXTURE_D);
    const withoutF1 = runCyclingSim({ ...FIXTURE_D, cbFutilityCheck: false });
    const capOff = runCyclingSim({ ...FIXTURE_D, strikeLtvCapPct: 0 });
    const specV1 = runCyclingSim({ ...FIXTURE_D, cbSurvivalGuard: false });
    // Coinbase dies in month 1 in EVERY arm — nothing Strike could hand over would save it.
    for (const r of [withF1, withoutF1, capOff, specV1]) expect(r.liqMonth).toBe(1);
    // With the futility check: no yield, nothing cut, and the reserve holds Strike at its cap.
    expect(withF1.firstSurvivalYieldMonth).toBeNull();
    expect(withF1.rows[1].strikeReserveCutBtc).toBe(0);
    expect(withF1.rows[1].strikeTopUpBtc).toBeGreaterThan(0);
    expect(withF1.rows[1].strikeLtv).toBeCloseTo(0.60, 9);
    // ⭐ The runnable mutation check: without it the guard yields — and the yield is futile, costing
    // Strike its cap for a Coinbase that is seized in the same month.
    expect(withoutF1.firstSurvivalYieldMonth).toBe(1);
    expect(withoutF1.rows[1].strikeReserveCutBtc).toBeGreaterThan(0);
    expect(withoutF1.rows[1].strikeLtv).toBeGreaterThan(0.60);
  });

  it('⭐ the TEST-ONLY engine inputs — both survival-guard flags, incomePath, modelStrikeLiquidation — reach no component', () => {
    const hits = execSync(
      'grep -rnE "cbSurvivalGuard|cbFutilityCheck|incomePath|modelStrikeLiquidation" src/components/ || true',
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    expect(hits, `a face passes a test-only flag:\n${hits.join('\n')}`).toEqual([]);
    // Non-vacuous: the same grep DOES reach the faces that run this engine.
    const faces = execSync(
      'grep -rlE "runCyclingSim\\(" src/components/Almanac/ --exclude-dir=__tests__ || true',
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    expect(faces).toContain('src/components/Almanac/CyclingFace.tsx');
  });
});

describe('runCyclingSim — unfunded bills (disclosure only)', () => {
  // The engine funds only what income and the Strike line can cover. When bills exceed both, nothing pays the
  // gap: no coins are sold, no debt grows for it. These fields DISCLOSE that gap — the funding and the
  // never-draw baseline are unchanged (the baseline has the same gap).
  const everyRowConsistent = (r: CyclingResult) => {
    expect(r.totalUnfundedUsd).toBeCloseTo(r.rows.reduce((s, x) => s + x.unfundedUsd, 0), 9);
    expect(r.rows[0].unfundedUsd).toBe(0);                          // month 0 is the opening position
    for (const x of r.rows) if (x.unfundedUsd > 0) expect(x.btcBoughtUsd).toBe(0);
    const first = r.rows.find((x) => x.unfundedUsd > 0);
    expect(r.firstUnfundedMonth).toBe(first ? first.m : null);
  };

  it('⭐ STOPPED branch: bills above income while the stop halts the draw — the gap is disclosed, not paid', () => {
    // $4,000 income against $6,000 bills, a 45% stop, a flat $100k: month 1 draws, the refinance lands
    // Coinbase ON the stop, interest keeps it there — so the stop holds from month 2, and every stopped month
    // leaves $2,000 of bills paid by nothing. 23 months × $2,000.
    const r = runCyclingSim({ ...REPRO, income: 4_000, expenses: 6_000, cbLtvCapPct: 45, pricePath: new Array(25).fill(100_000) });
    expect(r.firstDrawMonth).toBe(1);
    expect(r.stopMonth).toBe(2);
    expect(r.drawingResumedMonth).toBeNull();
    everyRowConsistent(r);
    for (let m = 2; m < r.rows.length; m++) expect(r.rows[m].unfundedUsd).toBe(2_000);
    expect(r.firstUnfundedMonth).toBe(2);
    expect(r.totalUnfundedUsd).toBe(46_000);
    // ⚠ FIXTURE-BOUND and PATH-DEPENDENT: on REPRO's own 4-yr path the same budget stops for ONE month (the
    // month-1 on-the-line step down), then the rising price lets the draw resume — a $2,000 gap, not $46,000.
    const onCycle = runCyclingSim({ ...REPRO, income: 4_000, expenses: 6_000, cbLtvCapPct: 45, pricePath: REPRO.pricePath.slice(0, 25) });
    everyRowConsistent(onCycle);
    expect(onCycle.totalUnfundedUsd).toBe(2_000);
    expect(onCycle.firstUnfundedMonth).toBe(1);
  });

  it('⭐ DRAWING branch: the credit line runs dry while CB LTV is still under the stop — the gap counts too', () => {
    // A $25k line with $20k already drawn: month 1 draws the last $5k, then the line is empty. CB LTV stays far
    // under an 85% stop (no refinance, no sweep), so every month is a DRAWING month with the whole $6,000 bill
    // short and only $3,000 of income to meet it — $3,000 a month paid by nothing.
    const r = runCyclingSim({
      ...REPRO, income: 3_000, expenses: 6_000, strikeCreditLine: 25_000, cbLtvCapPct: 85,
      cycleMonths: 999, coldStoreBufferPct: 0, defendCbLtv: false, pricePath: new Array(13).fill(100_000),
    });
    expect(r.stopMonth).toBeNull();                                  // never left the drawing branch
    everyRowConsistent(r);
    expect(r.rows[1].unfundedUsd).toBe(0);                           // month 1: the line funded $5k of it
    const dry = r.rows.slice(2);
    for (const x of dry) {
      expect(x.strikeDrawn).toBe(0);
      expect(x.strikeShortfall).toBe(6_000);
      expect(x.unfundedUsd).toBe(3_000);                             // shortfall − income
      expect(x.btcBoughtUsd).toBe(0);
    }
    expect(r.firstUnfundedMonth).toBe(2);
    expect(r.totalUnfundedUsd).toBe(3_000 * dry.length);
  });

  it('a default budget (income above bills) has no gap', () => {
    const r = runCyclingSim(REPRO);
    expect(r.totalUnfundedUsd).toBe(0);
    expect(r.firstUnfundedMonth).toBeNull();
    expect(r.rows.every((x) => x.unfundedUsd === 0)).toBe(true);
  });

  it('⭐ non-cycle modes disclose the gap too — but the cycle-only notice stays off (C1 covers them)', () => {
    // `hold` also funds only the surplus, so a deficit is unpaid there as well. The field is true in every
    // mode; the notice is cycle-only because deficitMode already speaks for the no-draw modes.
    const r = runCyclingSim({ ...REPRO, mode: 'hold', income: 4_000, expenses: 6_000, pricePath: REPRO.pricePath.slice(0, 25) });
    everyRowConsistent(r);
    expect(r.totalUnfundedUsd).toBeGreaterThan(0);
    expect(r.totalUnfundedUsd).toBe(2_000 * 24);
    const c = modeConstraints('hold', r.firstDrawMonth, 4_000, 6_000, r.totalUnfundedUsd);
    expect(c.cycleUnfunded).toBe(false);
    expect(c.deficitMode).toBe(true);
  });
});
