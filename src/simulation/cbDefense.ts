/**
 * Debt-shift defense — the shared pure math for holding a Coinbase LTV stop.
 *
 * The doctrine (the Almanac faces, matching the Advisor's ltvTriggered playbook): when a price fall pushes
 * CB LTV over the stop, draw from Strike and PAY THE COINBASE LOAN DOWN to the stop — shifting the dollar
 * debt from Coinbase to Strike — then let the normal refinance sweep the debt back to the cheaper facility
 * as the price recovers. No BTC is bought or pledged, so total debt is unchanged by the shift itself.
 *
 * When the Strike line cannot fully restore the stop, the FALLBACK is a collateral top-up (`topUpToCbLtv`):
 * move BTC from the cold reserve first, then the Strike collateral the line no longer needs, into the
 * Coinbase pool — growing the denominator instead of shrinking the numerator.
 *
 * The STRIKE leg has its own twin (`topUpStrikeLtv`, cold → Strike), and the two share a pool — so the
 * survival guard's risk math lives here too (`cbSurvivalCollateralBtc`, `cbDoomedThisMonth`): Coinbase
 * survival outranks the Strike cap, which outranks the Coinbase cap.
 *
 * STRIKE'S RELEASE RULES are leaves here too (`strikeReleasableBtc`, `STRIKE_RELEASE_EPS`): collateral leaves Strike
 * only at or under 40% LTV, only down to UNDER 50% after the move, and never within 60 days of a deposit. The crash
 * playbook (`crashPlaybook.ts`, and the engine under the support policy) moves Strike collateral into Coinbase only
 * through them — the margin-bound grab above is a move Strike would never allow. `ceilingLiquidationMultiple` is the
 * playbook's depth gate.
 *
 * 🔴 Pure leaf: imports only the zero-import `./ltv` (no store, no power law, no cyclingSim). The lender
 * ratios arrive as plain numbers, so the engine, the two faces' stress readout, and the Emergency Console
 * can all share ONE capacity definition and can never drift.
 */
import { ltvOf } from './ltv';

/**
 * Strike draw capacity — the engine-consistent headroom: `min(creditLine, collateral × price × maxDrawLtv)
 * − drawn`, floored at 0. This is the same constraint the cycling engine's expense draw uses; with no credit
 * line (the default, Infinity) it reduces to the 50%-LTV line exactly.
 */
export function strikeDrawCapacity(
  strikeCollateralBtc: number,
  strikeBalance: number,
  price: number,
  maxDrawLtv: number,
  creditLine: number = Number.POSITIVE_INFINITY,
): number {
  if (!(strikeCollateralBtc > 0) || !(price > 0) || !(maxDrawLtv > 0)) return 0;
  const ltvCap = strikeCollateralBtc * price * maxDrawLtv;
  const limit = Math.min(Number.isFinite(creditLine) ? creditLine : Number.POSITIVE_INFINITY, ltvCap);
  return Math.max(0, limit - Math.max(0, strikeBalance));
}

export interface CbDefenseInput {
  cbDebt: number;
  cbCollateralBtc: number;
  strikeCollateralBtc: number;
  strikeBalance: number;
  price: number;
  /** The CB LTV to restore, as a percentage (e.g. 70). */
  targetCbLtvPct: number;
  creditLine: number;
  maxDrawLtv: number;
  /** Strike's margin-call LTV — reporting only (the new margin-call price after the draw). */
  marginLtv: number;
}

export interface CbDefenseResult {
  targetCbLtv: number;          // fraction
  /** Paydown that would bring CB LTV exactly to the target at this price. */
  paydownNeededUsd: number;
  /** Strike headroom available to fund it. */
  capacityUsd: number;
  /** What can actually be drawn now. */
  drawUsd: number;
  /** paydownNeededUsd − drawUsd; > 0 means the cap cannot be fully held. */
  shortfallUsd: number;
  fullyDefended: boolean;
  cbDebtAfter: number;
  cbLtvAfter: number;
  skLtvAfter: number;
  skMarginCallPriceAfter: number;
  /** Price at which the POST-defense CB LTV returns to the target — "reversible above $R". */
  recoveryPrice: number;
}


