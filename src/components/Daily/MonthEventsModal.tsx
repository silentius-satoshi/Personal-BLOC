// Daily Mode P4c-1b — the month-events modal (D4). Opened from the Month-scope "from N day entries"
// affordance; lists the month's individual events grouped by day, each editable (reuses the P4b-2
// EventSheet edit mode via onEditEvent → the host closes the modal then opens the edit sheet).
// P2 — editable rows are SWIPE-TO-DELETE (design.md §3.3): left-swipe reveals a Delete panel; deletion is a
// TAP on the revealed button (non-negotiable 1 — velocity NEVER deletes). Read-only for viewers.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { groupEventsByDay } from './calendarModel';
import { describeDayEvent } from './dailyView';
import { isEditableKind } from './EventSheet';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { rubberBand } from '../../lib/gestureModel';
import { haptics } from '../../lib/haptics';
import type { DayEvent } from '../../simulation/types';
import styles from './MonthEventsModal.module.css';

interface MonthEventsModalProps {
  open:             boolean;
  month:            number;
  events:           DayEvent[];
  advisorStartDate: string;   // reserved (grouping is date-based); kept for caller symmetry
  viewerMode:       boolean;
  onClose:          () => void;
  onEditEvent:      (ev: DayEvent) => void;
  onDeleteEvent:    (ev: DayEvent) => void;   // P2 — host deletes + shows the undo snackbar
}

// ISO yyyy-mm-dd → "Sun, Jan 5" (local, no UTC shift — parse the parts).
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function tone(kind: DayEvent['kind']): { dot: string; ring: boolean; amt: string } {
  switch (kind) {
    case 'buy':      return { dot: styles.dotO, ring: false, amt: styles.amtPos };
    case 'paydown':  return { dot: styles.dotG, ring: false, amt: styles.amtNeu };
    case 'draw':     return { dot: styles.dotN, ring: false, amt: styles.amtNeu };
    case 'minPayment': return { dot: styles.dotR, ring: false, amt: styles.amtNeu };
    case 'deposit':  return { dot: styles.dotG, ring: false, amt: styles.amtNeu };
    case 'withdraw': return { dot: styles.dotY, ring: false, amt: styles.amtNeu };
    case 'balanceReading':
    case 'cbCollateralReading': return { dot: '', ring: true, amt: styles.amtAnchor };
  }
}

const REVEAL = 96;    // px the row rests open at
const ARM = 64;       // px at which the delete arms (rest-open threshold + haptic)
const COLLAPSE_MS = 200;

