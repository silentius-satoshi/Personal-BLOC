import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { DockTabView, DockTone } from './controlDockView';
import styles from './ControlDock.module.css';

/**
 * The control dock (sticky controls — spec `pbloc-spec-sticky-controls-v1.md`): a face's controls, kept in reach
 * while the face scrolls. LAYOUT ONLY — the face hands it each control (`content`) and each tab's words
 * (`controlDockView`); the dock owns which one is open, and where it sits.
 *
 * ONE per face, and the face's LAST child: `position: sticky; bottom` holds it on the window's bottom edge until the
 * face ends, where it settles under the disclaimer and never covers it.
 * 🔴 Never `position: fixed`: EdgeBackGesture's `.page` has `will-change: transform`, which makes it the containing
 * block for fixed descendants — a fixed dock scrolls away with the page (measured). Sticky also moves with the page
 * through a swipe-back.
 *
 * Under 1024 px (a phone, an iPad upright, a phone sideways): one tab per control, label over value, all always visible,
 * over ONE open control. Tapping the open tab folds it. The open panel is inset 14 px, so its controls start right of
 * EdgeBackGesture's 20 px swipe-back zone — a drag from a slider's left end moves the slider, never the page.
 * 1024 px and up: a bar floating 12 px above the window's edge — the `live` controls side by side, the rest as chips
 * whose panel opens UPWARD, so the chart at the top of the window stays in view. The panel follows the bar in the DOM
 * (so Tab goes chip → panel) and shows above it (`order: -1`). A second click or Escape folds it. Why 1024: at 768–900 px
 * both slider heads wrapped and the bar grew from 87 to 106 px (measured), and a touch screen there would get 32 px chips.
 *
 * Escape is heard on the DOCUMENT while a panel is open: Safari never focuses a clicked button, so a listener on the
 * dock alone would never hear it. An Escape typed into a value field is that field's (SliderInput cancels its own
 * edit); the next one folds the panel, and focus returns to its chip.
 *
 * ⚠ No `scroll-padding-bottom` on the body: it kept scrolled-to elements above the dock, but then focusing the dock
 * itself (Tab from the page into it) jumped the page by ~400 px — the browser reads a sticky element's own controls as
 * hidden under the padding (measured). Without it, Chromium's focus scrolling centres a control that is off screen.
 */
export interface DockPanel extends DockTabView {
  /** 1024 px and up: always shown in the bar. Otherwise a chip that opens upward. */
  live?: boolean;
  content: ReactNode;
}

export interface ControlDockProps {
  panels: DockPanel[];
}

/** Where the bar starts (R2) — below it, the tabs. */
const WIDE = '(min-width: 1024px)';
const TONE: Record<DockTone, string> = { plain: '', good: styles.good, bad: styles.bad };

export default function ControlDock({ panels }: ControlDockProps) {
  const wide = useMediaQuery(WIDE);
  // The first control is open under 1024 px at first (the month); from 1024 it is live, so nothing opens upward.
  const [open, setOpen] = useState<string | null>(panels[0]?.id ?? null);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  const panelId = `${useId()}-panel`;
  const dockRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  // The bar's open panel: a non-live control that is open. Every hook runs before the layout branch.
  const dropId = wide ? (panels.find((p) => !p.live && p.id === open)?.id ?? null) : null;

  useEffect(() => {
    if (dropId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A typed value's Escape belongs to its field: SliderInput cancels the edit, and the panel stays open.
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
      // Read before the fold: the panel's content unmounts with it.
      const a = document.activeElement;
      const returnFocus = a === null || a === document.body || (dockRef.current?.contains(a) ?? false);
      setOpen(null);
      if (returnFocus) chipRefs.current.get(dropId)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dropId]);

  if (!wide) {
    const current = panels.find((p) => p.id === open);
    return (
      <div className={styles.dock} role="region" aria-label="Controls">
        <div className={styles.tabs}>
          {panels.map((p) => (
            <button key={p.id} type="button" className={`${styles.tab} ${open === p.id ? styles.tabOn : ''}`}
              aria-expanded={open === p.id} aria-controls={open === p.id ? panelId : undefined}
              onClick={() => toggle(p.id)}>
              <span className={styles.tabLabel}>{p.label}</span>
              <span className={`${styles.tabValue} ${TONE[p.tone]}`}>{p.value}</span>
            </button>
          ))}
        </div>
        {current && <div id={panelId} className={styles.panel}>{current.content}</div>}
      </div>
    );
  }

  const drop = panels.find((p) => p.id === dropId);
  return (
    <div ref={dockRef} className={styles.dock} role="region" aria-label="Controls">
      <div className={styles.bar}>
        {panels.filter((p) => p.live).map((p) => <div key={p.id} className={styles.live}>{p.content}</div>)}
        <div className={styles.chips}>
          {panels.filter((p) => !p.live).map((p) => (
            <button key={p.id} type="button" className={`${styles.chip} ${open === p.id ? styles.chipOn : ''}`}
              ref={(el) => { if (el) chipRefs.current.set(p.id, el); else chipRefs.current.delete(p.id); }}
              aria-expanded={open === p.id} aria-controls={open === p.id ? panelId : undefined}
              onClick={() => toggle(p.id)}>
              {p.label} <b className={TONE[p.tone]}>{p.value}</b> <span aria-hidden="true">{open === p.id ? '▾' : '▴'}</span>
            </button>
          ))}
        </div>
      </div>
      {drop && <div id={panelId} className={styles.drop}>{drop.content}</div>}
    </div>
  );
}
