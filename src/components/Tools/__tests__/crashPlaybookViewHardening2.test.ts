import { describe, it, expect } from 'vitest';
import { fmtStepBtc } from '../crashPlaybookView';

/**
 * Hardening 2 — crashPlaybookView.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HE.json).
 */
describe('Hardening 2 — crashPlaybookView', () => {
  it('HE-16 · engine.md "Every crash-day step amount is floored to its printed precision" — the 8-dp tier floors too: never more than moves, never a satoshi that isn\'t there', () => {
    expect(fmtStepBtc(0.000009996), 'HE-16 floored to the satoshi, not rounded up to 0.00001000').toBe('0.00000999');
    expect(fmtStepBtc(6e-9), 'HE-16 under one satoshi is no step').toBeNull();
  });
});
