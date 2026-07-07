// Daily Mode P4c-1a — the Week|Month calendar. RENDER + SELECT + (P2) SWIPE-PAGE + LONG-PRESS-ADD. Pure date
// math lives in calendarModel.ts; the grid/week unit is wrapped in a shared <SwipeStrip> that pages months
// (or weeks) — the drag animates the view, real state changes only at rest (design.md §3.1). A 500ms
// long-press on a day cell opens the pre-dated add sheet (P2).
import { useRef, type ReactNode } from 'react';
import { monthDateRange, weekDates, buildDayCells, type DayCell as DayCellData } from './calendarModel';
import type { DayEvent } from '../../simulation/types';
import { SwipeStrip } from '../ui/SwipeStrip';
import { useLongPress } from '../../hooks/useLongPress';
import styles from './Calendar.module.css';

interface CalendarProps {
  dayLog:           DayEvent[];
  advisorStartDate: string;
  currentMonth:     number;
  scope:            'week' | 'month';
  selectedDay:      string;
  monthLabel:       string;
  onScopeChange:    (s: 'week' | 'month') => void;
  onSelectDay:      (iso: string) => void;
  onPrevMonth?:     () => void;
  onNextMonth?:     () => void;
  canPrevMonth?:    boolean;
  canNextMonth?:    boolean;
  // P2 — week-scope paging (added: there was no week nav before). Shift selectedDay by ∓7 days.
  onPrevWeek?:      () => void;
  onNextWeek?:      () => void;
  canPrevWeek?:     boolean;
  canNextWeek?:     boolean;
  // P2 — long-press a day → quick add (parent selects the day + opens the sheet, respecting the future guard).
  onLongPressDay?:  (iso: string) => void;
}

