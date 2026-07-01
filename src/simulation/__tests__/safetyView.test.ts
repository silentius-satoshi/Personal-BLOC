import { describe, it, expect } from 'vitest';
import {
  deriveSafetyView,
  deriveViewerOverall,
  selectSafetyViewInputs,
  CREDIT_WARN_USED,
  CREDIT_ACT_USED,
  type SafetyViewInputs,
} from '../safetyView';
import { cbMetrics, accruedCbBalance } from '../cbMetrics';
import { CB_LLTV } from '../runCoinbaseLoan';
import type { StoreState } from '../../store/useStore';

// Base: no CB loan, healthy Strike. strikeLiquidationLtvPct 85 → warn 0.646, act 0.697.
// asOf null keeps CB accrual deterministic (no Date.now dependence).
const base: SafetyViewInputs = {
  advisorActualBlocBalance: 0,
  creditLine: 10_000,
  currentBtcHeld: 1,
  btcPrice: 100_000,
  strikeLiquidationLtvPct: 85,
  hasCbLoan: false,
  cbLoanBalance: 0,
  cbAprPct: 5,
  cbLoanBalanceAsOf: null,
  cbCollateralBtc: 0,
  cbLtvTriggerPct: 75,
  cbLiquidationPrice: 0,
};

describe('deriveSafetyView — credit (capacity) bands', () => {
  it('green below 75% used', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 7_000 });
    expect(v.capacityUsed).toBeCloseTo(0.7);
    expect(v.creditLevel).toBe('safe');
  });
  it('amber at 75-90% used', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 8_000 });
    expect(v.creditLevel).toBe('watch');
  });
  it('red at/above 90% used', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 9_500 });
    expect(v.creditLevel).toBe('act');
  });
  it('exactly at the band edges classifies up', () => {
    expect(deriveSafetyView({ ...base, advisorActualBlocBalance: CREDIT_WARN_USED * 10_000 }).creditLevel).toBe('watch');
    expect(deriveSafetyView({ ...base, advisorActualBlocBalance: CREDIT_ACT_USED * 10_000 }).creditLevel).toBe('act');
  });
  it('creditLine 0 → capacityUsed 0, safe (guard)', () => {
    const v = deriveSafetyView({ ...base, creditLine: 0, advisorActualBlocBalance: 5_000 });
    expect(v.capacityUsed).toBe(0);
    expect(v.creditLevel).toBe('safe');
  });
});

describe('deriveSafetyView — Strike LTV bands (warn 0.646 / act 0.697 at 85% liq)', () => {
  it('safe', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 50_000 }); // 50000/100000 = 0.5
    expect(v.strikeLtv).toBeCloseTo(0.5);
    expect(v.strikeLevel).toBe('safe');
  });
  it('watch', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 66_000 }); // 0.66
    expect(v.strikeLevel).toBe('watch');
  });
  it('act', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 71_000 }); // 0.71
    expect(v.strikeLevel).toBe('act');
  });
  it('crashLtv = LTV at 20% of price (80% drop)', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 10_000 }); // 10000/(1*20000) = 0.5
    expect(v.crashLtv).toBeCloseTo(0.5);
  });
  it('zero collateral value → LTV 0 (guard)', () => {
    const v = deriveSafetyView({ ...base, currentBtcHeld: 0, advisorActualBlocBalance: 10_000 });
    expect(v.strikeLtv).toBe(0);
  });
});

describe('deriveSafetyView — Coinbase LTV gating', () => {
  it('no CB loan → cbLtv 0, cbLevel safe', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: false, cbLoanBalance: 999_999, cbCollateralBtc: 1 });
    expect(v.cbLtv).toBe(0);
    expect(v.cbLevel).toBe('safe');
  });
  it('CB loan, collateral 2 @ 100k: 0.5 → safe', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 100_000 });
    expect(v.cbLtv).toBeCloseTo(0.5);
    expect(v.cbLevel).toBe('safe');
  });
  it('0.76 → watch (>= trigger 0.75, < act ~0.80)', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 152_000 });
    expect(v.cbLtv).toBeCloseTo(0.76);
    expect(v.cbLevel).toBe('watch');
  });
  it('0.85 → act', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 170_000 });
    expect(v.cbLevel).toBe('act');
  });
  it('cbCollateralBtc 0 → cbLtv 0 (guard, no divide-by-zero)', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 0, cbLoanBalance: 100_000 });
    expect(v.cbLtv).toBe(0);
    expect(v.cbLevel).toBe('safe');
  });
});

