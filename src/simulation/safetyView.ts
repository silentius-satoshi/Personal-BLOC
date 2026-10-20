import { cbMetrics, accruedCbBalance, accruedCbLiquidationPrice, barLevel, cbBarLevel, worseLevel, type SafetyLevel } from './cbMetrics';
import { computeStrikeLtv, strikeAvailableCredit } from './strikeCredit';
import { CB_LLTV } from './runCoinbaseLoan';
import { ceilingHeadroomUsd } from './supportPolicy';
import { planCbLimitOf } from '../lib/planPolicy';
import { fmtUSD, fmtUSDCents, fmtLtvPct, shownUsd } from '../utils/format';
import type { StoreState } from '../store/useStore'; // TYPE-only → erased at compile → no runtime cycle

/**
 * Viewer Experience Revamp — V1.
 *
 * PURE single source of truth for the three safety dimensions BOTH the viewer home AND the owner's
 * SafetyDashboard render: Strike BLOC credit (capacity utilization), Strike BLOC LTV, and Coinbase LTV.
 * The owner-side dedup is DONE — SafetyDashboard.tsx now consumes deriveSafetyView (its inline copy is
 * gone), so the two surfaces cannot drift. `selectSafetyViewInputs` (below) is the single store→inputs
 * mapping shared by both call sites (and Viewer V2's safe-snapshot builder next).
 *
 * Reuses the already-shared primitives: cbMetrics/accruedCbBalance/barLevel/worseLevel (cbMetrics.ts),
 * computeStrikeLtv (strikeCredit.ts), CB_LLTV (runCoinbaseLoan.ts) — and since the plan of record's Run 4,
 * ceilingHeadroomUsd (supportPolicy.ts), planCbLimitOf (lib/planPolicy.ts) and the formatters (utils/format.ts). Today's
 * support arrives as an input (powerLaw's supportToday), so no belief is imported. No store/UI/price VALUE imports
 * (the StoreState import is type-only — the selector takes state as an argument, keeping this pure).
 *
 * The overall pill composition is left to each CONSUMER (one line) so the owner's `state` can stay
 * credit-excluded while the viewer's includes credit — see deriveViewerOverall below.
 */

export type { SafetyLevel } from './cbMetrics';
export { worseLevel };

/** The single SafetyLevel → CSS-var color map. Lifted here (was module-private in SafetyDashboard) so
 *  every level-colored surface — the owner SafetyDashboard bars AND the Almanac Ledger CB LTV cells —
 *  reads one map and can never drift. */
export const LEVEL_COLOR: Record<SafetyLevel, string> = {
  safe:  'var(--green)',
  watch: 'var(--amber)',
  act:   'var(--red)',
};

/** NEW for V1 — the credit gauge gets a risk band the owner UI lacks (capacity is "room", not risk
 *  in the owner view, so its bar is always green there). green < 75% used, amber 75-90%, red >= 90%. */
export const CREDIT_WARN_USED = 0.75;
export const CREDIT_ACT_USED = 0.90;

export interface SafetyViewInputs {
  advisorActualBlocBalance: number;
  creditLine: number;
  currentBtcHeld: number;
  btcPrice: number;
  strikeLiquidationLtvPct: number;
  hasCbLoan: boolean;
  cbLoanBalance: number;
  cbAprPct: number;
  cbLoanBalanceAsOf: string | null;
  cbCollateralBtc: number;
  cbLtvTriggerPct: number;
  cbLiquidationPrice: number;
  cbLiquidationPriceAsOf?: string | null;
  /** D7 (the plan of record's Run 4) — the plan's Coinbase limit at support, a fraction (`planCbLimitOf`). */
  cbLimitAtSupport?: number;
  /** D7 — today's support price (powerLaw's `supportToday`); a clock read, so the CALLER supplies it. Absent → no at-support
   *  reading. */
  supportToday?: number;
}

/**
 * D7 — Safety's at-support reading: Coinbase's debt against its collateral's value at today's support, beside the plan's
 * limit. On Safety's own inputs (the bar's accrued balance and collateral), by THIS MONTH's rule for "over" — the debt past
 * the limit at support by at least the dust floor (`placement`'s over-limit fact) — and amber, never red: red stays the
 * today's-price danger. A fact about the position as it stands: THIS MONTH's status reads it after the month's move.
 */
