import { describe, it, expect } from 'vitest';
import { deriveForMonth, isOperatingMonth, composeMonthSummary, minPaymentStatus, type MonthSummaryArgs } from '../simpleModePlan';
import { runAdvisor, type AdvisorMonthRow } from '../runAdvisor';

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

function makeRow(month: number, o: Partial<AdvisorMonthRow> = {}): AdvisorMonthRow {
  return {
    month, tier: 4, tierLabel: 'Safe', isCurrentMonth: false,
    blocDraw: 3500, fiatGap: 0, cbPayment: 0, cbExtraPayment: 0,
    cbPaydownDraw: 0, cbLtvTriggered: false, cbPaydownCapped: false, cbPaydownShortfall: 0,
    strikeRepayDraw: 0, strikeRepayFired: false,
    blocMinPayment: 0, blocMinShortfall: 0,
    btcBought: 0.05, incomeToBtc: 4000, blocBalance: 10000, blocLtv: 0.12,
    cbBalance: 0, cbLtv: 0, btcHeld: 1.0, blocInterest: 108, cbInterest: 0, totalInterest: 108,
    ...o,
  };
}

function summaryArgs(o: Partial<MonthSummaryArgs> = {}): MonthSummaryArgs {
  return {
    month: 3, isLogged: false, hasCbLoan: false,
    cbLtv: 0, triggerPct: 75, draw: 3500, btcBoughtUsd: 4000, cbPayment: 0,
    rotationFired: false, rotationAmount: 0, interest: 108, minPayment: 0,
    ...o,
  };
}

describe('deriveForMonth — unskipped projection', () => {
  it('maps a row to plain projected amounts (no CB loan)', () => {
    const p = deriveForMonth(makeRow(1, { incomeToBtc: 4000, blocDraw: 3500, blocInterest: 108 }), 4000, false, 'monthly');
    expect(p.blocDraw).toBe(3500);
    expect(p.btcBoughtUsd).toBe(4000);
    expect(p.cbPayment).toBe(0);
    expect(p.cbLtv).toBe(0);            // !hasCbLoan zeros CB
    expect(p.blocInterest).toBe(108);
    expect(p.paydown).toBe(0);          // income - 0 - 4000
    expect(p.allocatedFromIncome).toBe(4000);
    expect(p.isFullyAllocated).toBe(true);
  });

  it('counts the monthly CB payment in monthly mode', () => {
    const p = deriveForMonth(makeRow(1, { cbPayment: 500, incomeToBtc: 3500, cbLtv: 0.6 }), 4000, true, 'monthly');
    expect(p.cbPayment).toBe(500);
    expect(p.btcBoughtUsd).toBe(3500);
    expect(p.paydown).toBe(0);          // 4000 - 500 - 3500
    expect(p.allocatedFromIncome).toBe(4000);
    expect(p.cbLtv).toBe(0.6);
  });

  it('does NOT count CB payment as a monthly line in ltvTriggered mode', () => {
    const p = deriveForMonth(makeRow(1, { cbPayment: 0, incomeToBtc: 4000, cbLtv: 0.7 }), 4000, true, 'ltvTriggered');
    expect(p.cbPayment).toBe(0);        // event-driven, not an income line
    expect(p.cbLtv).toBe(0.7);
  });

  it('two different rows produce different values (bars track the scrubbed month)', () => {
    const a = deriveForMonth(makeRow(1, { blocLtv: 0.12, blocInterest: 90 }), 4000, false, 'monthly');
    const b = deriveForMonth(makeRow(8, { blocLtv: 0.30, blocInterest: 240 }), 4000, false, 'monthly');
    expect(a.blocLtv).not.toBe(b.blocLtv);
    expect(a.blocInterest).not.toBe(b.blocInterest);
  });
});

describe('isOperatingMonth', () => {
  it('is true only when selected === current', () => {
    expect(isOperatingMonth(3, 3)).toBe(true);
    expect(isOperatingMonth(2, 3)).toBe(false);
    expect(isOperatingMonth(4, 3)).toBe(false);
  });
});

