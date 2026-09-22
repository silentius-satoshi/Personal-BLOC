import { CB_LLTV, CB_LIF, cbBorrowFee, cbMaxDrawForHeadroom } from './runCoinbaseLoan';
import { defendCbLtv, topUpToCbLtv } from './cbDefense';
import { ltvOf } from './ltv';

/**
 * Cycling strategy — pure projection engine (Almanac `cycling` face).
 *
 * The strategy: draw monthly bills on the Strike BLOC, refinance the accumulated Strike balance into the
 * cheaper Coinbase loan every `cycleMonths`, route every BTC purchase to the Coinbase collateral pool, and
 * stop drawing once CB LTV reaches `cbLtvCapPct`. The verdict compares it to a "pay bills from income,
 * never draw" baseline.
 *
 * ⚠ `mode` (S1) adds three no-draw strategies — `hold` (surplus buys, nothing repaid), `clearStrike`
 * (surplus retires Strike, then buys), `clearBoth` (surplus retires Strike, then Coinbase, then buys).
 * `mode` defaults to `'cycle'`, so every pre-S1 call site is byte-identical. For `hold` the "never draw"
 * baseline is SELF-REFERENTIAL — the strategy IS the baseline, so a view must not compare the two.
 * The cold-storage / unpledged reserve IS modeled (opt-in `coldStoreBufferPct`); a support-line "switch"
 * mode is still NOT MODELED.
 *
 * 🔴 §2 ISOLATION WALL — this module imports NOTHING from powerLaw/cycleModel. The price path arrives as a
 * plain `number[]` and the three lender ratios (`strikeMaxDrawLtv`, `strikeMarginLtv`) arrive as plain
 * numbers, so the engine is a leaf: clock-free, power-law-free, store-free, fixture-testable. The VIEW does
 * the labelled crossing (the OutlookProjection/MonthBreakdown precedent).
 *
 * ⚠ TWO COLLATERAL POOLS, NEVER ONE. Strike-pledged BTC cannot also back Morpho. `strikeColl` and `cbColl`
 * are separate denominators (purchases only ever grow `cbColl`; the sweep cascade / top-up may MOVE Strike
 * collateral in), and `btcHeld` is their sum (+ the cold pool) and is DISPLAY ONLY; it is never a
 * denominator. Collapsing them understates CB LTV by ~16 points on a real position, which lets the cap
 * fire late and runs the liquidation test on a frozen denominator.
 */

export interface CyclingInputs {
  /**
   * COLD-STORAGE SWEEP (opt-in; 0 or undefined = off). The percentage break below the CURRENT PATH PRICE
   * the position must still survive. Each month, any Coinbase collateral in excess of that requirement is
   * moved to a THIRD pool — unpledged, self-custodied, and permanently outside every LTV denominator.
   *
   * ⚠ THE CASCADE: at each refinance cadence, the Strike collateral the fixed credit line no longer needs
   * (above `max(line backing, margin backing)` at the buffer-stressed price) is moved to COINBASE first —
   * it creates CB headroom so more cheap debt can refinance under the stop — and the CB leg then moves the
   * true excess on to cold. So as the price rises: Strike keeps only the line's backing → Coinbase keeps
   * the floor's backing → everything else is cold. The old direct Strike→cold leg is GONE.
   *
   * ⚠ Expressed as a SURVIVABLE DRAWDOWN, not an LTV. The equivalent LTV is `CB_LLTV × (1 − buffer)`, so
   * 60% LTV is a 30% buffer — which sounds conservative beside the 70% draw cap but actually means
   * "liquidated if price breaks 30% below the path."
   *
   * 🔴 CALIBRATE THIS AGAINST THE REGRESSION LINE, NOT AGAINST SUPPORT. On the support path the buffer
   * reads as "% below support", and that unit has NO historical content on its own: support is a line
   * PARALLEL to fair (same PL_B) at a fixed 36.2% of it (0.42e-17 / 1.16e-17), and its constant was FITTED
   * to the cycle bottoms — the 2022 bottom implies 4.2317e-18 against the 4.2e-18 used. Support already IS
   * the historical maximum-drawdown envelope, so a further "% below support" is priced by nothing.
   * Translated into fair-value terms: a 30% buffer survives down to 25.3% of fair (0.70x the fitted
   * floor — a real margin for model error), a 50% buffer to 18.1% (0.50x), a 70% buffer to 10.9% (0.30x,
   * i.e. 3.3x deeper than any bottom on record). An earlier draft of this feature recommended 50–70% on
   * the reasoning that it cost no bitcoin; it also cost eight years of waiting to buy a scenario nothing
   * calibrates. The DEFAULT is the 30% end for that reason. The VIEW must show the fair-value translation
   * so the knob cannot be read as more precise than it is.
   *
   * ⚠⚠ NOT FREE SAFETY, and the sign depends on the PATH. Swept collateral is gone, so every later month
   * starts from a smaller base. On a RISING path the position de-levers anyway and the sweep is free —
   * same total stack, coins simply relocated. On a FLAT path it trades stack for time (less drawing, so
   * less accumulation, but the cap binds sooner). On a FALLING path a loose buffer is actively dangerous.
   * The engine clamps the floor to the draw cap (below) to remove the incoherent settings, but a real
   * trade-off remains at every setting. The face must show the liquidation month, not just the ₿ banked.
   *
   * 🔴 §2 WALL: "below the path price" — the engine still knows nothing about the power law. On the
   * support path that reads as "below support"; the VIEW does the labelling, as always.
   */
  coldStoreBufferPct?: number;