export interface CbAtSupport {
  /** Today's support price. */
  support: number;
  /** Debt ÷ (collateral × support). */
  ltv: number;
  /** The plan's limit, a fraction. */
  limit: number;
  over: boolean;
  level: SafetyLevel;
}
export function cbAtSupportOf(f: {
  hasCbLoan: boolean; debt: number; collateralBtc: number; support: number | undefined; limit: number | undefined;
}): CbAtSupport | null {
  const { support, limit } = f;
  if (!f.hasCbLoan || !shownUsd(f.debt) || !(f.collateralBtc > 0) || support === undefined || !(support > 0)
    || limit === undefined || !(limit > 0) || !Number.isFinite(f.debt) || !Number.isFinite(f.collateralBtc)) return null;
  const over = shownUsd(Math.max(0, -ceilingHeadroomUsd(f.debt, f.collateralBtc, support, limit)));
  return { support, ltv: f.debt / (f.collateralBtc * support), limit, over, level: over ? 'watch' : 'safe' };
}

/** D7 (D-R4-1) — the owner's line when Coinbase is over now and this month's move brings it within (THIS MONTH's card
 *  then reads "within", after the move): the position as it stands, and the fix the card's to-do names. Run 4.1 (BL29):
 *  after the line's own dash, a semicolon. */
export const CB_MOVE_BRINGS_WITHIN = "; this month's move brings it within";
export function ownerAtSupportLine(r: CbAtSupport, moveBringsWithin: boolean): string {
  return cbAtSupportLine(r, fmtUSDCents) + (r.over && moveBringsWithin ? CB_MOVE_BRINGS_WITHIN : '');
}

/** D7 — the Safety card's eyebrow when only the at-support reading is amber. */
export const CB_AT_SUPPORT_WATCH = "Watch — Coinbase is over the plan's limit at support";

/**
 * The owner's Safety verdict (the card's eyebrow) — CREDIT-EXCLUDED, unlike deriveViewerOverall: the nearer of the bars
 * shown (Strike, + Coinbase with a loan), and — D7, the plan of record's Run 4 — Coinbase at support against the plan's
 * limit: the worse reading wins, and the at-support one is amber at most (red stays the today's-price danger). When only
 * the at-support reading is amber, the words say so.
 */
export function ownerSafetyVerdict(view: SafetyView, hasCbLoan: boolean): { state: SafetyLevel; copy: string } {
  const today: SafetyLevel = hasCbLoan ? worseLevel(view.cbLevel, view.strikeLevel) : view.strikeLevel;
  const atSupport: SafetyLevel = hasCbLoan && view.cbAtSupport ? view.cbAtSupport.level : 'safe';
  const state = worseLevel(today, atSupport);
  const copy = state === 'safe'
    ? 'Safe — nothing to do today'
    : state === 'watch'
      ? (today === 'watch' ? 'Watch — your CB cushion is tightening' : CB_AT_SUPPORT_WATCH)
      : 'Act — pay down or add collateral now';
  return { state, copy };
}

/** D7 — the at-support line under the Coinbase bar (the owner's Safety card, to the cent; the Dashboard and a trusted
 *  viewer, whole). Run 4.1 (BL29, F-R4-2) — a what-if, in the bar's own terms, that says which side of the limit it is:
 *  "If BTC were at support ($S): X% LTV — over the plan's L% limit" (or "within"). "Were at" holds whether BTC is above
 *  support or below it. Over or within is the reading's level (the plan's 50¢ rule — `cbAtSupportOf`, or the owner's
 *  verdict in a viewer's snapshot), never the ratios; "the plan's limit", never "safe" (§4.7). With no support price
 *  (the safe viewer's snapshot carries none) it leaves the price out. */
export function cbAtSupportLine(
  r: { support: number | null; ltv: number; limit: number; level: SafetyLevel }, money: (n: number) => string = fmtUSD,
): string {
  const at = r.support !== null ? `If BTC were at support (${money(r.support)})` : 'If BTC were at support';
  const over = r.level !== 'safe';
  return `${at}: ${atSupportLtvText(r.ltv, r.limit, over)} LTV — ${over ? 'over' : 'within'} the plan's ${limitText(r.limit)} limit`;
}

/** Run 4.1 (BL29) — the plan's limit as a percentage, with its own decimals when it has them, at most two (a restored
 *  setting can be 45.5; §16.11): "45%", "45.5%", "45.25%" — and a 45.0951% limit, "45.1%". Printed from the hundredths
 *  the figure is held against (`atSupportLtvText`), so the line reads one limit: a 40.305% limit prints "40.31%". */
