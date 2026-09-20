import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { deriveOwnership } from '../ownership';
import { runCyclingSim, type CyclingInputs } from '../cyclingSim';
import { buildViewerSnapshotPayload } from '../../store/payloads';
import { useStore } from '../../store/useStore';
import { btcGained } from '../../components/Almanac/cyclingFaceView';
import { ownershipGained } from '../../components/Almanac/ownershipFaceView';

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
  strikeCollateralBtc: 1.0,
  strikeBalance: 7_000,
  strikeCreditLine: 38_000,
  strikeMaxDrawLtv: 0.5,
  strikeMarginLtv: 0.7,
  cbCollateralBtc: 2.0,
  cbDebt: 70_000,
  income: 6_000,
  expenses: 5_500,
  strikeAprPct: 13,
  cbAprPct: 5.28,
};
const SPOT = 80_000;
const flat = (months: number, price = SPOT): number[] => new Array(months + 1).fill(price);
const runSeed = (o: Partial<CyclingInputs> = {}) =>
  runCyclingSim({ ...SEED, pricePath: flat(60), cbLtvCapPct: 75, cycleMonths: 1, ...o });
const yoursAt = (r: { last: { btcHeld: number; debt: number; price: number } }) =>
  deriveOwnership(r.last.btcHeld, r.last.debt, r.last.price).yoursBtc;

