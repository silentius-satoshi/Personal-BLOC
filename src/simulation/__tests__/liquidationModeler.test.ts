import { describe, it, expect } from 'vitest';
import { computeLiquidationAnalysis, CB_LIF, CB_LLTV } from '../runCoinbaseLoan';

const BASE = { loanBalance: 60000, collateralBtc: 1.48, btcPrice: 100000, liquidationPrice: 47000 };

describe('computeLiquidationAnalysis', () => {
  it('liquidationPrice < btcPrice → isAlreadyLiquidatable false, effectivePrice = liquidationPrice', () => {
    const r = computeLiquidationAnalysis(BASE.loanBalance, BASE.collateralBtc, BASE.btcPrice, BASE.liquidationPrice);
    expect(r.isAlreadyLiquidatable).toBe(false);
    expect(r.effectivePrice).toBe(47000);
  });

  it('liquidationPrice >= btcPrice → isAlreadyLiquidatable true, effectivePrice = btcPrice', () => {
    const r = computeLiquidationAnalysis(60000, 1.48, 45000, 47000);
    expect(r.isAlreadyLiquidatable).toBe(true);
    expect(r.effectivePrice).toBe(45000);
  });

  it('equity matches collateral×effectivePrice − loanBalance', () => {
    const r = computeLiquidationAnalysis(BASE.loanBalance, BASE.collateralBtc, BASE.btcPrice, BASE.liquidationPrice);
    expect(r.equity).toBeCloseTo(1.48 * 47000 - 60000, 0);
  });

  it('100% scenario lifBonus = debtRepaid × (CB_LIF − 1)', () => {
    const r = computeLiquidationAnalysis(BASE.loanBalance, BASE.collateralBtc, BASE.btcPrice, BASE.liquidationPrice);
    const full = r.scenarios[3];
    expect(full.repayPct).toBe(1.0);
    expect(full.lifBonus).toBeCloseTo(60000 * (CB_LIF - 1), 4);
  });

  it('100% scenario remainingCollateralBtc = collateralBtc − (debtRepaid×CB_LIF / effectivePrice)', () => {
    const r = computeLiquidationAnalysis(BASE.loanBalance, BASE.collateralBtc, BASE.btcPrice, BASE.liquidationPrice);
    const full = r.scenarios[3];
    const expected = BASE.collateralBtc - (60000 * CB_LIF / 47000);
    expect(full.remainingCollateralBtc).toBeCloseTo(expected, 6);
  });

  it('CB_LLTV is 0.86 and CB_LIF matches formula', () => {
    expect(CB_LLTV).toBe(0.86);
    expect(CB_LIF).toBeCloseTo(1 / (0.3 * 0.86 + 0.7), 10);
  });
});