function limitText(limit: number): string {
  const hundredths = Math.round(limit * 10_000);
  return fmtLtvPct(hundredths / 10_000, hundredths % 100 === 0 ? 0 : hundredths % 10 === 0 ? 1 : 2);
}

/** Run 4.1 (BL29) — the figure agrees with the word, against the limit as `limitText` prints it: over, it never prints
 *  at or below it; within, never above it. One decimal, as `fmtLtvPct` prints it, moved to the nearest tenth on the
 *  word's side whenever one decimal would put it on the other — near the limit by rounding (over: a debt up to about $32
 *  past a 45% limit on 1 ₿ at a $64,699.79 support; within, too, under a two-decimal limit), or by the 50¢ rule on
 *  collateral worth under about $1,000 at support, where a reading within past the limit prints the limit itself (under
 *  a two-decimal limit, the tenth below). */
function atSupportLtvText(ltv: number, limit: number, over: boolean): string {
  if (!Number.isFinite(ltv)) return fmtLtvPct(ltv);
  const limitHundredths = Math.round(limit * 10_000);
  let tenths = Math.round(parseFloat(fmtLtvPct(ltv)) * 10);
  if (over && tenths * 10 <= limitHundredths) tenths = Math.floor(limitHundredths / 10) + 1;
  if (!over && tenths * 10 > limitHundredths) tenths = Math.floor(limitHundredths / 10);
  return fmtLtvPct(tenths / 1000);
}

export interface SafetyView {
  capacityUsed: number; // advisorActualBlocBalance / creditLine (0..1+)
  creditLevel: SafetyLevel;
  strikeLtv: number; // 0..1+
  strikeLevel: SafetyLevel;
  crashLtv: number; // Strike LTV if BTC fell 80% (read-only stress)
  cbLtv: number; // 0..1+ (0 when !hasCbLoan / no collateral)
  cbLevel: SafetyLevel; // 'safe' when !hasCbLoan
  // CB display intermediates — additive for the owner dashboard (the viewer ignores them).
  accruedBalance: number; // accrued CB debt (0 when !hasCbLoan)
  cbLiqPrice: number; // effective liquidation price: entered cbLiquidationPrice, else computed m.liqPrice (0 when !hasCbLoan)
  cbLiqFrac: number; // effective liquidation LTV fraction (CB_LLTV when !hasCbLoan)
  /** D7 (Run 4) — Coinbase at today's support against the plan's limit; null with no loan, no debt or no support. */
  cbAtSupport: CbAtSupport | null;
}

export function deriveSafetyView(inputs: SafetyViewInputs): SafetyView {
  const {
    advisorActualBlocBalance,
    creditLine,
    currentBtcHeld,
    btcPrice,
    strikeLiquidationLtvPct,
    hasCbLoan,
    cbLoanBalance,
    cbAprPct,
    cbLoanBalanceAsOf,
    cbCollateralBtc,
    cbLtvTriggerPct,
    cbLiquidationPrice,
    cbLiquidationPriceAsOf = null,
    cbLimitAtSupport,
    supportToday: support,
  } = inputs;

  // ── Strike credit (capacity utilization) ──
  const capacityUsed = creditLine > 0 ? advisorActualBlocBalance / creditLine : 0;
  const creditLevel = barLevel(capacityUsed, CREDIT_WARN_USED, CREDIT_ACT_USED);

  // ── Strike LTV (mirrors SafetyDashboard) ──
  const strikeLiqLtv = strikeLiquidationLtvPct / 100;
  const strikeLtv = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice);
  const crashLtv = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice * 0.2);
  const strikeLevel = barLevel(strikeLtv, strikeLiqLtv * 0.76, strikeLiqLtv * 0.82);

  // ── Coinbase LTV (mirrors SafetyDashboard; 'safe'/0 when no CB loan) ──
  // Intermediates hoisted with no-CB defaults so the return always carries them; when !hasCbLoan the
  // dashboard shows the CB setup card (never these values), so the defaults are value-inert.
  let cbLtv = 0;
  let cbLevel: SafetyLevel = 'safe';
  let accruedBalance = 0;
  let cbLiqPrice = 0;
  let cbLiqFrac = CB_LLTV;
  if (hasCbLoan) {
    accruedBalance = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
    const m = cbMetrics(accruedBalance, cbCollateralBtc, btcPrice, cbLtvTriggerPct);
    cbLiqPrice = cbLiquidationPrice > 0
      ? accruedCbLiquidationPrice(cbLiquidationPrice, cbAprPct, cbLiquidationPriceAsOf)
      : m.liqPrice;
    cbLtv = m.ltv;
    cbLiqFrac =
      cbLiqPrice > 0 && cbCollateralBtc > 0
        ? accruedBalance / (cbCollateralBtc * cbLiqPrice)
        : CB_LLTV;
    cbLevel = cbBarLevel(cbLtv, cbLtvTriggerPct, cbLiqFrac);
  }
  const cbAtSupport = cbAtSupportOf({
    hasCbLoan, debt: accruedBalance, collateralBtc: cbCollateralBtc, support, limit: cbLimitAtSupport,
  });

  return {
    capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel,
    accruedBalance, cbLiqPrice, cbLiqFrac, cbAtSupport,
  };
}

