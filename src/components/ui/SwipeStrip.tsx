import { useCallback, useRef, useState, type ReactNode } from 'react';
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
  /**
   * Render the pane at `offset` (−1 prev / 0 current / +1 next). `live` is true from gesture start until the
   * snap settles (false at rest) — a consumer can use it to mount REAL neighbour content only during a gesture
   * (e.g. Almanac faces with heavy hooks) instead of at rest. offset 0 is always live. Pure/cheap — no store writes.
   */
  renderPane: (offset: -1 | 0 | 1, live: boolean) => ReactNode;
  /** Fired when the horizontal gesture axis-locks (coexistence: cancels a pending long-press). */
  onSwipeStart?: () => void;
  /**
   * Optional pointerdown gate (default → always start). Return false to REFUSE the paging gesture for this
   * press — the pointer falls through to the content (charts, the left edge-back zone). Receives the whole
   * event so a guard can read both `e.target` and `e.clientX`. P2 call sites omit it (unaffected).
   */
  shouldStart?: (e: React.PointerEvent) => boolean;
  disabled?: boolean;
  labelledBy?: string;
}

const COMMIT_FRACTION = 0.35;
const COMMIT_VELOCITY = 800;
const SNAP_MS = 320; // --motion-settle

export function SwipeStrip({ onPage, canPage, renderPane, onSwipeStart, shouldStart, disabled, labelledBy }: SwipeStripProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const movedRef = useRef(false);
  // True from gesture start (pointerdown accepted) until the snap/spring settles — drives `live` neighbour
  // panes. Cleared ONLY at settle (when the transform is already at rest), so the strip's JSX inline transform
  // re-render can never clobber an in-flight animation (see onEnd / the clobber-guard note).
  const [dragging, setDragging] = useState(false);

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
      const eff = canPage(dir) ? dx : rubberBand(dx, 20);
      setTransform(restPct + (eff / w) * 100, 'none');
    },
    onEnd: (dx, _dy, _v, committed) => {
      movedRef.current = false;
      const dir: -1 | 1 = dx < 0 ? 1 : -1;
      const doPage = committed && dx !== 0 && canPage(dir);
      if (!doPage) {
        // spring back to rest (--ease-spring-soft — calmer than --ease-spring), then clear `dragging` AT SETTLE
        // (transform already at rest → the re-render's inline-transform write is a no-op).
        setTransform(restPct, reducedRef.current ? 'none' : 'transform var(--motion-settle) var(--ease-spring-soft)');
        if (reducedRef.current) setDragging(false);
        else window.setTimeout(() => setDragging(false), SNAP_MS);
        return;
      }
      haptics.tick(); // commit-only (Android in practice; no arm haptic for navigation)
      if (reducedRef.current) {
        onPage(dir); // reduced motion: no snap animation, swap panes immediately (global CSS fades)
        setTransform(restPct, 'none');
        setDragging(false);
        return;
      }
      // Double-buffered snap: animate to the target pane, then in ONE commit page + reset to rest (no flash —
      // the incoming pane already rendered the target content).
      setTransform(dir === 1 ? -200 / 3 : 0, 'transform var(--motion-settle) var(--ease-spring-soft)');
      window.setTimeout(() => {
        onPage(dir);
        setTransform(restPct, 'none');
        setDragging(false); // at settle: transform is restPct → the re-render write is a no-op
      }, SNAP_MS);
    },
  });

  return (
    <div ref={viewportRef} className={styles.viewport} role="group" aria-labelledby={labelledBy}>
      <div
        ref={stripRef}
        className={styles.strip}
        style={{ transform: `translateX(${restPct}%)` }}
        onPointerDown={disabled ? undefined : (e) => { if (shouldStart && !shouldStart(e)) return; setDragging(true); drag.onPointerDown(e); }}
      >
        <div className={styles.pane} aria-hidden="true" style={{ pointerEvents: 'none' }}>{renderPane(-1, dragging)}</div>
        <div className={styles.pane}>{renderPane(0, true)}</div>
        <div className={styles.pane} aria-hidden="true" style={{ pointerEvents: 'none' }}>{renderPane(1, dragging)}</div>
      </div>
    </div>
  );
}