/**
 * How far INSIDE its margin-call line the emergency top-up leaves Strike.
 *
 * Bounding `strikeAvailable` at `marginLtv` itself put an exhausting top-up EXACTLY ON the call line, so
 * cyclingSim's `strikeLtv >= strikeMarginLtv` fired in the same month — a second liquidation, not a last
 * resort. Exported as a named constant so a future spec can make it an input without touching call sites.
 */
export const TOPUP_MARGIN_BUFFER = 0.05;

/**
 * Compute the debt-shift defense at `price`: how much CB debt must move to Strike to restore the cap, how
 * much Strike can actually fund, and the post-defense position. Guarded so a zero/negative price or
 * collateral never produces NaN — a capacity of 0 with a positive shortfall is the honest answer there.
 */
export function defendCbLtv(input: CbDefenseInput): CbDefenseResult {
  const target = input.targetCbLtvPct / 100;
  const collateralValue = input.cbCollateralBtc * input.price;
  const paydownNeededUsd = target > 0 && collateralValue > 0
    ? Math.max(0, input.cbDebt - target * collateralValue)
    : Math.max(0, input.cbDebt);
  const capacityUsd = strikeDrawCapacity(
    input.strikeCollateralBtc,
    input.strikeBalance,
    input.price,
    input.maxDrawLtv,
    input.creditLine,
  );
  const drawUsd = Math.min(paydownNeededUsd, capacityUsd);
  const shortfallUsd = Math.max(0, paydownNeededUsd - drawUsd);
  const cbDebtAfter = Math.max(0, input.cbDebt - drawUsd);
  const newSkDrawn = Math.max(0, input.strikeBalance) + drawUsd;
  const recoveryPrice = target > 0 && input.cbCollateralBtc > 0
    ? cbDebtAfter / (target * input.cbCollateralBtc)
    : 0;
  return {
    targetCbLtv: target,
    paydownNeededUsd,
    capacityUsd,
    drawUsd,
    shortfallUsd,
    fullyDefended: shortfallUsd <= 0,
    cbDebtAfter,
    cbLtvAfter: ltvOf(cbDebtAfter, input.cbCollateralBtc, input.price),
    // ⚠ BOTH LTVs route through `ltvOf` — the whole point of this module is one definition that cannot
    // drift. A `skValue > 0 ? … : 0` fallback reported 0% for a Strike balance with NO collateral behind
    // it: the worst position in the app rendered as perfectly safe. Any consumer must use `fmtLtvPct`.
    skLtvAfter: ltvOf(newSkDrawn, input.strikeCollateralBtc, input.price),
    skMarginCallPriceAfter:
      input.marginLtv > 0 && input.strikeCollateralBtc > 0
        ? newSkDrawn / (input.strikeCollateralBtc * input.marginLtv)
        : 0,
    recoveryPrice,
  };
}

export interface CbTopUpInput {
  cbDebt: number;
  cbCollateralBtc: number;
  price: number;
  /** The CB LTV to restore, as a percentage (e.g. 70). */
  targetCbLtvPct: number;
  /** The unpledged reserve — the FIRST source: no lender constraint, no Strike side effect. */
  coldBtc: number;
  strikeCollateralBtc: number;
  strikeBalance: number;
  /** Strike's margin-call LTV. The LAST-resort bound is a `TOPUP_MARGIN_BUFFER` STEP INSIDE it, never it:
   *  the line's own backing may be sacrificed, but the top-up must not walk Strike onto its own call. */
  marginLtv: number;
  /** THE STRIKE FLOOR (opt-in). When the Strike defense is armed its cap binds this grab too — otherwise
   *  the cold reservation is a fiction: Coinbase simply takes the COLLATERAL instead of the coins. */
  strikeFloorLtv?: number;
  /** STRIKE'S RELEASE RULES (opt-in): the most Strike collateral Strike will release now (`strikeReleasableBtc` —
   *  at or under 40% LTV before, under 50% after, never within 60 days of a deposit). It caps the Strike leg on top of
   *  the margin bound and the floor. ⚠ Absent ≡ byte-identical to the function without it (a test pins it);
   *  non-finite or negative ≡ 0 — never move Strike collateral on junk. */
  strikeReleaseCapBtc?: number;
}

