// Daily Mode P4c-1b — the month-events modal (D4). Opened from the Month-scope "from N day entries"
// affordance; lists the month's individual events grouped by day, each editable (reuses the P4b-2
// EventSheet edit mode via onEditEvent → the host closes the modal then opens the edit sheet).
// Read-only for viewers (rows non-interactive). Pure presentation — grouping via calendarModel.
import { createPortal } from 'react-dom';
import { groupEventsByDay } from './calendarModel';
import { describeDayEvent } from './dailyView';
import { isEditableKind } from './EventSheet';
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

export function MonthEventsModal({ open, month, events, viewerMode, onClose, onEditEvent }: MonthEventsModalProps) {
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
          <div className={styles.groups}>
            {groups.map((g) => (
              <div key={g.date} className={styles.dayGroup}>
                <div className={styles.dayHeader}>{fmtDay(g.date)}</div>
                {g.events.map((ev) => {
                  const d = describeDayEvent(ev);
                  const t = tone(ev.kind);
                  const editable = !viewerMode && isEditableKind(ev.kind);
                  const openEdit = () => onEditEvent(ev);
                  return (
                    <div
                      key={ev.id}
                      className={`${styles.row} ${editable ? styles.rowClickable : ''}`}
                      role={editable ? 'button' : undefined}
                      tabIndex={editable ? 0 : undefined}
                      onClick={editable ? openEdit : undefined}
                      onKeyDown={editable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(); } } : undefined}
                    >
                      <span className={styles.rowType}>
                        {t.ring ? <span className={styles.ring} /> : <span className={`${styles.dot} ${t.dot}`} />}
                        {d.label}
                      </span>
                      <span className={`${styles.rowAmt} ${t.amt}`}>{d.detail}</span>
                    </div>
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
