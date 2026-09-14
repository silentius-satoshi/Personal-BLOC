// Pure builders for the Daily Mode event sheet (P4b-1, the write path). Standalone — NO React/store/UI.
// The sheet's local field-state (SheetState) → DayEvent[] (buildEventsFromSheet) and the Save gate
// (readingComplete). Kept pure so the LD6 atomic flow+reading write + the LTV fraction conversion are unit-tested.
import type { DayEvent } from '../../simulation/types';
import { flowVenue, type UnreconciledCbFlows } from '../../simulation/logUtils';
import { cbBorrowFee } from '../../simulation/runCoinbaseLoan';
import { fmtUSD } from '../../utils/format';

/**
 * The stale-Coinbase-balance warning shown under the reading's "Coinbase loan balance" field (pure copy over
 * unreconciledCbFlows). Null when no CB flow has been logged since the last CB-bearing reading. The suggested figure is
 * a HINT in copy — never a prefill, never an anchor — and it excludes interest, which is why it says "before interest".
 */
export function staleCbBalanceNote(u: UnreconciledCbFlows): string | null {
  if (u.events.length === 0) return null;
  const parts: string[] = [];
  if (u.drawn > 0) parts.push(`a ${fmtUSD(u.drawn)} Coinbase borrow${u.fees > 0 ? ` (+${fmtUSD(u.fees)} fee)` : ''}`);
  if (u.paid > 0) parts.push(`a ${fmtUSD(u.paid)} Coinbase paydown`);
  const suggest = u.suggestedCbBal !== null ? ` — about ${fmtUSD(u.suggestedCbBal)} before interest` : '';
  return `You logged ${parts.join(' and ')} since your last Coinbase reading. Update this to what Coinbase shows now${suggest}.`;
}

export type SheetType = 'draw' | 'buy' | 'paydown' | 'minPayment' | 'collateral' | 'setBalance';

/** Where a draw/paydown lands. Distinct from CollateralTarget (BTC) so the two can never be confused at a call site. */
export type DebtTarget = 'strike' | 'cb';

/**
 * Per-venue rules for a draw/paydown (mirrors COLLATERAL_TARGET_RULES).
 *  - needsReading: the flow is written WITH a balanceReading (LD6). A Coinbase borrow/paydown is JOURNAL-ONLY — CB debt
 *                  comes from a reading, and the sheet isn't asking you to reconcile that venue — so it is written
 *                  ALONE. Writing one would also re-state the stale pre-filled Coinbase balance as today's.
 */
export const DEBT_TARGET_RULES: Record<DebtTarget, { needsReading: boolean }> = {
  strike: { needsReading: true },
  cb:     { needsReading: false },
};

/** Where a collateral move goes. 'cb' needs a CB loan; 'cold' (self-custody) never does. */
export type CollateralTarget = 'strike' | 'cb' | 'cold';

/**
 * Per-target rules. Every branch that used to be a two-way `cb ? … : <Strike>` — which cold silently fell into —
 * reads this table instead, so the branches are three-way by construction and a forgotten target is a compile error.
 *  - needsReading:  the move is written WITH a balanceReading (LD6). Lenders have a statement; cold does not, and a
 *                   cold move changes neither lender's balance, so demanding their balances would be pure friction.
 *  - needsLiqPrice: a Coinbase move re-anchors the CB liquidation price.
 *  - ltvWarnVenue:  whose LTV a withdraw can push toward its limit (D5). Cold is pledged to nobody.
 */
export const COLLATERAL_TARGET_RULES: Record<CollateralTarget, {
  needsReading: boolean; needsLiqPrice: boolean; ltvWarnVenue: 'strike' | 'cb' | null;
}> = {
  strike: { needsReading: true,  needsLiqPrice: false, ltvWarnVenue: 'strike' },
  cb:     { needsReading: true,  needsLiqPrice: true,  ltvWarnVenue: 'cb' },
  cold:   { needsReading: false, needsLiqPrice: false, ltvWarnVenue: null },
};

/**
 * EDIT-mode rebuild of a draw/paydown (was inlined in EventSheet.handleSave as `{id,date,ts,kind,amount}` — which
 * DROPPED target: editing a Coinbase borrow's amount silently turned it into a Strike draw, monthly-meaningful again,
 * straight into expensesActual). Preserves id/date/ts/kind (updateDayEvent bumps ts) and the venue.
 *  - Strike → { id, date, ts, kind, amount } — byte-identical to the pre-CB shape.
 *  - CB paydown → + target:'cb' (never a fee).
 *  - CB borrow → + target:'cb' + fee: the STORED fee when the amount is unchanged; otherwise recomputed from
 *    currentCbBalance. ⚠ Approximation: at edit time the balance may already include this borrow (if a reading has
 *    landed since), which can shift the bracket near $250k. Re-typing the same amount never moves the fee.
 */