export interface CbTopUpResult {
  targetCbLtv: number;
  /** BTC that must be added to CB to reach the target. */
  requiredBtc: number;
  fromColdBtc: number;
  fromStrikeBtc: number;
  topUpBtc: number;
  /** requiredBtc − topUpBtc; > 0 means even both sources cannot restore the target. */
  shortfallBtc: number;
  fullyDefended: boolean;
  cbLtvAfter: number;
}

/**
 * Emergency collateral top-up: grow the CB denominator from the cold reserve first, then from the Strike
 * collateral above `marginLtv × (1 − TOPUP_MARGIN_BUFFER)` — the true last resort, which sacrifices the
 * 50% line backing but STOPS A BUFFER SHORT of the margin call rather than landing on it.
 * With `strikeReleaseCapBtc` (the support policy's crash playbook) the Strike leg is also capped by what Strike will
 * release under its terms — at or under 40% before, under 50% after, never within 60 days of a deposit.
 * Pure; guarded so zero price / zero collateral never yields NaN.
 */
export function topUpToCbLtv(input: CbTopUpInput): CbTopUpResult {
  const target = input.targetCbLtvPct / 100;
  const canPrice = target > 0 && input.price > 0;
  const requiredBtc = canPrice ? Math.max(0, input.cbDebt / (target * input.price) - input.cbCollateralBtc) : 0;
  // ⚠ `Number.isFinite && > 0`, NOT `Math.max(0, x)` — the latter returns NaN for NaN and would poison
  // every figure downstream. Same guard as the `topUpStrikeLtv` twin, so junk cold reads as an EMPTY pool
  // on both legs.
  const fromColdBtc = Math.min(requiredBtc, Number.isFinite(input.coldBtc) && input.coldBtc > 0 ? input.coldBtc : 0);
  const remaining = requiredBtc - fromColdBtc;
  // ⚠ Bounded a buffer INSIDE the call line, never on it. Consequence to expect: a leg already inside the
  // buffer now yields ZERO available collateral where it previously yielded a sliver taken right up to the
  // call. Zero is the correct answer there — the sliver bought nothing and triggered the margin call.
  const marginBound = input.marginLtv * (1 - TOPUP_MARGIN_BUFFER);
  const floor = input.strikeFloorLtv;
  // ⚠ `strikeFloorLtv: undefined` (and 0, and any floor looser than the margin bound) must stay
  // byte-identical to the pre-floor function — every existing call site passes nothing, and a silently
  // tightened bound would change the shipped defense on every face. A test pins it.
  const bound = floor !== undefined && floor > 0 ? Math.min(marginBound, floor) : marginBound;
  const strikeAvailable = canPrice
    ? strikeCollateralAboveLtv(input.strikeCollateralBtc, input.strikeBalance, input.price, bound)
    : 0;
  // Strike's release rules cap the leg when supplied. Absent → no third term (the pre-cap function, byte-identical).
  const releaseCap = input.strikeReleaseCapBtc;
  const fromStrikeBtc = releaseCap === undefined
    ? Math.min(remaining, strikeAvailable)
    : Math.min(remaining, strikeAvailable, Number.isFinite(releaseCap) && releaseCap > 0 ? releaseCap : 0);
  const topUpBtc = fromColdBtc + fromStrikeBtc;
  const shortfallBtc = Math.max(0, requiredBtc - topUpBtc);
  return {
    targetCbLtv: target,
    requiredBtc,
    fromColdBtc,
    fromStrikeBtc,
    topUpBtc,
    shortfallBtc,
    fullyDefended: shortfallBtc <= 0,
    cbLtvAfter: ltvOf(input.cbDebt, input.cbCollateralBtc + topUpBtc, input.price),
  };
}

/**
 * Strike collateral in EXCESS of what `strikeBalance` needs at `boundLtv` — the coins that could leave the
 * Strike pool without pushing its LTV past that bound. Shared by the CB top-up's last-resort grab and the
 * futility check, so "what Strike can spare" has one definition.
 * Guarded: a non-positive price or bound spares nothing (0), never NaN.
 */
