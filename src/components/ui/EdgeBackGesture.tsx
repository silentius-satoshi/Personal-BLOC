import { useRef, useState, type ReactNode } from 'react';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { rubberBand } from '../../lib/gestureModel';
import styles from './EdgeBackGesture.module.css';

/**
 * EdgeBackGesture (Gesture & Motion System — P3) — iOS-style swipe-back from the LEFT bezel (standalone
 * PWAs have no system swipe-back). A 20px left-edge capture zone drives `usePointerDrag` (axis 'x'); the
 * page (children) translates right 1:1 while `renderUnder()` — the surface back-navigation reveals — rides
 * in behind it at scale(0.92)→1 with a 40%→0 dim (iOS parallax grammar). Commit (≥50% width OR flick) →
 * animate off-right → `onBack()`; else spring back.
 *
 * SCOPE: mounts ONLY on the two simple-mode "← Back" surfaces (AppShell Branch H/I) — NEVER on an
 * auth/viewer gate, onboarding, or the full-mode shell. The gesture only NAVIGATES (non-negotiable 1);
 * the visible "← Back" button remains the accessible path (the zone is aria-hidden).
 *
 * ⚠ The zone is `touch-action: pan-y` (NOT `none`): a vertical stroke starting at the bezel must still
 * scroll the page natively THROUGH the zone; the contested axis here is horizontal, which pan-y leaves to
 * our pointer stream. (If a device gate later shows WebKit cancelling horizontal edge drags, the fallback
 * is the P1 selective-preventDefault pattern scoped to the zone.)
 *
 * ⚠ Tap forwarding: the left 20px must never be a dead strip — a sub-slop tap on the zone is re-dispatched
 * to the underlying content via `document.elementFromPoint`.
 */

export interface EdgeBackGestureProps {
  onBack: () => void;
  /** The surface back-nav reveals — mounted only during an active gesture (at pointerdown, to hide the cost). */
  renderUnder?: () => ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

const SLOP = 8;
const EXIT_MS = 200;   // --motion-standard
const SETTLE_MS = 320; // --motion-settle

export function EdgeBackGesture({ onBack, renderUnder, disabled, children }: EdgeBackGestureProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const downRef = useRef({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const width = () => wrapRef.current?.clientWidth ?? 0;

  const setPage = (tx: number, transition: string) => {
    const el = pageRef.current;
    if (el) { el.style.transition = transition; el.style.transform = `translateX(${tx}px)`; }
  };
  const paintUnder = (progress: number) => {
    if (underRef.current) underRef.current.style.transform = `scale(${(0.92 + 0.08 * progress).toFixed(4)})`;
    if (dimRef.current) dimRef.current.style.opacity = String(0.4 * (1 - progress));
  };

  const drag = usePointerDrag({
    axis: 'x',
    slop: SLOP,
    armThreshold: 24,
    commitThreshold: width() * 0.5 || 200, // self-corrects on the setDragging re-render; read at release time
    commitVelocity: 700,
    enabled: !disabled,
    onMove: (dx) => {
      if (reducedRef.current) return; // no continuous tracking under reduced motion
      const eff = dx > 0 ? dx : rubberBand(dx, 16); // rightward tracks; leftward reveals nothing
      const w = width() || 1;
      setPage(Math.max(0, eff), 'none');
      paintUnder(Math.min(Math.max(dx / w, 0), 1));
    },
    onEnd: (dx, dy, _v, committed) => {
      // Tap forwarding — a sub-slop press on the zone dispatches a click to the content beneath (the left
      // 20px must not be a dead strip). Total movement < slop ⇒ it was a tap, not a drag.
      if (!committed && Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
        setPage(0, 'none');
        const zone = zoneRef.current;
        if (zone) {
          const x = downRef.current.x + dx, y = downRef.current.y + dy;
          zone.style.pointerEvents = 'none';
          try { (document.elementFromPoint(x, y) as HTMLElement | null)?.click(); }
          finally { zone.style.pointerEvents = ''; }
        }
        setDragging(false);
        return;
      }
      const doBack = committed && dx > 0;
      if (doBack) {
        if (reducedRef.current) { onBack(); return; }
        setPage(width(), 'transform var(--motion-standard) var(--ease-standard)');
        paintUnder(1);
        window.setTimeout(onBack, EXIT_MS);
        return;
      }
      // Spring back to rest, then unmount the under-layer.
      setPage(0, reducedRef.current ? 'none' : 'transform var(--motion-settle) var(--ease-spring)');
      paintUnder(0);
      window.setTimeout(() => setDragging(false), reducedRef.current ? 0 : SETTLE_MS);
    },
  });

  const onZoneDown = (e: React.PointerEvent) => {
    if (disabled) return;
    downRef.current = { x: e.clientX, y: e.clientY };
    if (renderUnder) setDragging(true); // mount the under-layer NOW (during slop) to hide the mount cost
    drag.onPointerDown(e);
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      {dragging && renderUnder && (
        <div ref={underRef} className={styles.under} aria-hidden="true">
          {renderUnder()}
          <div ref={dimRef} className={styles.dim} style={{ opacity: 0.4 }} />
        </div>
      )}
      <div ref={pageRef} className={styles.page}>{children}</div>
      <div
        ref={zoneRef}
        className={styles.zone}
        aria-hidden="true"
        data-testid="edge-back-zone"
        onPointerDown={onZoneDown}
      />
    </div>
  );
}
