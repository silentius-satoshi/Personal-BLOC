import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { bucketEventToMonth } from '../../simulation/logUtils';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import { NumberInput } from '../ui/NumberInput';
import { readingComplete, buildEventsFromSheet, autoStrikeCollateral, type SheetType, type SheetState } from './eventSheetModel';
import { minPaymentStatus } from '../../simulation/simpleModePlan';
import { getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import type { DayEvent, DayEventKind } from '../../simulation/types';
import styles from './EventSheet.module.css';

interface EventSheetProps {
  open: boolean;
  onClose: () => void;
  editEvent?: DayEvent;   // P4b-2 — when set, the sheet opens in type-locked EDIT mode for this event
  targetDate?: string;    // P4c-2 — ISO yyyy-mm-dd the add-sheet logs to (the calendar's selectedDay); ignored in edit mode
  initialType?: SheetType; // P4c-3b — add-mode opens to this type (e.g. 'setBalance' from the Review sheet); default 'draw'
}

// P4b-2 — the DayEvent kinds the sheet can edit (map 1:1 to a SheetType). cbCollateralReading has no sheet
// UI, so its log rows stay non-tappable. P4c-3a — withdraw is now editable (collateral pill, withdraw dir).
export function isEditableKind(k: DayEventKind): boolean {
  return k === 'draw' || k === 'paydown' || k === 'minPayment' || k === 'buy' || k === 'deposit' || k === 'withdraw' || k === 'balanceReading';
}

// ISO yyyy-mm-dd → "Mon D" (local, no UTC shift). Replicated from DailyModeView (not exported there).
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const TYPE_PILLS: { type: SheetType; label: string; incomeOnly?: boolean }[] = [
  { type: 'draw',       label: 'Draw' },
  { type: 'buy',        label: 'Buy ₿' },
  { type: 'paydown',    label: 'Paydown' },
  { type: 'minPayment', label: 'Strike minimum', incomeOnly: true },   // §2b — income mode only
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
export function EventSheet({ open, onClose, editEvent, targetDate, initialType }: EventSheetProps) {
  const hasCbLoan          = useStore((s) => s.hasCbLoan);
  const strikeBtcAvailable = useStore((s) => s.strikeBtcAvailable);
  const btcPrice           = useStore((s) => s.btcPrice);
  const advisorStartDate   = useStore((s) => s.advisorStartDate);
  const currentBtcHeld     = useStore((s) => s.getCurrentBtcHeld());
  const cbCollateralBtc        = useStore((s) => s.cbCollateralBtc);          // D5 withdraw warning
  const cbLoanBalance          = useStore((s) => s.cbLoanBalance);            // D5 withdraw warning
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance); // D5 withdraw warning
  const addDayEvent           = useStore((s) => s.addDayEvent);
  const updateDayEvent        = useStore((s) => s.updateDayEvent);
  const deleteDayEvent        = useStore((s) => s.deleteDayEvent);
  const dayLog                = useStore((s) => s.dayLog);
  const cbLiquidationPrice    = useStore((s) => s.cbLiquidationPrice);
  const setCbLiquidationPrice = useStore((s) => s.setCbLiquidationPrice);
  const setCbLiquidationPriceAsOf = useStore((s) => s.setCbLiquidationPriceAsOf);
  // §2b — Strike minimum payment context
  const blocMinPaymentSource = useStore((s) => s.blocMinPaymentSource);
  const blocMinPaymentDueDay = useStore((s) => s.blocMinPaymentDueDay);
  const blocStatementMinimum = useStore((s) => s.blocStatementMinimum);
  const blocApr              = useStore((s) => s.blocApr);

  const isEdit = !!editEvent;
  const isIncomeSource = blocMinPaymentSource === 'income';
  const strikeMinEstimate = Math.round(advisorActualBlocBalance * (blocApr / 100 / 12));   // one month's interest
  const strikeMinOwed = blocStatementMinimum ?? strikeMinEstimate;

  const [type, setType]                     = useState<SheetType>('draw');
  const [amount, setAmount]                 = useState<number | null>(null);
  const [collateralDir, setCollateralDir]   = useState<'deposit' | 'withdraw'>('deposit');
  const [collateralTarget, setCollTarget]   = useState<'strike' | 'cb'>('strike');
  const [strikeBal, setStrikeBal]           = useState<number | null>(null);
  const [strikeLtv, setStrikeLtv]           = useState<number | null>(null);
  const [strikeCollateral, setStrikeCollateral]       = useState<number | null>(null);   // v20 — reading-anchored Strike collateral
  const [strikeCollateralTouched, setStrikeCollTouched] = useState(false);                // manual edit stops the auto-track
  const [pledgeToStrike, setPledgeToStrike] = useState(false);                            // buy-only — emit a paired strike deposit
  const [cbBal, setCbBal]                   = useState<number | null>(null);
  const [cbLtv, setCbLtv]                   = useState<number | null>(null);
  const [cbCollateral, setCbCollateral]     = useState<number | null>(null);
  const [cbLiqPrice, setCbLiqPrice]         = useState<number | null>(null);   // collateral-move liq (existing)
  const [cbLiqPriceReading, setCbLiqPriceReading] = useState<number | null>(null);   // §5b — optional liq on a reading-bearing NON-collateral event (prefill empty; blank/0 → keep the anchor)
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
        case 'minPayment':
          setType(editEvent.kind);
          setAmount(editEvent.amount);
          break;
        case 'buy':
          setType('buy');
          setAmount(editEvent.amount);
          break;
        case 'deposit':
          setType('collateral');
          setCollateralDir('deposit');
          setCollTarget(editEvent.target);
          setAmount(editEvent.amount);
          setCbLiqPrice(editEvent.target === 'cb' ? (cbLiquidationPrice > 0 ? cbLiquidationPrice : null) : null);
          break;
        case 'withdraw':
          setType('collateral');
          setCollateralDir('withdraw');
          setCollTarget(editEvent.target);
          setAmount(editEvent.amount);
          setCbLiqPrice(editEvent.target === 'cb' ? (cbLiquidationPrice > 0 ? cbLiquidationPrice : null) : null);
          break;
        case 'balanceReading':
          setType('setBalance');
          setStrikeBal(editEvent.reading.strikeBal);
          setStrikeLtv(editEvent.reading.strikeLtv * 100);   // fraction → percent for display
          setStrikeCollateral(editEvent.reading.strikeCollateral ?? currentBtcHeld);   // v20 — venue truth on edit
          setStrikeCollTouched(true);
          setCbBal(editEvent.reading.cbBal ?? null);
          setCbLtv(editEvent.reading.cbLtv != null ? editEvent.reading.cbLtv * 100 : null);
          setCbCollateral(editEvent.reading.cbCollateral ?? null);
          setCbLiqPriceReading(editEvent.reading.cbLiqPrice ?? null);   // §5b — seed the reading's liq (preserved on re-save)
          break;
      }
      return;
    }

    setType(initialType ?? 'draw');
    setAmount(null);
    setCollateralDir('deposit');
    setCollTarget('strike');
    setPledgeToStrike(false);
    setStrikeCollTouched(false);   // v20 — the track effect sets strikeCollateral from getCurrentBtcHeld ± move

    // P4c-2 — recompute past-ness here (effectiveDate/isPast are declared after this effect closes).
    const effDate = targetDate ?? todayLocalISO();
    const past = effDate < todayLocalISO();

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
    setCbLiqPriceReading(null);   // §5b — always empty on open (Q2: never auto-submit the old liq → no fake freshness)
  }, [open, editEvent?.id, targetDate, initialType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effective collateral target — no toggle without a CB loan (implicitly Strike). Hoisted above the early
  // return below so the track effect (which depends on it) stays an unconditionally-called hook.
  const effectiveTarget = hasCbLoan ? collateralTarget : 'strike';

  // v20 — auto-track the Strike-collateral field to the POST-move total (current ± amount) while the user hasn't
  // manually edited it. A strike collateral move / pledged buy states the new total; everything else = current
  // (an idempotent re-anchor). A manual edit (onChange sets touched) freezes it — venue truth wins. Guarded on
  // `open` (like the prefill effect) so it doesn't churn state while the sheet is closed; MUST stay above the
  // early return below — a hook after a conditional return violates the Rules of Hooks (React #310).
  useEffect(() => {
    if (!open) return;
    if (strikeCollateralTouched) return;
    setStrikeCollateral(autoStrikeCollateral(currentBtcHeld, { type, collateralDir, effectiveTarget, amount, pledgeToStrike }));
  }, [open, type, effectiveTarget, collateralDir, amount, pledgeToStrike, strikeCollateralTouched, currentBtcHeld]);

  if (!open) return null;

  const today = todayLocalISO();
  // P4c-2 — add-mode logs to the calendar's selectedDay (effectiveDate); edit-mode stays on editEvent.date.
  const effectiveDate = targetDate ?? today;
  const isPast = !isEdit && effectiveDate < today;   // yyyy-mm-dd string compare; past = strictly before today
  const month = isEdit && editEvent
    ? bucketEventToMonth(editEvent.date, advisorStartDate)
    : bucketEventToMonth(effectiveDate, advisorStartDate);

  const state: SheetState = { type, amount, collateralDir, collateralTarget, strikeBal, strikeLtv, strikeCollateral, pledgeToStrike, cbBal, cbLtv, cbCollateral, cbLiqPriceReading };

  const showAmount = type !== 'setBalance';
  const amountValid = amount !== null && amount > 0;

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
    else if (editEvent.kind === 'deposit' || editEvent.kind === 'withdraw')
                                                  canSave = amountValid && (editEvent.target === 'strike' || cbLiqOk);
    else                                          canSave = amountValid;   // draw / paydown / buy
  } else if (type === 'minPayment') {
    // §2b — reading-free one-field sheet; just needs a positive amount.
    canSave = amountValid;
  } else {
    // P4c-2 — past dates relax the reading requirement for FLOW types (reading-only setBalance still needs it).
    canSave = ((isPast && type !== 'setBalance') || readingComplete(state, hasCbLoan))
      && (!showAmount || amountValid)
      && (!cbCollateralNeedsLiq || cbLiqOk);
  }

  const strikeLtvWarn = strikeLtv !== null && strikeLtv > 100;
  const cbLtvWarn     = cbLtv !== null && cbLtv > 100;

  // D2 — direction-aware "Strike held after" readout. The edit-backout is kind-aware: a deposit edit ADDED
  // to currentBtcHeld, a withdraw edit SUBTRACTED — back out the original effect before applying the new one.
  const dirSign = collateralDir === 'withdraw' ? -1 : 1;
  const origEffect = isEdit && editEvent && (editEvent.kind === 'deposit' || editEvent.kind === 'withdraw')
    ? (editEvent.kind === 'withdraw' ? -editEvent.amount : editEvent.amount)
    : 0;
  const strikeAfter = currentBtcHeld - origEffect + dirSign * (amount ?? 0);

  // D5 — soft, non-blocking heads-up. Conservative post-withdraw LTV estimate from live figures; NEVER gates Save.
  let withdrawWarnLtv: number | null = null;
  if (type === 'collateral' && collateralDir === 'withdraw' && amountValid) {
    const amt = amount ?? 0;
    if (effectiveTarget === 'cb') {
      const postColl = cbCollateralBtc - amt;                                  // CB: 65% trigger / 86% LLTV
      const est = postColl > 0 ? cbLoanBalance / (postColl * btcPrice) : Infinity;
      if (est > 0.6) withdrawWarnLtv = est;
    } else {
      const postColl = currentBtcHeld - amt;                                   // Strike: 50% max-draw ceiling
      const est = postColl > 0 ? advisorActualBlocBalance / (postColl * btcPrice) : Infinity;
      if (est > 0.5) withdrawWarnLtv = est;
    }
  }

  function pickType(t: SheetType) {
    setType(t);
    setAmount(t === 'minPayment' ? strikeMinOwed : null);   // minPayment prefills the owed figure; else clear (USD vs BTC unit changes)
  }

  function reset() {
    setType('draw');
    setAmount(null);
    setCollateralDir('deposit');
    setCollTarget('strike');
    setStrikeBal(null);
    setStrikeLtv(null);
    setStrikeCollateral(null);
    setStrikeCollTouched(false);
    setPledgeToStrike(false);
    setCbBal(null);
    setCbLtv(null);
    setCbCollateral(null);
    setCbLiqPrice(null);
    setCbLiqPriceReading(null);
    setConfirmDelete(false);
  }

  function handleSave() {
    // EDIT mode — reconstruct the SINGLE event preserving id/date — ts is bumped by updateDayEvent as the
    // merge version clock (a preserved ts would tie with, and lose to, the stale remote copy). Then
    // updateDayEvent (Option A: no second event, no LD6 re-enforcement). CB-deposit edits also re-anchor the
    // coupled liq-price scalar.
    if (isEdit && editEvent) {
      const { id, date, ts } = editEvent;
      let updated: DayEvent;
      switch (editEvent.kind) {
        case 'draw':
        case 'paydown':
        case 'minPayment':
          updated = { id, date, ts, kind: editEvent.kind, amount: amount ?? 0 };
          break;
        case 'buy':
          updated = { id, date, ts, kind: 'buy', amount: amount ?? 0, usd: (amount ?? 0) * btcPrice };
          break;
        case 'deposit':
          updated = { id, date, ts, kind: 'deposit', amount: amount ?? 0, target: editEvent.target };
          break;
        case 'withdraw':
          updated = { id, date, ts, kind: 'withdraw', amount: amount ?? 0, target: editEvent.target };
          break;
        case 'balanceReading': {
          const reading: { strikeBal: number; strikeLtv: number; strikeCollateral?: number; cbBal?: number; cbLtv?: number; cbCollateral?: number; cbLiqPrice?: number; price?: number } =
            { strikeBal: strikeBal ?? 0, strikeLtv: (strikeLtv ?? 0) / 100, strikeCollateral: strikeCollateral ?? currentBtcHeld, price: btcPrice };   // v20 — Strike collateral (outside the CB block)
          if (editEvent.reading.cbBal != null) {   // CB-bearing reading → keep CB fields
            reading.cbBal = cbBal ?? 0;
            reading.cbLtv = (cbLtv ?? 0) / 100;
            reading.cbCollateral = cbCollateral ?? 0;
            if (cbLiqPriceReading !== null && cbLiqPriceReading > 0) reading.cbLiqPrice = cbLiqPriceReading;   // §5b — preserve/edit the reading's liq
          }
          updated = { id, date, ts, kind: 'balanceReading', reading };
          break;
        }
        default:
          reset(); onClose(); return;   // cbCollateralReading — not editable via the sheet
      }
      updateDayEvent(updated);
      if ((editEvent.kind === 'deposit' || editEvent.kind === 'withdraw') && editEvent.target === 'cb' && cbLiqPrice !== null) {
        setCbLiquidationPrice(cbLiqPrice);
        setCbLiquidationPriceAsOf(todayLocalISO());
      }
      reset();
      onClose();
      return;
    }

    const events = buildEventsFromSheet(
      { type, amount, collateralDir, collateralTarget: effectiveTarget, strikeBal, strikeLtv, strikeCollateral, pledgeToStrike, cbBal, cbLtv, cbCollateral, cbLiqPriceReading },
      hasCbLoan, btcPrice, effectiveDate, Date.now(), newId, currentBtcHeld,
    );
    // P4c-2 — a past-dated flow with the reading skipped writes ONLY the flow (no false balanceReading);
    // the store carry-forwards prior stocks + marks the month provisional (logUtils rollupMonth).
    const toWrite = (isPast && !readingComplete(state, hasCbLoan))
      ? events.filter((e) => e.kind !== 'balanceReading')
      : events;
    toWrite.forEach((e) => addDayEvent(e));
    if (type === 'collateral' && effectiveTarget === 'cb' && cbLiqPrice !== null) {
      setCbLiquidationPrice(cbLiqPrice);
      setCbLiquidationPriceAsOf(todayLocalISO());
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

  const amountPrefix = type === 'draw' || type === 'paydown' || type === 'minPayment' ? '$' : '₿';
  const amountDecimals = type === 'buy' || type === 'collateral' ? 8 : undefined;
  const amountLabel =
    type === 'draw'        ? 'Draw amount'
    : type === 'paydown'   ? 'Paydown amount'
    : type === 'minPayment' ? 'Minimum paid'
    : type === 'buy'       ? 'Bitcoin bought'
    : collateralDir === 'withdraw' ? 'Collateral removed (BTC)'
    : 'Collateral added (BTC)';

  // §2b — paydown-sheet context: surface the Strike minimum's status so a paydown never strands it.
  const paydownMonth = isEdit && editEvent ? bucketEventToMonth(editEvent.date, advisorStartDate) : month;
  const minPaidThisMonth = dayLog
    .filter((e) => e.kind === 'minPayment' && bucketEventToMonth(e.date, advisorStartDate) === paydownMonth)
    .reduce((sum, e) => sum + (e as Extract<DayEvent, { kind: 'minPayment' }>).amount, 0);
  const minStatus = minPaymentStatus({
    source: blocMinPaymentSource,
    paidSoFar: minPaidThisMonth,
    owed: strikeMinOwed,
    dueDay: blocMinPaymentDueDay,
    todayDay: Number(today.split('-')[2]),
    isCurrent: paydownMonth === getCurrentStrategyMonth(advisorStartDate),
  });

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

        {/* Type-pills — hidden in edit mode (the type is locked to the event's kind); Strike-minimum is income-mode only */}
        {!isEdit && (
          <div className={styles.typepills}>
            {TYPE_PILLS.filter((p) => !p.incomeOnly || isIncomeSource).map((p) => (
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

        {/* §2b — paydown-sheet context line: the Strike minimum status (income mode) */}
        {type === 'paydown' && isIncomeSource && (
          <div className={styles.readout}>
            Minimum · due the {blocMinPaymentDueDay}th · {fmtUSD(strikeMinOwed)}
            <span className={styles.note}> · {minStatus}</span>
          </div>
        )}

        {/* Collateral extras — Deposit|Withdraw direction + Strike|Coinbase target toggles + contextual readout */}
        {type === 'collateral' && (
          <div className={styles.section}>
            {!isEdit && (
              <div className={styles.targetToggle} role="tablist" aria-label="Collateral direction">
                <button
                  role="tab"
                  aria-selected={collateralDir === 'deposit'}
                  className={`${styles.targetBtn} ${collateralDir === 'deposit' ? styles.targetBtnActive : ''}`}
                  onClick={() => setCollateralDir('deposit')}
                >
                  Deposit
                </button>
                <button
                  role="tab"
                  aria-selected={collateralDir === 'withdraw'}
                  className={`${styles.targetBtn} ${collateralDir === 'withdraw' ? styles.targetBtnActive : ''}`}
                  onClick={() => setCollateralDir('withdraw')}
                >
                  Withdraw
                </button>
              </div>
            )}

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
                  {collateralDir === 'withdraw'
                    ? 'Removing collateral raises your liquidation price — enter the new value from your Loan Center.'
                    : 'Logged as activity. Effect on dry powder & projections is not modeled yet (Feature B).'}
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
                  Strike held after: {strikeAfter.toFixed(5)} ₿
                  {amountValid && (
                    <span className={styles.note}> ({dirSign > 0 ? '+' : '−'}{(amount ?? 0).toFixed(5)})</span>
                  )}
                </div>
                <div className={styles.note}>Updates your Strike collateral.</div>
              </>
            )}

            {withdrawWarnLtv !== null && (
              <div className={styles.warnNote}>
                This withdrawal raises {effectiveTarget === 'cb' ? 'Coinbase' : 'Strike'} LTV to ~
                {Number.isFinite(withdrawWarnLtv) ? Math.round(withdrawWarnLtv * 100) : '∞'}% — approaching your
                limit. Proceed only if intended.
              </div>
            )}
          </div>
        )}

        {/* Buy — optional "Pledged to Strike" toggle (add path only). ON emits a paired deposit target:'strike'
            (the buy's BTC pledged as collateral) so the buy DOES move Strike collateral; OFF keeps buys unpledged. */}
        {type === 'buy' && !isEdit && (
          <div className={styles.section}>
            <span className={styles.sectionLabel}>Pledged to Strike?</span>
            <div className={styles.targetToggle} role="tablist" aria-label="Pledge to Strike">
              <button
                role="tab"
                aria-selected={!pledgeToStrike}
                className={`${styles.targetBtn} ${!pledgeToStrike ? styles.targetBtnActive : ''}`}
                onClick={() => setPledgeToStrike(false)}
              >
                No
              </button>
              <button
                role="tab"
                aria-selected={pledgeToStrike}
                className={`${styles.targetBtn} ${pledgeToStrike ? styles.targetBtnActive : ''}`}
                onClick={() => setPledgeToStrike(true)}
              >
                Pledge to Strike
              </button>
            </div>
            <div className={styles.note}>
              {pledgeToStrike ? 'Adds a Strike collateral deposit for this buy.' : 'Held as spendable BTC — not pledged as collateral.'}
            </div>
          </div>
        )}

        {/* Reading section — in ADD mode it's the bundled hard-require; in EDIT mode it shows ONLY for a
            balanceReading edit (a flow edit touches just the flow, never its separate reading row).
            §2b — minPayment is reading-free (a one-field sheet). */}
        {type !== 'minPayment' && (!isEdit || (editEvent && editEvent.kind === 'balanceReading')) && (
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
            <NumberInput
              label="Strike collateral (BTC)"
              value={strikeCollateral ?? 0}
              onChange={(v) => { setStrikeCollateral(v); setStrikeCollTouched(true); }}
              min={0}
              prefix="₿"
              decimals={8}
            />
            {showCbReading && (
              <>
                <NumberInput label="Coinbase loan balance" value={cbBal ?? 0} onChange={setCbBal} min={0} prefix="$" />
                <NumberInput label="Coinbase LTV" value={cbLtv ?? 0} onChange={setCbLtv} min={0} suffix="%" />
                {cbLtvWarn && <span className={styles.warn}>Coinbase LTV over 100% — double-check the value.</span>}
                <NumberInput label="Coinbase collateral (BTC)" value={cbCollateral ?? 0} onChange={setCbCollateral} min={0} prefix="₿" decimals={8} />
                {/* §5b — optional liq price on a reading (collateral moves have their own liq field → hidden here).
                    Blank/0 (untouched) keeps the current anchor + its freshness; a value re-anchors to the reading's date. */}
                {type !== 'collateral' && (
                  <NumberInput
                    label="New Coinbase liquidation price (optional)"
                    value={cbLiqPriceReading ?? 0}
                    onChange={setCbLiqPriceReading}
                    min={0}
                    prefix="$"
                    subtext={cbLiquidationPrice > 0 ? `last: ${fmtUSD(cbLiquidationPrice)} — leave blank to keep it` : 'leave blank to keep the current value'}
                  />
                )}
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