describe('composeMonthSummary', () => {
  it('omits the CB clause and the LTV lead when there is no CB loan', () => {
    const s = composeMonthSummary(summaryArgs({ hasCbLoan: false }));
    expect(s).toContain('Month 3:');
    expect(s).not.toContain('CB LTV');
    expect(s).not.toContain('Coinbase');
  });

  it('non-logged month uses plan voice (Draw / Buy)', () => {
    const s = composeMonthSummary(summaryArgs({ isLogged: false, draw: 3500, btcBoughtUsd: 4000 }));
    expect(s).toContain('Draw $3,500');
    expect(s).toContain('Buy $4,000 of Bitcoin');
  });

  it('rotation fired → rotation clause, not a paydown clause', () => {
    const s = composeMonthSummary(summaryArgs({ hasCbLoan: true, cbLtv: 0.6, rotationFired: true, rotationAmount: 2000, cbPayment: 500 }));
    expect(s).toContain('Rotate $2,000');
    expect(s).not.toContain('Pay $500 to your Coinbase loan');
  });

  it('logged month narrates past-tense actuals', () => {
    const s = composeMonthSummary(summaryArgs({ isLogged: true, hasCbLoan: true, cbLtv: 0.55, draw: 3500, btcBoughtUsd: 4000, cbPayment: 500 }));
    expect(s).toContain('CB LTV was');
    expect(s).toContain('You drew $3,500');
    expect(s).toContain('Bought $4,000');
    expect(s).toContain('Paid $500');
  });

  it('Logging Consolidation §3 — the current month uses plan voice (no skip-adjusted narration)', () => {
    // Skip args are retired; the current month narrates exactly like any projected month.
    const s = composeMonthSummary(summaryArgs({ draw: 3500, btcBoughtUsd: 4000 }));
    expect(s).toContain('Draw $3,500 from your credit line');
    expect(s).toContain('Buy $4,000 of Bitcoin');
    expect(s).not.toContain('skipped');
  });

  it('income minimum narration vs roll capitalization', () => {
    const income = composeMonthSummary(summaryArgs({ minPayment: 108, interest: 108 }));
    expect(income).toContain('Strike minimum from income');
    expect(income).not.toContain('capitalizes');
    const roll = composeMonthSummary(summaryArgs({ minPayment: 0, interest: 108 }));
    expect(roll).toContain('capitalizes onto the balance');
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

  it('deriveForMonth folds minPayment into the allocation identity (sums to income)', () => {
    const p = deriveForMonth(makeRow(1, { blocMinPayment: 108, incomeToBtc: 3892 }), 4000, false, 'monthly');
    expect(p.minPayment).toBe(108);
    expect(p.paydown).toBe(0);
    expect(p.allocatedFromIncome).toBe(4000);
    expect(p.isFullyAllocated).toBe(true);
  });

  it('narration: income source says "Strike minimum from income", not "capitalizes"', () => {
    const income = composeMonthSummary(summaryArgs({ minPayment: 108, interest: 108 }));
    expect(income).toContain('Strike minimum from income');
    expect(income).not.toContain('capitalizes');
    const roll = composeMonthSummary(summaryArgs({ minPayment: 0, interest: 108 }));
    expect(roll).toContain('capitalizes onto the balance');
    expect(roll).not.toContain('Strike minimum');
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

describe('projection-vs-reality split (the headline guarantee)', () => {
  it('deriveForMonth carries NO skip parameters — its output is skip-independent by construction', () => {
    // Same row + income → identical projection no matter what skip state the caller holds.
    const row = makeRow(5, { incomeToBtc: 4000 });
    const a = deriveForMonth(row, 4000, false, 'monthly');
    const b = deriveForMonth(row, 4000, false, 'monthly');
    expect(a).toEqual(b);
    expect(a.isFullyAllocated).toBe(true);   // a clean forward projection is always fully allocated
  });

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
});
