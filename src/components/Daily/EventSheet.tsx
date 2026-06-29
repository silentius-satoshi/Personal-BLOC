import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { bucketEventToMonth } from '../../simulation/logUtils';
import { fmtUSD } from '../../utils/format';
import { NumberInput } from '../ui/NumberInput';
import { readingComplete, buildEventsFromSheet, type SheetType, type SheetState } from './eventSheetModel';
import type { DayEvent, DayEventKind } from '../../simulation/types';
import styles from './EventSheet.module.css';

interface EventSheetProps {
  open: boolean;
  onClose: () => void;
  editEvent?: DayEvent;   // P4b-2 — when set, the sheet opens in type-locked EDIT mode for this event
  targetDate?: string;    // P4c-2 — ISO yyyy-mm-dd the add-sheet logs to (the calendar's selectedDay); ignored in edit mode
}

// P4b-2 — the DayEvent kinds the sheet can edit (map 1:1 to a SheetType). withdraw + cbCollateralReading
// have no sheet UI, so their log rows stay non-tappable.
export function isEditableKind(k: DayEventKind): boolean {
  return k === 'draw' || k === 'paydown' || k === 'buy' || k === 'deposit' || k === 'balanceReading';
}

const todayISO = () => new Date().toISOString().split('T')[0];

// ISO yyyy-mm-dd → "Mon D" (local, no UTC shift). Replicated from DailyModeView (not exported there).
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const TYPE_PILLS: { type: SheetType; label: string }[] = [
  { type: 'draw',       label: 'Draw' },
  { type: 'buy',        label: 'Buy ₿' },
  { type: 'paydown',    label: 'Paydown' },
  { type: 'collateral', label: 'Collateral' },
  { type: 'setBalance', label: 'Set balance' },
];

/**
 * Daily Mode P4b-1 — the one adaptive event-entry bottom-sheet (ADD path only).
 * D1 bundled cash-event sheet (type-pills + amount + a required "current balances" reading section,
 * Save gated on the reading), D2 Collateral pill with a Strike|Coinbase target toggle + contextual
 * readout, D3 Set-balance reading-only pill. Scope-2 orange (active pills + Save = --btc). P4c-2: the add path
 * targets `targetDate` (the calendar's selectedDay) — past dates make the reading optional (provisional month),
 * future dates are blocked at the FAB. LD6: a today flow Save writes the flow AND a balanceReading atomically
 * (two addDayEvent calls, same date/ts) — see buildEventsFromSheet.
 */