/**
 * The SINGLE store→inputs mapping. Pure: takes StoreState as an argument (type-only import, no cycle)
 * so every consumer feeds deriveSafetyView the same numbers. Consumers: SafetyDashboard (owner),
 * ViewerHomeView (viewer home), and Viewer V2's safe-snapshot builder (next).
 */
export function selectSafetyViewInputs(s: StoreState): SafetyViewInputs {
  return {
    advisorActualBlocBalance: s.advisorActualBlocBalance,
    creditLine: s.creditLine,
    currentBtcHeld: s.getCurrentBtcHeld(),
    btcPrice: s.btcPrice,
    strikeLiquidationLtvPct: s.strikeLiquidationLtvPct,
    hasCbLoan: s.hasCbLoan,
    cbLoanBalance: s.cbLoanBalance,
    cbAprPct: s.cbAprPct,
    cbLoanBalanceAsOf: s.cbLoanBalanceAsOf,
    cbCollateralBtc: s.cbCollateralBtc,
    cbLtvTriggerPct: s.cbLtvTriggerPct,
    cbLiquidationPrice: s.cbLiquidationPrice,
    cbLiquidationPriceAsOf: s.cbLiquidationPriceAsOf,
    cbLimitAtSupport: planCbLimitOf(s),   // D7 — pure: the plan's six fields, through the clamp
  };
}

/** Viewer overall pill = worst of the gauges SHOWN (credit + strike, + cb when hasCbLoan) — and, since the plan of
 *  record's Run 4, Coinbase at support (amber at most).
 *  Intentionally INCLUDES credit (so no red card sits under a green overall) — differs from the
 *  owner's SafetyDashboard `state`, which excludes the always-green capacity. */
export function deriveViewerOverall(view: SafetyView, hasCbLoan: boolean): SafetyLevel {
  const base = worseLevel(view.creditLevel, view.strikeLevel);
  // D7 — the verdict takes the worse reading: over the plan's limit at support is amber.
  return hasCbLoan ? worseLevel(worseLevel(base, view.cbLevel), view.cbAtSupport?.level ?? 'safe') : base;
}

// ── Viewer V2 — C-safe privacy: ratio/level-only projection + live price-scaler ──────────────────
/**
 * The ratio/level-only projection of SafetyView that the owner seals into a C-SAFE viewer snapshot.
 * ⚠ Privacy-load-bearing: it deliberately DROPS SafetyView's two $ absolutes (accruedBalance = CB debt,
 * cbLiqPrice = CB liq price). Every field here is a ratio (0..1+) or a level string from which NO
 * absolute is recoverable (2 unknowns, 1 equation) — so "no absolute exists by construction". One edge since the plan
 * of record's Run 4 (spec v1.20 §16.3): the at-support verdict, and whether a ratio is sealed at all, follow the 50¢
 * dust floor — an absolute — so within 50¢ of the plan's limit, or on a debt under 50¢, they carry one bit about size.
 */
export interface ViewerSafeSafety {
  capacityUsed: number;
  creditLevel: SafetyLevel;
  strikeLtv: number;
  strikeLevel: SafetyLevel;
  crashLtv: number;
  cbLtv: number;
  cbLevel: SafetyLevel;
  cbLiqFrac: number; // ratio (effective liquidation LTV) — safe to share
  /** D9 (Run 4) — Coinbase's LTV at the snapshot day's support, a ratio (null with no reading). Absent on older snapshots. */
  cbLtvAtSupport?: number | null;
  /** D9 — the owner's at-support verdict on it, by the owner's rule — whose 50¢ dust floor makes it one bit about size
   *  within 50¢ of the limit (above). */
  cbAtSupportLevel?: SafetyLevel;
  overall: SafetyLevel;
}

