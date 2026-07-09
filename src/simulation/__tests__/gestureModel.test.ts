import { describe, it, expect } from 'vitest';
import {
  advance,
  createGesture,
  velocity,
  primaryDelta,
  rubberBand,
  resolveScrollClaim,
  type GestureConfig,
  type GestureEvent,
  type GestureState,
} from '../../lib/gestureModel';

// A permissive base config; individual tests override thresholds as needed.
const CFG: GestureConfig = {
  axis: 'x',
  slop: 8,
  axisLockRatio: 1.4,
  armThreshold: 64,
  commitThreshold: 120,
  commitVelocity: 900,
};

const ev = (type: GestureEvent['type'], x: number, y: number, t: number): GestureEvent => ({
  type,
  x,
  y,
  t,
});

/** Drive a sequence of events through advance() from a fresh gesture. */
function run(config: GestureConfig, events: GestureEvent[]): GestureState {
  let state = createGesture(config);
  for (const e of events) state = advance(state, e, config);
  return state;
}

describe('slop', () => {
  it('keeps a sub-slop move in tracking', () => {
    // WHY: small jitter under 8px must not capture — it protects taps.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 5, 2, 16)]);
    expect(s.phase).toBe('tracking');
  });

  it('cancels a tap (down→up inside slop)', () => {
    // WHY: a release before axis-lock is never a commit.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 3, 1, 16), ev('up', 3, 1, 32)]);
    expect(s.phase).toBe('cancelled');
  });
});

describe('axis lock', () => {
  it('locks x when x dominates y beyond the ratio', () => {
    // WHY: dx=20 vs dy=5 → 20 ≥ 1.4×5 and dominant is x === config.axis.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 20, 5, 16)]);
    expect(s.phase).toBe('axisLocked');
    expect(s.lockedAxis).toBe('x');
  });

  it('cancels when neither axis dominates by the ratio', () => {
    // WHY: dx=20 vs dy=18 → 20 < 1.4×18 → ambiguous → released to native scroll.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 20, 18, 16)]);
    expect(s.phase).toBe('cancelled');
  });

  it('cancels when the dominant axis is not the configured axis', () => {
    // WHY: a vertical drag on an x-axis gesture belongs to the scroller, not us.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 5, 30, 16)]);
    expect(s.phase).toBe('cancelled');
  });
});

describe('arm / disarm', () => {
  it('arms on the SAME move that crosses slop when |delta| >= armThreshold', () => {
    // WHY: a single large move (a flick) must land in 'armed', not 'axisLocked' — otherwise the release
    // never reaches the velocity-commit branch. (The P0-flagged arm-on-lock fix.)
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 70, 0, 16)]);
    expect(s.phase).toBe('armed');
  });

  it('arms when the primary delta crosses armThreshold', () => {
    // WHY: 70 ≥ 64 arms the gesture.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 20, 0, 16), ev('move', 70, 0, 32)]);
    expect(s.phase).toBe('armed');
  });

  it('disarms when the primary delta retreats below armThreshold', () => {
    // WHY: pulling back under the threshold returns to axisLocked (the arm is not sticky).
    const s = run(CFG, [
      ev('down', 0, 0, 0),
      ev('move', 20, 0, 16),
      ev('move', 70, 0, 32),
      ev('move', 40, 0, 48),
    ]);
    expect(s.phase).toBe('axisLocked');
  });
});

describe('capture-on-arm contract (usePointerDrag defers setPointerCapture to the armed boundary)', () => {
  // usePointerDrag captures the pointer ONLY on the tracking→armed transition, so a tap/sub-arm press keeps its
  // native click (the desktop drag-swallow fix). These pin the exact phases at DraggableSheet's config
  // (axis:'y', slop:8, armThreshold:24) that gate whether capture is taken.
  const SHEET: GestureConfig = { axis: 'y', slop: 8, axisLockRatio: 1.4, armThreshold: 24, commitThreshold: 200, commitVelocity: 900 };

  it('a tap (down→up, no move) never arms → cancelled → capture never taken, native click survives', () => {
    const s = run(SHEET, [ev('down', 0, 0, 0), ev('up', 0, 0, 16)]);
    expect(s.phase).toBe('cancelled');
  });

  it('a sub-armThreshold drag (20px < 24) stays axisLocked, never armed → still no capture', () => {
    const s = run(SHEET, [ev('down', 0, 0, 0), ev('move', 0, 20, 16)]);
    expect(s.phase).toBe('axisLocked');
  });

  it('crossing armThreshold (30px >= 24) reaches armed → the frame usePointerDrag captures', () => {
    const s = run(SHEET, [ev('down', 0, 0, 0), ev('move', 0, 30, 16)]);
    expect(s.phase).toBe('armed');
  });
});

