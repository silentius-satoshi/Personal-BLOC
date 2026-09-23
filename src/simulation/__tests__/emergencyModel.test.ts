import { describe, it, expect } from 'vitest';
import {
  classifyStage,
  firepower,
  drawToLtv,
  floorTable,
  direSwitch,
  wall3Sale,
  wall4External,
  surplus,
  CB_LADDER,
  type EmergencyState,
} from '../emergencyModel';
import { CB_LLTV } from '../runCoinbaseLoan';
import { BLOC_OPERATING_CEILING } from '../strikeCredit';

// ── Emergency Directive fixture (§10) — the hard completion gate (all numbers ±$1) ────────────────
// State at the moment of a crash: CB debt already accrued, Strike drawn to the 0.15 operating ceiling.
// ⚠ SYNTHETIC and internally consistent: round collateral, CB LTV ≈ 58% at the crash price, and skDrawn
// held to the documented 0.15 × skColl × price relation. This repo is public — a fixture built from the
// owner's real balances publishes their position to anyone who reads the tests.
const BASE: EmergencyState = {
  cbDebt:          72_000,
  cbCollateralBtc: 2.0,
  skCollateralBtc: 1.0,
  skDrawn:         9_300,      // = 0.15 × skColl × 62000 (Strike cured to the operating ceiling)
  price:           62_000,
  ceilingPct:      30,
};

describe('emergencyModel — directive fixtures', () => {
  it('classifyStage: CB liq price + ladder band prices', () => {
    const r = classifyStage(BASE);
    expect(r.liqPrice).toBeCloseTo(41_860.47, 0);
    expect(r.bandPrices.watch).toBeCloseTo(52_174, 0);
    expect(r.bandPrices.execute).toBeCloseTo(48_000, 0);
    expect(r.bandPrices.lastResort).toBeCloseTo(44_444, 0);
    // sanity: liq band = CB_LLTV, distance is positive while price sits above liq
    expect(r.liqPrice).toBeCloseTo(BASE.cbDebt / (BASE.cbCollateralBtc * CB_LLTV), 2);
    expect(r.distancePct).toBeGreaterThan(0);
  });

  it('firepower slow floor (price-independent cured top-up) ≈ 38940', () => {
    const fp = firepower(BASE);
    // slowBtc = (0.30 − 0.15) × skColl
    expect(fp.slowBtc).toBeCloseTo((0.30 - BLOC_OPERATING_CEILING) * BASE.skCollateralBtc, 8);
    const slowFloor = BASE.cbDebt / ((BASE.cbCollateralBtc + fp.slowBtc) * CB_LLTV);
    expect(slowFloor).toBeCloseTo(38_940, 0);
  });

  it('firepower fast floor (stuck skDrawn, crash price 48000) ≈ 39749', () => {
    const fp = firepower(BASE);
    const fastBtc = fp.fastBtc(48_000); // uses the live/stuck skDrawn = 9300
    const fastFloor = BASE.cbDebt / ((BASE.cbCollateralBtc + fastBtc) * CB_LLTV);
    expect(fastFloor).toBeCloseTo(39_749, 0);
  });

  it('floorTable: ceiling-30 slow row reproduces the slow floor', () => {
    const rows = floorTable(BASE);
    const standing = rows.find((r) => r.standing)!;
    expect(standing.floor).toBeCloseTo(41_860.47, 0);
    const row30 = rows.find((r) => !r.standing && r.ceilingPct === 30)!;
    expect(row30.floor).toBeCloseTo(38_940, 0);
    expect(row30.deltaVsStanding).toBeCloseTo(standing.floor - row30.floor, 6);
    // strike survives 1 − 0.30/0.70 further
    expect(row30.strikeSurvivesFurtherPct).toBeCloseTo(1 - 0.30 / 0.70, 6);
  });

  it('drawToLtv(30) @48000 slow drawUsd ≈ 7200', () => {
    // slow/cured assumption: Strike drawn is first paid down to 0.15 at the crash price.
    const slowState: EmergencyState = {
      ...BASE,
      price: 48_000,
      skDrawn: BLOC_OPERATING_CEILING * BASE.skCollateralBtc * 48_000,
    };
    const r = drawToLtv(slowState, 30);
    expect(r.drawUsd).toBeCloseTo(7_200, 0);
    expect(r.capped).toBe(false);
    // drawing to 30% Strike LTV lands newSkLtv at exactly 0.30
    expect(r.newSkLtv).toBeCloseTo(0.30, 6);
  });

  it('drawToLtv clamps to the 50% Strike line (capped)', () => {
    // target above the 50% cap → clamped, capped flag set
    const r = drawToLtv(BASE, 80);
    expect(r.capped).toBe(true);
    expect(r.drawUsd).toBeCloseTo(r.availableCredit, 6);
  });

  it('walls: direSwitch / wall3Sale / wall4External paydown math', () => {
    const targetLiq = 35_000;
    const w3 = wall3Sale(BASE, targetLiq);
    expect(w3.paydownNeeded).toBeCloseTo(BASE.cbDebt - targetLiq * BASE.cbCollateralBtc * CB_LLTV, 2);
    expect(w3.btcToSell).toBeCloseTo(w3.paydownNeeded / BASE.price, 8);

    // paying down w3.paydownNeeded lands the liq price at the target
    const ds = direSwitch(BASE, w3.paydownNeeded);
    expect(ds.liqAfter).toBeCloseTo(targetLiq, 0);
    const w4 = wall4External(BASE, w3.paydownNeeded);
    expect(w4.liqAfter).toBeCloseTo(targetLiq, 0);
  });

  it('surplus = income − expenses − ceiling interest', () => {
    expect(surplus(8_000, 4_000, 9_300, 13)).toBeCloseTo(8_000 - 4_000 - (9_300 * 13) / 100 / 12, 6);
  });

  it('CB_LADDER bands are fixed 69/72/75/81', () => {
    expect(CB_LADDER).toEqual({ watch: 0.69, prepare: 0.72, execute: 0.75, lastResort: 0.81 });
  });
});

