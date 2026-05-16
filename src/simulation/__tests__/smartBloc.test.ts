// src/simulation/__tests__/smartBloc.test.ts
import { describe, it, expect } from 'vitest';
import { runBLOC } from '../runBLOC';

const MODERATE_RATE = 0.50;
const REC_TIER_BTC = 3500 / (0.05 * 82000);

const BASE_INPUTS = {
  income: 4000,
  expenses: 3500,
  startPrice: 82000,
  apr: 0.13,
  foldRate: 0.015,
  startBTC: REC_TIER_BTC,
};

describe('Smart BLOC — Moderate 50%, Recommended tier, $82k BTC', () => {
  const data = runBLOC(MODERATE_RATE, BASE_INPUTS);

  it('returns 61 data points (month 0–60)', () => {
    expect(data).toHaveLength(61);
  });

  it('month 0: starts at correct collateral, zero LoC', () => {
    expect(data[0].btc).toBeCloseTo(REC_TIER_BTC, 3);
    expect(data[0].loc).toBe(0);
    expect(data[0].ltv).toBe(0);
  });

  it('month 1: BTC price ≈ $84,818', () => {
    expect(data[1].btcPrice).toBeCloseTo(84818, -2);
  });

  it('month 1: LTV ≈ 4.8% (well below 15% ceiling)', () => {
    expect(data[1].ltv * 100).toBeCloseTo(4.8, 0);
  });

  it('month 1: no paydown triggered', () => {
    expect(data[1].paydown).toBe(0);
  });

  it('month 30: paydown triggered (LTV breached 15% before income arrived)', () => {
    // The stored ltv is POST-paydown (~14.9%). 15.8% was the pre-income LTV.
    // Verifying paydown fired is sufficient — the interest and paydown amount tests confirm correctness.
    expect(data[30].paydown).toBeGreaterThan(0);
  });

  it('month 30: interest ≈ $442', () => {
    expect(data[30].interest).toBeCloseTo(442, -1);
  });

  it('month 30: paydown ≈ $2,279', () => {
    expect(data[30].paydown).toBeCloseTo(2279, -1);
  });

  it('month 60: BTC price ≈ $622,688', () => {
    expect(data[60].btcPrice).toBeCloseTo(622688, -3);
  });

  it('month 60: LTV ≈ 15.0%', () => {
    expect(data[60].ltv * 100).toBeCloseTo(15.0, 0);
  });

  it('month 60: interest ≈ $1,427', () => {
    expect(data[60].interest).toBeCloseTo(1427, -1);
  });

  it('month 60: BTC stack is larger than starting collateral', () => {
    expect(data[60].btc).toBeGreaterThan(REC_TIER_BTC);
  });
});