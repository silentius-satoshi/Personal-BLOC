import { CB_LLTV } from './runCoinbaseLoan';

export interface CbMetrics {
  ltv:          number;   // loanBalance / (collateralBtc × price)
  liqPrice:     number;   // computed liquidation price: balance / (collateral × 86%)
  triggerPrice: number;   // price at which CB LTV hits the trigger %
  pctToTrigger: number;   // (triggerPrice − price) / price; positive = price above trigger
  pctToLiq:     number;   // (liqPrice − price) / price; uses COMPUTED liqPrice only
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
  const ltv           = collateralUsd > 0 ? loanBalance / collateralUsd : 0;
  const liqPrice      = collateralBtc > 0 ? loanBalance / (collateralBtc * CB_LLTV) : 0;
  const triggerPrice  = collateralBtc > 0 ? loanBalance / (collateralBtc * (triggerPct / 100)) : 0;
  const pctToTrigger  = price > 0 ? (triggerPrice - price) / price : 0;
  const pctToLiq      = price > 0 ? (liqPrice - price) / price : 0;
  return { ltv, liqPrice, triggerPrice, pctToTrigger, pctToLiq };
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