export function strikeCollateralAboveLtv(
  strikeCollateralBtc: number,
  strikeBalance: number,
  price: number,
  boundLtv: number,
): number {
  return price > 0 && boundLtv > 0
    ? Math.max(0, strikeCollateralBtc - Math.max(0, strikeBalance) / (boundLtv * price))
    : 0;
}

/** Strike's "under 50% after" is STRICT: collateral may leave only down to `maxAfterLtv × (1 − STRIKE_RELEASE_EPS)`,
 *  so a release can never land ON the draw line. */
export const STRIKE_RELEASE_EPS = 1e-9;

export interface StrikeReleaseInput {
  strikeCollateralBtc: number;
  strikeBalance: number;
  price: number;
  /** STRIKE_RETRIEVE_MAX_LTV (40%) — collateral leaves Strike only while its LTV is at or under this. */
  retrieveMaxLtv: number;
  /** STRIKE_MAX_DRAW_LTV (50%) — the move must leave Strike strictly UNDER this. */
  maxAfterLtv: number;
  /** Collateral went IN within the last 60 days (Strike's hold) — nothing leaves until it ends. */
  inHold: boolean;
}

/**
 * The BTC Strike will release NOW, under its terms: only while its LTV is at or under `retrieveMaxLtv` (40%) before
 * the move — EQUAL is allowed, the policy migration's own rule — only down to strictly under `maxAfterLtv` (50%)
 * after it, and never within 60 days of a deposit (`inHold`).
 *
 * ⚠ WHY THIS EXISTS. The emergency top-up's Strike leg used to be bounded only by the margin buffer (0.70 × 0.95 =
 * 66.5%), a move Strike never allows: in the scratch probe every Strike-leg move broke these rules. Under the support
 * policy every defense move — and the doom question — goes through this function instead.
 *
 * Guarded: in the hold, above `retrieveMaxLtv`, at a non-positive price, or on any non-finite input → 0 (never NaN).
 */
export function strikeReleasableBtc(input: StrikeReleaseInput): number {
  const { strikeCollateralBtc, strikeBalance, price, retrieveMaxLtv, maxAfterLtv, inHold } = input;
  if (inHold) return 0;
  for (const v of [strikeCollateralBtc, strikeBalance, price, retrieveMaxLtv, maxAfterLtv]) {
    if (!Number.isFinite(v)) return 0;
  }
  if (!(price > 0)) return 0;
  if (ltvOf(strikeBalance, strikeCollateralBtc, price) > retrieveMaxLtv) return 0;
  return strikeCollateralAboveLtv(strikeCollateralBtc, strikeBalance, price, maxAfterLtv * (1 - STRIKE_RELEASE_EPS));
}

/**
 * The support multiple at which a Coinbase loan sitting AT its support ceiling reaches its liquidation LTV:
 * `cbStopAtSupport / lltv` (0.60 / 0.86 ≈ 0.70 × support at the engine fixtures' 60% stop; 0.45 / 0.86 ≈ 0.52 × at the
 * faces' 45%). THE CRASH PLAYBOOK'S DEPTH GATE — top up
 * first from here up to support; deeper than this, a Coinbase at its ceiling is already past 86%, so spending every coin
 * there leaves nothing for a second leg, and the debt shift goes first.
 * Junk or a non-positive input → +∞, so junk never tops up first (the pre-playbook order).
 */
export function ceilingLiquidationMultiple(cbStopAtSupport: number, lltv: number): number {
  return Number.isFinite(cbStopAtSupport) && cbStopAtSupport > 0 && Number.isFinite(lltv) && lltv > 0
    ? cbStopAtSupport / lltv
    : Number.POSITIVE_INFINITY;
}

/**
 * A debt shift under half a cent after a top-up-first step is FLOAT DUST, never a defense. A release leaves Strike a
 * relative STRIKE_RELEASE_EPS under its 50% draw line, so the shift that follows has capacity of about balance × 1e-9
 * (≈ $0.00003 on a $30k balance). Counted, it would set `defended`, bump the defense count, and show a "$0" shift.
 * The engine and `crashPlaybook` both drop it and keep its need as the shortfall — so the survival guard and the
 * fallback top-up still run. Half a cent is the engine's existing residual precedent (clearStrike / clearBoth /
 * the pay-down's 0.005 sweep). Owner decision, 2026-09-28.
 */
