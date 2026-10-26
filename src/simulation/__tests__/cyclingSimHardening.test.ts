import { describe, it, expect } from 'vitest';
import { runCyclingSim, type CyclingInputs, type SupportPolicyInputs } from '../cyclingSim';
import { STRIKE_MARGIN_CALL_LTV } from '../emergencyModel';
import { SP_REPRO, policyFor } from './supportPolicyPaths';

/**
 * Hardening 1 · engine — rules of the support-anchored policy no test caught (HE-*). Round synthetic figures only —
 * this repo is public. Every run: SP_REPRO with both APRs at 0 (so the arithmetic is the rule's alone), a FLAT support
 * line of $50,000 (stored literally — never a power-law recompute), the engine fixtures' policy (CB stop 60%, Strike
 * stop 50%, buy below 1.5×, pay down above 2.0×). No fixture sets a goal (spec §1.2).
 */
const BASE: Omit<CyclingInputs, 'pricePath'> = { ...SP_REPRO, strikeAprPct: 0, cbAprPct: 0 };
const flat = (n: number): number[] => new Array(n).fill(50_000);
const run = (o: Partial<CyclingInputs>, pricePath: number[], po: Partial<SupportPolicyInputs> = {}) =>
  runCyclingSim({ ...BASE, ...o, pricePath, supportPolicy: policyFor(flat(pricePath.length), po) });

