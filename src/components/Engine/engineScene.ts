import { computeViewerSafety, deriveSafetyView, type SafetyLevel, type SafetyViewInputs } from '../../simulation/safetyView';
import { CB_ACT_LTV_FACTOR, cbMonthlyInterest } from '../../simulation/cbMetrics';
import { computeLiquidationAnalysis } from '../../simulation/runCoinbaseLoan';
import type { CyclingRow } from '../../simulation/cyclingSim';
import type { CycleLeg } from '../../simulation/cycleModel';
import type { CycleLegView } from '../Almanac/cycleClockView';
import { shownUsd } from '../../utils/format';
import {
  engineLabels, type CardFigures, type EngineLabels, type EnginePart, type FeedState, type FlowFigures, type LabelFigures,
} from './engineView';

/**
 * The Engine · Micro (BL61, step 1) — THE pure scene. Facts, the canvas's width and a tried price in; every figure, word,
 * place and tap area the canvas shows out, at rest. No store, no DOM, and no clock but the Dashboard's own
 * (`deriveSafetyView` accrues Coinbase's balance to now once it has an as-of date): the hook (`useEngineFacts`) gathers
 * the facts, and the canvas (`engineDraw`) draws this, moving between two scenes with the same pure geometry exported
 * here.
 *
 * Every figure is the app's own: the Dashboard's view — `deriveSafetyView` on the Dashboard's inputs, at the price shown
 * (a tried price is that same call with `btcPrice` swapped, so it moves exactly what a price moves there); Strike's
 * liquidation price from `computeViewerSafety` (the Dashboard's formula); the month from THIS MONTH's run (the plan of
 * record's month 1) and the CB Loan tab's monthly interest (`cbMonthlyInterest`); what Coinbase would sell from the CB Loan
 * tab's liquidation math (`computeLiquidationAnalysis`, its full-repayment case). The drop to liquidation is the
 * Dashboard's own (`(price − liquidation) ÷ price`).
 *
 * Everything else is the picture, after the owner's prototypes — `personal-bloc-engine-prototype-v2.html`'s Micro view,
 * which draws with `family-fire-engine-v3.html`'s machine: its phone layout, its price scale, its cylinders as wide as
 * their coins, its flywheel and price motor, its tags and tap areas. Two of their numbers are left out: the family's
 * coin floor (here the bay is the owner's own coins), and their five colour zones (BL61: the
 * Dashboard's three levels colour the engine).
 */

/** THIS MONTH's month — the fields of the plan of record's month 1 the Engine reads (Daily's `pr1`). */
export type EngineMonthRow = Pick<CyclingRow,
  'strikeInterestUsd' | 'strikeDrawn' | 'strikeRepaidUsd' | 'cbRepaidUsd' | 'strikeMinPaidUsd' | 'cashToCureUsd' | 'refinancedFeeUsd'>;

