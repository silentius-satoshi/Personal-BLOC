import { useState, useEffect } from 'react';

/**
 * useMediaQuery — true while `query` matches, following it as the window resizes. The control dock reads it to pick
 * its layout (spec `pbloc-spec-sticky-controls-v1.md`): ONE markup in the DOM at a time, so every control exists once.
 * Safe-defaults `false` when `matchMedia` is missing (test/node env) — the phone layout. useReducedMotion's pattern.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);

  return matches;
}
