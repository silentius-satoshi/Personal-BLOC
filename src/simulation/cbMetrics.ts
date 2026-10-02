import { ltvOfUsd } from './ltv';
import { cbLiquidationPrice } from './runCoinbaseLoan';
import { shownUsd } from '../utils/format';

export interface CbMetrics {
  ltv:          number;   // loanBalance / (collateralBtc × price)
  liqPrice:     number;   // computed liquidation price: balance / (collateral × 86%)
  triggerPrice: number;   // price at which CB LTV hits the trigger %
  pctToTrigger: number;   // (triggerPrice − price) / price; positive = price above trigger
  pctToLiq:     number;   // (liqPrice − price) / price; uses COMPUTED liqPrice only
}

/** Coinbase's seizure price: where `balance` on `collateralBtc` reaches CB_LLTV — 0 with no collateral (the guard
 *  `cbMetrics` has always had). Two readers here, `cbMetrics().liqPrice` and `cbSeizurePrice` — and ONE expression,
 *  `cbLiquidationPrice` (runCoinbaseLoan), which the engine's seizure on the way down reads too. */
function liqPriceOf(balance: number, collateralBtc: number): number {
  return cbLiquidationPrice(balance, collateralBtc);
}

/**
 * Single source of truth for CB (Coinbase/Morpho) LTV + liquidation/trigger prices.
 * Consumed by the Simple Mode SafetyDashboard, the CB Loan tab (CoinbaseLoanMain/Sidebar),
 * so the figures can never disagree. Feed `accruedCbBalance(...)` in as `loanBalance` to
 * reflect interest accrued since the balance was last re-anchored.
 */
export function cbMetrics(
  loanBalance: number,
  collateralBtc: number,
  price: number,
  triggerPct: number,
): CbMetrics {
  const collateralUsd = collateralBtc * price;
  // Positive debt with no collateral is not a healthy zero-LTV position. Keep the sentinel finite
  // for normal zero-price guards, but classify an actually unbacked loan as immediately unsafe.
  const ltv           = ltvOfUsd(loanBalance, collateralUsd, collateralBtc);
  const liqPrice      = liqPriceOf(loanBalance, collateralBtc);
  const triggerPrice  = collateralBtc > 0 ? loanBalance / (collateralBtc * (triggerPct / 100)) : 0;
  const pctToTrigger  = price > 0 ? (triggerPrice - price) / price : 0;
  const pctToLiq      = price > 0 ? (liqPrice - price) / price : 0;
  return { ltv, liqPrice, triggerPrice, pctToTrigger, pctToLiq };
}

/**
 * Coinbase's seizure price for ONE projected row, or null when there is none — 🔴 THE one per-row rule. The Decision
 * face's cliff (`cliffPath`) draws it and the Worst (modeled) ranking (`planSearch`) measures its cushion against it,
 * so the line on the chart and the ranking's "closest to seizure" can never disagree. Policy v2, Run B: the support
 * policy card's cliff line and the three parent faces' charts (`chartCliffUsd`) read it too.
 *
 * Null:
 *  - on a `postLiquidation` row — the engine marks the liquidation row (pushed pre-seizure at month-end; the survivor,
 *    owing nothing, on the way down — Policy v2) and every row after it: null either way. There is no loan left to
 *    seize, and "the months before a liquidation" is this same cutoff;
 *  - when the debt is under the dust floor (`shownUsd`) — a residue is not a loan;
 *  - with no Coinbase collateral (`liqPriceOf` gives 0, and 0 is not a price);
 *  - when the PRICE is under the dust floor (`shownUsd`, Run B's R9) — a 60¢ loan on 2 ₿ seizes at 35¢, which would print
 *    as "$0" on the card and draw a cliff at nothing on a chart. Not finite is no price either.
 * Otherwise it is exactly `cbMetrics(...).liqPrice` — the Safety Dashboard's formula, never a second one.
 */
export function cbSeizurePrice(
  row: { cbDebt: number; cbCollateralBtc: number; postLiquidation: boolean },
): number | null {
  if (row.postLiquidation || !shownUsd(row.cbDebt)) return null;
  const p = liqPriceOf(row.cbDebt, row.cbCollateralBtc);
  return Number.isFinite(p) && shownUsd(p) ? p : null;
}

/**
 * Accrue a CB loan balance forward from its `asOf` date to now, compounding daily at aprPct.
 * Null asOf (never re-anchored) → return the balance unchanged. The CB balance drifts up with
 * interest, so a stale figure under-states LTV; accruing keeps the safety read honest.
 */
export function accruedCbBalance(balance: number, aprPct: number, asOf: string | null): number {
  if (!asOf) return balance;
  const days = Math.max(0, (Date.now() - Date.parse(asOf)) / 86_400_000);
  return balance * Math.pow(1 + aprPct / 100 / 365, days);
}

/**
 * Manual liquidation-price anchors age with the same daily debt factor as the balance. Coinbase's
 * liquidation price is debt divided by collateral and LLTV, so a stale entered price rises as the
 * underlying principal accrues. A null AsOf means the value has never been anchored and is left alone.
 */
export function accruedCbLiquidationPrice(price: number, aprPct: number, asOf: string | null): number {
  if (!(price > 0) || !asOf) return price;
  const days = Math.max(0, (Date.now() - Date.parse(asOf)) / 86_400_000);
  return price * Math.pow(1 + aprPct / 100 / 365, days);
}

export type SafetyLevel = 'safe' | 'watch' | 'act';

/** Classify a single LTV bar into safe/watch/act by two ascending thresholds (as LTV decimals). */
export function barLevel(ltv: number, warnAt: number, actAt: number): SafetyLevel {
  if (ltv >= actAt)  return 'act';
  if (ltv >= warnAt) return 'watch';
  return 'safe';
}

/** The 'act' (red) boundary factor for the CB gauge: red once cbLtv reaches cbLiqFrac × this. */
export const CB_ACT_LTV_FACTOR = 0.93;

/**
 * The CB (Coinbase/Morpho) gauge zone classifier — the SINGLE source of the CB bar's green/amber/red.
 * green (safe) below the trigger (default 75% → 0.75), amber (watch) up to cbLiqFrac × CB_ACT_LTV_FACTOR,
 * red (act) at/above that. Consumed by safetyView (owner dashboard + viewer scaler) AND the Almanac
 * Ledger face so a CB LTV colors identically everywhere (e.g. 57% under the default trigger stays green).
 */
export function cbBarLevel(cbLtv: number, cbLtvTriggerPct: number, cbLiqFrac: number): SafetyLevel {
  return barLevel(cbLtv, cbLtvTriggerPct / 100, cbLiqFrac * CB_ACT_LTV_FACTOR);
}

/** The more severe of two levels — the state line follows the NEARER (worse) bar. */
export function worseLevel(a: SafetyLevel, b: SafetyLevel): SafetyLevel {
  const rank: Record<SafetyLevel, number> = { safe: 0, watch: 1, act: 2 };
  return rank[a] >= rank[b] ? a : b;
}
