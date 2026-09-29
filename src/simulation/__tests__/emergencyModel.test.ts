import { describe, it, expect } from 'vitest';
import {
  classifyStage,
  wall3Sale,
  wall4External,
  CB_LADDER,
  type EmergencyState,
} from '../emergencyModel';
import { CB_LLTV } from '../runCoinbaseLoan';

// ── Emergency Directive fixture (§10) ─────────────────────────────────────────────────────────────────
// State at the moment of a crash: CB debt already accrued.
// ⚠ SYNTHETIC and internally consistent: round collateral, CB LTV ≈ 58% at the crash price. This repo is
// public — a fixture built from the owner's real balances publishes their position to anyone who reads the tests.
const BASE: EmergencyState = {
  cbDebt:          72_000,
  cbCollateralBtc: 2.0,
  price:           62_000,
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

  it('walls: wall3Sale / wall4External paydown math', () => {
    const targetLiq = 35_000;
    const w3 = wall3Sale(BASE, targetLiq);
    expect(w3.paydownNeeded).toBeCloseTo(BASE.cbDebt - targetLiq * BASE.cbCollateralBtc * CB_LLTV, 2);
    expect(w3.btcToSell).toBeCloseTo(w3.paydownNeeded / BASE.price, 8);

    // paying down w3.paydownNeeded lands the liq price at the target
    const w4 = wall4External(BASE, w3.paydownNeeded);
    expect(w4.liqAfter).toBeCloseTo(targetLiq, 0);
  });

  it('CB_LADDER bands are fixed 69/72/75/81', () => {
    expect(CB_LADDER).toEqual({ watch: 0.69, prepare: 0.72, execute: 0.75, lastResort: 0.81 });
  });
});

// ── The LTV through the shared `ltvOf` — debt with no collateral is ∞, never a flattering 0 ──────────────
// Synthetic: the Directive BASE with the relevant collateral removed. Before this, the site used
// `x > 0 ? a / b : 0`, so Coinbase debt with NO collateral behind it classified as 'normal'.
describe('emergencyModel — LTVs route through ltvOf', () => {
  it('⭐ no debt and no collateral stays 0 / normal — the ∞ is for UNBACKED debt only', () => {
    // Pinned first: ltvOf's "nothing at all" case is 0, not ∞, so an empty position never alarms.
    const empty: EmergencyState = { ...BASE, cbDebt: 0, cbCollateralBtc: 0 };
    const r = classifyStage(empty);
    expect(r.cbLtv).toBe(0);
    expect(r.stage).toBe('normal');
  });

  it('⭐ classifyStage: Coinbase debt with zero collateral is ∞ and liquidated, not normal', () => {
    const r = classifyStage({ ...BASE, cbCollateralBtc: 0 });
    expect(r.cbLtv).toBe(Number.POSITIVE_INFINITY);
    expect(r.stage).toBe('liquidated');
  });
});
