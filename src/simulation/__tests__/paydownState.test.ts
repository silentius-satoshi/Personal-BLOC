import { describe, it, expect } from 'vitest';
import { classifyPaydownState, paydownReadout } from '../simpleModePlan';

// ⚠ SYNTHETIC round figures — this repo is public; never a real position.
const C = 0.15;

// The engine half of these blocks — each state reached through runAdvisor — left with the engine in 5e (D5-A); the
// classifier's own checks stay.
describe('classifyPaydownState — four states', () => {
  it('quiet — no paydown, peak never crossed', () => {
    expect(classifyPaydownState(0.128, 0, 0.128, C)).toBe('quiet');
  });

  it('defended — a paydown settled the LTV at or below the ceiling', () => {
    expect(classifyPaydownState(0.189, 3900, 0.147, C)).toBe('defended');
  });

  it('⭐ partial — a paydown fired but the income ran out, and the LTV SETTLED ABOVE the ceiling', () => {
    // Collapse partial into defended and this goes red — the state most likely to be "simplified" away.
    expect(classifyPaydownState(0.239, 500, 0.18, C)).toBe('partial');
  });

  it('⭐ undefended — above the ceiling with NO paydown (no income left to fund one)', () => {
    // Drop the undefended branch and this reads "quiet" → red.
    expect(classifyPaydownState(0.192, 0, 0.192, C)).toBe('undefended');
  });

  it('a paydown sized exactly to the gap lands ON the ceiling as a float — that is defended, not partial', () => {
    expect(classifyPaydownState(0.2, 1000, C + 1e-12, C)).toBe('defended');
    expect(classifyPaydownState(0.2, 1000, C + 1e-6, C)).toBe('partial');
    expect(classifyPaydownState(C, 0, C, C)).toBe('quiet');
  });
});

describe('paydownReadout — one source for the header', () => {
  const plan = { paydown: 3900, blocLtv: 0.147, blocLtvPeak: 0.189 };

  it('⭐ a CLOSED logged month reports the ledger — even when it logged no paydown and the plan projected one', () => {
    // The reported bug: a real 12.8% reading wearing the plan's projected paydown flag. Swap the order and this is red.
    expect(paydownReadout(plan, { paydown: 0, strikeLtv: 0.128 }, false, C))
      .toEqual({ mode: 'actual', ltv: 0.128, peakLtv: 0, paydown: 0, paydownDone: 0, state: null });
  });

  it('a logged month with a real paydown reports the ledger\'s amount', () => {
    expect(paydownReadout(plan, { paydown: 1200, strikeLtv: 0.13 }, false, C)).toMatchObject({ mode: 'actual', paydown: 1200 });
  });

  it('⭐ the CURRENT month in progress keeps the PLANNED paydown as the instruction, with the ledger\'s progress', () => {
    // The owner journals daily, so the current month has an entry from its first event. Drop the in-progress branch
    // and the plan's paydown vanishes from his primary screen for the whole month → red.
    expect(paydownReadout(plan, { paydown: 1000, strikeLtv: 0.128 }, true, C))
      .toEqual({ mode: 'inProgress', ltv: 0.128, peakLtv: 0.189, paydown: 3900, paydownDone: 1000, state: 'defended' });
  });

  it('no entry → the plan, with its peak and state', () => {
    expect(paydownReadout(plan, null, false, C))
      .toEqual({ mode: 'projected', ltv: 0.147, peakLtv: 0.189, paydown: 3900, paydownDone: 0, state: 'defended' });
  });

  it('neither → all zeros, no throw', () => {
    expect(paydownReadout(null, null, true, C))
      .toEqual({ mode: 'none', ltv: 0, peakLtv: 0, paydown: 0, paydownDone: 0, state: null });
  });
});

// deriveForMonth, displaySettledLtv and isLtvFigureStressed left with the Advisor's rows (plan of record, Run 3).

describe('noCollateral — the fifth state (the draw landed with nothing behind it)', () => {
  // (Its two cases through runAdvisor — A2 and the stuck case — left with the engine in 5e, D5-A.)

  it('⭐ the guard runs FIRST — a paydown against zero collateral is noCollateral, not defended', () => {
    // Mutation: move the !isFinite(peak) guard below `paydown > 0` → 'defended' → red.
    expect(classifyPaydownState(Infinity, 6000, 0, C)).toBe('noCollateral');
  });

  it('peak === 0 stays quiet — no debt and no collateral is not the alarm', () => {
    expect(classifyPaydownState(0, 0, 0, C)).toBe('quiet');
  });
});
