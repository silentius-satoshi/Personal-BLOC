// Daily Mode P4c-3b + Logging Consolidation §2 — the reconcile Review sheet (the SIGN-OFF). Opened from
// the Month-scope reconcile banner; shows the month's rolled-up totals + a SIGN-OFF DETAILS group, and
// signs the month off in ONE atomic confirmMonth(month, extras) write. confirmed/provisional are
// ORTHOGONAL:
//  - a clean unconfirmed month → "Confirm" (confirmMonth → confirmed:true).
//  - a provisional month → "Add balance reading" (opens EventSheet in setBalance → a real reading clears
//    provisional via the rollup) OR "Confirm as provisional" (confirmMonth — provisional SURVIVES; honest).
// Mostly-presentational: it holds only the sign-off field drafts (seeded fresh each open — it unmounts when
// closed) and hands them back via onConfirm(extras); the host owns confirmMonth + the side-effects.
import { useState, useEffect } from 'react';
import { DraggableSheet } from '../ui/DraggableSheet';
import { fmtUSD } from '../../utils/format';
import type { MonthRollup } from './calendarModel';
import styles from './ReviewSheet.module.css';

export interface ConfirmExtras {
  expensesActual?: number;
  ndpPaid?:        number;
  strikeMinPaid?:  number;
  strikeMinSource?: 'income' | 'roll';
}

interface ReviewSheetProps {
  open:          boolean;
  month:         number;
  rollup:        MonthRollup;
  isProvisional: boolean;
  // §2b sign-off details context (owner-computed):
  source:          'income' | 'roll';
  strikeMinPrefill: number;   // sum(month's minPayment events) ?? blocStatementMinimum ?? estimate
  statementIsSet:  boolean;   // chip: true → 'statement', false → 'est.'
  ndpActive:       boolean;   // roll mode + NDP not OK → show the NDP row
  ndpPrefill:      number;    // estimated NDP amount
  onClose:       () => void;
  onConfirm:     (extras: ConfirmExtras) => void;   // → confirmMonth(month, extras) + side-effects
  onAddReading:  () => void;                         // → open EventSheet in setBalance mode
}

export function ReviewSheet({
  open, month, rollup, isProvisional,
  source, strikeMinPrefill, statementIsSet, ndpActive, ndpPrefill,
  onClose, onConfirm, onAddReading,
}: ReviewSheetProps) {
  const isIncome = source === 'income';
  // Drafts seed fresh on each open (the sheet unmounts when closed → useState initializers re-run).
  const [expenses, setExpenses]     = useState(Math.round(rollup.streams.draw));
  const [strikeMin, setStrikeMin]   = useState(Math.round(strikeMinPrefill));
  const [ndpChecked, setNdpChecked] = useState(false);
  const [ndpPaid, setNdpPaid]       = useState(Math.round(ndpPrefill));

  // P1 DraggableSheet dirty-guard — a `touched` flag flipped only by real user input (DraggableSheet's
  // onChangeCapture). Reset on each open (robust whether the sheet mounts fresh or stays mounted). A pristine
  // review flick-dismisses; any edit to a sign-off field guards it (dismissal becomes tap-only).
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) setTouched(false); }, [open]);

  if (!open) return null;

  const dirty = touched;

  const buildExtras = (): ConfirmExtras => ({
    expensesActual: expenses,
    ...(isIncome ? { strikeMinPaid: strikeMin, strikeMinSource: 'income' as const } : { strikeMinSource: 'roll' as const }),
    ...(!isIncome && ndpActive && ndpChecked ? { ndpPaid } : {}),
  });

  return (
    <DraggableSheet open={open} onDismiss={onClose} dirty={dirty} maxHeight="88vh" labelledBy="reviewSheetTitle" onUserInput={() => setTouched(true)}>
        <div className={styles.head}>
          <span id="reviewSheetTitle" className={styles.title}>Review Month {month}</span>
        </div>

        {/* Rolled-up totals (read-only, the hero) */}
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

        {/* §2 — SIGN-OFF DETAILS (editable actuals that land with the confirm) */}
        <div className={styles.detailsGroup}>
          <div className={styles.detailsLabel}>SIGN-OFF DETAILS</div>

          <div className={styles.detailRow}>
            <span className={styles.detailName}>Expenses actually paid</span>
            <div className={styles.detailField}>
              <span className={styles.detailPrefix}>$</span>
              <input type="number" inputMode="decimal" className={styles.detailInput} value={expenses} step={50}
                onChange={(e) => setExpenses(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div className={styles.detailHint}>From the ledger's draws — adjust if you covered expenses from savings.</div>

          {isIncome && (
            <>
              <div className={styles.detailRow}>
                <span className={styles.detailName}>
                  Strike minimum paid
                  <span className={`${styles.chip} ${statementIsSet ? styles.chipStatement : styles.chipEst}`}>{statementIsSet ? 'statement' : 'est.'}</span>
                </span>
                <div className={styles.detailField}>
                  <span className={styles.detailPrefix}>$</span>
                  <input type="number" inputMode="decimal" className={styles.detailInput} value={strikeMin} step={10}
                    onChange={(e) => setStrikeMin(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              <div className={styles.detailHint}>The monthly minimum you paid from income this month.</div>
            </>
          )}

          {!isIncome && ndpActive && (
            <>
              <label className={styles.detailCheckRow}>
                <span className={styles.detailName}>NDP payment made this year</span>
                <input type="checkbox" checked={ndpChecked} onChange={(e) => setNdpChecked(e.target.checked)} />
              </label>
              {ndpChecked && (
                <div className={styles.detailRow}>
                  <span className={styles.detailName}>NDP amount</span>
                  <div className={styles.detailField}>
                    <span className={styles.detailPrefix}>$</span>
                    <input type="number" inputMode="decimal" className={styles.detailInput} value={ndpPaid} step={10}
                      onChange={(e) => setNdpPaid(parseFloat(e.target.value) || 0)} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.why}>
          {isProvisional
            ? 'This month has a logged day with no balance reading, so its balances are carried-forward estimates.'
            : 'Confirm these figures are correct to sign off on the month.'}
        </div>

        {isProvisional ? (
          <div className={styles.actionsCol}>
            <button className={styles.primaryBtn} onClick={onAddReading}>Add balance reading</button>
            <button className={styles.secondaryBtn} onClick={() => onConfirm(buildExtras())}>Confirm as provisional</button>
            <div className={styles.provNote}>
              Sign off without a reading — balances stay marked as estimated. You can add a reading later.
            </div>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          </div>
        ) : (
          <div className={styles.actionsRow}>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button className={styles.primaryBtn} onClick={() => onConfirm(buildExtras())}>Confirm</button>
          </div>
        )}
    </DraggableSheet>
  );
}
