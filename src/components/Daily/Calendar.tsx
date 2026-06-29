// Daily Mode P4c-1a — the Week|Month calendar. RENDER + SELECT only: it shows day cells with pips and
// lets the user toggle scope / pick a day, but does NOT yet drive the activity card (P4c-1b consumes
// scope/selectedDay). Pure date math lives in calendarModel.ts; presentation aligned to
// mode-toggle-preview.html (.seg / .calcard / .week / .grid / .cell / .ind / .legend), using app tokens.
import { monthDateRange, weekDates, buildDayCells } from './calendarModel';
import type { DayEvent } from '../../simulation/types';
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
}

const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function Calendar({
  dayLog, advisorStartDate, currentMonth, scope, selectedDay, monthLabel, onScopeChange, onSelectDay,
}: CalendarProps) {
  const isMonth = scope === 'month';
  const dates = isMonth ? monthDateRange(advisorStartDate, currentMonth) : weekDates(selectedDay);
  const cells = buildDayCells(dayLog, dates);
  // Month grid: pad leading blanks so the first date lands under its weekday column (Mon=0).
  const leadBlanks = isMonth && cells.length > 0 ? cells[0].weekday : 0;

  return (
    <div>
      <div className={styles.seg} role="tablist" aria-label="Calendar scope">
        <button role="tab" aria-selected={scope === 'week'}
          className={scope === 'week' ? styles.segActive : ''} onClick={() => onScopeChange('week')}>Week</button>
        <button role="tab" aria-selected={scope === 'month'}
          className={scope === 'month' ? styles.segActive : ''} onClick={() => onScopeChange('month')}>Month</button>
      </div>

      <div className={styles.calcard}>
        <div className={styles.calTitle}>{isMonth ? monthLabel : 'This week'}</div>

        {isMonth && (
          <div className={styles.wdRow}>
            {WD.map((w, i) => <span key={i} className={styles.wd}>{w}</span>)}
          </div>
        )}

        <div className={isMonth ? styles.grid : styles.week}>
          {isMonth && Array.from({ length: leadBlanks }, (_, i) => <span key={`b${i}`} />)}
          {cells.map((c) => {
            const sel = c.date === selectedDay;
            return (
              <button
                key={c.date}
                className={`${styles.cell} ${isMonth ? styles.cellMonth : ''} ${sel ? styles.cellSel : ''}`}
                aria-pressed={sel}
                onClick={() => onSelectDay(c.date)}
              >
                {!isMonth && <span className={styles.wdl}>{WD[c.weekday]}</span>}
                <span className={styles.num}>{c.day}</span>
                <span className={styles.ind}>
                  {c.pips.map((p, i) => {
                    const cls = p === 'logged' ? `${styles.m} ${styles.mG}`
                      : p === 'reading' ? `${styles.m} ${styles.mRing}`
                      : `${styles.m} ${styles.mCb}`;
                    return <span key={i} className={cls} />;
                  })}
                </span>
              </button>
            );
          })}
        </div>

        <div className={styles.legend}>
          <span className={styles.lg}><span className={`${styles.lgD} ${styles.lgG}`} />logged</span>
          <span className={styles.lg}><span className={`${styles.lgD} ${styles.lgRing}`} />reading</span>
          <span className={styles.lg}><span className={`${styles.lgD} ${styles.lgCb}`} />CB collateral</span>
        </div>
      </div>
    </div>
  );
}
