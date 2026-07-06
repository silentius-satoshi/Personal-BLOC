import { useState, useEffect } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * useReducedMotion (Gesture & Motion System — P0) — the JS side of the reduced-motion policy. The
 * global CSS block (`global.css`) already strips CSS transitions/animations to 80ms cross-fades; this
 * hook lets motion drivers that track under a finger SNAP between rest states instead of animating
 * continuously (gestures still FUNCTION — only their rendering collapses). Safe-defaults `false` when
 * `matchMedia` is missing (test/node env), so callers get "motion on" rather than a crash.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return reduced;
}