export interface EngineFacts {
  /** The Dashboard's inputs, exactly: `selectSafetyViewInputs(state)` with today's support (`SafetyDashboard.tsx`). */
  safety: SafetyViewInputs;
  /** THIS MONTH's month, or null before its run exists. */
  month: EngineMonthRow | null;
  /** This month's move brings Coinbase within its limit at support (`planMoveBringsCbWithin` on THIS MONTH's run, as the
   *  owner's Dashboard is told it): the at-support line says so (v1.4). */
  moveBringsCbWithin: boolean;
  /** The Cycle Clock's leg now (`cycleLegAt`, and `cycleLegView` for its words) — null outside the projection. */
  cycle: { leg: CycleLeg; view: CycleLegView } | null;
  /** The market's last hour: one-minute candles (each `t` is its minute's start), oldest first (`useBtcHistory('1H')`). */
  candles: readonly { t: number; price: number }[];
  /** The live feed's state, and its newest price and time (`useLivePrice`). */
  feed: FeedState;
  livePrice: number | null;
  liveAt: number | null;
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface PriceScale { lo: number; hi: number }
export interface TapePoint { t: number; p: number }

/** The phone layout (the prototypes' `layout`, under 880 px), from the canvas's width. */
export interface EngineLayout {
  W: number;
  H: number;
  top: number;
  bot: number;
  under: number;
  flowY: number;
  tagX: number;
  tagW: number;
  area: number;
  cylX: number;
  tape: Rect;
  gauge: { cx: number; cy: number; r: number };
  wheel: { y: number; r: number };
  motor: { y: number; r: number };
}

/** The cylinder bay: Coinbase's tube, Strike's beside it (when it has room), the rods and the beam's ends. */
export interface Bay { cX: number; cW: number; sX: number; sW: number; showS: boolean; right: number; rodX: number; attX: number }

/** The tap areas, in the order the prototypes register them: the last that holds a point wins. */
export type RegionId = 'month' | 'tape' | 'strike' | 'dots' | 'redline' | 'piston' | 'wheel' | 'worm' | 'motor' | 'gauge' | 'price' | 'untest' | 'redtag';
export interface EngineRegion extends Rect {
  id: RegionId;
  /** The part a tap opens; null for `untest`, whose tap goes back to today's price. */
  part: EnginePart | null;
  /** The piston: a drag tries a price. */
  drag?: true;
}
/** The regions a ring is drawn round, when their part is open (the prototypes' `ringIds`). */
export const RING_IDS: ReadonlySet<RegionId> = new Set<RegionId>(['gauge', 'wheel', 'motor', 'strike', 'dots', 'price', 'redtag']);

/** The motor's lamp: live, a tried price, a manual or stale price, or none. */
export type MotorLamp = 'live' | 'tried' | 'held' | 'off';

export interface EngineScene extends EngineLayout {
  /** Today's price (every screen's) and the price drawn — a tried one, or today's. */
  realPrice: number;
  price: number;
  tried: boolean;
  /** The log-price scale the cylinders stand on, and the piston's height, at rest. */
  scale: PriceScale;
  yP: number;
  bay: Bay;
  cb: { coins: number; debt: number; owes: boolean; ltv: number; level: SafetyLevel; liq: number; liqFrac: number; yF: number | null };
  sk: { coins: number; debt: number; owes: boolean; ltv: number; level: SafetyLevel; liq: number; liqFrac: number; yF: number | null };
  /** The Dashboard's drop to Coinbase's liquidation price; null with nothing owed there. */
  drop: number | null;
  /** The price drawn is at or under Coinbase's liquidation price. */
  sells: boolean;
  atSupportOver: boolean;
  /** The gauge: Coinbase's level and its bands; `needle`, where the needle rests (`needleOf`). */
  gaugeFig: { loan: boolean; ltv: number; level: SafetyLevel; warnAt: number; actAt: number; liqAt: number; needle: number };
  /** The flywheel's angle: 0 at a projected peak, π at a floor (each leg half a turn); null outside the projection. */
  cycle: { angle: number; rising: boolean } | null;
  wheelAt: WheelAt;
  motorAt: MotorAt;
  flows: FlowFigures | null;
  /** Each pipe's share of the larger flow (0–1), for its pace. */
  flowShares: { in: number; out: number };
  feed: FeedState;
  /** The motor runs on live prices, and rests while a price is tried. */
  motorOn: boolean;
  lamp: MotorLamp;
  /** The tape's prices: the minute closes (each at its minute's end) and the newest live price, when the feed has one. */
  tapePrices: { closes: TapePoint[]; live: TapePoint | null };
  /** The dollars of debt one particle of the charge stands for (the prototypes' `U × 3 ÷ 260`, U today's price). */
  chargeUsd: number;
  /** The tags' heights: the price, the liquidation price (null without one) and the drop between them (null without room). */
  tags: { py: number; ry: number | null; my: number | null };
  labels: EngineLabels;
  /** The figures a part's card reads (`partCard`). */
  card: CardFigures;
  /** Tap areas, at rest, in drawing order. */
  regions: EngineRegion[];
}

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** The canvas's width bounds: the phone layout, centred by the face from 700 px. */
export const ENGINE_MIN_W = 300;
export const ENGINE_MAX_W = 700;
/** The live tape shows the last half hour (the prototypes' `LIVE_MS`). */
export const TAPE_MS = 30 * 60_000;

/** THE layout: the prototypes' phone machine in its Micro view (no wallets, no plan strip, no knob bank). */
export function engineLayout(width: number): EngineLayout {
  const W = clamp(Math.floor(width), ENGINE_MIN_W, ENGINE_MAX_W);
  const top = 118;
  const bot = 378;
  const tagW = 68;
  const tagX = W - 8 - tagW;
  const area = clamp(W * 0.27, 84, 132);
  const cylX = tagX - 6 - (area * 0.944 + 6);
  const flowY = bot + 94;
  return {
    W, H: flowY + 44, top, bot, under: bot + 26, flowY, tagX, tagW, area, cylX,
    tape: { x: 8, y: top, w: cylX - 6 - 8, h: bot - top },
    gauge: { cx: 54, cy: 49, r: 35 },
    wheel: { y: 58, r: 31 },
    motor: { y: 58, r: 18 },
  };
}

/** THE bay: each tube as wide as its coins (Coinbase's at least 0.05 ₿ wide), the two together filling the space the
 *  layout keeps for them; Strike's drawn once it is over 3 px. */
export function bayOf(L: Pick<EngineLayout, 'area' | 'cylX'>, cbCoins: number, skCoins: number): Bay {
  const cb = Math.max(0.05, cbCoins);
  const sk = Math.max(0, skCoins);
  const coinsRef = Math.max(1e-6, (cb + sk) * 1.06);
  const cW = L.area * cb / coinsRef;
  const sW = L.area * sk / coinsRef;
  const showS = sW > 3;
  const cX = L.cylX;
  const sX = cX + cW + (showS ? 6 : 0);
  const rodX = cX + cW / 2;
  return {
    cX, cW, sX, sW, showS, right: showS ? sX + sW : cX + cW, rodX,
    attX: showS ? sX + sW / 2 : rodX + Math.max(10, Math.min(cW / 2 - 8, 34)),
  };
}

/** The names' places under the tubes: their centres, pushed 31 px apart either way when the two crowd. */
export function cylLabelX(b: Pick<Bay, 'cX' | 'cW' | 'sX' | 'sW' | 'showS'>): { c: number; s: number } {
  let c = b.cX + b.cW / 2;
  let s = b.sX + b.sW / 2;
  if (b.showS && s - c < 62) { const mid = (c + s) / 2; c = mid - 31; s = mid + 31; }
  return { c, s };
}

/** The flywheel's measures, from its radius (the prototypes' `rotorDims`). */
export function rotorDims(wr: number): { big: boolean; band: number; tooth: number; Rt: number; Ro: number; depth: number } {
  const big = wr >= 40;
  const band = big ? 14 : 10.5;
  const tooth = big ? 4.6 : 3.6;
  return { big, band, tooth, Rt: wr + band / 2 + tooth / 2, Ro: wr + band / 2 + tooth, depth: big ? 7 : 4.5 };
}

export interface WheelAt { x: number; y: number; r: number; Ro: number }
/** The flywheel stands over Coinbase's rod, never closer to the bay's edge than its own radius. */
export function wheelOf(L: Pick<EngineLayout, 'cylX' | 'wheel'>, b: Pick<Bay, 'rodX'>): WheelAt {
  return { x: Math.max(b.rodX, L.cylX + L.wheel.r + 4), y: L.wheel.y, r: L.wheel.r, Ro: rotorDims(L.wheel.r).Ro };
}

export interface MotorAt { x: number; y: number; r: number; tr: number; big: boolean; wormX: number; wormW: number; wormH: number; boxW: number }
/** The price motor stands to the flywheel's right, its worm gear against the flywheel's teeth, its crank over the beam's
 *  far end (the prototypes' `drawMotor`). */
export function motorOf(L: Pick<EngineLayout, 'W' | 'motor'>, w: WheelAt, b: Pick<Bay, 'attX'>): MotorAt {
  const mr = L.motor.r;
  const big = mr >= 24;
  const wormW = big ? 12 : 10;
  const wormH = big ? 34 : 26;
  const boxW = big ? 9 : 7;
  const shaft = big ? 5 : 3;
  const wormX = w.x + w.Ro + 1 + wormW / 2;
  const x = clamp(Math.max(wormX + wormW / 2 + boxW + shaft + mr + 5, b.attX + 4), mr + 12, L.W - mr - 12);
  return { x, y: L.motor.y, r: mr, tr: mr + 9, big, wormX, wormW, wormH, boxW };
}

/** A price's height on the cylinders' log scale. */
export function yOfPrice(p: number, s: PriceScale, top: number, bot: number): number {
  return bot - (Math.log(Math.max(p, 1e-9)) - Math.log(s.lo)) / (Math.log(s.hi) - Math.log(s.lo)) * (bot - top);
}
/** The price at a height — `yOfPrice`'s inverse (the piston's drag). */
export function priceOfY(y: number, s: PriceScale, top: number, bot: number): number {
  return Math.exp(Math.log(s.lo) + (bot - y) / (bot - top) * (Math.log(s.hi) - Math.log(s.lo)));
}

/** THE scale, by the prototypes' live rule ("the cylinder frames just the price and the liquidation price"): 12% of
 *  room over the price; under it, a fifth below the liquidation line when that line is within reach (over 30% of the
 *  price), else 16% below the price; never flatter than 0.5 in log units. `P` is the piston's price (moving, in the
 *  canvas) and `target` the price it is going to. */
export function priceScale(P: number, liq: number, target: number = P): PriceScale {
  const p = P > 0 ? P : 1;
  const cut = liq > 0 ? liq * 0.8 : 0;
  let lo = p;
  let hi = p;
  if (target > hi) hi = target;
  if (target >= cut && target > 0 && target < lo) lo = target;
  let tl = liq > lo * 0.3 ? Math.log(Math.min(cut, p * 0.9)) : Math.log(lo * 0.84);
  let th = Math.log(hi * 1.12);
  if (th - tl < 0.5) { const mid = (th + tl) / 2; tl = mid - 0.25; th = mid + 0.25; }
  return { lo: Math.exp(tl), hi: Math.exp(th) };
}

/** The tags' heights: the price rides the piston; the liquidation price sits under its line; the drop between them,
 *  given room — both kept above the bed plate, where Micro's pipes run. ONE rule: the scene at rest, the canvas moving. */
export function tagHeights(yP: number, yF: number | null, top: number, bot: number): { py: number; ry: number | null; my: number | null } {
  let py = clamp(yP - 6, top + 10, bot - 6);
  if (yF !== null) py = Math.min(py, bot - 52);
  const ry = yF !== null ? clamp(yF + 13, py + 34, bot - 18) : null;
  const my = ry !== null && ry - py > 44 ? (py + 6 + ry - 11) / 2 + 6 : null;
  return { py, ry, my };
}

/** The flywheel's angle at a leg: a peak at the top, a floor at the bottom — the descending leg the right half, the
 *  rising leg the left (the prototypes' `cycleAngle`). */
export function cycleAngleOf(leg: Pick<CycleLeg, 'rising' | 'fraction'>): number {
  return leg.rising ? Math.PI + leg.fraction * Math.PI : leg.fraction * Math.PI;
}

/** THE month's two flows: in — Coinbase's interest (the CB Loan tab's, at today's balance), Strike's interest, the
 *  bills' draw and Coinbase's fee on a refinance; out — what spare income repays on both loans, Strike's minimum paid
 *  from income and the cash reserve's cure. A move between the two loans (a refinance, a defense) is neither: it moves
 *  debt, it adds or repays none — but a refinance's fee is new debt, so it is in (v1.4). */
export function engineFlows(row: EngineMonthRow, cbDebt: number, cbAprPct: number): FlowFigures {
  const cbInterestUsd = cbMonthlyInterest(cbDebt, cbAprPct);
  const repaidUsd = row.strikeRepaidUsd + row.cbRepaidUsd;
  return {
    cbInterestUsd,
    strikeInterestUsd: row.strikeInterestUsd,
    drawnUsd: row.strikeDrawn,
    feeUsd: row.refinancedFeeUsd,
    repaidUsd,
    minPaidUsd: row.strikeMinPaidUsd,
    cureUsd: row.cashToCureUsd,
    inUsd: cbInterestUsd + row.strikeInterestUsd + row.strikeDrawn + row.refinancedFeeUsd,
    outUsd: repaidUsd + row.strikeMinPaidUsd + row.cashToCureUsd,
  };
}

/** Where the gauge's needle rests: the loan level on the dial, which reads 0–100%. A level past it — or an infinite one, a
 *  debt with no coins behind it — rests at the dial's end, so the needle's spring never runs to infinity (v1.4). */
export function needleOf(ltv: number): number {
  return ltv > 1 ? 1 : ltv > 0 ? ltv : 0;
}

/** The tape's prices: each minute's close at its minute's end, oldest first, the half hour (and a little more) before the
 *  newest; and the live price, while the feed has one (live or stale) newer than the last close. */
export function tapeOf(facts: Pick<EngineFacts, 'candles' | 'feed' | 'livePrice' | 'liveAt'>): { closes: TapePoint[]; live: TapePoint | null } {
  const all = facts.candles
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.price) && c.price > 0)
    .map((c) => ({ t: c.t + 60_000, p: c.price }))
    .sort((a, b) => a.t - b.t);
  const t1 = all.length > 0 ? all[all.length - 1].t : -Infinity;
  const closes = all.filter((q) => q.t >= t1 - TAPE_MS - 3 * 60_000);
  const live = (facts.feed === 'live' || facts.feed === 'stale') && facts.livePrice !== null && facts.livePrice > 0
    && facts.liveAt !== null && Number.isFinite(facts.liveAt) && facts.liveAt > t1 - 60_000
    ? { t: facts.liveAt, p: facts.livePrice } : null;
  return { closes, live };
}

