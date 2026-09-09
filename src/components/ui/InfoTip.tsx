import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './InfoTip.module.css';

/**
 * A small ⓘ affordance next to a heading that reveals explanatory copy on demand.
 *
 * ⚠ NOT a CSS `:hover` tooltip. This is a touch-first PWA (DraggableSheet / SwipeStrip / EdgeBackGesture),
 * and hover does not exist on a phone — a hover-only tip would be invisible to most of the people using it.
 * So the tip is a real toggle: tap or click opens it, hover ALSO opens it on pointer devices, Escape
 * closes it, and a pointerdown anywhere outside closes it.
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // `pointerdown`, not `click`: a click listener fires after the trigger's own onClick has already
    // toggled it open, which would slam it shut again in the same gesture.
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <span
      className={styles.wrap}
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <span className={styles.panel} id={panelId} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
