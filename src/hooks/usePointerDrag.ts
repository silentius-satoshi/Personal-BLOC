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
    active.el.removeEventListener('pointermove', active.move as EventListener);
    active.el.removeEventListener('pointerup', active.up as EventListener);
    active.el.removeEventListener('pointercancel', active.cancel as EventListener);
    try {
      (active.el as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(
        active.pointerId,
      );
    } catch {
      // capture may already be gone — harmless.
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

      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Non-capturable target (test env / detached) — proceed without capture.
      }

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

        if (prevPhase !== 'armed' && nextPhase === 'armed') cfgRef.current.onArm?.();
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

      el.addEventListener('pointermove', active.move as EventListener, { passive: true });
      el.addEventListener('pointerup', active.up as EventListener, { passive: true });
      el.addEventListener('pointercancel', active.cancel as EventListener, { passive: true });

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