/** THE scene: the facts, the canvas's width and a tried price (null: today's) in; the picture out. */
export function engineScene(facts: EngineFacts, width: number, tried: number | null): EngineScene {
  const L = engineLayout(width);
  const { top, bot, tagX, tagW } = L;

  // ── the figures: the Dashboard's view at the price drawn. Live, that is the live price (BL64): the whole picture rides
  //    it, as in the prototypes; the saved price behind every other screen keeps its own rule (a 0.1% move or a minute).
  //    Manual, stale or off, the saved price. A tried price swaps it, as on the Dashboard. ──
  const saved = facts.safety.btcPrice;
  const realPrice = facts.feed === 'live' && facts.livePrice !== null && facts.livePrice > 0 ? facts.livePrice : saved;
  const isTried = tried !== null && Number.isFinite(tried) && tried > 0;
  const price = isTried ? tried : realPrice;
  const inputs: SafetyViewInputs = price !== saved ? { ...facts.safety, btcPrice: price } : facts.safety;
  const view = deriveSafetyView(inputs);
  const viewer = computeViewerSafety(null, price, inputs);
  const hasCbLoan = inputs.hasCbLoan;
  const cbCoins = hasCbLoan ? inputs.cbCollateralBtc : 0;   // the Coinbase leg is the owner's: none with the loan off (D-R2-4)
  const cbDebt = view.accruedBalance;
  const cbLiq = view.cbLiqPrice;
  const skCoins = inputs.currentBtcHeld;
  const skDebt = inputs.advisorActualBlocBalance;
  const skLiq = viewer.figures?.strike.liqPrice ?? 0;
  const owesCb = hasCbLoan && shownUsd(cbDebt) && cbLiq > 0;
  const owesSk = shownUsd(skDebt);
  const drop = owesCb ? (price > 0 ? (price - cbLiq) / price : 0) : null;   // the Dashboard's drop (`liqDropPct`)
  const sells = owesCb && price <= cbLiq;
  const atSupportOver = view.cbAtSupport?.over === true;
  const sellBtc = sells ? computeLiquidationAnalysis(cbDebt, cbCoins, price, cbLiq).scenarios[3].collateralSeizedBtc : null;

  // ── the picture: two tubes as wide as their coins, on one log scale ──
  const bay = bayOf(L, cbCoins, skCoins);
  const scale = priceScale(price, owesCb ? cbLiq : 0);
  const Y = (p: number): number => yOfPrice(p, scale, top, bot);
  const yP = clamp(Y(price), top + 2, bot - 2);
  const floorAt = (liq: number, owes: boolean): number | null => (owes && liq > 0 && Y(liq) < bot - 1 ? Math.max(top, Y(liq)) : null);
  const cbYF = floorAt(cbLiq, owesCb);
  const skYF = bay.showS ? floorAt(skLiq, owesSk) : null;
  const wheelAt = wheelOf(L, bay);
  const motorAt = motorOf(L, wheelAt, bay);
  const { py, ry, my } = tagHeights(yP, cbYF, top, bot);

  const flows = facts.month !== null ? engineFlows(facts.month, cbDebt, inputs.cbAprPct) : null;
  const big = flows !== null ? Math.max(flows.inUsd, flows.outUsd, 1) : 1;
  const flowShares = {
    in: flows !== null && shownUsd(flows.inUsd) ? flows.inUsd / big : 0,
    out: flows !== null && shownUsd(flows.outUsd) ? flows.outUsd / big : 0,
  };
  const motorOn = facts.feed === 'live' && !isTried;
  const lamp: MotorLamp = isTried ? 'tried' : facts.feed === 'live' ? 'live' : facts.feed === 'off' ? 'off' : 'held';

  const labelFigures: LabelFigures = {
    price, tried: isTried, hasCbLoan, cbCoins, cbDebt, cbLiq, cbLtv: view.cbLtv, cbLevel: view.cbLevel, cbLiqFrac: view.cbLiqFrac,
    skCoins, skDebt, drop, sells, atSupportOver, flows, feed: facts.feed, sellBtc,
  };
  const card: CardFigures = {
    ...labelFigures, realPrice, cbAprPct: inputs.cbAprPct, skLtv: view.strikeLtv, skLevel: view.strikeLevel, skLiq,
    strikeLiqLtvPct: inputs.strikeLiquidationLtvPct, cbLtvTriggerPct: inputs.cbLtvTriggerPct,
    cbActAt: view.cbLiqFrac * CB_ACT_LTV_FACTOR, cbAtSupport: view.cbAtSupport, moveBringsCbWithin: facts.moveBringsCbWithin,
    leg: facts.cycle?.view ?? null,
  };

  // the tap areas, in the prototypes' drawing order (the last that holds a point wins); Micro's pipes first, under all
  const tx = tagX + 10;
  const tape = L.tape;
  const tapeW = tape.w - (tape.w > 300 ? 46 : 26);
  const G = L.gauge;
  const M = motorAt;
  const regions: EngineRegion[] = [
    { id: 'month', part: 'month', x: 0, y: L.flowY - 16, w: L.W, h: 54 },
    { id: 'tape', part: 'tape', x: tape.x, y: tape.y, w: tapeW, h: tape.h },
  ];
  if (bay.showS) regions.push({ id: 'strike', part: 'strike', x: bay.sX, y: top - 8, w: Math.max(bay.sW, 12), h: bot - top + 8 });
  regions.push({ id: 'dots', part: 'coinbase', x: bay.cX, y: top - 8, w: bay.cW, h: bot - top + 8 });
  if (cbYF !== null) regions.push({ id: 'redline', part: 'sale', x: bay.cX - 10, y: cbYF - 9, w: bay.cW + 16, h: 18 });
  regions.push({ id: 'piston', part: 'price', x: bay.cX - 4, y: yP - 20, w: bay.right - bay.cX + 8, h: 28, drag: true });
  regions.push({ id: 'wheel', part: 'cycle', x: wheelAt.x - wheelAt.Ro - 4, y: wheelAt.y - wheelAt.Ro - 4, w: wheelAt.Ro * 2 + 8, h: wheelAt.Ro * 2 + 8 });
  regions.push({ id: 'worm', part: 'tape', x: M.wormX - M.wormW / 2 - 4, y: M.y - M.wormH / 2 - 6, w: M.wormW + M.boxW + 10, h: M.wormH + 12 });
  regions.push({ id: 'motor', part: 'tape', x: M.x - M.tr - 2, y: M.y - M.tr - 2, w: M.tr * 2 + 4, h: M.tr * 2 + 4 });
  regions.push({ id: 'gauge', part: 'gauge', x: G.cx - G.r * 1.14, y: G.cy - G.r * 1.14, w: G.r * 2.28, h: G.r * 2.28 });
  regions.push({ id: 'price', part: 'price', x: tx - 4, y: py - 20, w: tagW - 6, h: 30 });
  if (isTried) regions.push({ id: 'untest', part: null, x: tx - 4, y: py - 34, w: tagW, h: 14 });
  if (ry !== null) regions.push({ id: 'redtag', part: 'sale', x: tx - 4, y: ry - 11, w: tagW - 6, h: 28 });

  return {
    ...L,
    realPrice, price, tried: isTried, scale, yP, bay,
    cb: { coins: cbCoins, debt: cbDebt, owes: owesCb, ltv: view.cbLtv, level: view.cbLevel, liq: cbLiq, liqFrac: view.cbLiqFrac, yF: cbYF },
    sk: { coins: skCoins, debt: skDebt, owes: owesSk, ltv: view.strikeLtv, level: view.strikeLevel, liq: skLiq, liqFrac: inputs.strikeLiquidationLtvPct / 100, yF: skYF },
    drop, sells, atSupportOver,
    gaugeFig: {
      loan: hasCbLoan, ltv: view.cbLtv, level: view.cbLevel,
      warnAt: inputs.cbLtvTriggerPct / 100, actAt: view.cbLiqFrac * CB_ACT_LTV_FACTOR, liqAt: view.cbLiqFrac,
      needle: needleOf(view.cbLtv),
    },
    cycle: facts.cycle !== null ? { angle: cycleAngleOf(facts.cycle.leg), rising: facts.cycle.leg.rising } : null,
    wheelAt, motorAt, flows, flowShares, feed: facts.feed, motorOn, lamp,
    tapePrices: tapeOf(facts),
    chargeUsd: realPrice > 0 ? realPrice * 3 / 260 : 0,
    tags: { py, ry, my },
    labels: engineLabels(labelFigures),
    card,
    regions,
  };
}

/** The region at a point: the last drawn that holds it (the prototypes' `hitAt`). A finger also finds a small region
 *  within 44 px of it — the nearest one — as a fingertip is wider than the mouse's point. */
export function regionAt(scene: Pick<EngineScene, 'regions'>, x: number, y: number, finger = false): EngineRegion | null {
  const rs = scene.regions;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  }
  if (!finger) return null;
  let best: EngineRegion | null = null;
  let bd = Infinity;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    const gx = Math.max(0, (44 - r.w) / 2);
    const gy = Math.max(0, (44 - r.h) / 2);
    if ((gx === 0 && gy === 0) || x < r.x - gx || x > r.x + r.w + gx || y < r.y - gy || y > r.y + r.h + gy) continue;
    const dx = Math.max(r.x - x, 0, x - r.x - r.w);
    const dy = Math.max(r.y - y, 0, y - r.y - r.h);
    const dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = r; }
  }
  return best;
}
