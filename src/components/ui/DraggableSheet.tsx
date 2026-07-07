import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  advance, createGesture, primaryDelta, resolveScrollClaim, rubberBand,
  type GestureConfig, type GestureState,
} from '../../lib/gestureModel';
import { haptics } from '../../lib/haptics';
import styles from './DraggableSheet.module.css';

/**
 * DraggableSheet (Gesture & Motion System — P1) — the shared drag-to-dismiss bottom-sheet shell.
 * Track-with-finger, flick-to-close; the BACKDROP is the progress indicator. All motion is
 * `transform`/`opacity` only (direct style writes, rAF-batched by usePointerDrag).
 *
 * P1.2 Bug E — DOM structure: `.root` (positioning only, never opacity-animated) wraps a SIBLING
 * `.backdrop` (the opacity target) + the `.sheet`, so animating backdrop opacity never fades the sheet.
 *
 * P1.3 scroll/drag handoff (replaces the P1.2 scrollTop-gate + touch-action-flip, disproved by two device
 * gates): ONE scoped non-passive `touchmove` listener decides, per frame, whether the SHEET owns the drag
 * or NATIVE SCROLL does (`resolveScrollClaim`). When a claimed downward stroke's pointer gesture has already
 * been terminated by a scroll-triggered `pointercancel`, the touch handler TAKES OVER as the source for the
 * SAME pure gestureModel (createGesture/advance) — a `pointercancel`led pointer pipeline is terminal and
 * cannot resume mid-touch. Exactly one source drives at a time (`touchDrivingRef`).
 *
 * NON-NEGOTIABLE 1 — no gesture commits a financial write: when `dirty`, the drag caps at 25% + one warn
 * haptic, and release always springs back. Dismissing a dirty sheet is tap-only (the children's Cancel/X).
 */

const MAX_HEIGHT_DEFAULT = '92vh';
const ENTRY_MS = 280;
const EXIT_MS = 200; // --motion-standard
const SLOP = 8;
const ARM = 24;
const COMMIT_VELOCITY = 900;

export interface DraggableSheetProps {
  open: boolean;
  onDismiss: () => void;
  /** When true, drag caps at 25% + warns; dismissal is tap-only. Default false. */
  dirty?: boolean;
  labelledBy?: string;
  /** Sheet max-height (the shells differ: 92vh / 88vh). Default '92vh'. */
  maxHeight?: string;
  /** The scroll container to gate the handoff on (defaults to the sheet element itself). */
  scrollRef?: RefObject<HTMLElement>;
  /** Fired on any real user `<input>` edit inside the sheet (wired to onChangeCapture) — the child uses
   *  it to set its own `touched`/`dirty`. Programmatic setState never triggers it (only DOM input events). */
  onUserInput?: () => void;
  children: ReactNode;
}

