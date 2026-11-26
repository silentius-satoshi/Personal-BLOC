import { describe, it, expect } from 'vitest';
import { placementPlan } from '../placement';

/**
 * Hardening 2 — placement.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HE.json).
 * Round synthetic figures; exact goldens only for + − × ÷.
 */
describe('Hardening 2 — placement', () => {
  it('HE-03 · engine.md "Every support-policy stress figure is support(t)" — strikeRoomUsd is the Strike room AT SUPPORT, never at today\'s price', () => {
    // Today 60,000, support 50,000: the room at support is coll × support × skStop − balance; at today's price it reads
    // 5,000 more — THE MOVE's "at support today the policy's Strike limit leaves $X" would overstate it.
    const p = placementPlan({
      creditLine: 30_000, strikeBalance: 10_000, strikeCollateralBtc: 1, cbDebt: 20_000, cbCollateralBtc: 1, coldBtc: 0,
      price: 60_000, support: 50_000, skStop: 0.5, cbStop: 0.6, cbDefenseLtv: 0.7, bufferUsd: 0,
      accumulateBelow: 1.5, payDownAbove: 2, inHold: false, broken: false,
    });
    expect(p.strikeRoomUsd).toBe(1 * 50_000 * 0.5 - 10_000);   // 15,000
  });
});