/** Owner-side: reduce the full SafetyView to the safe ratio/level block (drops accruedBalance + cbLiqPrice). */
export function buildSafeSafety(view: SafetyView, hasCbLoan: boolean): ViewerSafeSafety {
  const { capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel, cbLiqFrac } = view;
  return {
    capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel, cbLiqFrac,
    cbLtvAtSupport: view.cbAtSupport?.ltv ?? null,
    cbAtSupportLevel: view.cbAtSupport?.level ?? 'safe',
    overall: deriveViewerOverall(view, hasCbLoan),
  };
}

/** What the viewer stores from a C-safe snapshot (mirrors the payload's safe branch). */
export interface SafeSnapshot {
  safety: ViewerSafeSafety;
  /** `cbLimitAtSupport` — D9 (Run 4): the plan's Coinbase limit at support, a ratio. Absent on older snapshots. */
  thresholds: { strikeLiqLtv: number; cbLtvTriggerPct: number; cbLiqFrac: number; cbLimitAtSupport?: number };
  btcPriceAtSnapshot: number;
  hasCbLoan: boolean;
}

/**
 * Viewer-side: scale the at-snapshot safe block to the LIVE price so C-safe gauges track the market
 * without ever receiving an absolute. Exact between owner publishes — balance/holdings are constant
 * (owner actions republish), so the only drift is price, and LTV ∝ 1/price. (CB interest accrual over
 * days nudges the true CB LTV up slightly between publishes; negligible for a safety gauge.)
 * livePrice unavailable (offline / feed down) → factor 1 → returns the at-snapshot levels (fallback).
 */
export function scaleSafetyView(snap: SafeSnapshot, livePrice: number): ViewerSafeSafety & { strikeDropPct: number } {
  // D9 — the at-support reading isn't price-scaled: it is the snapshot day's (support moves a little each day, and the
  // owner republishes on every change); its verdict is the owner's.
  const f = livePrice > 0 && snap.btcPriceAtSnapshot > 0 ? snap.btcPriceAtSnapshot / livePrice : 1;
  const { strikeLiqLtv, cbLtvTriggerPct, cbLiqFrac } = snap.thresholds;
  const capacityUsed = snap.safety.capacityUsed; // price-free
  const strikeLtv = snap.safety.strikeLtv * f;
  const cbLtv = snap.safety.cbLtv * f;
  const crashLtv = strikeLtv * 5; // Strike LTV at price × 0.2 (an 80% crash) — 1/0.2 = 5
  const creditLevel = barLevel(capacityUsed, CREDIT_WARN_USED, CREDIT_ACT_USED);
  const strikeLevel = barLevel(strikeLtv, strikeLiqLtv * 0.76, strikeLiqLtv * 0.82);
  const cbLevel: SafetyLevel = snap.hasCbLoan ? cbBarLevel(cbLtv, cbLtvTriggerPct, cbLiqFrac) : 'safe';
  const base = worseLevel(creditLevel, strikeLevel);
  const cbLtvAtSupport = snap.hasCbLoan ? snap.safety.cbLtvAtSupport ?? null : null;
  const cbAtSupportLevel: SafetyLevel = cbLtvAtSupport !== null ? snap.safety.cbAtSupportLevel ?? 'safe' : 'safe';
  const overall = snap.hasCbLoan ? worseLevel(worseLevel(base, cbLevel), cbAtSupportLevel) : base;
  const strikeDropPct = strikeLiqLtv > 0 ? Math.max(0, 1 - strikeLtv / strikeLiqLtv) : 0;
  return {
    capacityUsed, creditLevel, strikeLtv, strikeLevel, crashLtv, cbLtv, cbLevel, cbLiqFrac,
    cbLtvAtSupport, cbAtSupportLevel, overall, strikeDropPct,
  };
}

// ── The render-ready viewer-safety shape + the one seam that unifies C-safe vs C-trusted ──────────
/** Render shape consumed by ViewerHomeView — C-safe (scaled from a snapshot) OR C-trusted (live-derived). */
export interface ViewerSafetyResult {
  mode: 'safe' | 'trusted';
  capacityUsed: number; creditLevel: SafetyLevel;
  strikeLtv: number;    strikeLevel: SafetyLevel;
  cbLtv: number;        cbLevel: SafetyLevel;
  hasCbLoan: boolean;   overall: SafetyLevel;
  strikeDropPct: number;
  /** D7 / D9 (Run 4) — the at-support reading: live on the trusted path (with today's support price), the snapshot's on
   *  the safe path (no price, no absolute); null with none. */
  cbAtSupport: null | { support: number | null; ltv: number; limit: number; level: SafetyLevel };
  figures: null | {
    credit: { used: number; total: number; avail: number };
    strike: { liqPrice: number; balance: number };
    cb:     { liqPrice: number; balance: number };
  };
}