// ── LTVs through the shared `ltvOf` — debt with no collateral is ∞, never a flattering 0 ──────────────
// Synthetic: the Directive BASE with the relevant collateral removed. Before this, all three sites used
// `x > 0 ? a / b : 0`, so Coinbase debt with NO collateral behind it classified as 'normal'.
describe('emergencyModel — LTVs route through ltvOf', () => {
  it('⭐ no debt and no collateral stays 0 / normal — the ∞ is for UNBACKED debt only', () => {
    // Pinned first: ltvOf's "nothing at all" case is 0, not ∞, so an empty position never alarms.
    const empty: EmergencyState = { ...BASE, cbDebt: 0, cbCollateralBtc: 0, skDrawn: 0, skCollateralBtc: 0 };
    const r = classifyStage(empty);
    expect(r.cbLtv).toBe(0);
    expect(r.stage).toBe('normal');
    expect(drawToLtv(empty, 30).newSkLtv).toBe(0);
    expect(floorTable(empty)[0].strikeSurvivesFurtherPct).toBe(1);
  });

  it('⭐ classifyStage: Coinbase debt with zero collateral is ∞ and liquidated, not normal', () => {
    const r = classifyStage({ ...BASE, cbCollateralBtc: 0 });
    expect(r.cbLtv).toBe(Number.POSITIVE_INFINITY);
    expect(r.stage).toBe('liquidated');
  });

  it('⭐ drawToLtv: a Strike balance with zero collateral reports newSkLtv ∞', () => {
    const r = drawToLtv({ ...BASE, skCollateralBtc: 0 }, 30);
    expect(r.drawUsd).toBe(0);                          // no capacity without collateral
    expect(r.newSkLtv).toBe(Number.POSITIVE_INFINITY);
  });

  it('⭐ floorTable: the standing row survives no further drop when Strike debt has no collateral', () => {
    const standing = floorTable({ ...BASE, skCollateralBtc: 0 }).find((r) => r.standing)!;
    expect(standing.strikeSurvivesFurtherPct).toBe(0);
  });
});
