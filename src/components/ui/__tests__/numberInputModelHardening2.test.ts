import { describe, it, expect } from 'vitest';
import { keystrokeWrite, numberCommit } from '../numberInputModel';

/**
 * Hardening 2 — numberInputModel.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 */
describe('Hardening 2 — numberInputModel', () => {
  it('HS-28 · ui.md "`NumberInput` saving" (\'live\' hands on each readable, non-negative keystroke) — a typed 0 is handed on', () => {
    expect(keystrokeWrite('live', '0'), 'HS-28 zero is a figure').toBe(0);
    expect([keystrokeWrite('live', '12'), keystrokeWrite('live', '-1'), keystrokeWrite('live', 'x'), keystrokeWrite('leave', '0')],
      'HS-28 premise: the rest of the rule').toEqual([12, null, null, null]);
  });

  it('HS-29 · ui.md "`NumberInput` saving" (numberCommit saves only what differs from what the field SHOWS) — retyping the figure shown, at its decimals, saves nothing', () => {
    // A stored 0.123456789 shows as 0.12345679 at 8 decimals; typing exactly that changes nothing the owner can see.
    const same = numberCommit({ typed: true, raw: '0.12345679', value: 0.123456789, decimals: 8 });
    expect(same.write, 'HS-29 nothing re-written').toBeNull();
    const other = numberCommit({ typed: true, raw: '0.12345678', value: 0.123456789, decimals: 8 });
    expect(other.write, 'HS-29 premise: a different figure saves').toBe(0.12345678);
  });
});
