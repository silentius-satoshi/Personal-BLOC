import { describe, it, expect } from 'vitest';
import { runAdvisor, type AdvisorInputs } from '../runAdvisor';

const BASE: AdvisorInputs = {
  btcPrice:       100_000,
  income:         4_000,
  expenses:       3_500,
  blocApr:        13,
  creditLine:     20_000,
  blocLtvCeiling: 0.15,
  cbBalance:      60_000,
  cbCollateralBtc: 1.48,
  cbAprPct:       4.77,
  cbMonthlyPayment: 0,
  cbPaymentStrategy: 'monthly',
  cbLtvTriggerPct: 75,
  cbLtvTargetPct:  65,
  cbRotateBackPct: 55,
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

describe('ltvTriggered — credit cap', () => {
  // 1 BTC collateral, btcPrice = 100_000, cbBalance = 80_000 → LTV = 80% (above 75% trigger)
  // After 1 month interest at 4.77%/12 ≈ +$318, cbBal ≈ 80_318
  // targetBal = 1.0 * 100_000 * 0.65 = 65_000
  // desiredPaydown ≈ 80_318 - 65_000 ≈ 15_318
  const TRIGGER_BASE: AdvisorInputs = {
    ...BASE,
    cbPaymentStrategy:   'ltvTriggered',
    cbBalance:           80_000,
    cbCollateralBtc:     1.0,
    cbLtvTriggerPct:     75,
    cbLtvTargetPct:      65,
    startingBlocBalance: 0,
  };

  it('a) capped: desiredPaydown exceeds availableCredit', () => {
    const { rows } = runAdvisor({ ...TRIGGER_BASE, creditLine: 10_000 });
    const m1 = rows[0];
    expect(m1.cbLtvTriggered).toBe(true);
    expect(m1.cbPaydownDraw).toBe(10_000);   // capped at creditLine
    expect(m1.cbPaydownCapped).toBe(true);
    expect(m1.cbPaydownShortfall).toBeGreaterThan(0);
  });

  it('b) not capped: desiredPaydown within availableCredit', () => {
    const { rows } = runAdvisor({ ...TRIGGER_BASE, creditLine: 50_000 });
    const m1 = rows[0];
    expect(m1.cbLtvTriggered).toBe(true);
    expect(m1.cbPaydownDraw).toBeGreaterThan(0);
    expect(m1.cbPaydownDraw).toBeLessThan(50_000);
    expect(m1.cbPaydownCapped).toBe(false);
    expect(m1.cbPaydownShortfall).toBe(0);
  });

  it('c) below trigger: all cap fields zero/false', () => {
    // BASE: cbBalance = 60_000, cbCollateralBtc = 1.48 → LTV ≈ 40.5%, below 75%
    const { rows } = runAdvisor({ ...BASE, cbPaymentStrategy: 'ltvTriggered' });
    const m1 = rows[0];
    expect(m1.cbPaydownDraw).toBe(0);
    expect(m1.cbPaydownCapped).toBe(false);
    expect(m1.cbPaydownShortfall).toBe(0);
  });
});

describe('reverse rotation (rotate-back band: trigger 75 / target 65 / rotate-back 55)', () => {
  // cbCollateralBtc = 1.0, btcPrice = 100_000 → LTV = cbBalance / 100_000 (before interest).
  // Reverse rotation fires only when CB LTV ≤ rotate-back (55%); it FILLS the CB loan up to
  // target (65%), capped at the available Strike balance. The neutral zone 55–75 fires nothing.
  const REV_BASE: AdvisorInputs = {
    ...BASE,
    cbPaymentStrategy: 'ltvTriggered',
    cbCollateralBtc:   1.0,
    cbLtvTriggerPct:   75,
    cbLtvTargetPct:    65,
    cbRotateBackPct:   55,
  };

  it('1) fires only below rotate-back — bounded by Strike balance', () => {
    // cbBalance 50_000 → LTV ≈ 50.2% after interest, ≤ 55% rotate-back; Strike has 5_000
    const { rows } = runAdvisor({ ...REV_BASE, cbBalance: 50_000, startingBlocBalance: 5_000 });
    const m1 = rows[0];
    expect(m1.strikeRepayFired).toBe(true);
    expect(m1.strikeRepayDraw).toBeGreaterThan(0);
    expect(m1.strikeRepayDraw).toBeCloseTo(5_000, 0);  // bounded by Strike balance
    expect(m1.cbPaydownDraw).toBe(0);                   // forward trigger did NOT fire
    expect(m1.cbLtvTriggered).toBe(false);
  });

  it('2) neutral zone — NO fire between rotate-back and trigger (the anti-oscillation property)', () => {
    // cbBalance 60_000 → LTV ≈ 60.2% after interest; strictly between 55% rotate-back and 75% trigger
    const { rows } = runAdvisor({ ...REV_BASE, cbBalance: 60_000, startingBlocBalance: 10_000 });
    const m1 = rows[0];
    expect(m1.strikeRepayFired).toBe(false);
    expect(m1.cbLtvTriggered).toBe(false);
  });

  it('3) capped at Strike balance (large CB headroom, small Strike)', () => {
    // cbBalance 40_000 → LTV ≈ 40% ≤ 55%; headroom to 65% target ≈ 24_800 ≫ Strike 3_000
    const startingStrikeBalance = 3_000;
    const { rows } = runAdvisor({ ...REV_BASE, cbBalance: 40_000, startingBlocBalance: startingStrikeBalance });
    const m1 = rows[0];
    expect(m1.strikeRepayFired).toBe(true);
    expect(m1.strikeRepayDraw).toBeCloseTo(startingStrikeBalance, 0);
  });

  it('4) capped at CB headroom — fills UP TO target (not to rotate-back, not beyond)', () => {
    // cbBalance 50_000 (LTV ≈ 50.2%), large Strike → rotation fills CB to 65% target
    const { rows } = runAdvisor({ ...REV_BASE, cbBalance: 50_000, startingBlocBalance: 100_000 });
    const m1 = rows[0];
    expect(m1.strikeRepayFired).toBe(true);
    // post-rotation CB balance ≈ target LTV × collateral value = 0.65 × 100_000 = 65_000
    expect(m1.cbBalance).toBeCloseTo(65_000, -2);  // within $100
    expect(m1.cbLtv).toBeCloseTo(0.65, 2);
    // did not over-repay: drew less than the full Strike balance
    expect(m1.strikeRepayDraw).toBeLessThan(100_000);
  });

  it('5) does not fire when Strike balance is zero', () => {
    const { rows } = runAdvisor({ ...REV_BASE, cbBalance: 50_000, startingBlocBalance: 0 });
    expect(rows[0].strikeRepayFired).toBe(false);
    expect(rows[0].strikeRepayDraw).toBe(0);
  });

  it('6) debt-neutral at fire — CB gains exactly what Strike loses (no debt created)', () => {
    // CB interest accrues on the opening balance (independent of rotation), so the CB end balance
    // in the firing run exceeds the no-rotation control by EXACTLY the drawn amount.
    const fire    = runAdvisor({ ...REV_BASE, cbBalance: 50_000, startingBlocBalance: 8_000 }).rows[0];
    const control = runAdvisor({ ...REV_BASE, cbBalance: 50_000, startingBlocBalance: 0 }).rows[0];
    expect(fire.strikeRepayFired).toBe(true);
    expect(control.strikeRepayFired).toBe(false);
    expect(fire.cbBalance - control.cbBalance).toBeCloseTo(fire.strikeRepayDraw, 0);
  });

  it('7) no oscillation under growth — does NOT fire every month (regression for the reported bug)', () => {
    // Properly-spread band 75/65/55 under +50%/yr BTC growth: month 1 fires (LTV ≤ 55%), fills to
    // 65% target, then the loan sits in the neutral zone and growth only pulls LTV down slowly.
    const { rows } = runAdvisor({
      ...REV_BASE,
      cbBalance:           50_000,   // LTV ≈ 50% → month 1 rotates
      startingBlocBalance: 100_000,  // ample Strike balance to rotate every month if mis-gated
      creditLine:          200_000,
      btcGrowthRate:       0.5,
    });
    const fireMonths = rows.filter((r) => r.strikeRepayFired).length;
    expect(fireMonths).toBeLessThanOrEqual(2);          // NOT a wall of rotations
    expect(rows[1].strikeRepayFired).toBe(false);        // month after the first fire sits in neutral
  });

  it('8) monthly mode never rotates', () => {
    const { rows } = runAdvisor({ ...REV_BASE, cbPaymentStrategy: 'monthly', cbBalance: 50_000, startingBlocBalance: 8_000 });
    for (const r of rows) {
      expect(r.strikeRepayDraw).toBe(0);
      expect(r.strikeRepayFired).toBe(false);
    }
  });
});
