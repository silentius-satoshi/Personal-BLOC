import { useEffect, useId, useLayoutEffect, useReducer, useRef, type ReactNode } from 'react';
import { nextTipState, tipShift } from './infoTipModel';
import styles from './InfoTip.module.css';

/**
 * A small ⓘ affordance next to a heading that reveals explanatory copy on demand.
 *
 * ⚠ NOT a CSS `:hover` tooltip. This is a touch-first PWA (DraggableSheet / SwipeStrip / EdgeBackGesture),
 * and hover does not exist on a phone — a hover-only tip would be invisible to most of the people using it.
 * The rules (`nextTipState`, spec `pbloc-spec-infotip-fit-v1.md`):
 *  - hover opens it only for a mouse (`pointerType === 'mouse'`). A touch tap fires a compat mouseenter before its
 *    click: with the old click toggle that shut the tip in ONE tap (Chromium), and with pin-on-press an ungated hover
 *    would leave iOS needing three taps to close it;
 *  - a tap or click shows it and keeps it open, until a second tap or click on the ⓘ, Escape, or a tap or click
 *    outside;
 *  - moving the mouse away closes only a tip that hover opened.
 * Hover uses native pointerenter / pointerleave listeners on the wrap: they fire exactly on it and don't depend on
 * React's over/out emulation, whose `toElement` fallback is engine-specific.
 *
 * Placement — measure and nudge. CSS hangs the panel under the ⓘ; before paint, and again on every resize, it slides
 * sideways (`tipShift`) to sit inside the 16px gutters. No fixed side works: on a phone the ⓘs sit left of centre and
 * the panel is about 90% of the screen wide.
 *
 * ⚠ The panel renders only while open. Keeping it mounted-but-hidden would leave its text in the
 * accessibility tree and in Cmd-F, which is how a "hidden" tip ends up read aloud on every heading.
 */
export interface InfoTipProps {
  /** Screen-reader name for the trigger, e.g. "About the cold-storage sweep". Required — "info" is useless. */
  label: string;
  children: ReactNode;
}

export function InfoTip({ label, children }: InfoTipProps) {
  const [tip, send] = useReducer(nextTipState, 'closed');
  const open = tip !== 'closed';
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') send('dismiss'); };
    // `pointerdown`, not `click`: a click listener fires after the trigger's own onClick has already
    // opened it, which would slam it shut again in the same gesture.
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) send('dismiss');
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // Hover: a mouse's only. The panel sits inside the wrap, so moving onto it doesn't count as leaving.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const enter = (e: PointerEvent) => { if (e.pointerType === 'mouse') send('hoverIn'); };
    const leave = (e: PointerEvent) => { if (e.pointerType === 'mouse') send('hoverOut'); };
    wrap.addEventListener('pointerenter', enter);
    wrap.addEventListener('pointerleave', leave);
    return () => {
      wrap.removeEventListener('pointerenter', enter);
      wrap.removeEventListener('pointerleave', leave);
    };
  }, []);

  // Placement: slide the panel inside the gutters before paint, and again on every resize.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const place = () => {
      panel.style.transform = '';   // measure from where the CSS puts it, never from the last shift
      const r = panel.getBoundingClientRect();
      const dx = tipShift(r.left, r.right, document.documentElement.clientWidth);
      panel.style.transform = dx === 0 ? '' : `translateX(${dx}px)`;
    };
    place();
    window.addEventListener('resize', place);   // a rotation fires resize too
    return () => window.removeEventListener('resize', place);
  }, [open]);

  return (
    <span className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => send('press')}
      >
        i
      </button>
      {open && (
        <span ref={panelRef} className={styles.panel} id={panelId} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