/**
 * PURE core of ViewerHomeView's useViewerSafety (extracted for node-testability — the hook is just the store
 * reads + this). `safeSnap` present → C-safe path (scaleSafetyView, figures:null — no absolutes exist);
 * null → C-trusted live-derive from `inputs` (deriveSafetyView + real $ figures).
 */
export function computeViewerSafety(
  safeSnap: SafeSnapshot | null,
  livePrice: number,
  inputs: SafetyViewInputs,
): ViewerSafetyResult {
  if (safeSnap) {
    const v = scaleSafetyView(safeSnap, livePrice);
    return {
      mode: 'safe',
      capacityUsed: v.capacityUsed, creditLevel: v.creditLevel,
      strikeLtv: v.strikeLtv, strikeLevel: v.strikeLevel,
      cbLtv: v.cbLtv, cbLevel: v.cbLevel,
      hasCbLoan: safeSnap.hasCbLoan, overall: v.overall,
      strikeDropPct: v.strikeDropPct,
      cbAtSupport: v.cbLtvAtSupport != null && safeSnap.thresholds.cbLimitAtSupport !== undefined
        ? { support: null, ltv: v.cbLtvAtSupport, limit: safeSnap.thresholds.cbLimitAtSupport, level: v.cbAtSupportLevel ?? 'safe' }
        : null,
      figures: null,
    };
  }
  const view = deriveSafetyView(inputs);
  const overall = deriveViewerOverall(view, inputs.hasCbLoan);
  const strikeLiqLtv = inputs.strikeLiquidationLtvPct / 100;
  const strikeDropPct = strikeLiqLtv > 0 ? Math.max(0, 1 - view.strikeLtv / strikeLiqLtv) : 0;
  // Strike available credit — the LTV-capped truth (min(creditLine, collateral·price·50%) − drawn),
  // NOT the naive creditLine − drawn (which overstated drawable credit by the LTV gap). total = binding limit.
  const cap = strikeAvailableCredit(inputs.creditLine, inputs.currentBtcHeld, inputs.btcPrice, inputs.advisorActualBlocBalance);
  const strikeLiqPrice = inputs.currentBtcHeld > 0
    ? inputs.advisorActualBlocBalance / (inputs.currentBtcHeld * strikeLiqLtv)   // bloc / (btcHeld × liqLtv)
    : 0;
  return {
    mode: 'trusted',
    capacityUsed: view.capacityUsed, creditLevel: view.creditLevel,
    strikeLtv: view.strikeLtv, strikeLevel: view.strikeLevel,
    cbLtv: view.cbLtv, cbLevel: view.cbLevel,
    hasCbLoan: inputs.hasCbLoan, overall, strikeDropPct,
    cbAtSupport: view.cbAtSupport
      ? { support: view.cbAtSupport.support, ltv: view.cbAtSupport.ltv, limit: view.cbAtSupport.limit, level: view.cbAtSupport.level }
      : null,
    figures: {
      credit: { used: inputs.advisorActualBlocBalance, total: cap.limit, avail: cap.available },
      strike: { liqPrice: strikeLiqPrice, balance: inputs.advisorActualBlocBalance },
      cb:     { liqPrice: view.cbLiqPrice, balance: view.accruedBalance },
    },
  };
}

/**
 * Owner-side "Preview as viewer": turn a real buildViewerSnapshotPayload into the SafeSnapshot the safe path
 * renders (mirrors viewerSync.ts's construction exactly, incl. hasCbLoan ?? false). Non-safe payload → null
 * (the trusted preview uses the live-derive path instead). Structural param type → no ViewerSnapshot import.
 */
export function previewSafeSnapFromPayload(payload: {
  privacyMode?: string;
  safety?: ViewerSafeSafety;
  thresholds?: SafeSnapshot['thresholds'];
  btcPriceAtSnapshot?: number;
  hasCbLoan?: boolean;
}): SafeSnapshot | null {
  if (payload.privacyMode !== 'safe') return null;
  return {
    safety:             payload.safety!,
    thresholds:         payload.thresholds!,
    btcPriceAtSnapshot: payload.btcPriceAtSnapshot!,
    hasCbLoan:          payload.hasCbLoan ?? false,
  };
}