  /**
   * The owner's REAL unpledged reserve at month 0 (`getCurrentColdBtc()`). Optional, defaults to 0, so
   * every pre-existing call site is byte-identical. Seeds the cold pool so the emergency top-up's FIRST
   * source is the reserve that actually exists, instead of only the coins this simulation itself swept.
   *
   * ⚠ NOT wired from the faces yet — that changes every projection and needs its own spec.
   */
  openingColdBtc?: number;

  /** price[m] for m = 0..N. The view builds it (plConvergencePath); the engine never derives a price. */
  pricePath: number[];
  /** Calendar year of month 0 — LABEL SEED ONLY, never used in math (keeps the engine clock-free). */
  startYear: number;

  // Strike leg
  strikeCollateralBtc: number;   // purchases never go here; the sweep cascade / top-up may MOVE it
  strikeBalance: number;
  strikeCreditLine: number;      // ← store `creditLine`
  strikeMaxDrawLtv: number;      // ← STRIKE_MAX_DRAW_LTV (passed in, not imported)
  strikeMarginLtv: number;       // ← STRIKE_MARGIN_CALL_LTV (passed in, not imported)

  // Coinbase leg
  cbCollateralBtc: number;
  cbDebt: number;                // ALREADY ACCRUED by the view (the accruedCbBalance boundary)

  income: number;
  expenses: number;
  strikeAprPct: number;
  cbAprPct: number;
  cycleMonths: number;           // refinance cadence (cycle mode only)
  cbLtvCapPct: number;           // stop-drawing cap, as a percentage (cycle mode only)
  /**
   * DEBT-SHIFT DEFENSE (opt-in; false/undefined = off → byte-identical to the pre-defense engine).
   *
   * In `cycle` mode, a month whose CB LTV sits above the cap draws from Strike to PAY THE COINBASE LOAN
   * DOWN to the cap — shifting the dollar debt to Strike, not buying BTC — and a due refinance then
   * sweeps ONLY up to the remaining CB headroom, so the sweep can never push LTV back over the cap. When
   * the price recovers, the normal cadence shifts the debt back to the cheaper Coinbase facility.
   *
   * Capacity is engine-consistent: min(creditLine, collateral × price × strikeMaxDrawLtv) − drawn.
   *
   * FALLBACK — COLLATERAL TOP-UP: if the Strike line still leaves CB LTV above the stop, BTC moves into
   * the CB pool from the COLD reserve first, then from the Strike collateral above its margin requirement
   * (the true last resort — it sacrifices the 50% line backing). No debt changes hands.
   *
   * Cycle mode only; other modes never draw and never refinance.
   */
  defendCbLtv?: boolean;
  /** Strategy (S1): `cycle` is today's behaviour byte-identical; the others never draw and never
   *  refinance — surplus retires the named leg(s) first, then buys into the Coinbase pool. */
  mode?: CyclingMode;
}

export type CyclingMode = 'cycle' | 'hold' | 'clearStrike' | 'clearBoth';

export interface CyclingRow {
  m: number;
  yearLabel: string;
  price: number;

  cbDebt: number;
  strikeBalance: number;
  debt: number;                  // cbDebt + strikeBalance

