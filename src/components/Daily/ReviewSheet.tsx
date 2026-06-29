// Daily Mode P4c-3b — the reconcile Review sheet. Opened from the Month-scope reconcile banner; shows the
// month's rolled-up totals + why it needs review, with sign-off actions. confirmed/provisional are ORTHOGONAL:
//  - a clean unconfirmed month → a single "Confirm" (confirmMonth → confirmed:true).
//  - a provisional month → "Add balance reading" (opens EventSheet in setBalance → a real reading clears
//    provisional via the rollup) OR "Confirm as provisional" (confirmMonth — provisional SURVIVES; honest).
// Pure presentation — no store access; the host wires confirmMonth / the EventSheet. createPortal scrim/sheet
// mirrors MonthEventsModal.
import { createPortal } from 'react-dom';
import { fmtUSD } from '../../utils/format';
import type { MonthRollup } from './calendarModel';
import styles from './ReviewSheet.module.css';

interface ReviewSheetProps {
  open:          boolean;
  month:         number;
  rollup:        MonthRollup;
  isProvisional: boolean;
  onClose:       () => void;
  onConfirm:     () => void;     // → confirmMonth(month) (preserves provisional)
  onAddReading:  () => void;     // → open EventSheet in setBalance mode
}

export function ReviewSheet({ open, month, rollup, isProvisional, onClose, onConfirm, onAddReading }: ReviewSheetProps) {
  if (!open) return null;

  return createPortal(
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.grab} />
        <div className={styles.head}>
          <span className={styles.title}>Review Month {month}</span>
        </div>

        {/* Rolled-up totals (read-only) */}
        <div className={styles.summary}>
          <div className={styles.sumRow}>
            <span className={styles.sumLabel}>Drawn (expenses)</span>
            <span className={styles.sumVal}>{fmtUSD(rollup.streams.draw)}</span>
          </div>
          <div className={styles.sumRow}>
            <span className={styles.sumLabel}>Bought bitcoin</span>
            <span className={`${styles.sumVal} ${styles.sumValBtc}`}>+₿{rollup.streams.buyBtc.toFixed(4)}</span>
          </div>
          <div className={styles.sumRow}>
            <span className={styles.sumLabel}>BLOC paydown</span>
            <span className={styles.sumVal}>{fmtUSD(rollup.streams.paydown)}</span>
          </div>
          <div className={styles.sumRow}>
            <span className={styles.sumLabel}>Net collateral</span>
            <span className={`${styles.sumVal} ${styles.sumValBtc}`}>
              {rollup.netBtc >= 0 ? '+' : ''}₿{rollup.netBtc.toFixed(4)}
            </span>
          </div>
          <div className={styles.entriesNote}>
            from {rollup.entryCount} day {rollup.entryCount === 1 ? 'entry' : 'entries'}
          </div>
        </div>

        <div className={styles.why}>
          {isProvisional
            ? 'This month has a logged day with no balance reading, so its balances are carried-forward estimates.'
            : 'Confirm these figures are correct to sign off on the month.'}
        </div>

        {isProvisional ? (
          <div className={styles.actionsCol}>
            <button className={styles.primaryBtn} onClick={onAddReading}>Add balance reading</button>
            <button className={styles.secondaryBtn} onClick={onConfirm}>Confirm as provisional</button>
            <div className={styles.provNote}>
              Sign off without a reading — balances stay marked as estimated. You can add a reading later.
            </div>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          </div>
        ) : (
          <div className={styles.actionsRow}>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button className={styles.primaryBtn} onClick={onConfirm}>Confirm</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
