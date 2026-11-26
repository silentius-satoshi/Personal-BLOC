import { describe, it, expect } from 'vitest';
import { calcMiningStrategy } from '../miningUtils';
import type { MiningDevice } from '../types';

/**
 * Hardening 2 — miningUtils.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * SYNTHETIC round figures: 100 TH pooled, no fee, 1 kW at 10¢ — at $100,000 a coin it mines $4.50 a day, 4,500 sats.
 * (The net figures' own deduction is Group 2's logged call, not this test's: it pins the gross daily figure alone.)
 */
const DEVICE: MiningDevice = {
  name: 'Rig', hashrateTH: 100, powerW: 1_000, efficiencyJTH: 10, enabled: true, soloMining: false, poolName: '', poolFee: 0,
};

describe('Hardening 2 — miningUtils', () => {
  it('HS-39 · ui.md "Mining electricity" (fiat overhead — 100% sats kept, never deducted) — dailyEV_sats is the gross mined sats, the power bill left in dollars', () => {
    const r = calcMiningStrategy('pooled', [DEVICE], 100_000, 10, 800, 1, [100_000]);
    expect(r.monthlyElecCost_usd, 'HS-39 premise: a $72 power bill a month ($2.40 a day)').toBeCloseTo(72, 9);
    expect(r.dailyEV_sats, 'HS-39 the sats mined, all of them').toBe(4_500);
  });
});
