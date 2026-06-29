import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { getCurrentStrategyMonth } from '../../simulation/runAdvisor';
import { fmtUSD } from '../../utils/format';
import { NumberInput } from '../ui/NumberInput';
import { readingComplete, buildEventsFromSheet, type SheetType, type SheetState } from './eventSheetModel';
import type { DayEvent } from '../../simulation/types';
import styles from './EventSheet.module.css';

interface EventSheetProps {
  open: boolean;
  onClose: () => void;
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
 * readout, D3 Set-balance reading-only pill. Scope-2 orange (active pills + Save = --btc). Today-only
 * (M3 past-dating → P4c). LD6: a flow Save writes the flow AND a balanceReading atomically (two addDayEvent
 * calls, same date/ts) — see buildEventsFromSheet.
 */
export function EventSheet({ open, onClose }: EventSheetProps) {
  const hasCbLoan          = useStore((s) => s.hasCbLoan);
  const strikeBtcAvailable = useStore((s) => s.strikeBtcAvailable);
  const btcPrice           = useStore((s) => s.btcPrice);
  const advisorStartDate   = useStore((s) => s.advisorStartDate);
  const currentBtcHeld     = useStore((s) => s.getCurrentBtcHeld());
  const addDayEvent           = useStore((s) => s.addDayEvent);
  const dayLog                = useStore((s) => s.dayLog);
  const cbLiquidationPrice    = useStore((s) => s.cbLiquidationPrice);
  const setCbLiquidationPrice = useStore((s) => s.setCbLiquidationPrice);
  const setCbLiquidationPriceAsOf = useStore((s) => s.setCbLiquidationPriceAsOf);

  const [type, setType]                     = useState<SheetType>('draw');
  const [amount, setAmount]                 = useState<number | null>(null);
  const [collateralTarget, setCollTarget]   = useState<'strike' | 'cb'>('strike');
  const [strikeBal, setStrikeBal]           = useState<number | null>(null);
  const [strikeLtv, setStrikeLtv]           = useState<number | null>(null);
  const [cbBal, setCbBal]                   = useState<number | null>(null);
  const [cbLtv, setCbLtv]                   = useState<number | null>(null);
  const [cbCollateral, setCbCollateral]     = useState<number | null>(null);
  const [cbLiqPrice, setCbLiqPrice]         = useState<number | null>(null);

  // On each open: reset flow fields and pre-fill the reading from the latest balanceReading in dayLog.
  // Keyed on [open] only — triggering on every dayLog change while open would clobber in-progress edits.
  useEffect(() => {
    if (!open) return;
    setType('draw');
    setAmount(null);
    setCollTarget('strike');
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
    setCbLiqPrice(cbLiquidationPrice > 0 ? cbLiquidationPrice : null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const today = todayISO();
  const month = getCurrentStrategyMonth(advisorStartDate);

  const state: SheetState = { type, amount, collateralTarget, strikeBal, strikeLtv, cbBal, cbLtv, cbCollateral };

  const showAmount = type !== 'setBalance';
  const amountValid = amount !== null && amount > 0;

  // Effective collateral target — no toggle without a CB loan (implicitly Strike).
  const effectiveTarget = hasCbLoan ? collateralTarget : 'strike';

  const cbCollateralNeedsLiq = type === 'collateral' && effectiveTarget === 'cb';
  const canSave = readingComplete(state, hasCbLoan)
    && (!showAmount || amountValid)
    && (!cbCollateralNeedsLiq || (cbLiqPrice !== null && cbLiqPrice > 0));

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
  }

  function handleSave() {
    const events = buildEventsFromSheet(
      { type, amount, collateralTarget: effectiveTarget, strikeBal, strikeLtv, cbBal, cbLtv, cbCollateral },
      hasCbLoan, btcPrice, today, Date.now(), newId,
    );
    events.forEach((e) => addDayEvent(e));
    if (type === 'collateral' && effectiveTarget === 'cb' && cbLiqPrice !== null) {
      setCbLiquidationPrice(cbLiqPrice);
      setCbLiquidationPriceAsOf(todayISO());
    }
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
          <div className={styles.sheetTitle}>Log an event</div>
          <div className={styles.sheetSub}>adds to {fmtDay(today)} · Month {month}</div>
        </div>

        {/* Type-pills */}
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
            {hasCbLoan && (
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
                  Strike held after: {(currentBtcHeld + (amount ?? 0)).toFixed(5)} ₿
                </div>
                <div className={styles.note}>Updates your Strike collateral.</div>
              </>
            )}
          </div>
        )}

        {/* Reading section — required to log */}
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Current balances · required to log</span>
          <NumberInput label="Strike BLOC balance" value={strikeBal ?? 0} onChange={setStrikeBal} min={0} prefix="$" />
          <NumberInput label="Strike LTV" value={strikeLtv ?? 0} onChange={setStrikeLtv} min={0} suffix="%" />
          {strikeLtvWarn && <span className={styles.warn}>Strike LTV over 100% — double-check the value.</span>}
          {hasCbLoan && (
            <>
              <NumberInput label="Coinbase loan balance" value={cbBal ?? 0} onChange={setCbBal} min={0} prefix="$" />
              <NumberInput label="Coinbase LTV" value={cbLtv ?? 0} onChange={setCbLtv} min={0} suffix="%" />
              {cbLtvWarn && <span className={styles.warn}>Coinbase LTV over 100% — double-check the value.</span>}
              <NumberInput label="Coinbase collateral (BTC)" value={cbCollateral ?? 0} onChange={setCbCollateral} min={0} prefix="₿" decimals={8} />
            </>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={handleClose}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>Save</button>
        </div>

      </div>
    </div>,
    document.body,
  );
}
