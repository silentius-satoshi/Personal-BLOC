import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { rubberBand } from '../../lib/gestureModel';
import { haptics } from '../../lib/haptics';
import styles from './DraggableSheet.module.css';

/**
 * DraggableSheet (Gesture & Motion System — P1) — the shared drag-to-dismiss bottom-sheet shell.
 * The app's static `.scrim`/`.sheet` sheets adopt this: track-with-finger, flick-to-close, the scrim
 * IS the progress indicator. All motion is `transform`/`opacity` only (direct style writes, rAF-batched
 * by usePointerDrag).
 *
 * NON-NEGOTIABLE 1 — no gesture commits a financial write: when `dirty`, the drag caps at 25% + one warn
 * haptic, and release always springs back. Dismissing a dirty sheet is tap-only (the children's Cancel/X).
 *
 * The sheet element is its OWN scroll container (matching the sheets it replaces). Drag-to-dismiss only
 * engages at scrollTop 0; otherwise the pointer belongs to native scroll (touch-action: pan-y).
 */

const MAX_HEIGHT_DEFAULT = '92vh';
const ENTRY_MS = 280;
const EXIT_MS = 200; // --motion-standard

export interface DraggableSheetProps {
  open: boolean;
  onDismiss: () => void;
  /** When true, drag caps at 25% + warns; dismissal is tap-only. Default false. */
  dirty?: boolean;
  labelledBy?: string;
  /** Sheet max-height (the shells differ: 92vh / 88vh). Default '92vh'. */
  maxHeight?: string;
  /** The scroll container to gate drag-to-dismiss on (defaults to the sheet element itself). */
  scrollRef?: RefObject<HTMLElement>;
  children: ReactNode;
}

export function DraggableSheet({
  open,
  onDismiss,
  dirty = false,
  labelledBy,
  maxHeight = MAX_HEIGHT_DEFAULT,
  scrollRef,
  children,
}: DraggableSheetProps): React.ReactPortal | null {
  const scrimRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const [heightPx, setHeightPx] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);

  // Per-gesture scratch (refs so the drag callbacks never re-bind).
  const dyRef = useRef(0);
  const warnedRef = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const scroller = useCallback(
    (): HTMLElement | null => scrollRef?.current ?? sheetRef.current,
    [scrollRef],
  );

  // Entry animation on mount + height measure (single transform channel, shared with drag/spring/exit).
  useLayoutEffect(() => {
    const el = sheetRef.current;
    const sc = scrimRef.current;
    if (!open || !el) return;
    setHeightPx(el.offsetHeight);
    if (reduced) {
      el.style.transition = 'none';
      el.style.transform = 'translateY(0)';
      if (sc) sc.style.opacity = '1';
      return;
    }
    el.style.transition = 'none';
    el.style.transform = 'translateY(100%)';
    if (sc) {
      sc.style.transition = 'none';
      sc.style.opacity = '0';
    }
    // Force reflow so the from-state paints before the transition.
    void el.offsetHeight;
    el.style.transition = `transform ${ENTRY_MS}ms var(--ease-decelerate)`;
    el.style.transform = 'translateY(0)';
    if (sc) {
      sc.style.transition = `opacity ${ENTRY_MS}ms var(--ease-decelerate)`;
      sc.style.opacity = '1';
    }
  }, [open, reduced]);

  const settleBack = useCallback(() => {
    const el = sheetRef.current;
    const sc = scrimRef.current;
    if (el) {
      el.style.transition = reducedRef.current ? 'none' : 'transform var(--motion-settle) var(--ease-spring)';
      el.style.transform = 'translateY(0)';
    }
    if (sc) {
      sc.style.transition = reducedRef.current ? 'none' : 'opacity var(--motion-settle) var(--ease-spring)';
      sc.style.opacity = '1';
    }
  }, []);

  const runExit = useCallback(() => {
    const el = sheetRef.current;
    const sc = scrimRef.current;
    if (reducedRef.current) {
      onDismiss();
      return;
    }
    if (el) {
      el.style.transition = `transform ${EXIT_MS}ms var(--ease-standard)`;
      el.style.transform = 'translateY(100%)';
    }
    if (sc) {
      sc.style.transition = `opacity ${EXIT_MS}ms var(--ease-standard)`;
      sc.style.opacity = '0';
    }
    window.setTimeout(onDismiss, EXIT_MS);
  }, [onDismiss]);

  const drag = usePointerDrag({
    axis: 'y',
    slop: 8,
    armThreshold: 24,
    // Read live per event via the hook's cfgRef — tracks the measured height.
    commitThreshold: heightPx > 0 ? heightPx * 0.45 : 200,
    commitVelocity: 900,
    enabled: !inputFocused,
    onMove: (_dx, dy) => {
      dyRef.current = dy;
      if (reducedRef.current) return; // snap-only under reduced motion — no continuous render.
      const el = sheetRef.current;
      const sc = scrimRef.current;
      if (!el) return;
      const h = heightPx || el.offsetHeight || 1;
      let ty: number;
      if (dy > 0) {
        ty = dirtyRef.current ? rubberBand(dy, 0.25 * h) : dy;
      } else {
        const s = scroller();
        const canScroll = !!s && s.scrollHeight > s.clientHeight + 1;
        ty = canScroll ? 0 : rubberBand(dy, 24);
      }
      el.style.transition = 'none';
      el.style.transform = `translateY(${ty}px)`;
      if (sc) {
        const progress = Math.min(Math.max(ty / h, 0), 1);
        sc.style.opacity = String(1 - progress);
      }
    },
    onArm: () => {
      // Direction-gated: the hook arms on |delta| regardless of sign, so an upward scroll from the top
      // would otherwise fire a spurious haptic.
      if (dyRef.current <= 0) return;
      if (dirtyRef.current) {
        if (!warnedRef.current) {
          warnedRef.current = true;
          haptics.warn();
        }
      } else {
        haptics.tick();
      }
    },
    onEnd: (_dx, dy, _v, committed) => {
      const el = sheetRef.current;
      if (el) el.removeAttribute('data-tracking');
      const dismiss = committed && dy > 0 && !dirtyRef.current;
      if (dismiss) runExit();
      else settleBack();
    },
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (inputFocused) return;
      const s = scroller();
      if (s && s.scrollTop > 0) return; // not at top → native scroll owns this pointer.
      dyRef.current = 0;
      warnedRef.current = false;
      sheetRef.current?.setAttribute('data-tracking', 'true');
      drag.onPointerDown(e);
    },
    [drag, inputFocused, scroller],
  );

  const handleScrimTap = useCallback(() => {
    if (dirty) {
      haptics.warn();
      return; // dirty sheets dismiss only via a labeled tap in the children.
    }
    runExit();
  }, [dirty, runExit]);

  const onFocusIn = useCallback((e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) setInputFocused(true);
  }, []);
  const onFocusOut = useCallback((e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) setInputFocused(false);
  }, []);

  if (!open) return null;

  return createPortal(
    <div ref={scrimRef} className={styles.scrim} onClick={handleScrimTap}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        style={{ maxHeight }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onPointerDown={handlePointerDown}
        onFocusCapture={onFocusIn}
        onBlurCapture={onFocusOut}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grab} aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
