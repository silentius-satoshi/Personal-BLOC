import { useCallback, useEffect, useRef, useState } from 'react';
import { haptics } from '../lib/haptics';

/**
 * useLongPress (Gesture & Motion System — P2) — a stationary press-and-hold. Pointer Events only, passive.
 * pointerdown arms a `ms` timer; a move beyond `slop` or pointerup/cancel clears it; fires ONCE on elapse
 * (one `haptics.tick()`). After a fired long-press, `shouldSuppressClick()` returns true for the immediately
 * following synthetic click so the caller can swallow it (the long-press replaces the tap).
 *
 * `onProgressStart`/`onProgressEnd` bracket the hold so the caller can render a fill cue (data-attribute + CSS).
 */
export interface UseLongPressOptions {
  onLongPress: () => void;
  ms?: number;                    // default 500
  slop?: number;                  // default 8
  onProgressStart?: () => void;   // hold began (paint the fill cue)
  onProgressEnd?: () => void;     // hold ended/cancelled/fired (clear the cue)
  enabled?: boolean;              // default true
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

export function useLongPress({
  onLongPress, ms = 500, slop = 8, onProgressStart, onProgressEnd, enabled = true,
}: UseLongPressOptions): { handlers: LongPressHandlers; holding: boolean; shouldSuppressClick: () => boolean; cancel: () => void } {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [holding, setHolding] = useState(false);

  const cfgRef = useRef({ onLongPress, ms, slop, onProgressStart, onProgressEnd });
  cfgRef.current = { onLongPress, ms, slop, onProgressStart, onProgressEnd };

  const clear = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    startRef.current = null;
    setHolding(false);
    cfgRef.current.onProgressEnd?.();
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!enabled || e.button === 2) return;
    firedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    setHolding(true);
    cfgRef.current.onProgressStart?.();
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      suppressClickRef.current = true;
      setHolding(false);
      cfgRef.current.onProgressEnd?.();
      haptics.tick();
      cfgRef.current.onLongPress();
    }, cfgRef.current.ms);
  }, [enabled]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s || timerRef.current === null) return;
    if (Math.abs(e.clientX - s.x) > cfgRef.current.slop || Math.abs(e.clientY - s.y) > cfgRef.current.slop) clear();
  }, [clear]);

  const onPointerUp = useCallback(() => clear(), [clear]);
  const onPointerCancel = useCallback(() => clear(), [clear]);

  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); }, []);

  const shouldSuppressClick = useCallback(() => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return true; }
    return false;
  }, []);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    holding,
    shouldSuppressClick,
    cancel: clear,
  };
}
