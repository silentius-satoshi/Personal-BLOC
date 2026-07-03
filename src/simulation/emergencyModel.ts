// Emergency Console — pure model (Phase 1). Clock-free, plain numbers only: the VIEW pre-accrues the CB
// debt via accruedCbBalance (cbMetrics.ts) and passes it in as `cbDebt`, so this module has no Date/clock
// dependency and is fully unit-testable against the Emergency Directive fixtures.
//
// Doctrine: the PRIMARY lever is collateral top-up (grow the CB collateral denominator → push the liq price
// DOWN). Paydown (numerator) is the Dire Switch / Wall-2 fallback only. All debt math flows through the
// pre-accrued `cbDebt`. No cycle/power-law inputs ever touch this model (§7 hard wall).

import { CB_LLTV } from './runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV, BLOC_OPERATING_CEILING } from './strikeCredit';

// Strike partial-liquidation / margin-call LTV used by the coupling warnings (distinct from the 0.50 draw
// cap and the 0.15 operating ceiling). Emergency-local per the directive's §10 formulas.
export const STRIKE_MARGIN_CALL_LTV = 0.70;

// The CB LTV ladder (fixed per spec — liq = CB_LLTV = 0.86). Exported for the future push-alerts consumer.
export const CB_LADDER = { watch: 0.69, prepare: 0.72, execute: 0.75, lastResort: 0.81 } as const;

export type LadderKey = keyof typeof CB_LADDER;
export type LadderStage = 'normal' | 'watch' | 'prepare' | 'execute' | 'lastResort' | 'liquidated';

