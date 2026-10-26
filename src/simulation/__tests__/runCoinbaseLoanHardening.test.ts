import { describe, it, expect } from 'vitest';
import { computeLiquidationAnalysis } from '../runCoinbaseLoan';

describe('runCoinbaseLoan hardening', () => {
  it('HS-13 · engines.md § CB Loan — at exactly the liquidation price the loan is already liquidatable', () => {
    expect(computeLiquidationAnalysis(50_000, 1, 50_000, 50_000).isAlreadyLiquidatable).toBe(true);
  });

  it('HS-14 · engines.md § CB Loan — the LIF penalty is never negative when the seizure is capped by the collateral', () => {
    // 1 BTC at $50,000 = $50,000 of collateral against a $100,000 loan: from 50% repaid up, the seizure is
    // capped at all the collateral, which is no more than the debt repaid, so the penalty is 0, not negative.
    const sc = computeLiquidationAnalysis(100_000, 1, 50_000, 60_000).scenarios;
    for (const s of sc) expect(s.lifBonus).toBeGreaterThanOrEqual(0);
    expect(sc[0].lifBonus).toBeGreaterThan(0);
    expect(sc[3].lifBonus).toBe(0);
  });
});