describe('Hardening 1 · cyclingSim under the support-anchored policy', () => {
  it('HE-02 · engine.md `Every support-policy stress figure is support(t)` — the draw stops at Strike\'s ceiling AT SUPPORT, not at today\'s price', () => {
    // 1.4× support (accumulate); Strike $22k on 1 ₿ is short of its line's keep, so its ceiling binds the draw.
    const r = run({ strikeCollateralBtc: 1, strikeBalance: 22_000, strikeCreditLine: 30_000, cbCollateralBtc: 2, cbDebt: 20_000 },
      [70_000, 70_000, 70_000]);
    // Strike's ceiling at support: collateral × S × strike stop − balance.
    expect(r.rows[1].strikeDrawn).toBe(1 * 50_000 * 0.5 - 22_000);   // 3,000 — at today's $70k it would be 13,000 more room
  });

  it('HE-06 · engine.md `Cold is never retrieved at or above support…` (never narrow it by dropping paths) — a Strike cure\'s cold at support counts in coldRetrievedAboveSupportBtc', () => {
    // An opening over Strike's ceiling: $40k on 1 ₿ at support $50k is 80% — over the 70% call, so month 1 cures from cold.
    const r = run({ strikeBalance: 40_000, strikeCreditLine: 40_000, strikeCollateralBtc: 1, cbDebt: 0, cbCollateralBtc: 0,
      openingColdBtc: 1, strikeLtvCapPct: 0 }, [50_000, 50_000, 50_000]);
    expect(r.rows[1].strikeCall).toBe('cured');
    // The month's surplus (8,000 − 6,000) repays the over-ceiling Strike first; the cure then tops the rest to 65%.
    const cureCold = (40_000 - (8_000 - 6_000)) / (0.65 * 50_000) - 1;
    expect(r.rows[1].coldRetrievedBtc).toBeCloseTo(cureCold, 12);
    expect(r.coldRetrievedAboveSupportBtc).toBeCloseTo(cureCold, 12);   // every coin that left cold at support is counted
  });

  it('HE-07 · engine.md `A stop at support can never exceed its leg\'s defense line (engine clamp)` — a 68% Strike stop under a 90% cap runs at the 66.5% the engine runs', () => {
    const r = run({ strikeLtvCapPct: 90 }, [60_000, 60_000, 60_000], { strikeStopAtSupportPct: 68 });
    // The cap the engine runs is min(90%, margin call × 0.95) = 66.5%; the stop is clamped to it, measured at support.
    expect(r.rows[0].strikeCeilingHeadroomUsd!).toBeCloseTo(1 * 50_000 * STRIKE_MARGIN_CALL_LTV * 0.95 - 0, 6);   // 33,250
  });

  it('HE-10 · engine.md `Under the policy, every Strike → Coinbase collateral move by a defense obeys Strike\'s release rules` — collateral leaving Strike starts no hold, so the next month releases again', () => {
    const r = run({ strikeCollateralBtc: 1, strikeBalance: 0, strikeCreditLine: 30_000, cbCollateralBtc: 1, cbDebt: 30_000 },
      [60_000, 40_000, 36_000, 36_000]);
    expect(r.rows[1].topUpFromStrikeBtc).toBeGreaterThan(0);
    expect(r.rows[2].topUpFromStrikeBtc).toBeGreaterThan(0);   // no 60-day hold after a release
    expect(r.rows[2].defenseDrawnUsd).toBe(0);
  });

  it('HE-11 · almanac.md § Support-anchored policy step 5 ("< 50% after") — a migration landing exactly ON Strike\'s 50% draw line is refused', () => {
    // keep = 25,000 / (0.5 × 50,000) = 1 ₿ of 2; the move leaves 25,000 / (1 × 50,000) = exactly 0.5 — not under it.
    const r = run({ strikeCreditLine: 25_000, strikeBalance: 25_000, strikeCollateralBtc: 2, cbCollateralBtc: 1, cbDebt: 10_000 },
      [50_000, 50_000, 50_000]);
    expect(25_000 / ((2 - 25_000 / (0.5 * 50_000)) * 50_000)).toBe(0.5);   // the fixture IS the tie
    expect(r.rows[1].strikeToCbBtc + r.rows[1].strikeToColdBtc).toBe(0);
    expect(r.rows[1].strikeCollateralBtc).toBe(2);
  });

  it('HE-27 · almanac.md § Support-anchored policy ("Pay down to ZERO … the 0.005 residual sweep") — a sub-half-cent Strike residue clears to exactly zero', () => {
    // 2.5× support (pay down): a $1,000 surplus (7,000 − 6,000) against $1,000.001 leaves a $0.001 residue.
    const r = run({ strikeBalance: 1_000.001, strikeCreditLine: 30_000, cbDebt: 0, income: 7_000, expenses: 6_000 },
      [125_000, 125_000, 125_000]);
    expect(r.rows[1].strikeBalance).toBe(0);
  });

  it('HE-28 · almanac.md § Support-anchored policy step 5 ("the 60-day hold that follows ANY cold → Strike move (strikeHoldUntil = m + 2)") — a Strike cure\'s cold deposit holds the migration for two months', () => {
    // The recorded GAP reached the hold through the goal's stand-down; spec §1.2 forbids a goal here, so the same
    // hold is reached through the ordinary migration: Strike $20k on 1 ₿, a $30k line, no Coinbase loan, 1 ₿ cold.
    // Month 1 at $25k is 80% — cured from cold to 65%; months 2–3 at $70k (1.4×, accumulate) Strike holds more than
    // its keep, 30,000 / (0.5 × 50,000) = 1.2 ₿.
    const r = run({ strikeBalance: 20_000, strikeCreditLine: 30_000, strikeCollateralBtc: 1, cbDebt: 0, cbCollateralBtc: 0,
      openingColdBtc: 1, strikeLtvCapPct: 0 }, [50_000, 25_000, 70_000, 70_000]);
    expect(r.rows[1].strikeCall).toBe('cured');
    expect(r.rows[1].coldRetrievedBtc).toBeCloseTo(20_000 / (0.65 * 25_000) - 1, 12);
    expect(r.rows[2].strikeToCbBtc + r.rows[2].strikeToColdBtc).toBe(0);   // m2 < m1 + 2: still in the hold
    expect(r.rows[3].strikeToCbBtc).toBeCloseTo(20_000 / (0.65 * 25_000) - 30_000 / (0.5 * 50_000), 12);
  });

  it('HE-29 · file-structure.md § cyclingSim.ts ("Terminal for the WHOLE Coinbase loop") · almanac.md step 9 — no sweep after the seizure month', () => {
    const r = run({ income: 6_000, strikeCreditLine: 20_000, strikeBalance: 19_000, cbDebt: 41_000 },
      [67_500, 22_500, 60_000, 60_000], { bearBufferMonths: 0 });
    expect(r.liqMonth).toBe(1);
    const after = r.rows.filter((x) => x.m > 1);
    expect(after.length).toBe(2);
    expect(after[0].cbCollateralBtc).toBeGreaterThan(0);   // a survivor pool exists to (wrongly) sweep
    for (const x of after) expect(x.sweptToColdBtc).toBe(0);
  });

  it('HE-30 · engine.md `crashPlaybook is the one crash-day answer` (almanac.md: top up first "between the liquidation depth and support"; at or above support the shift first) — on the support line the engine shifts first', () => {
    const r = run({ cbDebt: 40_000, cbCollateralBtc: 1, openingColdBtc: 0.5, strikeBalance: 0, strikeCreditLine: 30_000 },
      [60_000, 50_000, 50_000]);
    expect(r.rows[1].cbLtvPreDefense!).toBeGreaterThan(0.7);   // the playbook runs, price exactly on support (k = 1)
    expect(r.rows[1].topUpFromColdBtc).toBe(0);
    expect(r.rows[1].defenseDrawnUsd).toBeGreaterThan(0);
    expect(r.rows[1].cbDebt).toBeCloseTo(0.7 * 1 * 50_000, 6);   // the shift alone restores the 70% line
  });

  it('HE-31 · almanac.md `firstUnheldMonth` ("over its line (> cap × (1 + 1e-9))") — a top-up landing on the line, an ulp over in float, holds it', () => {
    // The drop to $40k (k = 0.8, inside the top-up-first band) puts Coinbase over 70%; 1 ₿ cold restores it exactly.
    const r = run({ cbDebt: 30_000, openingColdBtc: 1 }, [60_000, 40_000]);
    expect(r.rows[1].cbLtvPreDefense!).toBeGreaterThan(0.7);
    expect(r.rows[1].topUpFromColdBtc).toBeGreaterThan(0);
    expect(r.rows[1].cbLtv).toBeCloseTo(0.7, 12);
    expect(r.firstUnheldMonth).toBeNull();
  });
});
