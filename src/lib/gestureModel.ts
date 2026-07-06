/**
 * Gesture state machine (Gesture & Motion System — P0) — PURE, no React, no DOM.
 *
 * The single source of truth for how a tracked drag progresses:
 *   idle → tracking → axisLocked → armed → committed | cancelled
 * `advance(state, event, config)` is `(state, event) → state'` — plain data in, plain data out,
 * fully covered by the node-only vitest harness (no component render). `usePointerDrag` is a thin
 * React adapter that feeds pointer events through `advance` and calls back on transitions.
 *
 * Design contracts consumers rely on:
 *  - `committed`/`cancelled` are TERMINAL — `advance` is the identity from them.
 *  - Beyond `slop`, the gesture axis-locks ONLY when the dominant axis both beats the cross axis by
 *    `axisLockRatio` AND matches `config.axis`; otherwise it CANCELS (releases to native scroll).
 *  - Velocity is a px/s reading over a 3-sample rolling window along the locked axis.
 *  - No gesture here decides a financial write — it only reveals/navigates/stages (see design.md §0).
 */

export type GesturePhase =
  | 'idle'
  | 'tracking'
  | 'axisLocked'
  | 'armed'
  | 'committed'
  | 'cancelled';

export type Axis = 'x' | 'y';

export interface GestureSample {
  t: number;
  x: number;
  y: number;
}

export interface GestureState {
  phase: GesturePhase;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  lockedAxis: Axis | null;
  /** Rolling window (max 3) of the most recent points, oldest first — feeds `velocity`. */
  samples: GestureSample[];
}

export interface GestureConfig {
  axis: Axis;
  /** px of movement tolerated before the gesture captures (protects taps). Default 8. */
  slop?: number;
  /** Dominant-axis displacement must beat the cross axis by this factor to lock. Default 1.4. */
  axisLockRatio?: number;
  /** |primaryDelta| at which the gesture arms (crosses its actionable threshold). */
  armThreshold: number;
  /** |primaryDelta| at release that commits. */
  commitThreshold: number;
  /** |velocity| (px/s) at release that commits even below `commitThreshold`. */
  commitVelocity: number;
}

export type GestureEventType = 'down' | 'move' | 'up' | 'cancel';

export interface GestureEvent {
  type: GestureEventType;
  x: number;
  y: number;
  t: number;
}

const DEFAULT_SLOP = 8;
const DEFAULT_AXIS_LOCK_RATIO = 1.4;
const MAX_SAMPLES = 3;

/** Fresh idle state. `config` is accepted for symmetry/future seeding; the seed is config-independent today. */
export function createGesture(_config: GestureConfig): GestureState {
  return {
    phase: 'idle',
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    lockedAxis: null,
    samples: [],
  };
}

/** dx or dy per the configured primary axis. */
export function primaryDelta(state: GestureState, config: GestureConfig): number {
  return config.axis === 'x' ? state.dx : state.dy;
}

/** px/s along the locked axis from the rolling window (first↔last sample). 0 if <2 samples or Δt=0. */
export function velocity(state: GestureState): number {
  const { samples, lockedAxis } = state;
  if (samples.length < 2 || lockedAxis === null) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = last.t - first.t;
  if (dt === 0) return 0;
  const dPos = lockedAxis === 'x' ? last.x - first.x : last.y - first.y;
  return (dPos / dt) * 1000;
}

/** Sign-preserving rubber-band resistance: f(pull) = pull*max/(pull+max). f(0)=0, monotonic, asymptote<max. */
export function rubberBand(pull: number, max: number): number {
  if (pull === 0) return 0;
  const sign = pull < 0 ? -1 : 1;
  const p = Math.abs(pull);
  return sign * ((p * max) / (p + max));
}

function pushSample(samples: GestureSample[], sample: GestureSample): GestureSample[] {
  const next = [...samples, sample];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

/**
 * The single transition function. Returns a NEW state (never mutates); terminal states return
 * themselves unchanged. A `cancel` event cancels from any non-terminal phase (covers second-pointer).
 */
export function advance(
  state: GestureState,
  event: GestureEvent,
  config: GestureConfig,
): GestureState {
  // Terminal — identity.
  if (state.phase === 'committed' || state.phase === 'cancelled') return state;

  // A cancel event kills any live gesture.
  if (event.type === 'cancel') {
    return { ...state, phase: 'cancelled' };
  }

  const slop = config.slop ?? DEFAULT_SLOP;
  const axisLockRatio = config.axisLockRatio ?? DEFAULT_AXIS_LOCK_RATIO;

  switch (event.type) {
    case 'down': {
      const sample = { t: event.t, x: event.x, y: event.y };
      return {
        phase: 'tracking',
        startX: event.x,
        startY: event.y,
        dx: 0,
        dy: 0,
        lockedAxis: null,
        samples: [sample],
      };
    }

    case 'move': {
      if (state.phase === 'idle') return state; // move before down — ignore.

      const dx = event.x - state.startX;
      const dy = event.y - state.startY;

      if (state.phase === 'tracking') {
        // Within slop → stay tracking (track the offset, no samples yet).
        if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) {
          return { ...state, dx, dy };
        }
        // Beyond slop → axis test.
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const dominant: Axis = absX >= absY ? 'x' : 'y';
        const dominantMag = dominant === 'x' ? absX : absY;
        const crossMag = dominant === 'x' ? absY : absX;
        const beatsCross = dominantMag >= axisLockRatio * crossMag;
        if (!beatsCross || dominant !== config.axis) {
          return { ...state, dx, dy, phase: 'cancelled' };
        }
        // Evaluate armThreshold in the SAME call: at the lock, lockedAxis === config.axis so the primary
        // delta is dominantMag. A single large move (a flick) that both crosses slop AND passes
        // armThreshold must land in 'armed' — else a down→one-big-move→up would cancel from 'axisLocked'
        // without ever reaching the velocity-commit branch.
        return {
          ...state,
          dx,
          dy,
          phase: dominantMag >= config.armThreshold ? 'armed' : 'axisLocked',
          lockedAxis: dominant,
          samples: pushSample(state.samples, { t: event.t, x: event.x, y: event.y }),
        };
      }

      // axisLocked | armed → update, sample, re-evaluate the arm boundary.
      const samples = pushSample(state.samples, { t: event.t, x: event.x, y: event.y });
      const next: GestureState = { ...state, dx, dy, samples };
      const primary = Math.abs(primaryDelta(next, config));
      if (primary >= config.armThreshold) {
        next.phase = 'armed';
      } else {
        next.phase = 'axisLocked';
      }
      return next;
    }

    case 'up': {
      if (state.phase === 'armed') {
        const primary = Math.abs(primaryDelta(state, config));
        const v = Math.abs(velocity(state));
        const commit = primary >= config.commitThreshold || v >= config.commitVelocity;
        return { ...state, phase: commit ? 'committed' : 'cancelled' };
      }
      // Released before arming (incl. a plain tap) → cancelled.
      return { ...state, phase: 'cancelled' };
    }

    default:
      return state;
  }
}