export function DraggableSheet({
  open,
  onDismiss,
  dirty = false,
  labelledBy,
  maxHeight = MAX_HEIGHT_DEFAULT,
  scrollRef,
  onUserInput,
  children,
}: DraggableSheetProps): React.ReactPortal | null {
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const [heightPx, setHeightPx] = useState(0);
  const heightRef = useRef(0);

  // Per-gesture scratch (refs so the drag callbacks never re-bind).
  const dyRef = useRef(0);
  const warnedRef = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // P1.3 handoff scratch.
  const pointerActiveRef = useRef(false);   // the pointer pipeline currently owns the gesture
  const startTouchYRef = useRef(0);
  const lastTouchYRef = useRef(0);
  const claimedRef = useRef(false);
  const claimStartYRef = useRef(0);         // y at the false→true claim (release baseline)
  const touchDrivingRef = useRef(false);    // the touch handler is the gesture source (pointer was terminal)
  const gestureRef = useRef<GestureState | null>(null);

  const scroller = useCallback(
    (): HTMLElement | null => scrollRef?.current ?? sheetRef.current,
    [scrollRef],
  );

  const cfg = useCallback((): GestureConfig => ({
    axis: 'y', slop: SLOP, armThreshold: ARM,
    commitThreshold: (heightRef.current || sheetRef.current?.offsetHeight || 444) * 0.45,
    commitVelocity: COMMIT_VELOCITY,
  }), []);

  // Entry animation on mount + height measure (single transform channel, shared with drag/spring/exit).
  useLayoutEffect(() => {
    const el = sheetRef.current;
    const sc = backdropRef.current;
    if (!open || !el) return;
    setHeightPx(el.offsetHeight);
    heightRef.current = el.offsetHeight;
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
    void el.offsetHeight; // force reflow so the from-state paints before the transition
    el.style.transition = `transform ${ENTRY_MS}ms var(--ease-decelerate)`;
    el.style.transform = 'translateY(0)';
    if (sc) {
      sc.style.transition = `opacity ${ENTRY_MS}ms var(--ease-decelerate)`;
      sc.style.opacity = '1';
    }
  }, [open, reduced]);

  const settleBack = useCallback(() => {
    const el = sheetRef.current;
    const sc = backdropRef.current;
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
    const sc = backdropRef.current;
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

  // ── Shared gesture handlers — called by BOTH the pointer source and the touch-driven source ────────────
  const applyMove = useCallback((dy: number) => {
    dyRef.current = dy;
    if (reducedRef.current) return; // snap-only under reduced motion — no continuous render
    const el = sheetRef.current;
    const sc = backdropRef.current;
    if (!el) return;
    const h = heightRef.current || el.offsetHeight || 1;
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
  }, [scroller]);

  const applyArmHaptic = useCallback(() => {
    // Direction-gated: the model arms on |delta| regardless of sign — an upward scroll must fire no haptic.
    if (dyRef.current <= 0) return;
    if (dirtyRef.current) {
      if (!warnedRef.current) { warnedRef.current = true; haptics.warn(); }
    } else {
      haptics.tick();
    }
  }, []);

  const finishGesture = useCallback((dy: number, committed: boolean) => {
    const el = sheetRef.current;
    if (el) el.removeAttribute('data-tracking');
    const dismiss = committed && dy > 0 && !dirtyRef.current;
    if (dismiss) runExit();
    else settleBack();
  }, [runExit, settleBack]);

  // Terminal for the TOUCH-DRIVEN path — claim and driver die TOGETHER (never a live claim with no driver).
  const endTouchDrive = useCallback((dy: number, committed: boolean) => {
    touchDrivingRef.current = false;
    gestureRef.current = null;
    claimedRef.current = false;
    claimStartYRef.current = 0;
    finishGesture(dy, committed);
  }, [finishGesture]);

  const drag = usePointerDrag({
    axis: 'y',
    slop: SLOP,
    armThreshold: ARM,
    commitThreshold: heightPx > 0 ? heightPx * 0.45 : 200, // read live per event via the hook's cfgRef
    commitVelocity: COMMIT_VELOCITY,
    onMove: (_dx, dy) => applyMove(dy),
    onArm: applyArmHaptic,
    onEnd: (_dx, dy, _v, committed) => { pointerActiveRef.current = false; finishGesture(dy, committed); },
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Fix 2 — focus guard: block ONLY when pressing the focused field itself (typing); pressing anywhere else
      // blurs the field (keyboard closes) and the drag proceeds. Fixes H1 (iOS keeps a field focused after a tap
      // → the old "bail on any focused input" made the whole sheet undraggable).
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
        if (e.target === ae || (ae as Element).contains?.(e.target as Node)) {
          return; // pressing the focused field → typing context, no drag
        }
        (ae as HTMLElement).blur();
      }
      dyRef.current = 0;
      warnedRef.current = false;
      pointerActiveRef.current = true;
      if (sheetRef.current) sheetRef.current.setAttribute('data-tracking', 'true');
      drag.onPointerDown(e);
    },
    [drag, scroller],
  );

  // ── P1.3 scroll/drag handoff — one scoped non-passive touchmove listener + touch-driven takeover ────────
  useEffect(() => {
    const el = sheetRef.current;
    if (!open || !el) return;

    const onTouchStart = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      startTouchYRef.current = y;
      lastTouchYRef.current = y;
      claimedRef.current = false;
      claimStartYRef.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const y = t.clientY;
      const goingDown = y > lastTouchYRef.current;
      const sc = scrollRef?.current ?? el;
      const prevClaimed = claimedRef.current;
      const dyClaim = prevClaimed ? y - claimStartYRef.current : 0;
      const { claim } = resolveScrollClaim({ claimed: prevClaimed }, { scrollTop: sc.scrollTop, goingDown, dyClaim });

      if (claim && !prevClaimed) {
        // false→true: the sheet claims this frame.
        claimStartYRef.current = y;
        claimedRef.current = true;
        if (!pointerActiveRef.current) {
          // The pointer pipeline is terminal (scroll-triggered pointercancel) or never locked → touch takes over.
          touchDrivingRef.current = true;
          gestureRef.current = advance(createGesture(cfg()), { type: 'down', x: t.clientX, y, t: e.timeStamp }, cfg());
        }
      } else if (!claim && prevClaimed) {
        // true→false: two-way release — hand control back to native scroll for the same finger.
        claimedRef.current = false;
        if (touchDrivingRef.current && gestureRef.current) {
          const g = advance(gestureRef.current, { type: 'cancel', x: t.clientX, y, t: e.timeStamp }, cfg());
          endTouchDrive(primaryDelta(g, cfg()), false);
        }
        // pointer-driven: ceasing preventDefault lets native scroll start → pointercancel → pointer onEnd settles.
      }

      if (claimedRef.current) e.preventDefault();

      if (touchDrivingRef.current && gestureRef.current) {
        const prevPhase = gestureRef.current.phase;
        const g = advance(gestureRef.current, { type: 'move', x: t.clientX, y, t: e.timeStamp }, cfg());
        gestureRef.current = g;
        const dy = primaryDelta(g, cfg());
        applyMove(dy);
        if (prevPhase !== 'armed' && g.phase === 'armed') applyArmHaptic();
        if (g.phase === 'cancelled') endTouchDrive(dy, false);
      }

      lastTouchYRef.current = y;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchDrivingRef.current && gestureRef.current) {
        const ct = e.changedTouches[0];
        const type = e.type === 'touchcancel' ? 'cancel' : 'up';
        const g = advance(gestureRef.current, { type, x: ct?.clientX ?? 0, y: ct?.clientY ?? lastTouchYRef.current, t: e.timeStamp }, cfg());
        endTouchDrive(primaryDelta(g, cfg()), g.phase === 'committed');
      }
      // Belt-and-suspenders: a stray claim with no driver must never survive a touch sequence.
      claimedRef.current = false;
      claimStartYRef.current = 0;
    };

    // passive:false is scoped to THIS sheet element, active only while it's open — page-scroll threads are
    // untouched. This is the standard iOS/production bottom-sheet pattern; the "never preventDefault" rule is
    // about page-level listeners, not a per-sheet handoff.
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [open, scrollRef, cfg, applyMove, applyArmHaptic, endTouchDrive]);

  const handleScrimTap = useCallback(() => {
    if (dirty) {
      haptics.warn();
      return; // dirty sheets dismiss only via a labeled tap in the children.
    }
    runExit();
  }, [dirty, runExit]);

  if (!open) return null;

  return createPortal(
    // .root is positioning-only; the .backdrop sibling is the sole opacity target (Bug E).
    <div className={styles.root}>
      <div ref={backdropRef} className={styles.backdrop} data-testid="sheet-backdrop" onClick={handleScrimTap} />
      <div
        ref={sheetRef}
        className={styles.sheet}
        style={{ maxHeight }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid="draggable-sheet"
        data-dirty={dirty ? 'true' : 'false'}
        onPointerDown={handlePointerDown}
        onChangeCapture={onUserInput}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grab} aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