describe('commit / cancel on release', () => {
  it('commits by distance when released past commitThreshold', () => {
    // WHY: 130 ≥ 120 commits regardless of velocity.
    const s = run(CFG, [
      ev('down', 0, 0, 0),
      ev('move', 20, 0, 16),
      ev('move', 70, 0, 32),
      ev('move', 130, 0, 400),
      ev('up', 130, 0, 416),
    ]);
    expect(s.phase).toBe('committed');
  });

  it('commits by velocity even below the distance threshold', () => {
    // WHY: a fast flick — window (20→90px over 16ms) ≈ 4375px/s ≥ 900 — commits though distance < 120.
    const s = run(CFG, [
      ev('down', 0, 0, 0),
      ev('move', 20, 0, 0),
      ev('move', 70, 0, 8),
      ev('move', 90, 0, 16),
      ev('up', 90, 0, 16),
    ]);
    expect(s.phase).toBe('committed');
  });

  it('commits a single-move flick via the velocity path (arm-on-lock fix)', () => {
    // WHY: down → one 100px move → up. Distance 100 < commitThreshold 200, but velocity
    // 100px/20ms = 5000px/s ≥ 900 commits. Pre-fix this cancelled from axisLocked (never armed).
    const flickCfg: GestureConfig = {
      axis: 'y',
      slop: 8,
      axisLockRatio: 1.4,
      armThreshold: 40,
      commitThreshold: 200,
      commitVelocity: 900,
    };
    const s = run(flickCfg, [ev('down', 0, 0, 0), ev('move', 0, 100, 20), ev('up', 0, 100, 30)]);
    expect(s.phase).toBe('committed');
  });

  it('cancels when released below both distance and velocity', () => {
    // WHY: armed but a slow, short drag on release springs back.
    const s = run(CFG, [
      ev('down', 0, 0, 0),
      ev('move', 20, 0, 0),
      ev('move', 70, 0, 400),
      ev('move', 75, 0, 800),
      ev('up', 75, 0, 1200),
    ]);
    expect(s.phase).toBe('cancelled');
  });
});

describe('velocity', () => {
  it('computes px/s across the rolling window', () => {
    // WHY: 3 retained samples [down(0,0), (10,30), (20,60)] → first↔last = (60-0)/(20-0)*1000 = 3000.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 30, 0, 10), ev('move', 60, 0, 20)]);
    expect(s.samples).toHaveLength(3);
    expect(velocity(s)).toBeCloseTo(3000, 5);
  });

  it('returns 0 with fewer than two samples', () => {
    // WHY: no window → no reading (guards the down-only / single-move case).
    const s = run(CFG, [ev('down', 0, 0, 0)]);
    expect(velocity(s)).toBe(0);
  });

  it('returns 0 when Δt is zero', () => {
    // WHY: down + one lock-move, both stamped t=0 → first/last share a timestamp → divide-by-zero guard.
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 20, 0, 0)]);
    expect(s.samples).toHaveLength(2);
    expect(velocity(s)).toBe(0);
  });

  it('keeps only the last three samples', () => {
    // WHY: window is bounded at 3 — a 4th move drops the oldest, so velocity uses the recent tail.
    const s = run(CFG, [
      ev('down', 0, 0, 0),
      ev('move', 20, 0, 0),
      ev('move', 40, 0, 10),
      ev('move', 60, 0, 20),
      ev('move', 80, 0, 30),
    ]);
    expect(s.samples).toHaveLength(3);
    // window now [10ms→20px offset...] first=(40,10) last=(80,30): (80-40)/(30-10)*1000 = 2000.
    expect(velocity(s)).toBeCloseTo(2000, 5);
  });
});

describe('primaryDelta', () => {
  it('reads dx for an x-axis gesture and dy for a y-axis gesture', () => {
    // WHY: consumers key thresholds off the axis-appropriate displacement.
    const sx = run(CFG, [ev('down', 0, 0, 0), ev('move', 20, 5, 16)]);
    expect(primaryDelta(sx, CFG)).toBe(sx.dx);
    const yCfg: GestureConfig = { ...CFG, axis: 'y' };
    const sy = run(yCfg, [ev('down', 0, 0, 0), ev('move', 5, 20, 16)]);
    expect(primaryDelta(sy, yCfg)).toBe(sy.dy);
  });
});

describe('rubberBand', () => {
  it('is 0 at 0', () => {
    expect(rubberBand(0, 24)).toBe(0);
  });

  it('is monotonic and asymptotes below max', () => {
    // WHY: resistance grows with pull but never reaches `max` (the ceiling is the affordance).
    const a = rubberBand(10, 24);
    const b = rubberBand(100, 24);
    const c = rubberBand(100_000, 24);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(24);
  });

  it('is sign-preserving for negative pull', () => {
    // WHY: an upward/leftward over-drag rubber-bands symmetrically.
    expect(rubberBand(-50, 24)).toBeCloseTo(-rubberBand(50, 24), 10);
    expect(rubberBand(-50, 24)).toBeLessThan(0);
  });
});