describe('deriveSafetyView — CB display intermediates (accruedBalance / cbLiqPrice / cbLiqFrac)', () => {
  it('!hasCbLoan → defaults (0 / 0 / CB_LLTV)', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: false, cbCollateralBtc: 2, cbLoanBalance: 100_000 });
    expect(v.accruedBalance).toBe(0);
    expect(v.cbLiqPrice).toBe(0);
    expect(v.cbLiqFrac).toBe(CB_LLTV);
  });
  it('hasCbLoan, no entered liq price → accruedBalance = accruedCbBalance, cbLiqPrice = m.liqPrice, cbLiqFrac = CB_LLTV', () => {
    const cbInputs = { ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 100_000, cbAprPct: 5, cbLoanBalanceAsOf: null, cbLiquidationPrice: 0 };
    const v = deriveSafetyView(cbInputs);
    const accrued = accruedCbBalance(cbInputs.cbLoanBalance, cbInputs.cbAprPct, cbInputs.cbLoanBalanceAsOf);
    const m = cbMetrics(accrued, cbInputs.cbCollateralBtc, cbInputs.btcPrice, cbInputs.cbLtvTriggerPct);
    expect(v.accruedBalance).toBeCloseTo(accrued);        // asOf null → unchanged 100_000
    expect(v.cbLiqPrice).toBeCloseTo(m.liqPrice);         // computed fallback
    expect(v.cbLiqFrac).toBeCloseTo(CB_LLTV);             // no-entered-price case resolves to exactly CB_LLTV
  });
  it('hasCbLoan, entered liq price wins and moves cbLiqFrac', () => {
    const v = deriveSafetyView({ ...base, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 100_000, cbLoanBalanceAsOf: null, cbLiquidationPrice: 50_000 });
    expect(v.cbLiqPrice).toBe(50_000);
    expect(v.cbLiqFrac).toBeCloseTo(100_000 / (2 * 50_000)); // 1.0 — authoritative price drives the denominator
  });
});

describe('selectSafetyViewInputs — the single store→inputs mapping', () => {
  it('maps the 12 store fields (getCurrentBtcHeld invoked)', () => {
    const fake = {
      advisorActualBlocBalance: 5_000,
      creditLine: 10_000,
      getCurrentBtcHeld: () => 1.5,
      btcPrice: 100_000,
      strikeLiquidationLtvPct: 85,
      hasCbLoan: true,
      cbLoanBalance: 60_000,
      cbAprPct: 4.77,
      cbLoanBalanceAsOf: '2026-01-01',
      cbCollateralBtc: 1.48,
      cbLtvTriggerPct: 75,
      cbLiquidationPrice: 42_000,
    } as unknown as StoreState;
    expect(selectSafetyViewInputs(fake)).toEqual({
      advisorActualBlocBalance: 5_000,
      creditLine: 10_000,
      currentBtcHeld: 1.5,
      btcPrice: 100_000,
      strikeLiquidationLtvPct: 85,
      hasCbLoan: true,
      cbLoanBalance: 60_000,
      cbAprPct: 4.77,
      cbLoanBalanceAsOf: '2026-01-01',
      cbCollateralBtc: 1.48,
      cbLtvTriggerPct: 75,
      cbLiquidationPrice: 42_000,
    });
  });
});

describe('deriveViewerOverall — worst of the gauges shown (credit included)', () => {
  it('all safe → safe', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 5_000 });
    expect(deriveViewerOverall(v, false)).toBe('safe');
  });
  it('red credit alone drives overall to act (credit IS included)', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 9_800 }); // 0.98 used → act credit, safe strike
    expect(v.creditLevel).toBe('act');
    expect(v.strikeLevel).toBe('safe');
    expect(deriveViewerOverall(v, false)).toBe('act');
  });
  it('CB level ignored when !hasCbLoan even if cb inputs present', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 5_000, cbCollateralBtc: 2, cbLoanBalance: 170_000 });
    expect(deriveViewerOverall(v, false)).toBe('safe');
  });
  it('CB act folds into overall when hasCbLoan', () => {
    const v = deriveSafetyView({ ...base, advisorActualBlocBalance: 5_000, hasCbLoan: true, cbCollateralBtc: 2, cbLoanBalance: 170_000 });
    expect(deriveViewerOverall(v, true)).toBe('act');
  });
});
