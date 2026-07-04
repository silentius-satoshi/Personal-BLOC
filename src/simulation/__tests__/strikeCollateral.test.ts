import { describe, it, expect } from 'vitest';
import type { DayEvent } from '../types';
import { deriveStrikeCollateral } from '../logUtils';

// Collateral-Truth v20 — the reading-anchored Strike-collateral derive. Fixed absolute dates so ordering is
// deterministic (deriveStrikeCollateral ranks by (date, then ts), never Date.now()).
const D1 = '2025-01-05';
const D2 = '2025-01-20';
const D3 = '2025-02-10';

let seq = 0;
const id = () => `e${++seq}`;

const reading = (strikeCollateral: number | undefined, date: string, ts: number): DayEvent =>
  ({ id: id(), date, ts, kind: 'balanceReading', reading: { strikeBal: 1000, strikeLtv: 0.1, ...(strikeCollateral !== undefined ? { strikeCollateral } : {}) } });
const move = (kind: 'deposit' | 'withdraw', amount: number, target: 'strike' | 'cb', date: string, ts: number): DayEvent =>
  ({ id: id(), date, ts, kind, amount, target });
const buy = (amount: number, date: string, ts: number): DayEvent => ({ id: id(), date, ts, kind: 'buy', amount });

describe('deriveStrikeCollateral', () => {
  it('no anchor → fallback (?? 0)', () => {
    expect(deriveStrikeCollateral([], 0.7)).toBeCloseTo(0.7);
    expect(deriveStrikeCollateral([])).toBe(0);
    // strike moves with NO strikeCollateral-bearing reading do NOT establish an anchor → fallback
    expect(deriveStrikeCollateral([move('deposit', 0.1, 'strike', D1, 1)], 0.7)).toBeCloseTo(0.7);
  });

  it('anchor = the strikeCollateral-bearing reading latest by DATE', () => {
    const log = [reading(0.5, D1, 100), reading(0.8, D3, 50)];   // D3 later by date, EARLIER ts
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(0.8);      // date wins over ts
  });

  it('same-date anchor tiebreak by ts (latest ts wins)', () => {
    const log = [reading(0.5, D1, 10), reading(0.9, D1, 20)];
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(0.9);
  });

  it('sums target:strike moves STRICTLY AFTER the anchor (deposit +, withdraw −)', () => {
    const log = [
      reading(1.0, D1, 100),
      move('deposit', 0.2, 'strike', D2, 200),    // after → +0.2
      move('withdraw', 0.05, 'strike', D2, 210),  // after → −0.05
    ];
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(1.15);
  });

  it('atomic flow+reading sharing a ts is NOT double-counted (strict ts >)', () => {
    // The sheet emits the deposit and its reading with the SAME ts; the reading states the post-move total.
    const TS = 300;
    const log = [
      reading(1.0, D1, 100),
      move('deposit', 0.2, 'strike', D2, TS),
      reading(1.2, D2, TS),   // shared ts with the deposit; states the new total directly
    ];
    // Anchor = the D2 reading (1.2); the same-ts deposit is NOT strictly after it → not re-summed.
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(1.2);
  });

  it('a move dated BEFORE the anchor is excluded (already reflected in the reading)', () => {
    const log = [
      move('deposit', 0.3, 'strike', D1, 50),   // before the anchor date → excluded
      reading(1.0, D2, 100),
    ];
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(1.0);
  });

  it('buys are invisible; target:cb moves are ignored', () => {
    const log = [
      reading(1.0, D1, 100),
      buy(0.5, D2, 200),                         // buy → not collateral
      move('deposit', 0.4, 'cb', D2, 210),       // cb target → ignored
      move('deposit', 0.1, 'strike', D2, 220),   // only this counts → +0.1
    ];
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(1.1);
  });

  it('withdraw after the anchor reduces collateral', () => {
    const log = [reading(2.0, D1, 100), move('withdraw', 0.5, 'strike', D2, 200)];
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(1.5);
  });

  it('readings without strikeCollateral do not anchor (later strike-debt re-anchor is ignored here)', () => {
    const log = [
      reading(0.9, D1, 100),        // the strike-collateral anchor
      reading(undefined, D3, 200),  // a debt-only re-anchor (no strikeCollateral) — NOT a collateral anchor
      move('deposit', 0.1, 'strike', D3, 210),   // after the collateral anchor → counts
    ];
    expect(deriveStrikeCollateral(log, 0)).toBeCloseTo(1.0);
  });
});
