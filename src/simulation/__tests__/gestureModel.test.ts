import { describe, it, expect } from 'vitest';
import {
  advance,
  createGesture,
  velocity,
  primaryDelta,
  rubberBand,
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
