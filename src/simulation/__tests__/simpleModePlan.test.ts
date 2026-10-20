import { describe, it, expect } from 'vitest';
import { minPaymentStatus } from '../simpleModePlan';

// The old Monthly Playbook card's helpers (deriveForMonth, isOperatingMonth, composeMonthSummary) and their tests left
// with the Advisor's rows (plan of record, Run 3), and runAdvisor's own behaviour tests left with the engine in 5e (D5-A).
// What stays: Strike's minimum status.

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
