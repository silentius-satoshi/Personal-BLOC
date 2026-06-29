// Pure builders for the Daily Mode event sheet (P4b-1, the write path). Standalone — NO React/store/UI.
// The sheet's local field-state (SheetState) → DayEvent[] (buildEventsFromSheet) and the Save gate
// (readingComplete). Kept pure so the LD6 atomic flow+reading write + the LTV fraction conversion are unit-tested.
import type { DayEvent } from '../../simulation/types';

export type SheetType = 'draw' | 'buy' | 'paydown' | 'collateral' | 'setBalance';

export interface SheetState {
  type: SheetType;
  amount: number | null;              // USD (draw/paydown) | BTC (buy/collateral) | null (setBalance)
  collateralDir: 'deposit' | 'withdraw';  // only meaningful when type === 'collateral'
  collateralTarget: 'strike' | 'cb';  // only meaningful when type === 'collateral' (and hasCbLoan)
  strikeBal: number | null;
  strikeLtv: number | null;           // PERCENT as typed by the user (e.g. 11.2 = 11.2%)
  cbBal: number | null;
  cbLtv: number | null;               // PERCENT
  cbCollateral: number | null;        // BTC
}

/**
 * The Save gate's reading half (D1): the balance-reading fields must be non-empty.
 * strikeBal + strikeLtv always; + cbBal + cbLtv + cbCollateral iff hasCbLoan.
 * The flow/collateral amount>0 gate is checked in the component (a separate clause of the Save gate).
 */
export function readingComplete(s: SheetState, hasCbLoan: boolean): boolean {
  if (s.strikeBal === null || s.strikeLtv === null) return false;
  if (hasCbLoan && (s.cbBal === null || s.cbLtv === null || s.cbCollateral === null)) return false;
  return true;
}

/**
 * SheetState → the DayEvent[] to write (LD6: a flow writes the flow AND a balanceReading atomically).
 *  - setBalance  → [balanceReading]
 *  - draw/paydown → [{kind}, balanceReading]            (amount = USD)
 *  - buy          → [{buy, usd: amount*price}, reading]  (amount = BTC)
 *  - collateral   → [{deposit|withdraw, target}, balanceReading]  (amount = BTC magnitude, positive; kind by
 *                   collateralDir — the store signs withdraw negative in collateralDelta; target='strike' when !hasCbLoan)
 * LTV is stored as a FRACTION (e.g. 0.112) — the user-entered PERCENT is divided by 100 here.
 * Each event gets a FRESH id from idFn(); the flow and its reading share date + ts.
 */
export function buildEventsFromSheet(
  s: SheetState,
  hasCbLoan: boolean,
  btcPrice: number,
  today: string,
  ts: number,
  idFn: () => string,
): DayEvent[] {
  const reading: {
    strikeBal: number; strikeLtv: number;
    cbBal?: number; cbLtv?: number; cbCollateral?: number; price?: number;
  } = {
    strikeBal: s.strikeBal ?? 0,
    strikeLtv: (s.strikeLtv ?? 0) / 100,   // percent → fraction
    price: btcPrice,
  };
  if (hasCbLoan) {
    reading.cbBal = s.cbBal ?? 0;
    reading.cbLtv = (s.cbLtv ?? 0) / 100;  // percent → fraction
    reading.cbCollateral = s.cbCollateral ?? 0;
  }

  const readingEvent: DayEvent = { id: idFn(), date: today, ts, kind: 'balanceReading', reading };
  const amount = s.amount ?? 0;

  switch (s.type) {
    case 'setBalance':
      return [readingEvent];
    case 'draw':
      return [{ id: idFn(), date: today, ts, kind: 'draw', amount }, readingEvent];
    case 'paydown':
      return [{ id: idFn(), date: today, ts, kind: 'paydown', amount }, readingEvent];
    case 'buy':
      return [{ id: idFn(), date: today, ts, kind: 'buy', amount, usd: amount * btcPrice }, readingEvent];
    case 'collateral':
      return [
        {
          id: idFn(), date: today, ts,
          kind: s.collateralDir === 'withdraw' ? 'withdraw' : 'deposit',
          amount, target: hasCbLoan ? s.collateralTarget : 'strike',
        },
        readingEvent,
      ];
  }
}
