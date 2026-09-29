// Emergency Console — the retained pure model. Clock-free, plain numbers only: the VIEW pre-accrues the CB debt via
// accruedCbBalance (cbMetrics.ts) and passes it in as `cbDebt`, so this module has no Date/clock dependency and is
// fully unit-testable.
//
// Since crash playbook Run 2 it holds only the stage ladder, STRIKE_MARGIN_CALL_LTV and the two last-resort walls. The
// crash-day answer is `crashPlaybook` (simulation/crashPlaybook.ts), run on the live position through
// components/Tools/crashPlaybookView. No cycle/power-law inputs ever touch this model (§7 hard wall).

import { CB_LLTV } from './runCoinbaseLoan';
// THE LTV definition (zero-import leaf — the §7 wall holds). Debt with no collateral is ∞, never a
// flattering 0: Coinbase debt with nothing behind it must classify as 'liquidated', not 'normal'.
import { ltvOf } from './ltv';

// Strike's margin-call LTV (distinct from the 0.50 draw cap and the 0.15 operating ceiling). The engine's inputs, the
// faces and the crash playbook import it from here.
export const STRIKE_MARGIN_CALL_LTV = 0.70;

// The CB LTV ladder (fixed per spec — liq = CB_LLTV = 0.86). Exported for the future push-alerts consumer.
export const CB_LADDER = { watch: 0.69, prepare: 0.72, execute: 0.75, lastResort: 0.81 } as const;

export type LadderKey = keyof typeof CB_LADDER;
export type LadderStage = 'normal' | 'watch' | 'prepare' | 'execute' | 'lastResort' | 'liquidated';

/** Live emergency inputs. `cbDebt` is the ALREADY-ACCRUED CB balance. The Strike position lives in
 *  `CrashPlaybookInput` now (components/Tools/crashPlaybookView builds it). */
export interface EmergencyState {
  cbDebt: number;
  cbCollateralBtc: number;
  price: number;
}

/** CB liquidation / ladder-band price = debt / (collateral × LTV). Guards zero collateral → 0. */
function cbPriceAt(cbDebt: number, cbCollateralBtc: number, ltv: number): number {
  return cbCollateralBtc > 0 ? cbDebt / (cbCollateralBtc * ltv) : 0;
}

export interface StageResult {
  stage: LadderStage;
  cbLtv: number;
  liqPrice: number;
  distancePct: number; // (price − liqPrice) / price — how far the current price sits above liquidation
  bandPrices: Record<LadderKey, number>;
}

export function classifyStage(s: EmergencyState): StageResult {
  const cbLtv = ltvOf(s.cbDebt, s.cbCollateralBtc, s.price);
  const liqPrice = cbPriceAt(s.cbDebt, s.cbCollateralBtc, CB_LLTV);
  const distancePct = s.price > 0 ? (s.price - liqPrice) / s.price : 0;

  let stage: LadderStage;
  if (cbLtv >= CB_LLTV) stage = 'liquidated';
  else if (cbLtv >= CB_LADDER.lastResort) stage = 'lastResort';
  else if (cbLtv >= CB_LADDER.execute) stage = 'execute';
  else if (cbLtv >= CB_LADDER.prepare) stage = 'prepare';
  else if (cbLtv >= CB_LADDER.watch) stage = 'watch';
  else stage = 'normal';

  const bandPrices = {
    watch:      cbPriceAt(s.cbDebt, s.cbCollateralBtc, CB_LADDER.watch),
    prepare:    cbPriceAt(s.cbDebt, s.cbCollateralBtc, CB_LADDER.prepare),
    execute:    cbPriceAt(s.cbDebt, s.cbCollateralBtc, CB_LADDER.execute),
    lastResort: cbPriceAt(s.cbDebt, s.cbCollateralBtc, CB_LADDER.lastResort),
  } as Record<LadderKey, number>;

  return { stage, cbLtv, liqPrice, distancePct, bandPrices };
}

// ── Last resorts (paydown-numerator fallbacks — salvaged Liq Sim math) ───────────────────────────────────────────

/** Sell to pay down (Wall 3): the paydown needed to reach `targetLiq`, and the BTC that raises it. */
export function wall3Sale(s: EmergencyState, targetLiq: number): { paydownNeeded: number; btcToSell: number } {
  const paydownNeeded = Math.max(0, s.cbDebt - targetLiq * s.cbCollateralBtc * CB_LLTV);
  const btcToSell = s.price > 0 ? paydownNeeded / s.price : 0;
  return { paydownNeeded, btcToSell };
}

/** Outside cash (Wall 4): pay down with outside cash → new liq price. */
export function wall4External(s: EmergencyState, cashUsd: number): { liqAfter: number } {
  const debtAfter = Math.max(0, s.cbDebt - cashUsd);
  return { liqAfter: cbPriceAt(debtAfter, s.cbCollateralBtc, CB_LLTV) };
}