describe('deriveOwnership — one definition of "what\'s yours"', () => {
  describe('⚠ the coldBtc parameter has TWO conventions — do not double-count', () => {
    // `coldBtc` is ADDED to `btcHeld`. That is correct ONLY when the caller's btcHeld EXCLUDES cold:
    //   • Viewer  (OwnershipBar) passes strike+cb and cold separately  → 4-arg form, cold added here.
    //   • Almanac (both faces)   passes CyclingRow.btcHeld, which ALREADY contains cold → 3-arg form.
    // A caller that passes `row.btcHeld` AND `row.coldBtc` counts the cold pool twice, and because
    // yoursShare is clamped to [0,1] the result still LOOKS plausible. These pin both conventions.

    it('the 3-arg form equals the 4-arg form with cold already inside btcHeld', () => {
      const viewerStyle = deriveOwnership(2.0, 80_000, 80_000, 1.0);   // 2 pledged + 1 cold
      const almanacStyle = deriveOwnership(3.0, 80_000, 80_000);       // btcHeld already 3
      expect(viewerStyle.yoursBtc).toBeCloseTo(almanacStyle.yoursBtc, 12);
      expect(viewerStyle.lendersBtc).toBeCloseTo(almanacStyle.lendersBtc, 12);
      expect(viewerStyle.yoursShare).toBeCloseTo(almanacStyle.yoursShare, 12);
    });

    it('⭐ double-counting cold inflates yoursBtc by exactly the cold amount', () => {
      // The bug this guards: passing an Almanac row's btcHeld (cold included) AND its coldBtc.
      const correct = deriveOwnership(3.0, 80_000, 80_000);            // btcHeld includes 1 BTC cold
      const doubled = deriveOwnership(3.0, 80_000, 80_000, 1.0);       // ...and cold passed again
      expect(doubled.yoursBtc - correct.yoursBtc).toBeCloseTo(1.0, 12);
      expect(doubled.lendersBtc).toBeCloseTo(correct.lendersBtc, 12);  // the debt leg is unaffected
      // Still inside [0,1], which is why a sanity check on the share alone cannot catch this.
      expect(doubled.yoursShare).toBeGreaterThan(0);
      expect(doubled.yoursShare).toBeLessThanOrEqual(1);
    });

    it('omitting coldBtc defaults to 0, so every 3-arg caller is unchanged', () => {
      expect(deriveOwnership(2.5, 100_000, 80_000)).toEqual(deriveOwnership(2.5, 100_000, 80_000, 0));
    });

    it('totalHeld is the denominator the shares were actually divided by', () => {
      // Returned so a caller renders the same total the shares came from. OwnershipBar used to re-derive
      // it as `btcHeld + Math.max(0, coldBtc)` — a second rule for one number, eight lines from the
      // comment forbidding that exact expression.
      expect(deriveOwnership(1, 10_000, 50_000).totalHeld).toBe(1);          // 3-arg: just btcHeld
      expect(deriveOwnership(1, 10_000, 50_000, 0.5).totalHeld).toBe(1.5);   // 4-arg: + the cold pool
      const o = deriveOwnership(1, 10_000, 50_000, 0.5);
      expect(o.yoursShare).toBeCloseTo(o.yoursBtc / o.totalHeld, 12);
      expect(o.lendersShare).toBeCloseTo(o.lendersBtc / o.totalHeld, 12);
    });

    it('⭐ totalHeld is clamped INSIDE the function — a caller cannot re-add cold and get NaN', () => {
      // `Math.max(0, NaN)` is NaN, so the caller-side re-add poisoned the displayed total while the
      // shares beside it stayed plausible. The clamp belongs where the shares are computed.
      expect(deriveOwnership(1, 10_000, 50_000, Number.NaN).totalHeld).toBe(1);
      expect(deriveOwnership(1, 10_000, 50_000, -5).totalHeld).toBe(1);
      expect(deriveOwnership(1, 10_000, 50_000, Number.POSITIVE_INFINITY).totalHeld).toBe(1);
    });

    it('negative / non-finite cold cannot shrink the stack', () => {
      const bare = deriveOwnership(2.0, 80_000, 80_000);
      for (const bad of [-5, Number.NaN]) {
        const o = deriveOwnership(2.0, 80_000, 80_000, bad as number);
        expect(o.yoursBtc).toBeCloseTo(bare.yoursBtc, 12);
      }
    });

    it('⭐ the Almanac callers use the 3-arg form — the convention is enforced, not just documented', () => {
      const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
      for (const f of ['src/components/Almanac/cyclingFaceView.ts',
                       'src/components/Almanac/ownershipFaceView.ts',
                       'src/components/Almanac/OwnershipFace.tsx']) {
        const calls = [...read(f).matchAll(/deriveOwnership\(([^)]*)\)/g)].map((m) => m[1]);
        expect(calls.length, `${f}: expected at least one deriveOwnership call`).toBeGreaterThan(0);
        for (const args of calls) {
          expect(args.split(',').length, `${f}: deriveOwnership(${args}) must not pass coldBtc`).toBe(3);
        }
      }
    });
  });
  it('⭐ the worked example: the share is of the COIN COUNT, never the value', () => {
    // 1.92 / 3 = 0.64 — btcHeld is the denominator, not collateralValue.
    // Debt buys 86_400/80_000 = 1.08 ₿ at this price, so 1.92 ₿ of the 3 held are yours.
    const o = deriveOwnership(3.0, 86_400, 80_000);
    expect(o.yoursBtc).toBeCloseTo(1.92, 3);
    expect(o.lendersBtc).toBeCloseTo(1.08, 3);
    expect(o.yoursShare).toBeCloseTo(0.64, 3);
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

  it('B2: ownershipGained is the SAME definition as btcGained — one name, one implementation', () => {
    const r = runSeed({ mode: 'cycle', cbLtvCapPct: 75 });
    const row = r.rows[24], base = r.rows[0];
    const a = ownershipGained(row, base, row.price * 0.5);
    const b = btcGained(row, base, row.price * 0.5);
    expect(a).toEqual(b);
    expect(a.yours).toBeCloseTo(
      deriveOwnership(row.btcHeld, row.debt, row.price * 0.5).yoursBtc
      - deriveOwnership(base.btcHeld, base.debt, base.price).yoursBtc, 12);
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

  it('⭐ firstDrawMonth is the engine ground truth the face uses — not the opening LTV', () => {
    // Opens at 43.75% (below the 50% cap); a drop to 60k pushes month-1 LTV over the cap before any
    // draw. An opening-LTV proxy would silently omit the C2 notice for exactly this run.
    const r = runSeed({ mode: 'cycle', cbLtvCapPct: 50, pricePath: [80_000, 60_000, 60_000, 60_000] });
    expect(r.rows[0].cbLtv).toBeLessThan(0.50);
    expect(r.firstDrawMonth).toBeNull();
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
