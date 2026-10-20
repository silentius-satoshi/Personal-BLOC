import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

/** How long the headline price takes to count to a new figure (5e, F12 — "a few hundred ms", the plan of record's F12). */
export const COUNT_MS = 400;

/**
 * One frame of the count, from the figure on screen to the new one, easing out (quick, then settling — the motion
 * vocabulary's decelerate). Pure + − ×, so a test pins every frame. The last frame is `to` exactly.
 */
export function countFrame(from: number, to: number, elapsedMs: number, durationMs: number = COUNT_MS): number {
  if (!(elapsedMs < durationMs)) return to;
  const q = 1 - Math.max(0, elapsedMs) / durationMs;
  return from + (to - from) * (1 - q * q * q);
}

/**
 * 5e (F12) — the price chart's headline counts to a new figure: the device's copy of the history handing over to the live
 * one, and every refresh that moves the price. No count on the first draw, nor from "no figure" (`null` — the chart's
 * "BTC" placeholder), and none with reduced motion: those jump. The frames run on requestAnimationFrame's own timestamps,
 * never Date.now (the e2e fixes Date.now; a count measured by it would never end). The figure on screen is held in a ref,
 * so StrictMode's second effect run starts no count, and a count interrupted by a newer figure goes on from where it is.
 */
export function useCountTo(target: number | null): number | null {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(target);
  const onScreen = useRef<number | null>(target);

  useEffect(() => {
    const from = onScreen.current;
    if (target === null || from === null || reduced || from === target) {
      onScreen.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const v = countFrame(from, target, ts - start);
      onScreen.current = v;
      setShown(v);
      if (v !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  return target === null ? null : shown;
}
