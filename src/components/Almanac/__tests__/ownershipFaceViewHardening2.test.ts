import { describe, it, expect } from 'vitest';
import { ownershipHero } from '../ownershipFaceView';
import type { CyclingRow } from '../../../simulation/cyclingSim';

/**
 * Hardening 2 — ownershipFaceView.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * Round synthetic figures: + − × ÷ only.
 */
describe('Hardening 2 — ownershipFaceView', () => {
  it('HS-26 · engine.md "Every opening figure on a face includes the cold reserve, and no Almanac face passes deriveOwnership\'s cold parameter" — the hero\'s Yours counts cold once (btcHeld already holds it)', () => {
    // 2 ₿ held, cold's 0.5 ₿ among them; $50,000 owed at $100,000 = 0.5 ₿ the lenders' — 1.5 ₿ yours.
    const row = { m: 12, btcHeld: 2, coldBtc: 0.5, debt: 50_000, price: 100_000 } as unknown as CyclingRow;
    const hero = ownershipHero(row, row);
    expect([hero.heldBtc, hero.owedBtc, hero.yoursBtc], 'HS-26 cold counted once').toEqual([2, 0.5, 2 - 50_000 / 100_000]);
  });
});
