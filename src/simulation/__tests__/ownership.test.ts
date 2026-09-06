import { describe, it, expect } from 'vitest';
import { deriveOwnership } from '../ownership';
import { runCyclingSim, type CyclingInputs } from '../cyclingSim';
import { buildViewerSnapshotPayload } from '../../store/payloads';
import { useStore } from '../../store/useStore';

/**
 * Ownership domain — the single definition of "what's yours" (S2′), the cap-dependent crossover (C2),
 * and the S4 ownership-bar structural privacy gate (A4/A5).
 *
 * The C2 fixture is the review's LIVE seed (the prototype SEED) — deliberately NOT the cyclingSim.test.ts
 * `LIVE` fixture, whose opening CB LTV (46.28%) sits BELOW the 50% cap so the draw runs there too. The
 * review's degenerate case needs the seed that opens ABOVE the cap (50.58%).
 */

const SEED: Omit<CyclingInputs, 'pricePath' | 'cbLtvCapPct' | 'mode' | 'cycleMonths'> = {
  startYear: 2026,
  strikeCollateralBtc: 0.96589757,
  strikeBalance: 7068.80,
  strikeCreditLine: 37328.91,
  strikeMaxDrawLtv: 0.5,
  strikeMarginLtv: 0.7,
  cbCollateralBtc: 1.72572674,
  cbDebt: 69544.90,
  income: 4300,
  expenses: 4000,
  strikeAprPct: 13,
  cbAprPct: 5.28,
};
const SPOT = 79674;
const flat = (months: number, price = SPOT): number[] => new Array(months + 1).fill(price);
const runSeed = (o: Partial<CyclingInputs> = {}) =>
  runCyclingSim({ ...SEED, pricePath: flat(60), cbLtvCapPct: 75, cycleMonths: 1, ...o });
const yoursAt = (r: { last: { btcHeld: number; debt: number; price: number } }) =>
  deriveOwnership(r.last.btcHeld, r.last.debt, r.last.price).yoursBtc;

describe('deriveOwnership — one definition of "what\'s yours"', () => {
  it('⭐ the worked example: the share is of the COIN COUNT, never the value', () => {
    // 1.730 / 2.69162431 = 0.643 — btcHeld is the denominator, not collateralValue.
    const o = deriveOwnership(2.69162431, 76613.29, 79674);
    expect(o.yoursBtc).toBeCloseTo(1.7300, 3);
    expect(o.lendersBtc).toBeCloseTo(0.9616, 3);
    expect(o.yoursShare).toBeCloseTo(0.643, 3);
    expect(o.hasData).toBe(true);
  });

  it('⭐ yoursBtc + lendersBtc ≡ btcHeld exactly — the clamping derivation rests on it', () => {
    const o = deriveOwnership(2.5, 100_000, 80_000);
    expect(o.yoursBtc + o.lendersBtc).toBeCloseTo(2.5, 12);
  });

  it('shares sum to 1 whenever hasData — normal, over-collateralised, and underwater', () => {
    for (const [h, d, p] of [[2.5, 100_000, 80_000], [2.5, 0, 80_000], [2.5, 300_000, 80_000]] as const) {
      const o = deriveOwnership(h, d, p);
      expect(o.hasData).toBe(true);
      expect(o.yoursShare + o.lendersShare).toBeCloseTo(1, 12);
    }
  });

  it('underwater: one share goes negative, the other exceeds 1 — clamped to 0 and 1', () => {
    const o = deriveOwnership(2, 300_000, 78_000);   // lenders 3.846 ₿, yours −1.846 ₿
    expect(o.yoursBtc).toBeLessThan(0);
    expect(o.lendersBtc).toBeGreaterThan(2);
    expect(o.yoursShare).toBe(0);
    expect(o.lendersShare).toBe(1);
  });

  it('zero price: the debt term contributes 0 — yoursBtc degenerates to btcHeld', () => {
    const o = deriveOwnership(2.5, 100_000, 0);
    expect(o.lendersBtc).toBe(0);
    expect(o.yoursBtc).toBe(2.5);
    expect(o.yoursShare).toBe(1);
  });

  it('no denominator (btcHeld <= 0): hasData false, both shares 0', () => {
    const o = deriveOwnership(0, 100_000, 80_000);
    expect(o.hasData).toBe(false);
    expect(o.yoursShare).toBe(0);
    expect(o.lendersShare).toBe(0);
  });
});

describe('C2 — the cycle/hold crossover is cap-dependent, not a property of the strategy', () => {
  it('⭐ at a cap below the opening CB LTV (50.58%), cycle never draws — it beats hold on carry alone', () => {
    // The degenerate case: "cycling" degenerates into refinancing the legacy Strike balance at the
    // cheaper rate — pure rate arbitrage, zero added leverage. This is WHY the face needs the notice.
    const cycle = yoursAt(runSeed({ mode: 'cycle', cbLtvCapPct: 50 }));
    const hold = yoursAt(runSeed({ mode: 'hold', cbLtvCapPct: 50 }));
    expect(cycle).toBeGreaterThan(hold);
  });

  it('⭐ above the opening LTV the draw runs, and leverage costs more than it earns on a flat path', () => {
    const cycle = yoursAt(runSeed({ mode: 'cycle', cbLtvCapPct: 75 }));
    const hold = yoursAt(runSeed({ mode: 'hold', cbLtvCapPct: 75 }));
    expect(cycle).toBeLessThan(hold);
  });
});

describe("the ownership bar's safe-mode gate is structural, not cosmetic", () => {
  it('⭐ a C-safe snapshot carries neither collateral scalar nor a settings block — the bar cannot render there', () => {
    const snap = buildViewerSnapshotPayload(useStore.getState(), 'safe');
    expect('settings' in snap).toBe(false);            // no advisorActualBlocBalance anywhere — not a top-level key
    expect('cbCollateralBtc' in snap).toBe(false);
    expect('strikeCollateralBtc' in snap).toBe(false);
  });
});
