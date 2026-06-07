import { describe, it, expect } from 'vitest';
import { runCoinbaseLoan } from '../runCoinbaseLoan';
import { runBlocYearOne } from '../runBlocYearOne';

describe('APR unit convention anchors', () => {
  it('runCoinbaseLoan: aprPct is percentage (4.77 → divided /100/12 internally)', () => {
    // WHY: if aprPct were accidentally 0.0477 (decimal), month-1 interest ≈ $0.24 not $238.50
    const { rows } = runCoinbaseLoan({
      loanBalance: 60_000, collateralBtc: 1.48, aprPct: 4.77, monthlyPayment: 0, btcPrice: 100_000,
    });
    expect(rows[0].interest).toBeCloseTo(238.50, 2);  // 60000 × 4.77/100/12
  });

  it('runBlocYearOne: apr is decimal (0.13 → divided /12 internally)', () => {
    // WHY: if apr were accidentally 13 (percent), month-1 interest ≈ $10833 not $108.33
    // BlocMonthRow has no interest field; infer: month-1 draws $10000 then adds interest
    const { rows } = runBlocYearOne({
      collateralBtc: 1, btcPrice: 100_000, income: 0, expenses: 10_000,
      apr: 0.13, ltvCeiling: 0.5, creditLine: 20_000, btcGrowthRate: 0,
    });
    expect(rows[0].strikeBalance - 10_000).toBeCloseTo(108.33, 2);  // 10000 × 0.13/12
  });
});
