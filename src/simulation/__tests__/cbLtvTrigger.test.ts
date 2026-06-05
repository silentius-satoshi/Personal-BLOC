import { describe, it, expect } from 'vitest';
import { runAdvisor, type AdvisorInputs } from '../runAdvisor';

const BASE: AdvisorInputs = {
  btcPrice:       100_000,
  income:         4_000,
  expenses:       3_500,
  blocApr:        13,
  creditLine:     20_000,
  collateralBtc:  1.0,
  blocLtvCeiling: 0.15,
  cbBalance:      60_000,
  cbCollateralBtc: 1.48,
  cbAprPct:       4.77,
  cbMonthlyPayment: 0,
  cbPaymentStrategy: 'monthly',
  cbLtvTriggerPct: 75,
  cbLtvTargetPct:  65,
  startingBlocBalance: 0,
  startingBtcHeld: 1.0,
  startingMonth:   1,
  btcGrowthRate:   0,
};

describe('monthly mode backward compatibility', () => {
  it('cbPaydownDraw is 0 and cbLtvTriggered is false on every row', () => {
    const { rows } = runAdvisor({ ...BASE, cbPaymentStrategy: 'monthly' });
    for (const row of rows) {
      expect(row.cbPaydownDraw).toBe(0);
      expect(row.cbLtvTriggered).toBe(false);
    }
  });
});

describe('ltvTriggered mode', () => {
  it('no trigger when CB LTV is safely below threshold', () => {
    // CB LTV = 60_000 / (1.48 * 100_000) = 40.5% — well below 75% trigger
    const { rows } = runAdvisor({ ...BASE, cbPaymentStrategy: 'ltvTriggered' });
    const month1 = rows[0];
    expect(month1.cbLtvTriggered).toBe(false);
    expect(month1.cbPaydownDraw).toBe(0);
  });

  it('trigger fires when CB LTV is at or above threshold', () => {
    // CB LTV = 60_000 / (1.0 * 100_000) = 60% — below 75%; raise cbBalance so LTV > 75%
    // Use 1 BTC collateral and cbBalance = 80_000 → LTV = 80%
    const { rows } = runAdvisor({
      ...BASE,
      cbPaymentStrategy: 'ltvTriggered',
      cbBalance:      80_000,
      cbCollateralBtc: 1.0,
      cbLtvTriggerPct: 75,
      cbLtvTargetPct:  65,
    });
    const month1 = rows[0];
    expect(month1.cbLtvTriggered).toBe(true);
    expect(month1.cbPaydownDraw).toBeGreaterThan(0);
  });

  it('post-paydown CB balance is at or near target LTV × collateral value', () => {
    const { rows } = runAdvisor({
      ...BASE,
      cbPaymentStrategy: 'ltvTriggered',
      cbBalance:      80_000,
      cbCollateralBtc: 1.0,
      cbLtvTriggerPct: 75,
      cbLtvTargetPct:  65,
    });
    const month1 = rows[0];
    expect(month1.cbLtvTriggered).toBe(true);
    // After paydown, CB LTV should be at or near 65%
    const expectedCbBal = 1.0 * BASE.btcPrice * (65 / 100);  // 65_000
    // cbBalance in row is after interest + paydown
    expect(month1.cbBalance).toBeCloseTo(expectedCbBal, -2);  // within $100
  });

  it('blocBalance increases by cbPaydownDraw in trigger month', () => {
    const { rows } = runAdvisor({
      ...BASE,
      cbPaymentStrategy: 'ltvTriggered',
      cbBalance:      80_000,
      cbCollateralBtc: 1.0,
      cbLtvTriggerPct: 75,
    });
    const month1 = rows[0];
    expect(month1.cbLtvTriggered).toBe(true);
    // blocBalance must be ≥ cbPaydownDraw (it starts at 0, gets the paydown draw + expense draw)
    expect(month1.blocBalance).toBeGreaterThanOrEqual(month1.cbPaydownDraw);
  });

  it('no CB payment from income in ltvTriggered mode', () => {
    const { rows } = runAdvisor({
      ...BASE,
      cbPaymentStrategy: 'ltvTriggered',
      cbMonthlyPayment: 500,  // would be paid in monthly mode but not here
    });
    for (const row of rows) {
      expect(row.cbPayment).toBe(0);
    }
  });
});