const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** UTC ±days shift of a yyyy-mm-dd string (calendarModel's ms helpers are module-private). */
function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** One day cell — its own long-press (hooks can't run in a map). */
function DayCell({ cell, isMonth, selected, onSelect, onLongPressDay, registerCancel }: {
  cell: DayCellData;
  isMonth: boolean;
  selected: boolean;
  onSelect: (iso: string) => void;
  onLongPressDay?: (iso: string) => void;
  registerCancel: (cancel: (() => void) | null) => void;
}) {
  const lp = useLongPress({ onLongPress: () => onLongPressDay?.(cell.date), enabled: !!onLongPressDay });
  return (
    <button
      className={`${styles.cell} ${isMonth ? styles.cellMonth : ''} ${selected ? styles.cellSel : ''}`}
      aria-pressed={selected}
      data-testid="day-cell"
      data-date={cell.date}
      data-holding={lp.holding ? 'true' : undefined}
      onPointerDown={(e) => { registerCancel(lp.cancel); lp.handlers.onPointerDown(e); }}
      onPointerMove={lp.handlers.onPointerMove}
      onPointerUp={(e) => { registerCancel(null); lp.handlers.onPointerUp(e); }}
      onPointerCancel={(e) => { registerCancel(null); lp.handlers.onPointerCancel(e); }}
      onClick={() => { if (lp.shouldSuppressClick()) return; onSelect(cell.date); }}
    >
      {!isMonth && <span className={styles.wdl}>{WD[cell.weekday]}</span>}
      <span className={styles.num}>{cell.day}</span>
      <span className={styles.ind}>
        {cell.pips.map((p, i) => {
          const cls = p === 'logged' ? `${styles.m} ${styles.mG}`
            : p === 'reading' ? `${styles.m} ${styles.mRing}`
            : `${styles.m} ${styles.mCb}`;
          return <span key={i} className={cls} />;
        })}
      </span>
    </button>
  );
}

export function Calendar({
  dayLog, advisorStartDate, currentMonth, scope, selectedDay, monthLabel, onScopeChange, onSelectDay,
  onPrevMonth, onNextMonth, canPrevMonth, canNextMonth,
  onPrevWeek, onNextWeek, canPrevWeek, canNextWeek, onLongPressDay,
}: CalendarProps) {
  const isMonth = scope === 'month';
  // The pointerdown-registered cancel of whichever cell is holding — invoked when the strip axis-locks (a swipe
  // must abort a pending long-press; the strip captures the pointer so the cell's own move handler can't).
  const activeCancelRef = useRef<(() => void) | null>(null);

  const paneDates = (offset: -1 | 0 | 1): string[] =>
    isMonth ? monthDateRange(advisorStartDate, currentMonth + offset)
            : weekDates(shiftISO(selectedDay, offset * 7));

  const renderPane = (offset: -1 | 0 | 1): ReactNode => {
    const cells = buildDayCells(dayLog, paneDates(offset));
    const leadBlanks = isMonth && cells.length > 0 ? cells[0].weekday : 0;
    return (
      <>
        {isMonth && (
          <div className={styles.wdRow}>
            {WD.map((w, i) => <span key={i} className={styles.wd}>{w}</span>)}
          </div>
        )}
        <div className={isMonth ? styles.grid : styles.week}>
          {isMonth && Array.from({ length: leadBlanks }, (_, i) => <span key={`b${i}`} />)}
          {cells.map((c) => (
            <DayCell
              key={c.date}
              cell={c}
              isMonth={isMonth}
              selected={c.date === selectedDay}
              onSelect={onSelectDay}
              onLongPressDay={offset === 0 ? onLongPressDay : undefined}
              registerCancel={(fn) => { activeCancelRef.current = fn; }}
            />
          ))}
        </div>
      </>
    );
  };

  const onPage = (dir: -1 | 1) => {
    if (isMonth) (dir === -1 ? onPrevMonth : onNextMonth)?.();
    else (dir === -1 ? onPrevWeek : onNextWeek)?.();
  };
  const canPage = (dir: -1 | 1): boolean =>
    isMonth ? !!(dir === -1 ? canPrevMonth : canNextMonth)
            : !!(dir === -1 ? canPrevWeek : canNextWeek);

  return (
    <div>
      <div className={styles.seg} role="tablist" aria-label="Calendar scope">
        <button role="tab" aria-selected={scope === 'week'}
          className={`${styles.segBtn} ${scope === 'week' ? styles.segActive : ''}`} onClick={() => onScopeChange('week')}>Week</button>
        <button role="tab" aria-selected={scope === 'month'}
          className={`${styles.segBtn} ${scope === 'month' ? styles.segActive : ''}`} onClick={() => onScopeChange('month')}>Month</button>
      </div>

      <div className={styles.calcard}>
        {isMonth && onPrevMonth ? (
          <div className={styles.calNav}>
            <button className={styles.calNavBtn} onClick={onPrevMonth} disabled={!canPrevMonth} aria-label="Previous month">‹</button>
            <span className={styles.calNavLabel}>{monthLabel}</span>
            <button className={styles.calNavBtn} onClick={onNextMonth} disabled={!canNextMonth} aria-label="Next month">›</button>
          </div>
        ) : (
          <div className={styles.calTitle}>{isMonth ? monthLabel : 'This week'}</div>
        )}

        {/* P2 — the wdRow+grid unit pages via SwipeStrip; a day tap is protected by slop 8. */}
        <SwipeStrip
          onPage={onPage}
          canPage={canPage}
          renderPane={renderPane}
          onSwipeStart={() => activeCancelRef.current?.()}
        />

        <div className={styles.legend}>
          <span className={styles.lg}><span className={`${styles.lgD} ${styles.lgG}`} />logged</span>
          <span className={styles.lg}><span className={`${styles.lgD} ${styles.lgRing}`} />reading</span>
          <span className={styles.lg}><span className={`${styles.lgD} ${styles.lgCb}`} />CB collateral</span>
        </div>
      </div>
    </div>
  );
}
