import { CB_LLTV, CB_LIF } from './runCoinbaseLoan';

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
 * Still NOT MODELED: a cold-storage / unpledged reserve and a support-line "switch" mode.
 *
 * 🔴 §2 ISOLATION WALL — this module imports NOTHING from powerLaw/cycleModel. The price path arrives as a
 * plain `number[]` and the three lender ratios (`strikeMaxDrawLtv`, `strikeMarginLtv`) arrive as plain
 * numbers, so the engine is a leaf: clock-free, power-law-free, store-free, fixture-testable. The VIEW does
 * the labelled crossing (the OutlookProjection/MonthBreakdown precedent).
 *
 * ⚠ TWO COLLATERAL POOLS, NEVER ONE. Strike-pledged BTC cannot also back Morpho. `strikeColl` is FIXED
 * (nothing is pledged to Strike after the opening position) and `cbColl` GROWS with every purchase — that
 * is the strategy. `btcHeld` is their sum and is DISPLAY ONLY; it is never a denominator. Collapsing them
 * understates CB LTV by ~16 points on a real position, which lets the cap fire late and runs the
 * liquidation test on a frozen denominator.
 */

export interface CyclingInputs {
  /** price[m] for m = 0..N. The view builds it (plConvergencePath); the engine never derives a price. */
  pricePath: number[];
  /** Calendar year of month 0 — LABEL SEED ONLY, never used in math (keeps the engine clock-free). */
  startYear: number;

  // Strike leg
  strikeCollateralBtc: number;   // fixed — purchases go to Coinbase
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

  strikeCollateralBtc: number;
  cbCollateralBtc: number;
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
  stopMonth: number | null;             // cap reached — drawing stopped
  liqMonth: number | null;              // CB LTV reached CB_LLTV
  strikeMarginMonth: number | null;     // Strike LTV reached its margin-call line
  creditExhaustedMonth: number | null;  // first month the Strike line couldn't fund the full bill
  seizedBtc: number | null;
  survivorBtc: number | null;
  deficiencyUsd: number | null;         // debt surviving an under-collateralised liquidation
  totalStrikeInterest: number;
  totalCbInterest: number;
  baselineEquity: number;               // "never draw" comparison, on the SAME price path
  baselineBtc: number;
}

/** Liquidation penalty as a fraction (≈ 0.04384) — derived from the shared incentive factor, not a literal. */
export const CB_LIQUIDATION_PENALTY = CB_LIF - 1;

const ltvOf = (debt: number, coll: number, price: number): number =>
  coll * price > 0 ? debt / (coll * price) : 0;

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

  const strikeColl = inputs.strikeCollateralBtc;   // fixed — purchases go to Coinbase
  let cbColl = inputs.cbCollateralBtc;             // grows with every purchase
  let cbDebt = inputs.cbDebt;
  let strikeBal = inputs.strikeBalance;

  let stopMonth: number | null = null;
  let liqMonth: number | null = null;
  let strikeMarginMonth: number | null = null;
  let creditExhaustedMonth: number | null = null;
  let seizedBtc: number | null = null;
  let survivorBtc: number | null = null;
  let deficiencyUsd: number | null = null;
  let totalStrikeInterest = 0;
  let totalCbInterest = 0;

  const rows: CyclingRow[] = [];

  for (let m = 0; m <= months; m++) {
    const price = pricePath[m];
    let strikeDrawn = 0;
    let strikeShortfall = 0;

    if (m > 0) {
      const ci = cbDebt * cmr;
      cbDebt += ci;
      totalCbInterest += ci;

      if (mode === 'cycle') {
        // The cap is a COINBASE threshold — test it against CB LTV, never a blended figure.
        const drawing = ltvOf(cbDebt, cbColl, price) < cap && liqMonth === null;

        if (drawing) {
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

          if (price > 0) cbColl += Math.max(0, income - strikeShortfall) / price;
        } else {
          if (stopMonth === null && liqMonth === null) stopMonth = m;
          const si = strikeBal * smr;
          strikeBal += si;
          totalStrikeInterest += si;
          if (price > 0) cbColl += Math.max(0, income - expenses) / price;
        }

        // Refinance: the whole Strike balance moves to the cheaper Coinbase loan.
        if (m % cycle === 0 && strikeBal > 0) {
          cbDebt += strikeBal;
          strikeBal = 0;
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
        if (cash > 0 && price > 0) cbColl += cash / price;
      }
    }

    const cbLtv = ltvOf(cbDebt, cbColl, price);
    const strikeLtv = ltvOf(strikeBal, strikeColl, price);
    if (strikeMarginMonth === null && strikeMarginLtv > 0 && strikeLtv >= strikeMarginLtv) strikeMarginMonth = m;

    const breached = liqMonth === null && cbColl > 0 && cbLtv >= CB_LLTV;
    if (breached) liqMonth = m;

    const btcHeld = strikeColl + cbColl;
    const collateralValue = btcHeld * price;
    rows.push({
      m,
      yearLabel: (startYear + m / 12).toFixed(1),
      price,
      cbDebt, strikeBalance: strikeBal, debt: cbDebt + strikeBal,
      strikeDrawn, strikeShortfall,
      strikeCollateralBtc: strikeColl, cbCollateralBtc: cbColl, btcHeld,
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
      survivorBtc = strikeColl + cbColl;
    }
  }

  // ── "Never draw" baseline, on the SAME price path (or the verdict compares two different worlds) ──
  // Each leg accrues at its OWN rate; only the surplus buys BTC.
  let baseCbDebt = inputs.cbDebt;
  let baseStrikeBal = inputs.strikeBalance;
  let baseBtc = strikeColl + inputs.cbCollateralBtc;
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
    stopMonth, liqMonth, strikeMarginMonth, creditExhaustedMonth,
    seizedBtc, survivorBtc, deficiencyUsd,
    totalStrikeInterest, totalCbInterest,
    baselineEquity, baselineBtc: baseBtc,
  };
}