/** One swipe-to-delete row (editable events only). Left-swipe reveals Delete; a TAP on it deletes. */
function SwipeDeleteRow({ ev, isOpen, onOpenChange, onDelete, onEdit }: {
  ev: DayEvent;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dxRef = useRef(0);
  const armedRef = useRef(false);
  const [collapsing, setCollapsing] = useState(false);
  const d = describeDayEvent(ev);
  const t = tone(ev.kind);

  const paint = (tx: number, transition: string) => {
    const row = rowRef.current;
    if (row) { row.style.transition = transition; row.style.transform = `translateX(${tx}px)`; }
    // DELETE label opacity ramps 0→1 across 40→64px of leftward reveal.
    const panel = panelRef.current;
    if (panel) panel.style.opacity = String(Math.min(Math.max((-tx - 40) / (ARM - 40), 0), 1));
  };

  // Rest position is driven by isOpen — this also springs the row shut when ANOTHER row opens (one-at-a-time).
  useEffect(() => { paint(isOpen ? -REVEAL : 0, 'transform var(--motion-settle) var(--ease-spring)'); }, [isOpen]);

  const drag = usePointerDrag({
    axis: 'x',
    slop: 8,
    armThreshold: ARM,
    // NON-NEGOTIABLE 1: no velocity/full-swipe delete — a flick NEVER deletes ledger data. Deletion is always
    // a tap on the revealed button; the gesture only reveals. Infinite thresholds ⇒ the model never commits.
    commitThreshold: Infinity,
    commitVelocity: Infinity,
    onArm: () => {
      // Direction-gate (same class as P1 DraggableSheet): the model arms sign-blind; only a LEFTWARD drag reveals.
      if (dxRef.current >= 0) return;
      armedRef.current = true;
      haptics.tick();
    },
    onDisarm: () => { armedRef.current = false; },
    onMove: (dx) => {
      dxRef.current = dx;
      const tx = dx < 0 ? Math.max(-REVEAL, dx) : rubberBand(dx, 16); // left reveals to 96; right rubber-bands, reveals nothing
      paint(tx, 'none');
    },
    onEnd: (dx) => {
      const willOpen = armedRef.current && dx < 0;
      armedRef.current = false;
      paint(willOpen ? -REVEAL : 0, 'transform var(--motion-settle) var(--ease-spring)');
      onOpenChange(willOpen);
    },
  });

  const collapseThenDelete = () => {
    setCollapsing(true);
    window.setTimeout(onDelete, COLLAPSE_MS);
  };

  return (
    <div className={`${styles.rowOuter} ${collapsing ? styles.collapsing : ''}`}>
      <div className={styles.swipeWrap}>
        <div ref={panelRef} className={styles.deletePanel} style={{ opacity: isOpen ? 1 : 0 }}>
          <button className={styles.deleteReveal} data-testid="swipe-delete-btn" aria-label="Delete event" onClick={collapseThenDelete}>
            <span aria-hidden="true">🗑</span> DELETE
          </button>
        </div>
        <div
          ref={rowRef}
          className={`${styles.row} ${styles.rowClickable}`}
          data-testid="event-row"
          data-open={isOpen ? 'true' : undefined}
          role="button"
          tabIndex={0}
          onPointerDown={drag.onPointerDown}
          onClick={() => { if (dxRef.current !== 0 || isOpen) return; onEdit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}
        >
          <span className={styles.rowType}>
            {t.ring ? <span className={styles.ring} /> : <span className={`${styles.dot} ${t.dot}`} />}
            {d.label}
          </span>
          <span className={`${styles.rowAmt} ${t.amt}`}>{d.detail}</span>
          {/* a11y: deletion never requires the gesture — a focusable Delete (visible on focus). */}
          <button className={styles.a11yDelete} aria-label="Delete event" onClick={(e) => { e.stopPropagation(); collapseThenDelete(); }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export function MonthEventsModal({ open, month, events, viewerMode, onClose, onEditEvent, onDeleteEvent }: MonthEventsModalProps) {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  if (!open) return null;
  const groups = groupEventsByDay(events);

  return createPortal(
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.grab} />
        <div className={styles.head}>
          <span className={styles.title}>Month {month} · {events.length} entr{events.length === 1 ? 'y' : 'ies'}</span>
        </div>

        {groups.length === 0 ? (
          <div className={styles.empty}>No entries this month.</div>
        ) : (
          <div className={styles.groups} onScroll={() => setOpenRowId(null) /* scrolling closes the open row */}>
            {groups.map((g) => (
              <div key={g.date} className={styles.dayGroup}>
                <div className={styles.dayHeader}>{fmtDay(g.date)}</div>
                {g.events.map((ev) => {
                  const editable = !viewerMode && isEditableKind(ev.kind);
                  if (!editable) {
                    const d = describeDayEvent(ev);
                    const t = tone(ev.kind);
                    return (
                      <div key={ev.id} className={styles.row}>
                        <span className={styles.rowType}>
                          {t.ring ? <span className={styles.ring} /> : <span className={`${styles.dot} ${t.dot}`} />}
                          {d.label}
                        </span>
                        <span className={`${styles.rowAmt} ${t.amt}`}>{d.detail}</span>
                      </div>
                    );
                  }
                  return (
                    <SwipeDeleteRow
                      key={ev.id}
                      ev={ev}
                      isOpen={openRowId === ev.id}
                      onOpenChange={(o) => {
                        if (o) setOpenRowId(ev.id);                                   // opening this row (closes others)
                        else setOpenRowId((prev) => (prev === ev.id ? null : prev));  // this row sprang shut
                      }}
                      onDelete={() => { setOpenRowId(null); onDeleteEvent(ev); }}
                      onEdit={() => onEditEvent(ev)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.doneBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