describe('terminal states', () => {
  it('is the identity from committed', () => {
    // WHY: once committed, further events must not resurrect the gesture.
    const committed = run(CFG, [
      ev('down', 0, 0, 0),
      ev('move', 70, 0, 16),
      ev('move', 130, 0, 32),
      ev('up', 130, 0, 48),
    ]);
    expect(committed.phase).toBe('committed');
    expect(advance(committed, ev('down', 0, 0, 64), CFG)).toBe(committed);
    expect(advance(committed, ev('move', 200, 0, 80), CFG)).toBe(committed);
  });

  it('is the identity from cancelled', () => {
    const cancelled = run(CFG, [ev('down', 0, 0, 0), ev('move', 20, 18, 16)]);
    expect(cancelled.phase).toBe('cancelled');
    expect(advance(cancelled, ev('move', 200, 0, 32), CFG)).toBe(cancelled);
  });
});

describe('cancel event', () => {
  it('cancels from tracking', () => {
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 4, 0, 16), ev('cancel', 4, 0, 20)]);
    expect(s.phase).toBe('cancelled');
  });

  it('cancels from axisLocked', () => {
    const s = run(CFG, [ev('down', 0, 0, 0), ev('move', 20, 0, 16), ev('cancel', 20, 0, 20)]);
    expect(s.phase).toBe('cancelled');
  });

  it('cancels from armed (models second-pointer landing mid-drag)', () => {
    // WHY: a second finger cancels the active gesture → springs to nearest rest.
    const s = run(CFG, [
      ev('down', 0, 0, 0),
      ev('move', 70, 0, 16),
      ev('cancel', 70, 0, 20),
    ]);
    expect(s.phase).toBe('cancelled');
  });
});

describe('resolveScrollClaim (P1.3 scroll/drag handoff)', () => {
  it('claims a downward stroke at the top', () => {
    // WHY: scrollTop 0 + finger going down → the sheet owns the frame.
    expect(resolveScrollClaim({ claimed: false }, { scrollTop: 0, goingDown: true, dyClaim: 0 }))
      .toEqual({ claim: true, claimed: true });
  });

  it('does NOT claim while content is scrolled', () => {
    // WHY: scrollTop > 0 → native scroll owns it (content scrolls back toward the top).
    expect(resolveScrollClaim({ claimed: false }, { scrollTop: 60, goingDown: true, dyClaim: 0 }))
      .toEqual({ claim: false, claimed: false });
  });

  it('does NOT claim an upward stroke at the top', () => {
    // WHY: going up at the top = scroll to reveal lower content → native scroll.
    expect(resolveScrollClaim({ claimed: false }, { scrollTop: 0, goingDown: false, dyClaim: 0 }))
      .toEqual({ claim: false, claimed: false });
  });

  it('stays claimed once claimed even if scrollTop later reads > 0', () => {
    // WHY: once the sheet owns the stroke it keeps it (WebKit may report a transient scrollTop) until release.
    expect(resolveScrollClaim({ claimed: true }, { scrollTop: 80, goingDown: true, dyClaim: 40 }))
      .toEqual({ claim: true, claimed: true });
  });

  it('releases (two-way handoff) when the finger returns to the claim point', () => {
    // WHY: dyClaim <= 0 hands control back to native scroll for the same finger.
    expect(resolveScrollClaim({ claimed: true }, { scrollTop: 0, goingDown: false, dyClaim: 0 }))
      .toEqual({ claim: false, claimed: false });
    expect(resolveScrollClaim({ claimed: true }, { scrollTop: 0, goingDown: false, dyClaim: -5 }))
      .toEqual({ claim: false, claimed: false });
  });

  it('re-claims after a release when back at the top going down', () => {
    // WHY: after handing off, a fresh at-top downward stroke can re-own the frame.
    expect(resolveScrollClaim({ claimed: false }, { scrollTop: 0, goingDown: true, dyClaim: 0 }))
      .toEqual({ claim: true, claimed: true });
  });

  it('measures release from the CLAIM point, not touchstart', () => {
    // WHY: the claim occurred after 180px of downward travel (claimStartY there); the finger reverses 20px UP
    // from the claim point → dyClaim = -20 → RELEASE. Measured from touchstart it'd be +160 (still down) and
    // would NOT release — the claim-relative baseline is what makes scroll-then-claim strokes hand off correctly.
    expect(resolveScrollClaim({ claimed: true }, { scrollTop: 0, goingDown: false, dyClaim: -20 }))
      .toEqual({ claim: false, claimed: false });
    // Still travelling down from the claim point (dyClaim > 0) → stays claimed.
    expect(resolveScrollClaim({ claimed: true }, { scrollTop: 0, goingDown: true, dyClaim: 160 }))
      .toEqual({ claim: true, claimed: true });
  });
});
