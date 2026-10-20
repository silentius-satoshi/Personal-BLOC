/**
 * BL14 — net coins and the goal test (Batch 1, build 2; spec `pbloc-spec-batch-1-v1` §2.2). The pure leaf the engine's
 * month decision and the Dashboard's goal tile share, so the two read one rule.
 *
 * Net coins: every coin (Strike, Coinbase, cold) minus what is owed, in bitcoin at the price — so borrowing can't reach a
 * goal. 🔴 Pure + − × ÷, zero imports: the engine's exact-golden rule (G1's import walk reaches this file).
 */

/** Net coins this close under the goal count as at it — a figure computed ONTO the goal never reads as below it (the
 *  SUPPORT_EPS rule, relative). */
export const GOAL_EPS = 1e-12;

/** The parts net coins are made of — ₿ at each venue, dollars owed, and the price that turns debt into bitcoin. */
export interface NetCoinsInput {
  strikeBtc: number;
  cbBtc: number;
  coldBtc: number;
  strikeBalanceUsd: number;
  cbDebtUsd: number;
  price: number;
}

/**
 * Net coins: every coin minus what is owed, in bitcoin at `price`. `null` when it can't be read — no positive finite
 * price, or a part that isn't finite: no figure is better than a wrong one, and the engine then acts on its zone as if
 * there were no goal.
 */
export function netCoinsBtc(i: NetCoinsInput): number | null {
  const { strikeBtc, cbBtc, coldBtc, strikeBalanceUsd, cbDebtUsd, price } = i;
  if (!(price > 0)) return null;
  if (![strikeBtc, cbBtc, coldBtc, strikeBalanceUsd, cbDebtUsd, price].every((x) => Number.isFinite(x))) return null;
  return strikeBtc + cbBtc + coldBtc - (strikeBalanceUsd + cbDebtUsd) / price;
}

/** At the goal: net coins at or above it (within GOAL_EPS, relative). No goal, or no figure → false. */
export function atGoalOf(net: number | null, goal: number | null): boolean {
  return goal !== null && net !== null && net >= goal * (1 - GOAL_EPS);
}
