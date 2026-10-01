import { describe, it, expect } from 'vitest';
import { nextTipState, tipShift, type TipEvent, type TipState } from '../infoTipModel';

/**
 * InfoTip's pure rules (spec `pbloc-spec-infotip-fit-v1.md` v1.1). Round fixtures: a 390px screen, so the gutters are
 * 16..374 unless a row says otherwise. Each ⭐ was proven red by its named mutation (T1–T8, R1–R6) before it landed.
 *
 * ⚠ `<` → `<=` on any of tipShift's three comparisons is an EQUIVALENT mutant, so no row here can catch it (F1). The
 * shift is continuous at each gutter: taking the slide branch at exactly 16 slides by 16 − 16 = 0, and at the too-wide
 * boundary pinning the left edge gives what the fall-through gives. The boundary mutants that CAN fail are T4 (the
 * gutter off by one) and T5 (the screen edge compared instead of the gutter).
 */
describe('⭐ tipShift — the open panel slides inside [16, width − 16]', () => {
  it('⭐ fits ⇒ 0', () => {
    expect(tipShift(40, 340, 390)).toBe(0);
  });

  it('⭐ off the left ⇒ slides right to the left gutter', () => {
    // T1 (the left branch dropped) → 0; T3 (gutter 0) → 100
    expect(tipShift(-100, 200, 390)).toBe(116);
  });

  it('⭐ in the left gutter, still on screen ⇒ slides right to the gutter', () => {
    // T5 (the screen edge, 0, compared instead of the gutter) → 0
    expect(tipShift(10, 300, 390)).toBe(6);
  });

  it('⭐ off the right ⇒ slides left to the right gutter', () => {
    // T2 (the right branch dropped) → 0; T3 (gutter 0) → −60
    expect(tipShift(150, 450, 390)).toBe(-76);
  });

  it('⭐ in the right gutter, still on screen ⇒ slides left to the gutter', () => {
    // T5 (the screen edge, the width, compared instead of the gutter) → 0
    expect(tipShift(90, 380, 390)).toBe(-6);
  });

  it('⭐ exactly on both gutters ⇒ 0', () => {
    // T4 (gutter 17) → 1: the panel reads as too wide by 2px
    expect(tipShift(16, 374, 390)).toBe(0);
  });

  it('⭐ too wide to fit ⇒ pins the left (reading) edge', () => {
    // F5: the left edge sits right of the gutter, so the left branch can't mask the too-wide one.
    // T6 (too wide pins the right) → −26; T8 (the too-wide check dropped) → −26; T3 (gutter 0) → −10
    expect(tipShift(20, 400, 390)).toBe(-4);
  });

  it.each([
    [NaN, 400, 390],
    [-10, NaN, 390],
    [0, 400, NaN],
    [-Infinity, 200, 390],
    [0, Infinity, 390],
    [0, 200, Infinity],
  ])('⭐ non-finite (%s, %s, %s) ⇒ 0', (left, right, width) => {
    // F4 / T7: every row is non-zero without the guard (−26, 26, 16, ∞, 16, 16) — NaN compares false, so a row like
    // (NaN, 0, 390) would return 0 either way and prove nothing.
    expect(tipShift(left, right, width)).toBe(0);
  });

  it('⭐ the spec\'s measured panels (the natural rect once the ≤480px rule is gone) land inside the gutters', () => {
    // T2 → 0; T3 → −91 / −97
    expect(tipShift(129, 481, 390)).toBe(-107);   // lands 22..374
    expect(tipShift(129, 472, 375)).toBe(-113);   // lands 16..359 — exactly the span between the gutters
  });
});

/**
 * closed / hover / pinned. Hover is a mouse's only (the component gates it); a tap or click pins; a second tap or
 * click on the ⓘ, Escape, or a tap or click outside closes; moving the mouse away closes only a hover-opened tip.
 */
const TRANSITIONS: [TipState, TipEvent, TipState][] = [
  ['closed', 'hoverIn', 'hover'],
  ['closed', 'hoverOut', 'closed'],
  ['closed', 'press', 'pinned'],     // R6 (a first press only hovers) → hover
  ['closed', 'dismiss', 'closed'],
  ['hover', 'hoverIn', 'hover'],
  ['hover', 'hoverOut', 'closed'],
  ['hover', 'press', 'pinned'],      // R1 (a press toggles a hover-opened tip shut) → closed — I4
  ['hover', 'dismiss', 'closed'],
  ['pinned', 'hoverIn', 'pinned'],   // R3 (hover demotes a pinned tip) → hover
  ['pinned', 'hoverOut', 'pinned'],  // R2 (leaving closes a pinned tip) → closed
  ['pinned', 'press', 'closed'],     // R4 (a second press keeps it) → pinned
  ['pinned', 'dismiss', 'closed'],   // R5 (dismiss spares a pinned tip) → pinned
];

describe('⭐ nextTipState — who opens and closes the tip', () => {
  it.each(TRANSITIONS)('⭐ %s + %s ⇒ %s', (from, event, to) => {
    expect(nextTipState(from, event)).toBe(to);
  });
});
