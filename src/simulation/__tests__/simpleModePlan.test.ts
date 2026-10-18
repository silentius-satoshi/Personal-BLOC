import { describe, it, expect } from 'vitest';
import { minPaymentStatus } from '../simpleModePlan';
import { runAdvisor } from '../runAdvisor';

// The old Monthly Playbook card's helpers (deriveForMonth, isOperatingMonth, composeMonthSummary) and their tests left
// with the Advisor's rows (plan of record, Run 3). What stays: Strike's minimum status, and runAdvisor's own behaviour —
// the comparison engine, kept one release (D5).

describe('Logging Consolidation §2b — minPaymentStatus', () => {
  const base = { owed: 400, dueDay: 15, todayDay: 10, isCurrent: true };
  it('roll mode always ROLLS', () => {
    expect(minPaymentStatus({ ...base, source: 'roll', paidSoFar: 0 })).toBe('ROLLS');
  });
  it('income: PAID once the logged sum covers the owed figure', () => {
    expect(minPaymentStatus({ ...base, source: 'income', paidSoFar: 400 })).toBe('PAID');
    expect(minPaymentStatus({ ...base, source: 'income', paidSoFar: 50 })).toBe('PAID');   // any payment counts
  });
  it('income: DUE before/on the due day, MISSED after (current month only)', () => {
    expect(minPaymentStatus({ ...base, source: 'income', paidSoFar: 0, todayDay: 10 })).toBe('DUE');
    expect(minPaymentStatus({ ...base, source: 'income', paidSoFar: 0, todayDay: 20 })).toBe('MISSED');
    expect(minPaymentStatus({ ...base, source: 'income', paidSoFar: 0, todayDay: 20, isCurrent: false })).toBe('DUE');   // past/future never MISSED-nag
  });
});

describe('Simple Mode Corrections — Strike minimum payment source', () => {
  const base = {
    btcPrice: 80000, income: 4000, expenses: 2000, blocApr: 12, creditLine: 100000,
    blocLtvCeiling: 0.15, cbBalance: 0, cbCollateralBtc: 1, cbAprPct: 0, cbMonthlyPayment: 0,
    cbPaymentStrategy: 'monthly' as const, cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
    startingBlocBalance: 10000, startingBtcHeld: 5, startingMonth: 1, btcGrowthRate: 0,
  };

  it('income source ends month 12 with a LOWER BLOC balance than roll (no compounding)', () => {
    const roll   = runAdvisor({ ...base, blocMinPaymentSource: 'roll' }).rows;
    const income = runAdvisor({ ...base, blocMinPaymentSource: 'income' }).rows;
    expect(income[11].blocBalance).toBeLessThan(roll[11].blocBalance);
    expect(income[0].blocMinPayment).toBeGreaterThan(0);
    expect(roll[0].blocMinPayment).toBe(0);
    expect(roll[0].blocMinShortfall).toBe(0);
  });

  it('roll mode is byte-identical to omitting the input (default roll)', () => {
    const explicit = runAdvisor({ ...base, blocMinPaymentSource: 'roll' }).rows;
    const omitted  = runAdvisor({ ...base }).rows;
    expect(omitted).toEqual(explicit);
  });

  it('shortfall path: when the minimum exceeds income, only income is paid and the rest capitalizes', () => {
    const rows = runAdvisor({
      ...base, expenses: 0, startingBlocBalance: 600000, creditLine: 600000,
      startingBtcHeld: 1, blocMinPaymentSource: 'income',
    }).rows;
    // interest = 600000 * (12/100/12) = 6000; income 4000 → pay 4000, capitalize 2000
    expect(rows[0].blocMinPayment).toBeCloseTo(4000, 0);
    expect(rows[0].blocMinShortfall).toBeCloseTo(2000, 0);
  });
});

describe('Simple Mode Corrections — mis-ordered CB thresholds guard', () => {
  const cbBase = {
    btcPrice: 80000, income: 4000, expenses: 2000, blocApr: 12, creditLine: 200000,
    blocLtvCeiling: 0.15, cbBalance: 90000, cbCollateralBtc: 1.48, cbAprPct: 5, cbMonthlyPayment: 0,
    cbPaymentStrategy: 'ltvTriggered' as const,
    startingBlocBalance: 0, startingBtcHeld: 3, startingMonth: 1, btcGrowthRate: 0,
  };

  it('ordered thresholds fire the paydown; mis-ordered suspends it (draw/interest still run)', () => {
    const ordered  = runAdvisor({ ...cbBase, cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55 }).rows;
    const misorder = runAdvisor({ ...cbBase, cbLtvTriggerPct: 75, cbLtvTargetPct: 80, cbRotateBackPct: 55 }).rows;
    // cbLtv = 90000/(1.48*80000) ≈ 0.76 > 0.75 trigger → ordered fires, mis-ordered doesn't
    expect(ordered[0].cbPaydownDraw).toBeGreaterThan(0);
    expect(ordered[0].cbLtvTriggered).toBe(true);
    expect(misorder[0].cbPaydownDraw).toBe(0);
    expect(misorder[0].cbLtvTriggered).toBe(false);
    expect(misorder[0].blocDraw).toBeGreaterThan(0);   // draw still runs
    expect(misorder[0].blocInterest).toBeGreaterThan(0);
  });
});

describe('runAdvisor — a monthly Coinbase payment', () => {
  it('a monthly CB payment lowers the advisor row LTV below the start-of-month (skipped) LTV', () => {
    // The current-month skip-aware CB LTV uses the start-of-month (no-payment) figure; paying drops it.
    const cbBalance = 60000, cbCollateralBtc = 1.48, btcPrice = 82000;
    const startLtv = cbBalance / (cbCollateralBtc * btcPrice);
    const { rows } = runAdvisor({
      btcPrice, income: 4000, expenses: 3500, blocApr: 13, creditLine: 10000, blocLtvCeiling: 0.15,
      cbBalance, cbCollateralBtc, cbAprPct: 4.77, cbMonthlyPayment: 1000,
      cbPaymentStrategy: 'monthly', cbLtvTriggerPct: 75, cbLtvTargetPct: 65, cbRotateBackPct: 55,
      startingBlocBalance: 0, startingBtcHeld: 1.0, startingMonth: 1, btcGrowthRate: 0,
    });
    expect(rows[0].cbLtv).toBeLessThan(startLtv);
  });

  it('reserves a fixed Coinbase payment from income exactly once', () => {
    const row = runAdvisor({
      btcPrice: 82_000, income: 4_000, expenses: 3_500, blocApr: 13, creditLine: 10_000,
      blocLtvCeiling: 0.15, cbBalance: 60_000, cbCollateralBtc: 1.48, cbAprPct: 5,
      cbMonthlyPayment: 1_000, cbPaymentStrategy: 'monthly', cbLtvTriggerPct: 75,
      cbLtvTargetPct: 65, cbRotateBackPct: 55, startingBlocBalance: 0, startingBtcHeld: 1,
      startingMonth: 1, btcGrowthRate: 0,
    }).rows[0];
    expect(row.cbPayment).toBe(1_000);
    expect(row.incomeToBtc).toBeCloseTo(3_000, 8);
    expect(row.cbPayment + row.incomeToBtc + row.blocMinPayment).toBeCloseTo(4_000, 8);
  });
});