export function rebuildEditedFlow(
  ev: Extract<DayEvent, { kind: 'draw' | 'paydown' }>, amount: number, currentCbBalance: number,
): DayEvent {
  const { id, date, ts, kind } = ev;
  if (flowVenue(ev) !== 'cb') return { id, date, ts, kind, amount };
  if (kind === 'paydown') return { id, date, ts, kind, amount, target: 'cb' };
  const fee = amount === ev.amount && ev.fee !== undefined ? ev.fee : cbBorrowFee(amount, currentCbBalance);
  return { id, date, ts, kind, amount, target: 'cb', fee };
}

/** The withdraw cap: the target venue's live balance + (edit mode) the original withdraw being replaced. */
export function collateralAvailableFor(
  target: CollateralTarget, bal: { strike: number; cb: number; cold: number }, originalWithdraw: number,
): number {
  return bal[target] + originalWithdraw;
}

/**
 * Total holdings (Strike + Coinbase + cold) after a COLD move — the same sum the owner Dashboard shows (OwnershipBar,
 * deriveVenueSplit). ⚠ A transfer between venues is TWO entries: log only the cold deposit and this total rises by the
 * amount until the source withdrawal is logged. The sheet shows it before save so the double-count can't be missed.
 * Non-finite inputs count as 0; cold is clamped at 0.
 */
export function totalHoldingsAfter(
  strike: number, cb: number, cold: number, dir: 'deposit' | 'withdraw', amount: number | null,
): number {
  const f = (n: number | null) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  return f(strike) + f(cb) + Math.max(0, f(cold) + (dir === 'withdraw' ? -1 : 1) * f(amount));
}

export interface SheetState {
  type: SheetType;
  amount: number | null;              // USD (draw/paydown) | BTC (buy/collateral) | null (setBalance)
  collateralDir: 'deposit' | 'withdraw';  // only meaningful when type === 'collateral'
  collateralTarget: CollateralTarget; // only meaningful when type === 'collateral'; 'cb' needs a loan, 'cold' never does
  debtTarget: DebtTarget;             // only meaningful for draw/paydown; 'cb' needs a loan (collapses to Strike without one)
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
  s: { type: SheetType; collateralDir: 'deposit' | 'withdraw'; effectiveTarget: CollateralTarget; amount: number | null; pledgeToStrike: boolean },
): number {
  const amt = s.amount ?? 0;
  if (s.type === 'collateral' && s.effectiveTarget === 'strike') return base + (s.collateralDir === 'withdraw' ? -amt : amt);
  if (s.type === 'buy' && s.pledgeToStrike) return base + amt;
  return base;
}

/**
 * SheetState → the DayEvent[] to write (LD6: a flow writes the flow AND a balanceReading atomically).
 *  - setBalance  → [balanceReading]
 *  - draw/paydown → [{kind}, balanceReading]            (amount = USD) — Strike
 *                   [{kind, target:'cb'[, fee]}]          — Coinbase: written ALONE; a borrow carries its computed
 *                                                          origination fee. target:'cb' collapses to Strike without a loan.
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
  currentCbBalance: number,          // the ACCRUED Coinbase balance — the fee bracket basis for a CB borrow
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
    case 'paydown': {
      // ⚠ Collapse 'cb' to Strike WITHOUT a loan — you cannot borrow from a loan you don't have. The OPPOSITE of the
      // cold rule (cold never needs a loan); don't "fix" one to match the other.
      const venue: DebtTarget = s.debtTarget === 'cb' && hasCbLoan ? 'cb' : 'strike';
      const flow: DayEvent = {
        id: idFn(), date: today, ts, kind: s.type, amount,
        // ⚠ target is written ONLY for Coinbase — a Strike flow serialises byte-identically to every existing row.
        ...(venue === 'cb' ? { target: 'cb' as const } : {}),
        // The fee is a FACT (the brackets), computed not typed — cbBorrowFee is the single definition.
        ...(venue === 'cb' && s.type === 'draw' ? { fee: cbBorrowFee(amount, currentCbBalance) } : {}),
      };
      return DEBT_TARGET_RULES[venue].needsReading ? [flow, readingEvent] : [flow];
    }
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
    case 'collateral': {
      // ⚠ Collapse ONLY 'cb' without a loan. Cold is self-custody and never needs a loan — the old
      // `hasCbLoan ? target : 'strike'` turned a no-loan owner's cold deposit into a STRIKE deposit.
      const target: CollateralTarget = s.collateralTarget === 'cb' && !hasCbLoan ? 'strike' : s.collateralTarget;
      const move: DayEvent = {
        id: idFn(), date: today, ts,
        kind: s.collateralDir === 'withdraw' ? 'withdraw' : 'deposit',
        amount, target,
      };
      // Cold has no statement and moves neither lender, so it is written ALONE — no balanceReading.
      return COLLATERAL_TARGET_RULES[target].needsReading ? [move, readingEvent] : [move];
    }
  }
}