  strikeDrawn: number;           // actually drawn this month (credit-line constrained)
  strikeShortfall: number;       // the part of `expenses` income had to cover instead
  /**
   * DOLLARS that bought bitcoin this month. ⚠ The view CANNOT derive this from a cbColl delta any more —
   * the sweep cascade and the emergency top-up also move collateral into that pool — and it is NOT the
   * surplus while the flywheel is running: a drawing month puts the WHOLE income into bitcoin because
   * the credit line, not income, paid the bill. `income − expenses` is the never-draw BASELINE, the
   * thing this strategy is measured against. Exposed so one number answers "what buys bitcoin".
   */
  btcBoughtUsd: number;

  /** Debt-shift defense: CB debt moved to Strike this month to hold the cap (0 when not defended). */
  defenseDrawnUsd: number;
  /** CB LTV just BEFORE the defense paydown (null when the cap wasn't breached that month). */
  cbLtvPreDefense: number | null;
  /** The paydown Strike could not fund this month (0 when fully defended or not defended). */
  defenseShortfallUsd: number;
  /** True when this month actually shifted CB debt to Strike. */
  defended: boolean;

  /** Routine migration (sweep cascade): Strike collateral moved to the CB pool this month. */
  strikeToCbBtc: number;
  /** Emergency top-up: BTC moved into the CB pool this month from cold + Strike collateral. */
  topUpBtc: number;
  topUpFromColdBtc: number;
  topUpFromStrikeBtc: number;
  /** Cumulative BTC pulled OUT of cold storage by the emergency top-up (reduces the pool). */
  coldRetrievedBtc: number;

  strikeCollateralBtc: number;
  cbCollateralBtc: number;
  /** Cumulative NET BTC in cold storage. UNPLEDGED — never in any LTV denominator, never seizable. */
  coldBtc: number;
  /** Split of the GROSS swept amount by origin (`openingColdBtc + coldFromCb + coldFromStrike −
   *  coldRetrievedBtc` = `coldBtc`; the opening reserve is a THIRD origin these two do not carry).
   *  Coinbase because the loan de-levers; Strike because a FIXED credit line needs ever less
   *  collateral as price rises (the migrated coins are attributed FIFO when the CB leg sweeps them on). */
  coldFromCb: number;
  coldFromStrike: number;
  btcHeld: number;               // display only — never a denominator

  cbLtv: number;                 // cbDebt / (cbColl × price)
  strikeLtv: number;             // strikeBalance / (strikeColl × price)

  collateralValue: number;
  equity: number;
  /** True AT `liqMonth` (the seizure happens within that row) and every row after it. */
  postLiquidation: boolean;
}

export interface CyclingResult {
  rows: CyclingRow[];
  last: CyclingRow;
  /**
   * First month the draw stopped (CB LTV reached the cap). NOT necessarily terminal: on a RISING path the
   * de-levering can pull LTV back under the cap and the draw resumes — see `drawingResumedMonth`.
   */
  stopMonth: number | null;
  /** First month the engine actually entered the drawing branch, else null (the draw never ran). Ground
   *  truth for the C2 "this run never draws" notice — the opening LTV alone cannot decide it. */
  firstDrawMonth: number | null;
  /** First month the draw resumed AFTER a stop, else null. With stopMonth, distinguishes a pause from a stop. */
  drawingResumedMonth: number | null;
  liqMonth: number | null;              // CB LTV reached CB_LLTV
  strikeMarginMonth: number | null;     // Strike LTV reached its margin-call line
  creditExhaustedMonth: number | null;  // first month the Strike line couldn't fund the full bill
  seizedBtc: number | null;
  survivorBtc: number | null;
  deficiencyUsd: number | null;         // debt surviving an under-collateralised liquidation
  totalStrikeInterest: number;
  totalCbInterest: number;
  /** Coinbase origination fees paid across the horizon, and how many borrows paid them. */
  totalCbFees: number;
  cbFeeCount: number;
  /** CASH moved from Strike to Coinbase across every refinance (the fee brackets key off this basis).
   *  `totalCbFees / totalRefinancedUsd` is the run's realized blended origination-fee fraction. */
  totalRefinancedUsd: number;
  /** Debt-shift defense telemetry (all 0/null when `defendCbLtv` is off). */
  firstDefenseMonth: number | null;
  /** First month Strike could NOT fully hold the stop (shortfall > 0) — residual risk after the shift. */
  defenseExhaustedMonth: number | null;
  totalDefenseDrawnUsd: number;
  defenseCount: number;
  /** Emergency top-up telemetry (0/null when `defendCbLtv` is off or it never fired). */
  firstTopUpMonth: number | null;
  /** First month even the top-up could NOT restore the stop — both sources exhausted. */
  topUpExhaustedMonth: number | null;
  totalTopUpBtc: number;
  totalTopUpFromColdBtc: number;
  totalTopUpFromStrikeBtc: number;
  /** Routine sweep-cascade migration total (Strike collateral → Coinbase). */
  totalStrikeToCbBtc: number;
  /** Cumulative BTC pulled out of cold by the top-up. */
  totalColdRetrievedBtc: number;
  baselineEquity: number;               // "never draw" comparison, on the SAME price path
  baselineBtc: number;
  /** The reserve the run STARTED with (`openingColdBtc`, 0 when not supplied). Reported so the cold ledger
   *  foots: opening + totalColdFromCb + totalColdFromStrike − totalColdRetrievedBtc === totalColdBtc. */
  openingColdBtc: number;
  /** NET BTC in cold storage at the end of the run (the opening reserve when the sweep is off and nothing
   *  was retrieved); gross swept = totalColdFromCb + totalColdFromStrike, and
   *  opening + gross − totalColdRetrievedBtc === this. */
  totalColdBtc: number;
  totalColdFromCb: number;
  totalColdFromStrike: number;
  /** First month the sweep moved anything, else null — "not yet" is the honest answer for a long while. */
  firstColdMonth: number | null;
}