export const SHIFT_DUST_USD = 0.005;

export interface StrikeTopUpInput {
  strikeBalance: number;
  strikeCollateralBtc: number;
  price: number;
  /** The Strike LTV to restore, as a percentage (e.g. 60). */
  targetStrikeLtvPct: number;
  /** The unpledged reserve — the ONLY source. Strike is never topped up from the Coinbase pool: that
   *  pool is the one facing an INSTANT liquidation at 86%, and robbing it to cure a 72-hour cure window
   *  inverts the risk. Bidirectional collateral flow is a separate spec. */
  coldBtc: number;
}

export interface StrikeTopUpResult {
  targetStrikeLtv: number;
  requiredBtc: number;
  fromColdBtc: number;
  shortfallBtc: number;
  fullyDefended: boolean;
  strikeLtvAfter: number;
}

/**
 * Strike-side twin of `topUpToCbLtv`: move BTC from the cold reserve into the Strike collateral pool until
 * Strike's LTV is back at the target. Cold is the only source (see `coldBtc`). Pure; never NaN.
 */
export function topUpStrikeLtv(input: StrikeTopUpInput): StrikeTopUpResult {
  const target = input.targetStrikeLtvPct / 100;
  const canPrice = target > 0 && input.price > 0;
  const requiredBtc = canPrice
    ? Math.max(0, Math.max(0, input.strikeBalance) / (target * input.price) - input.strikeCollateralBtc)
    : 0;
  // ⚠ `Number.isFinite && > 0`, NOT `Math.max(0, x)` — the latter returns NaN for NaN and would poison
  // every pool figure downstream (ownership.ts's rule, and cyclingSim's own openingColdBtc precedent).
  const fromColdBtc = Math.min(requiredBtc, Number.isFinite(input.coldBtc) && input.coldBtc > 0 ? input.coldBtc : 0);
  const shortfallBtc = Math.max(0, requiredBtc - fromColdBtc);
  return {
    targetStrikeLtv: target,
    requiredBtc,
    fromColdBtc,
    shortfallBtc,
    fullyDefended: shortfallBtc <= 0,
    // ⚠ Routes through the SHARED `ltvOf`, like `skLtvAfter` — `∞` for a balance with no collateral, never
    // a flattering 0%. Any consumer MUST render it with `fmtLtvPct`.
    strikeLtvAfter: ltvOf(input.strikeBalance, input.strikeCollateralBtc + fromColdBtc, input.price),
  };
}

/** How far INSIDE Morpho's 86% liquidation the survival guard keeps Coinbase. Its own constant, NOT
 *  TOPUP_MARGIN_BUFFER: that one is Strike's margin-call buffer, and one constant serving two unrelated
 *  lines means tuning either silently moves the other. Same value today, different concepts. */
export const CB_SURVIVAL_BUFFER = 0.05;

/**
 * Collateral Coinbase must ADD to sit `buffer` inside its liquidation LTV at `price`:
 * `max(0, cbDebt / (lltv × (1 − buffer) × price) − cbCollateralBtc)`.
 *
 * The survival guard's risk number — the Strike reserve may never claim cold that Coinbase needs to stay
 * alive. Guarded like every pool figure: a non-positive price, a non-positive or non-finite denominator,
 * or any NaN/∞ input returns 0, never NaN (the `Number.isFinite && > 0` rule, never `Math.max(0, NaN)`).
 *
 * `stopLtv` (optional) — the Coinbase STOP the top-up actually aims at. The target LTV is the LOOSER of the
 * survival line and the stop: above an 81.7% stop (0.86 × 0.95) the top-up only restores the stop, so a need
 * sized to the survival line would claim coins the top-up never takes — and the guard would report a Strike
 * yield that handed nothing to Coinbase. Because the need FALLS as the target LTV rises,
 * need(max(line, stop)) === min(need(line), need(stop)). ⚠ Absent / junk / at-or-below the line ≡ the
 * 5-arg value, byte-identical (a test pins it).
 */
