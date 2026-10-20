import { describe, it, expect } from 'vitest';
import { runBlocYearOne } from '../runBlocYearOne';

// (runCoinbaseLoan's projection and its percentage anchor left the code in 5e, D5-A — no screen had run it since the plan
// of record's Run 4.)
describe('APR unit convention anchors', () => {
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
