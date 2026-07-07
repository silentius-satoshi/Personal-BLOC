import { useCallback, useRef, type ReactNode } from 'react';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { rubberBand } from '../../lib/gestureModel';
import { haptics } from '../../lib/haptics';
import styles from './SwipeStrip.module.css';

/**
 * SwipeStrip (Gesture & Motion System — P2) — shared horizontal pager. Renders a 300%-wide strip of THREE
 * panes (prev/current/next via `renderPane(offset)`) at rest `translateX(-33.333%)`; the drag animates the
 * VIEW only — REAL state (currentMonth etc.) changes ONLY at rest, after a committed page snap (design.md
 * §3.1). Vertical page scroll is never stolen (`touch-action: pan-y`; the gesture axis-locks x per §1.2).
 *
 * NON-NEGOTIABLE: a swipe only NAVIGATES — it never commits a financial write.
 */

export interface SwipeStripProps {
  /** Commit a page in `dir` (−1 prev / +1 next). Called at rest, after the snap animation. */
  onPage: (dir: -1 | 1) => void;
  /** Whether paging in `dir` is allowed (boundary → rubber-band instead). */
  canPage: (dir: -1 | 1) => boolean;
  /** Render the pane at `offset` (−1 prev / 0 current / +1 next). Pure/cheap — no store writes. */
  renderPane: (offset: -1 | 0 | 1) => ReactNode;
  /** Fired when the horizontal gesture axis-locks (coexistence: cancels a pending long-press). */
  onSwipeStart?: () => void;
  disabled?: boolean;
  labelledBy?: string;
}

const COMMIT_FRACTION = 0.35;
const COMMIT_VELOCITY = 800;
const SNAP_MS = 320; // --motion-settle

export function SwipeStrip({ onPage, canPage, renderPane, onSwipeStart, disabled, labelledBy }: SwipeStripProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const movedRef = useRef(false);

  const width = useCallback(() => viewportRef.current?.clientWidth ?? 0, []);

  const setTransform = (pct: number, transition: string) => {
    const el = stripRef.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = `translateX(${pct}%)`;
  };

  const restPct = -100 / 3;

  const drag = usePointerDrag({
    axis: 'x',
    slop: 8,
    axisLockRatio: 1.4,
    armThreshold: 24,
    commitThreshold: width() * COMMIT_FRACTION || 120,
    commitVelocity: COMMIT_VELOCITY,
    enabled: !disabled,
    onMove: (dx) => {
      // First move after axis-lock == horizontal intent → cancel any pending long-press on a child cell.
      if (!movedRef.current) { movedRef.current = true; onSwipeStart?.(); }
      if (reducedRef.current) return; // no continuous tracking under reduced motion
      const w = width() || 1;
      const dir: -1 | 1 = dx < 0 ? 1 : -1;
      const eff = canPage(dir) ? dx : rubberBand(dx, 32);
      setTransform(restPct + (eff / w) * 100, 'none');
    },
    onEnd: (dx, _dy, _v, committed) => {
      movedRef.current = false;
      const dir: -1 | 1 = dx < 0 ? 1 : -1;
      const doPage = committed && dx !== 0 && canPage(dir);
      if (!doPage) {
        // spring back to rest
        setTransform(restPct, reducedRef.current ? 'none' : 'transform var(--motion-settle) var(--ease-spring)');
        return;
      }
      haptics.tick(); // commit-only (Android in practice; no arm haptic for navigation)
      if (reducedRef.current) {
        onPage(dir); // reduced motion: no snap animation, swap panes immediately (global CSS fades)
        setTransform(restPct, 'none');
        return;
      }
      // Double-buffered snap: animate to the target pane, then in ONE commit page + reset to rest (no flash —
      // the incoming pane already rendered the target content).
      setTransform(dir === 1 ? -200 / 3 : 0, 'transform var(--motion-settle) var(--ease-spring)');
      window.setTimeout(() => {
        onPage(dir);
        setTransform(restPct, 'none');
      }, SNAP_MS);
    },
  });

  return (
    <div ref={viewportRef} className={styles.viewport} role="group" aria-labelledby={labelledBy}>
      <div
        ref={stripRef}
        className={styles.strip}
        style={{ transform: `translateX(${restPct}%)` }}
        onPointerDown={disabled ? undefined : drag.onPointerDown}
      >
        <div className={styles.pane} aria-hidden="true" style={{ pointerEvents: 'none' }}>{renderPane(-1)}</div>
        <div className={styles.pane}>{renderPane(0)}</div>
        <div className={styles.pane} aria-hidden="true" style={{ pointerEvents: 'none' }}>{renderPane(1)}</div>
      </div>
    </div>
  );
}
