import { describe, it, expect } from 'vitest';
import { crashPlaybook, type CrashPlaybookInput } from '../crashPlaybook';
import { CB_LLTV } from '../runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';

/**
 * Hardening 1 · engine — crashPlaybook against engine.md's `crashPlaybook` row (HE-12, HE-13). Round synthetic figures
 * only. Price ON support ($100k), so the order is the shift first (top up first only below support).
 */
const BASE: CrashPlaybookInput = {
  price: 100_000, support: 100_000, cbDebt: 90_000, cbCollateralBtc: 1, strikeBalance: 45_000, strikeCollateralBtc: 1,
  strikeCreditLine: 55_000, coldBtc: 0.02, targetCbLtvPct: 70, cbStopAtSupport: 0.6, lltv: CB_LLTV,
  maxDrawLtv: STRIKE_MAX_DRAW_LTV, marginLtv: STRIKE_MARGIN_CALL_LTV, retrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV,
  strikeInHold: false,
};

describe('Hardening 1 · crashPlaybook', () => {
  it('HE-12 · engine.md `crashPlaybook is the one crash-day answer` — the fallback top-up asks doom again after the shift', () => {
    // Coinbase opens at 90% (past 86%: doomed); the shift's capacity, 0.5 × 1 ₿ × 100k − 45k = 5,000, takes it to 85% —
    // alive, so the fallback pours the cold in.
    const r = crashPlaybook(BASE);
    expect(r.doomed).toBe(true);
    expect(r.order).toBe('shiftFirst');
    expect(r.steps.map((s) => s.kind)).toEqual(['shiftToStrike', 'coldToCoinbase']);
    const [shift, cold] = r.steps as unknown as [{ usd: number }, { btc: number }];
    expect(shift.usd).toBe(STRIKE_MAX_DRAW_LTV * 1 * 100_000 - 45_000);
    expect(cold.btc).toBe(0.02);
    expect(r.shortfallBtc).toBeCloseTo((90_000 - 5_000) / (0.7 * 100_000) - (1 + 0.02), 12);
  });

  it('HE-13 · engine.md `crashPlaybook is the one crash-day answer` ("After a top-up-first step, a shift under SHIFT_DUST_USD is dust") — a shift-first draw under half a cent is booked, not dropped', () => {
    const r = crashPlaybook({ ...BASE, cbDebt: 70_000.001, strikeBalance: 0, strikeCreditLine: 30_000, coldBtc: 0 });
    expect(r.order).toBe('shiftFirst');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].kind).toBe('shiftToStrike');
    expect((r.steps[0] as { usd: number }).usd).toBeCloseTo(70_000.001 - 0.7 * 1 * 100_000, 9);   // $0.001
  });
});