/** Liquidation penalty as a fraction (≈ 0.04384) — derived from the shared incentive factor, not a literal. */
export const CB_LIQUIDATION_PENALTY = CB_LIF - 1;


export function runCyclingSim(inputs: CyclingInputs): CyclingResult {
  const {
    startYear, strikeCreditLine, strikeMaxDrawLtv, strikeMarginLtv,
    income, expenses, strikeAprPct, cbAprPct, cbLtvCapPct,
  } = inputs;

  const pricePath = inputs.pricePath.length > 0 ? inputs.pricePath : [0];
  const months = pricePath.length - 1;
  const smr = strikeAprPct / 100 / 12;
  const cmr = cbAprPct / 100 / 12;
  const cap = cbLtvCapPct / 100;
  const cycle = Math.max(1, Math.floor(inputs.cycleMonths));
  const mode: CyclingMode = inputs.mode ?? 'cycle';
  const defend = inputs.defendCbLtv === true;

  // Cold-storage sweep. 0 disables it; 1 (survive a 100% drawdown) would demand an LTV of 0 — infinite
  // collateral for any debt — so the buffer is held below 1.
  const coldBufferRaw = inputs.coldStoreBufferPct ?? 0;
  const coldBuffer = Number.isFinite(coldBufferRaw) ? Math.min(0.99, Math.max(0, coldBufferRaw / 100)) : 0;
  const coldOn = coldBuffer > 0;
  // 🔴 THE SWEEP CAN NEVER BE LOOSER THAN THE DRAW CAP. Without this clamp the sweep silently undoes the
  // CB LTV STOP: a 1% buffer implies an 85.1% floor, so it would strip collateral down to a level the cap
  // has already declared too risky to BORROW at. Measured, unclamped, on a −30%/yr path: liquidation moved
  // from month 13 to month 2. Withdrawing collateral to a worse LTV than you are willing to borrow at is
  // incoherent, so the cap wins and the two knobs compose instead of fighting.
  // ⚠ This does NOT make the sweep risk-free — see the header. It removes only the incoherent settings.
  const coldFloorLtv = Math.min(CB_LLTV * (1 - coldBuffer), cap);

  // ⚠ NO LONGER const. Purchases still never go here — but the sweep CASCADE's cadence migration and the
  // emergency TOP-UP can move collateral out (to cbColl; the top-up may take it on to CB from cold first).
  let strikeColl = inputs.strikeCollateralBtc;
  let cbColl = inputs.cbCollateralBtc;             // grows with every purchase
  let cbDebt = inputs.cbDebt;
  let strikeBal = inputs.strikeBalance;

  let stopMonth: number | null = null;
  let firstDrawMonth: number | null = null;
  let drawingResumedMonth: number | null = null;
  let liqMonth: number | null = null;
  let strikeMarginMonth: number | null = null;
  let creditExhaustedMonth: number | null = null;
  let seizedBtc: number | null = null;
  let survivorBtc: number | null = null;
  let deficiencyUsd: number | null = null;
  let totalStrikeInterest = 0;
  let totalCbInterest = 0;
  let totalCbFees = 0;
  let cbFeeCount = 0;
  let totalRefinancedUsd = 0;
  let firstDefenseMonth: number | null = null;
  let defenseExhaustedMonth: number | null = null;
  let totalDefenseDrawnUsd = 0;
  let defenseCount = 0;
  // The opening reserve seeds the pool. ⚠ `Number.isFinite && > 0`, NOT `Math.max(0, x)` — the latter
  // returns NaN for NaN, which would poison every pool figure instead of clamping it (ownership.ts's rule).
  let coldBtc = Number.isFinite(inputs.openingColdBtc) && (inputs.openingColdBtc ?? 0) > 0
    ? (inputs.openingColdBtc as number)
    : 0;
  const openingColdBtc = coldBtc;
  let coldFromCb = 0;
  let coldFromStrike = 0;
  let coldRetrievedBtc = 0;
  let strikeToCbPending = 0;   // migrated-but-not-yet-swept ledger (FIFO attribution for the origin split)
  let totalStrikeToCbBtc = 0;
  let firstTopUpMonth: number | null = null;
  let topUpExhaustedMonth: number | null = null;
  let totalTopUpBtc = 0;
  let totalTopUpFromColdBtc = 0;
  let totalTopUpFromStrikeBtc = 0;
  let firstColdMonth: number | null = null;

  const rows: CyclingRow[] = [];

  for (let m = 0; m <= months; m++) {
    const price = pricePath[m];
    let strikeDrawn = 0;
    let strikeShortfall = 0;
    let btcBoughtUsd = 0;
    let defenseDrawnUsd = 0;
    let cbLtvPreDefense: number | null = null;
    let defenseShortfallUsd = 0;
    let strikeToCbBtc = 0;
    let topUpBtc = 0;
    let topUpFromColdBtc = 0;
    let topUpFromStrikeBtc = 0;

    if (m > 0) {
      const ci = cbDebt * cmr;
      cbDebt += ci;
      totalCbInterest += ci;

      if (mode === 'cycle') {
        // The cap is a COINBASE threshold — test it against CB LTV, never a blended figure.
        const drawing = ltvOf(cbDebt, cbColl, price) < cap && liqMonth === null;

        if (drawing) {
          // Ground truth for the view's "this run never draws" notice — the opening LTV alone cannot
          // decide it (interest and the path can push LTV across the cap before month 1 draws). A month
          // that draws AFTER any non-drawing month is a resume, even if it is also the first-ever draw.
          if (stopMonth !== null && drawingResumedMonth === null) drawingResumedMonth = m;
          if (firstDrawMonth === null) firstDrawMonth = m;
          // The Strike line is a hard constraint: min(credit line, collateral × price × max-draw LTV).
          // What it can't fund comes out of income, which is what would actually happen — so the
          // constraint is self-limiting (fewer sats bought) rather than a hard stop.
          const available = Math.max(0, Math.min(strikeCreditLine, strikeColl * price * strikeMaxDrawLtv) - strikeBal);
          strikeDrawn = Math.min(expenses, available);
          strikeShortfall = expenses - strikeDrawn;
          if (strikeShortfall > 0 && creditExhaustedMonth === null) creditExhaustedMonth = m;

          strikeBal += strikeDrawn;
          const si = strikeBal * smr;
          strikeBal += si;
          totalStrikeInterest += si;

          // ⭐ THE FLYWHEEL: the line paid the bill, so ALL of income buys bitcoin — less only the part
          // of the bill the line could not fund. Not the surplus.
          btcBoughtUsd = Math.max(0, income - strikeShortfall);
          if (price > 0) cbColl += btcBoughtUsd / price;
        } else {
          if (stopMonth === null && liqMonth === null) stopMonth = m;
          const si = strikeBal * smr;
          strikeBal += si;
          totalStrikeInterest += si;
          // Not drawing: income pays the bill itself, so only the surplus is left to buy.
          btcBoughtUsd = Math.max(0, income - expenses);
          if (price > 0) cbColl += btcBoughtUsd / price;
        }

        // ── SWEEP CASCADE: Strike surplus collateral → Coinbase ─────────────────────────────────────
        // A FIXED credit line needs ever less collateral as the price rises. Keep the larger of what the
        // line and the margin demand AT THE STRESSED PRICE (the old direct-to-cold rule), and move the
        // rest into the CB pool BEFORE the refinance — the freed collateral is headroom that lets more
        // cheap debt move under the stop in the same month. The CB leg then sweeps the true excess on to
        // cold. ⚠ If Strike ever RAISES the line, this collateral is what you'd need back.
        // ⚠ Gated on the SWEEP **or** the DEFENSE. The migration's own justification above is a DEFENSE
        // one — freed collateral is CB headroom that lets more cheap debt move under the stop — so it must
        // run when the defense is on even with the sweep off. With the sweep off `coldBuffer` is 0, so
        // `stressed` is the raw price: the honest reading of "no buffer requested". Byte-identical to the
        // pre-A3 engine only when BOTH are off.
        if ((coldOn || defend) && m % cycle === 0 && price > 0 && strikeColl > 0) {
          const stressed = price * (1 - coldBuffer);
          const keepForLine = strikeCreditLine / (stressed * strikeMaxDrawLtv);
          const keepForMargin = strikeMarginLtv > 0 ? strikeBal / (strikeMarginLtv * stressed) : 0;
          const move = Math.max(0, strikeColl - Math.max(keepForLine, keepForMargin));
          if (move > 0) {
            strikeColl -= move;
            cbColl += move;
            strikeToCbBtc = move;
            strikeToCbPending += move;
            totalStrikeToCbBtc += move;
          }
        }

        // Refinance: the Strike balance moves to the cheaper Coinbase loan.
        // ⚠ NOT FREE. Coinbase charges its origination fee on EVERY borrow, including adding to an
        // existing loan, and CAPITALISES it — so the fee joins the principal and compounds at the CB APR
        // for the rest of the horizon. Modelling the sweep as a clean transfer overstates the arbitrage.
        // ⚠ With the defense ON the sweep is capped by the remaining CB headroom (cbMaxDrawForHeadroom —
        // fee-inclusive), so it can never push LTV back over the cap: the mirror image of the defense
        // paydown. As the price recovers, this is what shifts the debt back to Coinbase.
        if (m % cycle === 0 && strikeBal > 0) {
          const headroom = defend
            ? Math.max(0, cap * cbColl * price - cbDebt)
            : Number.POSITIVE_INFINITY;
          const sweepCash = Math.min(strikeBal, cbMaxDrawForHeadroom(headroom, cbDebt));
          if (sweepCash > 0) {
            const fee = cbBorrowFee(sweepCash, cbDebt);
            cbDebt += sweepCash + fee;
            totalRefinancedUsd += sweepCash;
            totalCbFees += fee;
            cbFeeCount += 1;
            strikeBal = sweepCash >= strikeBal ? 0 : strikeBal - sweepCash;
          }
        }

        // ── DEBT-SHIFT DEFENSE (cycle + defendCbLtv) ────────────────────────────────────────────────
        // A month whose CB LTV sits above the cap draws from Strike to PAY THE CB LOAN DOWN to the cap,
        // shifting the debt to the more expensive but still-open Strike facility until the price recovers.
        // ⚠ Runs AFTER the refinance (the headroom-capped sweep sits at/below the cap) and BEFORE the cold
        // sweep — the sweep can move STRIKE collateral the defense needs for its 50%-line capacity.
        if (defend && liqMonth === null && price > 0) {
          const ltvBefore = ltvOf(cbDebt, cbColl, price);
          if (ltvBefore > cap) {
            const d = defendCbLtv({
              cbDebt,
              cbCollateralBtc: cbColl,
              strikeCollateralBtc: strikeColl,
              strikeBalance: strikeBal,
              price,
              targetCbLtvPct: cbLtvCapPct,
              creditLine: strikeCreditLine,
              maxDrawLtv: strikeMaxDrawLtv,
              marginLtv: strikeMarginLtv,
            });
            cbLtvPreDefense = ltvBefore;
            defenseDrawnUsd = d.drawUsd;
            defenseShortfallUsd = d.shortfallUsd;
            if (d.drawUsd > 0) {
              cbDebt -= d.drawUsd;      // pay the CB loan down — no CB origination fee on a paydown
              strikeBal += d.drawUsd;   // the debt now sits on Strike; its interest starts next month
              totalDefenseDrawnUsd += d.drawUsd;
              defenseCount += 1;
              if (firstDefenseMonth === null) firstDefenseMonth = m;
            }
            if (d.shortfallUsd > 0 && defenseExhaustedMonth === null) defenseExhaustedMonth = m;
          }
        }

        // ── EMERGENCY COLLATERAL TOP-UP (fallback, cycle + defendCbLtv) ─────────────────────────────
        // The shift can't always hold the stop (the line is finite). Then grow the CB denominator instead:
        // cold reserve FIRST (no lender constraint, no Strike side effect), then the Strike collateral
        // above its margin line — the true last resort, which sacrifices the 50% line backing. ⚠ Runs
        // AFTER the shift and BEFORE the cold sweep, so the sweep can never undo it.
        if (defend && liqMonth === null && price > 0 && defenseShortfallUsd > 0) {
          const t = topUpToCbLtv({
            cbDebt,
            cbCollateralBtc: cbColl,
            price,
            targetCbLtvPct: cbLtvCapPct,
            coldBtc,
            strikeCollateralBtc: strikeColl,
            strikeBalance: strikeBal,
            marginLtv: strikeMarginLtv,
          });
          topUpBtc = t.topUpBtc;
          topUpFromColdBtc = t.fromColdBtc;
          topUpFromStrikeBtc = t.fromStrikeBtc;
          if (t.topUpBtc > 0) {
            coldBtc -= t.fromColdBtc;
            strikeColl -= t.fromStrikeBtc;
            cbColl += t.topUpBtc;
            coldRetrievedBtc += t.fromColdBtc;
            totalTopUpBtc += t.topUpBtc;
            totalTopUpFromColdBtc += t.fromColdBtc;
            totalTopUpFromStrikeBtc += t.fromStrikeBtc;
            if (firstTopUpMonth === null) firstTopUpMonth = m;
          }
          if (t.shortfallBtc > 0 && topUpExhaustedMonth === null) topUpExhaustedMonth = m;
        }
      } else {
        // Non-cycle modes: no draw, no refinance. Both legs accrue at their own rates; the surplus
        // (never the deficit — see C1) retires the named leg(s) first, then buys into the Coinbase pool.
        const si = strikeBal * smr;
        strikeBal += si;
        totalStrikeInterest += si;

        let cash = Math.max(0, income - expenses);
        if (mode === 'clearStrike' || mode === 'clearBoth') {
          const pay = Math.min(cash, strikeBal);
          strikeBal -= pay;
          cash -= pay;
          // ⚠ SUB-CENT RESIDUAL SWEEP, not float dust: 0.005 is half a US cent — three orders of
          // magnitude above float noise. A non-zero residual here would render a phantom non-zero
          // strikeLtv. Never "correct" this to 1e-9.
          if (strikeBal < 0.005) strikeBal = 0;
        }
        if (mode === 'clearBoth') {
          const pay = Math.min(cash, cbDebt);
          cbDebt -= pay;
          cash -= pay;
          if (cbDebt < 0.005) cbDebt = 0;
        }
        btcBoughtUsd = Math.max(0, cash);
        if (cash > 0 && price > 0) cbColl += cash / price;
      }
    }

    // ── COLD-STORAGE SWEEP ── after the month's accumulation, before the LTV is read, so the row shows
    // the position as it actually stands once the coins are gone. Never at m=0 (that is the opening
    // position, not a month of the plan) and never once liquidated (there is nothing left to protect).
    // ⚠ Removing only the EXCESS raises cbLtv at most TO coldFloorLtv IN THAT MONTH — but the collateral
    // is gone for good, so every LATER month starts from a smaller base. On a rising path that never
    // matters (LTV keeps falling anyway); on a flat or falling one it does. The sweep is a RISK TRANSFER,
    // not free safety, and `coldStoreBufferPct` is the size of the transfer.
    if (coldOn && m > 0 && liqMonth === null && price > 0) {
      // ── COINBASE leg (the ONLY sweep leg): the loan de-levers as price rises, freeing collateral
      // above the buffer's floor. The Strike surplus already flowed in via the cadence migration above;
      // this leg moves the true excess on to cold, attributing the migrated coins FIFO (display only).
      if (cbColl > 0) {
        const required = cbDebt / (coldFloorLtv * price);   // collateral the buffer demands we keep
        const excess = cbColl - required;
        if (excess > 0) {
          const moved = Math.min(excess, cbColl);
          cbColl -= moved;
          coldBtc += moved;
          const fromStrikeAttrib = Math.min(moved, strikeToCbPending);
          strikeToCbPending -= fromStrikeAttrib;
          coldFromStrike += fromStrikeAttrib;
          coldFromCb += moved - fromStrikeAttrib;
          if (firstColdMonth === null) firstColdMonth = m;
        }
      }
    }

    const cbLtv = ltvOf(cbDebt, cbColl, price);
    const strikeLtv = ltvOf(strikeBal, strikeColl, price);
    if (strikeMarginMonth === null && strikeMarginLtv > 0 && strikeLtv >= strikeMarginLtv) strikeMarginMonth = m;

    const breached = liqMonth === null && cbDebt > 0 && (cbColl <= 0 || cbLtv >= CB_LLTV);
    if (breached) liqMonth = m;

    // ⚠ btcHeld is the THREE pools — Strike-pledged, Coinbase-pledged, and cold. It stays DISPLAY ONLY
    // and is still never a denominator; adding cold here is what keeps "yours" honest once coins leave.
    const btcHeld = strikeColl + cbColl + coldBtc;
    const collateralValue = btcHeld * price;
    rows.push({
      m,
      yearLabel: (startYear + m / 12).toFixed(1),
      price,
      cbDebt, strikeBalance: strikeBal, debt: cbDebt + strikeBal,
      strikeDrawn, strikeShortfall, btcBoughtUsd,
      defenseDrawnUsd, cbLtvPreDefense, defenseShortfallUsd, defended: defenseDrawnUsd > 0,
      strikeToCbBtc, topUpBtc, topUpFromColdBtc, topUpFromStrikeBtc, coldRetrievedBtc,
      strikeCollateralBtc: strikeColl, cbCollateralBtc: cbColl, coldBtc, coldFromCb, coldFromStrike, btcHeld,
      cbLtv, strikeLtv,
      collateralValue, equity: collateralValue - (cbDebt + strikeBal),
      postLiquidation: liqMonth !== null,
    });

    // The seizure is applied AFTER the row is pushed, so the liquidation row honestly shows the position
    // that BREACHED (LTV ≥ 86%) and month m+1 opens with the survivor. Morpho repays up to 100% of debt in
    // one transaction and seizes collateral at CB_LIF.
    if (breached) {
      seizedBtc = Math.min(cbColl, price > 0 ? (cbDebt * CB_LIF) / price : cbColl);
      const repaidUsd = price > 0 ? (seizedBtc * price) / CB_LIF : cbDebt;
      cbColl -= seizedBtc;
      // ⚠ NOT `cbDebt = 0`. When the min() binds, the collateral was short and a deficiency SURVIVES —
      // both facilities are full-recourse, so showing a clean zero errs optimistic.
      cbDebt = Math.max(0, cbDebt - repaidUsd);
      deficiencyUsd = cbDebt > 0 ? cbDebt : null;
      // ⭐ Cold storage CANNOT be seized — that is the entire point of the feature, and the survivor
      // figure is where it shows up. Morpho reaches the Coinbase pool only.
      survivorBtc = strikeColl + cbColl + coldBtc;
    }
  }

  // ── "Never draw" baseline, on the SAME price path (or the verdict compares two different worlds) ──
  // Each leg accrues at its OWN rate; only the surplus buys BTC.
  let baseCbDebt = inputs.cbDebt;
  let baseStrikeBal = inputs.strikeBalance;
  // Compare against the untouched opening position. `strikeColl` may have been reduced by the optional
  // cold-storage sweep above; using it here would make the baseline pay for the strategy's own transfer.
  // ⚠ `openingColdBtc` IS part of the untouched opening position — the owner holds that reserve in the
  // never-draw world too. Omitting it would credit the strategy with coins it never earned, inflating the
  // verdict by exactly the seed (0 today, since no caller passes one).
  let baseBtc = inputs.strikeCollateralBtc + inputs.cbCollateralBtc + openingColdBtc;
  const surplus = Math.max(0, income - expenses);
  for (let m = 1; m <= months; m++) {
    baseCbDebt *= 1 + cmr;
    baseStrikeBal *= 1 + smr;
    if (pricePath[m] > 0) baseBtc += surplus / pricePath[m];
  }
  const last = rows[rows.length - 1];
  const baselineEquity = baseBtc * last.price - (baseCbDebt + baseStrikeBal);

  return {
    rows, last,
    stopMonth, firstDrawMonth, drawingResumedMonth, liqMonth, strikeMarginMonth, creditExhaustedMonth,
    seizedBtc, survivorBtc, deficiencyUsd,
    totalStrikeInterest, totalCbInterest, totalCbFees, cbFeeCount, totalRefinancedUsd,
    firstDefenseMonth, defenseExhaustedMonth, totalDefenseDrawnUsd, defenseCount,
    firstTopUpMonth, topUpExhaustedMonth, totalTopUpBtc, totalTopUpFromColdBtc, totalTopUpFromStrikeBtc,
    totalStrikeToCbBtc, totalColdRetrievedBtc: coldRetrievedBtc,
    baselineEquity, baselineBtc: baseBtc,
    openingColdBtc,
    totalColdBtc: coldBtc, totalColdFromCb: coldFromCb, totalColdFromStrike: coldFromStrike, firstColdMonth,
  };
}
