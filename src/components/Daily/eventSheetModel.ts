// Pure builders for the Daily Mode event sheet (P4b-1, the write path). Standalone — NO React/store/UI.
// The sheet's local field-state (SheetState) → DayEvent[] (buildEventsFromSheet) and the Save gate
// (readingComplete). Kept pure so the LD6 atomic flow+reading write + the LTV fraction conversion are unit-tested.
import type { DayEvent } from '../../simulation/types';

export type SheetType = 'draw' | 'buy' | 'paydown' | 'minPayment' | 'collateral' | 'setBalance';

export interface SheetState {
  type: SheetType;
  amount: number | null;              // USD (draw/paydown) | BTC (buy/collateral) | null (setBalance)
  collateralDir: 'deposit' | 'withdraw';  // only meaningful when type === 'collateral'
  collateralTarget: 'strike' | 'cb';  // only meaningful when type === 'collateral' (and hasCbLoan)
  strikeBal: number | null;
  strikeLtv: number | null;           // PERCENT as typed by the user (e.g. 11.2 = 11.2%)
  strikeCollateral: number | null;    // BTC — v20 reading-anchored Strike collateral (POST-move total on a strike move; auto-tracked)
  pledgeToStrike: boolean;            // buy-only — ON emits a paired deposit target:'strike' (add path)
  cbBal: number | null;
  cbLtv: number | null;               // PERCENT
  cbCollateral: number | null;        // BTC
  cbLiqPriceReading: number | null;   // §5b — optional CB liq price on a reading-bearing NON-collateral event; null = leave the anchor untouched (distinct from the collateral-move liq field)
}

/**
 * The Save gate's reading half (D1): the balance-reading fields must be non-empty.
 * strikeBal + strikeLtv + strikeCollateral (v20) always; + cbBal + cbLtv + cbCollateral iff hasCbLoan.
 * The flow/collateral amount>0 gate is checked in the component (a separate clause of the Save gate).
 */
export function readingComplete(s: SheetState, hasCbLoan: boolean): boolean {
  if (s.strikeBal === null || s.strikeLtv === null || s.strikeCollateral === null) return false;
  if (hasCbLoan && (s.cbBal === null || s.cbLtv === null || s.cbCollateral === null)) return false;
  return true;
}

/**
 * v20 — the POST-move Strike collateral total for the reading paired with a target:'strike' move. PURE, so the
 * EventSheet's auto-track (untouched field) and its unit tests share one definition. The reading MUST state the
 * post-move total because the flow + reading share a ts and deriveStrikeCollateral EXCLUDES the same-ts move.
 *  - collateral + effectiveTarget 'strike' → base + (deposit +, withdraw −)·amount
 *  - buy + pledgeToStrike                  → base + amount (the pledged buy adds a strike deposit)
 *  - anything else (setBalance/draw/paydown/unpledged buy/cb move) → base (unchanged; an idempotent re-anchor)
 */
export function autoStrikeCollateral(
  base: number,
  s: { type: SheetType; collateralDir: 'deposit' | 'withdraw'; effectiveTarget: 'strike' | 'cb'; amount: number | null; pledgeToStrike: boolean },
): number {
  const amt = s.amount ?? 0;
  if (s.type === 'collateral' && s.effectiveTarget === 'strike') return base + (s.collateralDir === 'withdraw' ? -amt : amt);
  if (s.type === 'buy' && s.pledgeToStrike) return base + amt;
  return base;
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
  currentStrikeCollateral: number,   // v20 — fallback if s.strikeCollateral is null (readingComplete gates non-null; defensive)
): DayEvent[] {
  const reading: {
    strikeBal: number; strikeLtv: number; strikeCollateral?: number;
    cbBal?: number; cbLtv?: number; cbCollateral?: number; cbLiqPrice?: number; price?: number;
  } = {
    strikeBal: s.strikeBal ?? 0,
    strikeLtv: (s.strikeLtv ?? 0) / 100,   // percent → fraction
    strikeCollateral: s.strikeCollateral ?? currentStrikeCollateral,   // BTC — no conversion; the POST-move total
    price: btcPrice,
  };
  if (hasCbLoan) {
    reading.cbBal = s.cbBal ?? 0;
    reading.cbLtv = (s.cbLtv ?? 0) / 100;  // percent → fraction
    reading.cbCollateral = s.cbCollateral ?? 0;
    // §5b — an OPTIONAL liq price re-anchors cbLiquidationPrice (only on reading-bearing non-collateral
    // events; collateral moves keep their own liq field). Blank/0 (untouched) → omitted → the seam leaves the
    // anchor + its asOf stale (honest freshness). Only a positive value re-anchors.
    if (s.type !== 'collateral' && s.cbLiqPriceReading !== null && s.cbLiqPriceReading > 0) reading.cbLiqPrice = s.cbLiqPriceReading;
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
    case 'minPayment':
      // Balance-neutral; reading-free (a one-field sheet). No atomic balanceReading — paying the billed
      // minimum doesn't move the position, so LD6 doesn't apply.
      return [{ id: idFn(), date: today, ts, kind: 'minPayment', amount }];
    case 'buy': {
      const buyEvent: DayEvent = { id: idFn(), date: today, ts, kind: 'buy', amount, usd: amount * btcPrice };
      // v20 pledge — ON emits a paired deposit target:'strike' (the buy's BTC pledged as collateral). Three events,
      // shared date+ts, independent ids; the reading states the post-move total (currentStrikeCollateral + amount).
      if (s.pledgeToStrike) {
        return [buyEvent, { id: idFn(), date: today, ts, kind: 'deposit', amount, target: 'strike' }, readingEvent];
      }
      return [buyEvent, readingEvent];
    }
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