export function EventSheet({ open, onClose, editEvent, targetDate }: EventSheetProps) {
  const hasCbLoan          = useStore((s) => s.hasCbLoan);
  const strikeBtcAvailable = useStore((s) => s.strikeBtcAvailable);
  const btcPrice           = useStore((s) => s.btcPrice);
  const advisorStartDate   = useStore((s) => s.advisorStartDate);
  const currentBtcHeld     = useStore((s) => s.getCurrentBtcHeld());
  const addDayEvent           = useStore((s) => s.addDayEvent);
  const updateDayEvent        = useStore((s) => s.updateDayEvent);
  const deleteDayEvent        = useStore((s) => s.deleteDayEvent);
  const dayLog                = useStore((s) => s.dayLog);
  const cbLiquidationPrice    = useStore((s) => s.cbLiquidationPrice);
  const setCbLiquidationPrice = useStore((s) => s.setCbLiquidationPrice);
  const setCbLiquidationPriceAsOf = useStore((s) => s.setCbLiquidationPriceAsOf);

  const isEdit = !!editEvent;

  const [type, setType]                     = useState<SheetType>('draw');
  const [amount, setAmount]                 = useState<number | null>(null);
  const [collateralTarget, setCollTarget]   = useState<'strike' | 'cb'>('strike');
  const [strikeBal, setStrikeBal]           = useState<number | null>(null);
  const [strikeLtv, setStrikeLtv]           = useState<number | null>(null);
  const [cbBal, setCbBal]                   = useState<number | null>(null);
  const [cbLtv, setCbLtv]                   = useState<number | null>(null);
  const [cbCollateral, setCbCollateral]     = useState<number | null>(null);
  const [cbLiqPrice, setCbLiqPrice]         = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete]   = useState(false);

  // On each open: ADD mode resets flow + pre-fills the reading from the latest balanceReading in dayLog
  // (today) OR leaves the reading fields EMPTY (past date — "skip" must genuinely skip; a seeded reading
  // would make readingComplete() return true and defeat the handleSave filter). EDIT mode seeds the fields
  // from editEvent (type-locked to its kind). Keyed on [open, editEvent?.id, targetDate] — targetDate is
  // included so switching the selected day while the sheet is open re-runs the empty/seed branch correctly.
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);

    if (editEvent) {
      switch (editEvent.kind) {
        case 'draw':
        case 'paydown':
          setType(editEvent.kind);
          setAmount(editEvent.amount);
          break;
        case 'buy':
          setType('buy');
          setAmount(editEvent.amount);
          break;
        case 'deposit':
          setType('collateral');
          setCollTarget(editEvent.target);
          setAmount(editEvent.amount);
          setCbLiqPrice(editEvent.target === 'cb' ? (cbLiquidationPrice > 0 ? cbLiquidationPrice : null) : null);
          break;
        case 'balanceReading':
          setType('setBalance');
          setStrikeBal(editEvent.reading.strikeBal);
          setStrikeLtv(editEvent.reading.strikeLtv * 100);   // fraction → percent for display
          setCbBal(editEvent.reading.cbBal ?? null);
          setCbLtv(editEvent.reading.cbLtv != null ? editEvent.reading.cbLtv * 100 : null);
          setCbCollateral(editEvent.reading.cbCollateral ?? null);
          break;
      }
      return;
    }

    setType('draw');
    setAmount(null);
    setCollTarget('strike');

    // P4c-2 — recompute past-ness here (effectiveDate/isPast are declared after this effect closes).
    const effDate = targetDate ?? todayISO();
    const past = effDate < todayISO();

    if (past) {
      // Past backfill: leave reading fields EMPTY so "skip" genuinely omits the balanceReading.
      // A seeded reading would make readingComplete() true → the handleSave filter would never fire.
      setStrikeBal(null);
      setStrikeLtv(null);
      setCbBal(null);
      setCbLtv(null);
      setCbCollateral(null);
    } else {
      // Today: pre-fill from the latest reading for convenience (LD6 reading still required).
      const latest = dayLog
        .filter((e): e is Extract<DayEvent, { kind: 'balanceReading' }> => e.kind === 'balanceReading')
        .reduce<Extract<DayEvent, { kind: 'balanceReading' }> | null>(
          (best, e) => (!best || e.ts > best.ts ? e : best),
          null,
        );
      if (latest) {
        setStrikeBal(latest.reading.strikeBal);
        setStrikeLtv(latest.reading.strikeLtv * 100);   // fraction → percent for display
        setCbBal(latest.reading.cbBal ?? null);
        setCbLtv(latest.reading.cbLtv != null ? latest.reading.cbLtv * 100 : null);
        setCbCollateral(latest.reading.cbCollateral ?? null);
      } else {
        setStrikeBal(null);
        setStrikeLtv(null);
        setCbBal(null);
        setCbLtv(null);
        setCbCollateral(null);
      }
    }
    setCbLiqPrice(cbLiquidationPrice > 0 ? cbLiquidationPrice : null);
  }, [open, editEvent?.id, targetDate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const today = todayISO();
  // P4c-2 — add-mode logs to the calendar's selectedDay (effectiveDate); edit-mode stays on editEvent.date.
  const effectiveDate = targetDate ?? today;
  const isPast = !isEdit && effectiveDate < today;   // yyyy-mm-dd string compare; past = strictly before today
  const month = isEdit && editEvent
    ? bucketEventToMonth(editEvent.date, advisorStartDate)
    : bucketEventToMonth(effectiveDate, advisorStartDate);

  const state: SheetState = { type, amount, collateralTarget, strikeBal, strikeLtv, cbBal, cbLtv, cbCollateral };

  const showAmount = type !== 'setBalance';
  const amountValid = amount !== null && amount > 0;

  // Effective collateral target — no toggle without a CB loan (implicitly Strike).
  const effectiveTarget = hasCbLoan ? collateralTarget : 'strike';

  // For a balanceReading edit, show/require CB reading fields based on the ORIGINAL reading (faithful to
  // when it was logged), not the current hasCbLoan. Add mode keys on hasCbLoan as before.
  const showCbReading = editEvent && editEvent.kind === 'balanceReading'
    ? editEvent.reading.cbBal != null
    : hasCbLoan;

  const cbLiqOk = cbLiqPrice !== null && cbLiqPrice > 0;
  const cbCollateralNeedsLiq = type === 'collateral' && effectiveTarget === 'cb';

  let canSave: boolean;
  if (isEdit && editEvent) {
    if      (editEvent.kind === 'balanceReading') canSave = readingComplete(state, showCbReading);
    else if (editEvent.kind === 'deposit')        canSave = amountValid && (editEvent.target === 'strike' || cbLiqOk);
    else                                          canSave = amountValid;   // draw / paydown / buy
  } else {
    // P4c-2 — past dates relax the reading requirement for FLOW types (reading-only setBalance still needs it).
    canSave = ((isPast && type !== 'setBalance') || readingComplete(state, hasCbLoan))
      && (!showAmount || amountValid)
      && (!cbCollateralNeedsLiq || cbLiqOk);
  }

  const strikeLtvWarn = strikeLtv !== null && strikeLtv > 100;
  const cbLtvWarn     = cbLtv !== null && cbLtv > 100;

  function pickType(t: SheetType) {
    setType(t);
    setAmount(null);   // switching the type clears the amount (USD vs BTC unit changes)
  }

  function reset() {
    setType('draw');
    setAmount(null);
    setCollTarget('strike');
    setStrikeBal(null);
    setStrikeLtv(null);
    setCbBal(null);
    setCbLtv(null);
    setCbCollateral(null);
    setCbLiqPrice(null);
    setConfirmDelete(false);
  }

  function handleSave() {
    // EDIT mode — reconstruct the SINGLE event preserving id/date/ts, then updateDayEvent (Option A: no
    // second event, no LD6 re-enforcement). CB-deposit edits also re-anchor the coupled liq-price scalar.
    if (isEdit && editEvent) {
      const { id, date, ts } = editEvent;
      let updated: DayEvent;
      switch (editEvent.kind) {
        case 'draw':
        case 'paydown':
          updated = { id, date, ts, kind: editEvent.kind, amount: amount ?? 0 };
          break;
        case 'buy':
          updated = { id, date, ts, kind: 'buy', amount: amount ?? 0, usd: (amount ?? 0) * btcPrice };
          break;
        case 'deposit':
          updated = { id, date, ts, kind: 'deposit', amount: amount ?? 0, target: editEvent.target };
          break;
        case 'balanceReading': {
          const reading: { strikeBal: number; strikeLtv: number; cbBal?: number; cbLtv?: number; cbCollateral?: number; price?: number } =
            { strikeBal: strikeBal ?? 0, strikeLtv: (strikeLtv ?? 0) / 100, price: btcPrice };
          if (editEvent.reading.cbBal != null) {   // CB-bearing reading → keep CB fields
            reading.cbBal = cbBal ?? 0;
            reading.cbLtv = (cbLtv ?? 0) / 100;
            reading.cbCollateral = cbCollateral ?? 0;
          }
          updated = { id, date, ts, kind: 'balanceReading', reading };
          break;
        }
        default:
          reset(); onClose(); return;   // withdraw / cbCollateralReading — not editable via the sheet
      }
      updateDayEvent(updated);
      if (editEvent.kind === 'deposit' && editEvent.target === 'cb' && cbLiqPrice !== null) {
        setCbLiquidationPrice(cbLiqPrice);
        setCbLiquidationPriceAsOf(todayISO());
      }
      reset();
      onClose();
      return;
    }

    const events = buildEventsFromSheet(
      { type, amount, collateralTarget: effectiveTarget, strikeBal, strikeLtv, cbBal, cbLtv, cbCollateral },
      hasCbLoan, btcPrice, effectiveDate, Date.now(), newId,
    );
    // P4c-2 — a past-dated flow with the reading skipped writes ONLY the flow (no false balanceReading);
    // the store carry-forwards prior stocks + marks the month provisional (logUtils rollupMonth).
    const toWrite = (isPast && !readingComplete(state, hasCbLoan))
      ? events.filter((e) => e.kind !== 'balanceReading')
      : events;
    toWrite.forEach((e) => addDayEvent(e));
    if (type === 'collateral' && effectiveTarget === 'cb' && cbLiqPrice !== null) {
      setCbLiquidationPrice(cbLiqPrice);
      setCbLiquidationPriceAsOf(todayISO());
    }
    reset();
    onClose();
  }

  function handleDelete() {
    if (!editEvent) return;
    deleteDayEvent(editEvent.id);
    reset();
    onClose();
  }

  function handleClose() {
    reset();
    onClose();
  }

  const amountPrefix = type === 'draw' || type === 'paydown' ? '$' : '₿';
  const amountDecimals = type === 'buy' || type === 'collateral' ? 8 : undefined;
  const amountLabel =
    type === 'draw'       ? 'Draw amount'
    : type === 'paydown'  ? 'Paydown amount'
    : type === 'buy'      ? 'Bitcoin bought'
    : 'Collateral added (BTC)';

  return createPortal(
    <div className={styles.scrim} onClick={handleClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.grab} />

        <div>
          <div className={styles.sheetTitle}>{isEdit ? 'Edit event' : 'Log an event'}</div>
          <div className={styles.sheetSub}>
            {isEdit && editEvent
              ? `${fmtDay(editEvent.date)} · Month ${month}`
              : isPast
                ? `backfilling ${fmtDay(effectiveDate)} · Month ${month}`
                : `adds to ${fmtDay(effectiveDate)} · Month ${month}`}
          </div>
        </div>

        {/* Type-pills — hidden in edit mode (the type is locked to the event's kind) */}
        {!isEdit && (
          <div className={styles.typepills}>
            {TYPE_PILLS.map((p) => (
              <button
                key={p.type}
                className={`${styles.typepill} ${type === p.type ? styles.typepillActive : ''}`}
                onClick={() => pickType(p.type)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Amount field (hidden for Set balance) */}
        {showAmount && (
          <NumberInput
            label={amountLabel}
            value={amount ?? 0}
            onChange={setAmount}
            min={0}
            prefix={amountPrefix}
            decimals={amountDecimals}
          />
        )}

        {/* Collateral extras — Strike|Coinbase toggle + contextual readout */}
        {type === 'collateral' && (
          <div className={styles.section}>
            {!isEdit && hasCbLoan && (
              <div className={styles.targetToggle} role="tablist" aria-label="Collateral target">
                <button
                  role="tab"
                  aria-selected={effectiveTarget === 'strike'}
                  className={`${styles.targetBtn} ${effectiveTarget === 'strike' ? styles.targetBtnActive : ''}`}
                  onClick={() => setCollTarget('strike')}
                >
                  Strike
                </button>
                <button
                  role="tab"
                  aria-selected={effectiveTarget === 'cb'}
                  className={`${styles.targetBtn} ${effectiveTarget === 'cb' ? styles.targetBtnActive : ''}`}
                  onClick={() => setCollTarget('cb')}
                >
                  Coinbase
                </button>
              </div>
            )}

            {effectiveTarget === 'cb' ? (
              <>
                <div className={styles.readout}>
                  {strikeBtcAvailable != null
                    ? `${strikeBtcAvailable.toFixed(3)} ₿ dry powder available (~${fmtUSD(strikeBtcAvailable * btcPrice)})`
                    : '— dry powder · connect Strike for context'}
                </div>
                <div className={styles.note}>
                  Logged as activity. Effect on dry powder &amp; projections is not modeled yet (Feature B).
                </div>
                <NumberInput
                  label="New liquidation price"
                  value={cbLiqPrice ?? 0}
                  onChange={setCbLiqPrice}
                  min={0}
                  prefix="$"
                />
              </>
            ) : (
              <>
                <div className={styles.readout}>
                  Strike held after: {(currentBtcHeld - (isEdit && editEvent && editEvent.kind === 'deposit' ? editEvent.amount : 0) + (amount ?? 0)).toFixed(5)} ₿
                </div>
                <div className={styles.note}>Updates your Strike collateral.</div>
              </>
            )}
          </div>
        )}

        {/* Reading section — in ADD mode it's the bundled hard-require; in EDIT mode it shows ONLY for a
            balanceReading edit (a flow edit touches just the flow, never its separate reading row). */}
        {(!isEdit || (editEvent && editEvent.kind === 'balanceReading')) && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>
              {isEdit ? 'Balances' : isPast ? 'Current balances · optional for past dates' : 'Current balances · required to log'}
            </span>
            {isPast && (
              <div className={styles.note}>
                Past date — current balances optional. Skip if you don&apos;t have them; this month is marked provisional until a reading is logged.
              </div>
            )}
            <NumberInput label="Strike BLOC balance" value={strikeBal ?? 0} onChange={setStrikeBal} min={0} prefix="$" />
            <NumberInput label="Strike LTV" value={strikeLtv ?? 0} onChange={setStrikeLtv} min={0} suffix="%" />
            {strikeLtvWarn && <span className={styles.warn}>Strike LTV over 100% — double-check the value.</span>}
            {showCbReading && (
              <>
                <NumberInput label="Coinbase loan balance" value={cbBal ?? 0} onChange={setCbBal} min={0} prefix="$" />
                <NumberInput label="Coinbase LTV" value={cbLtv ?? 0} onChange={setCbLtv} min={0} suffix="%" />
                {cbLtvWarn && <span className={styles.warn}>Coinbase LTV over 100% — double-check the value.</span>}
                <NumberInput label="Coinbase collateral (BTC)" value={cbCollateral ?? 0} onChange={setCbCollateral} min={0} prefix="₿" decimals={8} />
              </>
            )}
          </div>
        )}

        {confirmDelete ? (
          <div className={styles.confirmBox}>
            <span className={styles.confirmText}>
              Delete this event? Month {month} will be re-rolled. If a today flow loses its reading, the month is marked provisional.
            </span>
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className={styles.deleteBtn} onClick={handleDelete}>Delete</button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={handleClose}>Cancel</button>
            {isEdit && <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>Delete</button>}
            <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>Save</button>
          </div>
        )}

      </div>
    </div>,
    document.body,
  );
}