/** Live emergency inputs. `cbDebt` is the ALREADY-ACCRUED CB balance; `ceilingPct` = cbEmergencyCeilingPct. */
export interface EmergencyState {
  cbDebt: number;
  cbCollateralBtc: number;
  skCollateralBtc: number;
  skDrawn: number;
  price: number;
  ceilingPct: number;
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
  const cbLtv = s.cbCollateralBtc * s.price > 0 ? s.cbDebt / (s.cbCollateralBtc * s.price) : 0;
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

export interface Firepower {
  slowBtc: number;                       // price-independent: (ceiling − operating) × skColl, i.e. Strike cured to 0.15 first
  fastBtc: (atPrice: number) => number;  // stuck: headroom to the ceiling given the LIVE skDrawn
  slowUsd: (atPrice: number) => number;
  fastUsd: (atPrice: number) => number;
}

/**
 * How much fresh BTC collateral you can raise from Strike to pledge to CB.
 * - SLOW (cured): assumes Strike was first paid down to the 0.15 operating ceiling, so the whole
 *   (ceiling − 0.15) LTV band is free headroom — a price-independent BTC amount.
 * - FAST (stuck): Strike is at its live drawn balance; headroom to the emergency ceiling at a given price.
 */
export function firepower(s: EmergencyState): Firepower {
  const ceiling = s.ceilingPct / 100;
  const slowBtc = Math.max(0, (ceiling - BLOC_OPERATING_CEILING) * s.skCollateralBtc);
  const fastBtc = (atPrice: number) =>
    atPrice > 0 ? Math.max(0, (ceiling * s.skCollateralBtc * atPrice - s.skDrawn) / atPrice) : 0;
  return {
    slowBtc,
    fastBtc,
    slowUsd: (atPrice: number) => slowBtc * atPrice,
    fastUsd: (atPrice: number) => fastBtc(atPrice) * atPrice,
  };
}

export interface DrawResult {
  drawUsd: number;
  btcAdded: number;
  newCbCollateral: number;
  newLiqPrice: number;
  liqDrop: number;
  newSkLtv: number;
  newSkMarginCallPrice: number;
  availableCredit: number; // headroom to the 50% Strike LTV line
  capped: boolean;
}

/**
 * Draw MORE from Strike up to `targetLtvPct` Strike LTV, buy BTC, pledge to CB. The draw is clamped to the
 * 50%-LTV Strike line (STRIKE_MAX_DRAW_LTV) — NOT the credit line, per spec §10. Every dollar drawn tightens
 * Strike (raising its own margin-call price) while loosening CB (dropping the CB floor).
 */
export function drawToLtv(s: EmergencyState, targetLtvPct: number): DrawResult {
  const target = targetLtvPct / 100;
  const skValue = s.skCollateralBtc * s.price;
  const availableCredit = Math.max(0, skValue * STRIKE_MAX_DRAW_LTV - s.skDrawn);
  const rawDraw = Math.max(0, target * skValue - s.skDrawn);
  const capped = rawDraw > availableCredit;
  const drawUsd = Math.min(rawDraw, availableCredit);

  const btcAdded = s.price > 0 ? drawUsd / s.price : 0;
  const newCbCollateral = s.cbCollateralBtc + btcAdded;
  const newLiqPrice = cbPriceAt(s.cbDebt, newCbCollateral, CB_LLTV);
  const liqPrice = cbPriceAt(s.cbDebt, s.cbCollateralBtc, CB_LLTV);

  const newDrawn = s.skDrawn + drawUsd;
  const newSkLtv = skValue > 0 ? newDrawn / skValue : 0;
  const newSkMarginCallPrice =
    s.skCollateralBtc > 0 ? newDrawn / (s.skCollateralBtc * STRIKE_MARGIN_CALL_LTV) : 0;

  return {
    drawUsd,
    btcAdded,
    newCbCollateral,
    newLiqPrice,
    liqDrop: liqPrice - newLiqPrice,
    newSkLtv,
    newSkMarginCallPrice,
    availableCredit,
    capped,
  };
}

export interface FloorRow {
  ceilingPct: number;      // NaN sentinel not used; standing row flagged by `standing`
  standing: boolean;
  btcAdded: number;        // slow (cured) top-up
  floor: number;           // CB liq price after the top-up
  deltaVsStanding: number; // how much lower the floor sits vs no action
  strikeSurvivesFurtherPct: number; // 1 − ceiling/marginCall — further BTC drop Strike survives at that draw
}

/** The "how low can I push the floor" table: standing (no action) + slow top-ups at [20,25,30,50]% ceilings. */
export function floorTable(s: EmergencyState): FloorRow[] {
  const standingLiq = cbPriceAt(s.cbDebt, s.cbCollateralBtc, CB_LLTV);
  const currentSkLtv = s.skCollateralBtc * s.price > 0 ? s.skDrawn / (s.skCollateralBtc * s.price) : 0;

  const standing: FloorRow = {
    ceilingPct: 0,
    standing: true,
    btcAdded: 0,
    floor: standingLiq,
    deltaVsStanding: 0,
    strikeSurvivesFurtherPct: Math.max(0, 1 - currentSkLtv / STRIKE_MARGIN_CALL_LTV),
  };

  const rows = [20, 25, 30, 50].map((ceilingPct): FloorRow => {
    const ceiling = ceilingPct / 100;
    const btcAdded = Math.max(0, (ceiling - BLOC_OPERATING_CEILING) * s.skCollateralBtc);
    const floor = cbPriceAt(s.cbDebt, s.cbCollateralBtc + btcAdded, CB_LLTV);
    return {
      ceilingPct,
      standing: false,
      btcAdded,
      floor,
      deltaVsStanding: standingLiq - floor,
      strikeSurvivesFurtherPct: Math.max(0, 1 - ceiling / STRIKE_MARGIN_CALL_LTV),
    };
  });

  return [standing, ...rows];
}

// ── Walls (paydown-numerator fallbacks — the Dire Switch, salvaged Liq Sim math) ──────────────────────

/** Wall 2 (Dire Switch): pay the CB debt down by `paydownUsd` → new liq price. */
export function direSwitch(s: EmergencyState, paydownUsd: number): { liqAfter: number } {
  const debtAfter = Math.max(0, s.cbDebt - paydownUsd);
  return { liqAfter: cbPriceAt(debtAfter, s.cbCollateralBtc, CB_LLTV) };
}

/** Wall 3 (sell to pay down): the paydown needed to reach `targetLiq`, and the BTC that raises it. */
export function wall3Sale(s: EmergencyState, targetLiq: number): { paydownNeeded: number; btcToSell: number } {
  const paydownNeeded = Math.max(0, s.cbDebt - targetLiq * s.cbCollateralBtc * CB_LLTV);
  const btcToSell = s.price > 0 ? paydownNeeded / s.price : 0;
  return { paydownNeeded, btcToSell };
}

/** Wall 4 (external cash injection): pay down with outside cash → new liq price. */
export function wall4External(s: EmergencyState, cashUsd: number): { liqAfter: number } {
  const debtAfter = Math.max(0, s.cbDebt - cashUsd);
  return { liqAfter: cbPriceAt(debtAfter, s.cbCollateralBtc, CB_LLTV) };
}

/** Monthly surplus available to service the emergency: income − expenses − interest on the ceiling balance. */
export function surplus(income: number, expenses: number, skDrawnAtCeiling: number, blocApr: number): number {
  return income - expenses - (skDrawnAtCeiling * blocApr) / 100 / 12;
}