export function cbSurvivalCollateralBtc(
  cbDebt: number, cbCollateralBtc: number, price: number, lltv: number, buffer: number = CB_SURVIVAL_BUFFER,
  stopLtv?: number,
): number {
  if (!(price > 0)) return 0;
  const line = lltv * (1 - buffer);
  const s = stopLtv ?? 0;
  const target = Number.isFinite(s) && s > line ? s : line;
  const denom = target * price;
  if (!(denom > 0) || !Number.isFinite(denom)) return 0;
  const debt = Number.isFinite(cbDebt) && cbDebt > 0 ? cbDebt : 0;
  const coll = Number.isFinite(cbCollateralBtc) && cbCollateralBtc > 0 ? cbCollateralBtc : 0;
  const need = debt / denom - coll;
  return Number.isFinite(need) && need > 0 ? need : 0;
}

export interface CbDoomInput {
  cbDebt: number;
  cbCollateralBtc: number;
  price: number;
  /** Morpho's liquidation LTV (CB_LLTV) — passed in, so this stays a leaf. */
  lltv: number;
  coldBtc: number;
  strikeCollateralBtc: number;
  strikeBalance: number;
  /** Strike's margin-call LTV. */
  marginLtv: number;
  /** STRIKE'S RELEASE RULES (opt-in): what Strike will release now (`strikeReleasableBtc` — at or under 40% before,
   *  under 50% after, never within 60 days of a deposit). Present ⇒ it REPLACES the margin-bound Strike term, because
   *  under the rules that is all the top-up can actually get. Present but non-finite ⇒ false (the junk rule).
   *  ⚠ Absent ≡ byte-identical to the check without it (a test pins it). */
  strikeReleasableBtc?: number;
}

/**
 * THE FUTILITY CHECK: is Coinbase liquidated THIS MONTH whatever Strike does? True when ALL the cold plus
 * every Strike coin the top-up could possibly take still falls short of clearing the ACTUAL 86% line.
 *
 * Why it exists: the survival guard makes Strike yield its reserve (and its floor) so Coinbase can
 * survive. In a month where Coinbase dies anyway, that yield is FUTILE — it feeds the reserved cold into
 * the very pool Morpho is about to seize, so the coins are seized instead of defending Strike. When this
 * returns true the guard stands down and Strike keeps its reserve.
 *
 * ⚠ BUFFER 0 IS DELIBERATE. The question is whether Coinbase can clear its ACTUAL 86% line, not the
 * buffered survival line; using CB_SURVIVAL_BUFFER here would declare savable positions doomed.
 * ⚠ THE STRIKE BOUND IS `marginLtv × (1 − TOPUP_MARGIN_BUFFER)`, NOT THE STRIKE CAP. The question is what
 * is POSSIBLE, not what policy allows; using the cap would also declare savable positions doomed.
 * ⚠ UNDER STRIKE'S RELEASE RULES (`strikeReleasableBtc` supplied) the Strike term is what Strike will release now —
 * at or under 40% before, under 50% after, never within 60 days of a deposit — because that is all it can hand over.
 *
 * Same-month only — it cannot see a later month's doom (that needs a forward-looking Coinbase reserve).
 * Guarded: a non-positive price or any non-finite input returns false (never throws, never NaN), so junk
 * never switches the guard off.
 */
export function cbDoomedThisMonth(input: CbDoomInput): boolean {
  const { cbDebt, cbCollateralBtc, price, lltv, coldBtc, strikeCollateralBtc, strikeBalance, marginLtv } = input;
  const release = input.strikeReleasableBtc;
  if (!(price > 0)) return false;
  for (const v of [cbDebt, cbCollateralBtc, price, lltv, coldBtc, strikeCollateralBtc, strikeBalance, marginLtv]) {
    if (!Number.isFinite(v)) return false;
  }
  if (release !== undefined && !Number.isFinite(release)) return false;
  const need = cbSurvivalCollateralBtc(cbDebt, cbCollateralBtc, price, lltv, 0);
  const possible = Math.max(0, coldBtc) + (release !== undefined
    ? Math.max(0, release)
    : strikeCollateralAboveLtv(strikeCollateralBtc, strikeBalance, price, marginLtv * (1 - TOPUP_MARGIN_BUFFER)));
  return possible < need;
}
