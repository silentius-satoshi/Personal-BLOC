import { useCallback, useEffect, useRef } from 'react';
import {
  advance,
  createGesture,
  velocity,
  type GestureConfig,
  type GestureEvent,
  type GestureState,
} from '../lib/gestureModel';

/**
 * usePointerDrag — the single gesture PRIMITIVE (Gesture & Motion System — P0). A thin React
 * adapter over the pure `gestureModel` state machine, Pointer Events only (unifies touch/mouse/pen).
 *
 * All motion writes are the CALLER's responsibility (transform/opacity only — never layout). This hook
 * just tracks: it feeds pointer events through `advance`, rAF-batches `onMove` (one style write per
 * frame, not per pointermove), fires `onArm`/`onDisarm` on the armed boundary, and reports `onEnd`.
 *
 * Listeners are attached `{ passive: true }` — CSS `touch-action` (declared per-surface) does the
 * scroll-vs-gesture blocking, so we NEVER `preventDefault` mid-gesture.
 */

export interface UsePointerDragConfig extends GestureConfig {
  onMove?: (dx: number, dy: number) => void;
  onArm?: () => void;
  onDisarm?: () => void;
  onEnd: (dx: number, dy: number, velocity: number, committed: boolean) => void;
  /** When false, `onPointerDown` is a no-op (the gesture is inert). Default true. */
  enabled?: boolean;
}

interface ActiveDrag {
  pointerId: number;
  el: Element;
  state: GestureState;
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  cancel: (e: PointerEvent) => void;
  raf: number | null;
}

export function usePointerDrag(config: UsePointerDragConfig): {
  onPointerDown: (e: React.PointerEvent) => void;
} {
  // Keep the latest config in a ref so listeners always see current callbacks without re-binding.
  const cfgRef = useRef(config);
  cfgRef.current = config;

  const activeRef = useRef<ActiveDrag | null>(null);

  const teardown = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    if (active.raf !== null) cancelAnimationFrame(active.raf);
    window.removeEventListener('pointermove', active.move as EventListener);
    window.removeEventListener('pointerup', active.up as EventListener);
    window.removeEventListener('pointercancel', active.cancel as EventListener);
    try {
      // Safe no-op when capture was never taken (a tap, or a sub-arm drag) — releasing an uncaptured pointer
      // throws InvalidStateError, which this catch swallows.
      (active.el as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(
        active.pointerId,
      );
    } catch {
      // capture may already be gone / never taken — harmless.
    }
    activeRef.current = null;
  }, []);

  const flush = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;
    active.raf = null;
    cfgRef.current.onMove?.(active.state.dx, active.state.dy);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const cfg = cfgRef.current;
      if (cfg.enabled === false) return;

      // A second pointer landing mid-drag cancels the active gesture (springs to nearest rest).
      if (activeRef.current) {
        const active = activeRef.current;
        active.state = advance(active.state, toEvent('cancel', e), cfg);
        const { dx, dy } = active.state;
        teardown();
        cfg.onEnd(dx, dy, 0, false);
        return;
      }

      // ⚠ Capture is DEFERRED to the armed boundary (see active.move), NOT taken here. Eager pointer capture
      // retargets the terminal pointerup/click to `el`, so a child button's click was swallowed on desktop
      // mouse (every DraggableSheet child). We keep `el` only as the capture target on arm + the release
      // target in teardown.
      const el = e.currentTarget;

      const active: ActiveDrag = {
        pointerId: e.pointerId,
        el,
        state: advance(createGesture(cfg), toEvent('down', e), cfg),
        move: () => {},
        up: () => {},
        cancel: () => {},
        raf: null,
      };

      active.move = (ev: PointerEvent) => {
        if (ev.pointerId !== active.pointerId) return;
        const prevPhase = active.state.phase;
        active.state = advance(active.state, toEvent('move', ev), cfgRef.current);
        const nextPhase = active.state.phase;

        if (prevPhase !== 'armed' && nextPhase === 'armed') {
          // Capture NOW (only once a real drag is recognized): keeps tracking past the element bounds AND
          // retargets the terminal pointerup/click so a committed drag releasing over a child fires no stray
          // click on it. A tap never reaches 'armed' → never captured → its native click survives.
          try {
            el.setPointerCapture(active.pointerId);
          } catch {
            // Non-capturable target (test env / detached) — proceed without capture.
          }
          cfgRef.current.onArm?.();
        }
        if (prevPhase === 'armed' && nextPhase !== 'armed') cfgRef.current.onDisarm?.();

        if (nextPhase === 'cancelled') {
          const { dx, dy } = active.state;
          teardown();
          cfgRef.current.onEnd(dx, dy, 0, false);
          return;
        }

        // rAF-batch: coalesce many pointermoves into ≤1 onMove per frame.
        if (active.raf === null) active.raf = requestAnimationFrame(flush);
      };

      active.up = (ev: PointerEvent) => {
        if (ev.pointerId !== active.pointerId) return;
        active.state = advance(active.state, toEvent('up', ev), cfgRef.current);
        const { dx, dy } = active.state;
        const v = velocity(active.state);
        const committed = active.state.phase === 'committed';
        teardown();
        cfgRef.current.onEnd(dx, dy, v, committed);
      };

      active.cancel = (ev: PointerEvent) => {
        if (ev.pointerId !== active.pointerId) return;
        active.state = advance(active.state, toEvent('cancel', ev), cfgRef.current);
        const { dx, dy } = active.state;
        teardown();
        cfgRef.current.onEnd(dx, dy, 0, false);
      };

      // Listeners on `window`, NOT `el`: pre-arm there is no capture yet, so a drag whose travel-to-arm exceeds
      // the element bounds (e.g. EdgeBackGesture's 20px zone vs its 24px armThreshold) would lose the move
      // stream if listeners lived on `el`. `window` receives every pointermove regardless of position, and is
      // touch-neutral (pointer events bubble to `window` whether or not capture is later taken).
      window.addEventListener('pointermove', active.move as EventListener, { passive: true });
      window.addEventListener('pointerup', active.up as EventListener, { passive: true });
      window.addEventListener('pointercancel', active.cancel as EventListener, { passive: true });

      activeRef.current = active;
    },
    [teardown, flush],
  );

  // Unmount safety: detach any in-flight listeners + cancel a pending frame.
  useEffect(() => teardown, [teardown]);

  return { onPointerDown };
}

function toEvent(
  type: GestureEvent['type'],
  e: { clientX: number; clientY: number; timeStamp: number },
): GestureEvent {
  return { type, x: e.clientX, y: e.clientY, t: e.timeStamp };
}
