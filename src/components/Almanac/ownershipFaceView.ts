import type { CyclingRow, CyclingMode } from '../../simulation/cyclingSim';
import { deriveOwnership } from '../../simulation/ownership';
import { btcGained } from './cyclingFaceView';
import { policyLimitPct } from './supportPolicyView';
import { fmtUSD } from '../../utils/format';

/**
 * Ownership face display math (S3). REUSES the shared Cycling helpers rather than defining a second set
 * (B1): `btcGained` / `clampMonth` / `holdingsSplit` / `applyPathStress` / `debtSplit` come straight from
 * cyclingFaceView. This module adds only the ownership-specific bits. Pure, store-free leaf imports only —
 * the support policy's chart limit comes from supportPolicyView (the testable-leaf rule).
 *
 * 🔴 Must never be imported by anything in the risk core (same discipline as cyclingFaceView).
 */

/** S3's gain adapter (B2): ownership-named view of the SAME definition `btcGained` uses — delegates, so
 *  the two can never drift. `rowPriceOverride` lenses the ROW side ONLY; `base` keeps its own real price. */
export function ownershipGained(row: CyclingRow, base: CyclingRow, rowPriceOverride?: number) {
  return btcGained(row, base, rowPriceOverride);
}

export interface OwnershipChartRow {
  m: number;
  held: number;
  yours: number;
  owed: number;
  /** Cold-storage BTC — a SUBSET of `held`, not a fourth quantity to add to it. 0 when the sweep is off. */
  cold: number;
  /** null when non-finite (debt with no collateral) — a chart GAP, never a coerced NaN or a fake 0. */
  cbLtv: number | null;
  strikeLtv: number | null;
  price: number;
  /** null when no finite liquidation price exists (debt-free leg, or debt with no collateral). Plotting a
   *  $0 line would read as "never liquidates", which is the inverse of an unbacked position's truth. */
  liq: number | null;
  /** The support policy's Coinbase limit at TODAY'S price, % (`policyLimitPct`, rounded to 1 dp like the other LTV
   *  series) — the LTV chart's dashed series. null without a stop (policy off) or without a multiple. */
  cbLimit: number | null;
}

/** Chart series for the three ownership views (held/owed/yours · LTV · price & liq). `yours`/`owed` read
 *  deriveOwnership — the definition, never an open-coded subtraction. Pass `cbStopEffPct` (the effective Coinbase
 *  stop at support) only while the policy applies; without it `cbLimit` is null on every row. */
export function chartOwnershipRows(rows: CyclingRow[], cbLiqLtv: number, cbStopEffPct?: number): OwnershipChartRow[] {
  return rows.map((r) => {
    const o = deriveOwnership(r.btcHeld, r.debt, r.price);
    const ltvPct = (fraction: number): number | null =>
      Number.isFinite(fraction) ? +(fraction * 100).toFixed(1) : null;
    const limit = cbStopEffPct === undefined ? null : policyLimitPct(r, cbStopEffPct);
    return {
      m: r.m,
      held: +r.btcHeld.toFixed(4),
      yours: +o.yoursBtc.toFixed(4),
      owed: +o.lendersBtc.toFixed(4),
      // ⚠ `held` ALREADY includes cold (btcHeld is all three pools), so plotting cold makes visible a
      // share the Held line was otherwise hiding. It is a floor under `yours`: coins no lender can reach.
      cold: +r.coldBtc.toFixed(4),
      cbLtv: ltvPct(r.cbLtv),
      strikeLtv: ltvPct(r.strikeLtv),
      price: Math.round(r.price),
      liq: cbLiqLtv > 0 && r.cbCollateralBtc > 0 && r.cbDebt > 0
        ? Math.round(r.cbDebt / (cbLiqLtv * r.cbCollateralBtc))
        : null,
      cbLimit: limit === null ? null : +limit.toFixed(1),
    };
  });
}

// ── Shared face rules — extracted from OwnershipFace's JSX so each has ONE definition ────────────────
// Moved verbatim (the face now calls them) because the Strategy face renders the same hero, the same mode
// notes and the same C1/C2 notices, and a second inline copy is how two faces drift apart. Pinned in
// ownershipFaceView.test.ts.

export interface OwnershipHero {
  heldBtc: number;
  /** BTC the debt buys at the row's price (deriveOwnership's lendersBtc). */
  owedBtc: number;
  /** Raw yours — can go negative when the debt outgrows the stack. */
  yoursBtc: number;
  /** The hero figure: yours clamped at 0 — DISPLAY ONLY, never fed back into math. */
  yoursDisplayBtc: number;
  /** Yours at the base row (today), for the "vs today" delta and the survival verdict. */
  netToday: number;
  deltaVsToday: number;
  /** The CLAMPED shares (they sum to 1 when hasData — B3), never 1 − yours. */
  yoursShare: number;
  lendersShare: number;
}

/** The ownership wrapper for one row against the base row — every figure through deriveOwnership, the
 *  definition, never an open-coded subtraction. 3-arg on purpose: `row.btcHeld` already contains cold. */
export function ownershipHero(row: CyclingRow, base: CyclingRow): OwnershipHero {
  const o = deriveOwnership(row.btcHeld, row.debt, row.price);
  const netToday = deriveOwnership(base.btcHeld, base.debt, base.price).yoursBtc;
  return {
    heldBtc: row.btcHeld,
    owedBtc: o.lendersBtc,
    yoursBtc: o.yoursBtc,
    yoursDisplayBtc: Math.max(0, o.yoursBtc),
    netToday,
    deltaVsToday: o.yoursBtc - netToday,
    yoursShare: o.yoursShare,
    lendersShare: o.lendersShare,
  };
}

export interface ModeConstraints {
  /**
   * C2 — the degenerate case: the cap never lets the draw run. ⚠ Judged on the ENGINE's ground truth
   * (`firstDrawMonth`), not the opening LTV: interest and the path can push LTV across the cap before
   * month 1 ever draws, so a 68%-opening run against a 70% cap can still never draw, and an opening-LTV
   * proxy would silently omit the notice.
   */
  degenerateCap: boolean;
  /** C1 — a no-draw mode with a deficit: the bills are funded by nothing (no coins sold, no debt grown). */
  deficitMode: boolean;
  /**
   * The cycle-mode twin of C1: the ENGINE found bills neither income nor the Strike line paid
   * (`totalUnfundedUsd > 0` — the stop halted the draw, or the line ran dry). Cycle-only on purpose: the
   * no-draw modes already carry `deficitMode`, and one gap must never raise two notices.
   */
  cycleUnfunded: boolean;
}

/** ⚠ `totalUnfundedUsd` is REQUIRED — pass the SAME `sim` that supplies `firstDrawMonth` (the displayed run),
 *  so the stress lens moves the notice with the rest of the face. */
export function modeConstraints(
  mode: CyclingMode,
  firstDrawMonth: number | null,
  income: number,
  expenses: number,
  totalUnfundedUsd: number,
): ModeConstraints {
  return {
    degenerateCap: mode === 'cycle' && firstDrawMonth === null,
    deficitMode: mode !== 'cycle' && expenses > income,
    cycleUnfunded: mode === 'cycle' && totalUnfundedUsd > 0,
  };
}

/** The cycleUnfunded notice — ONE sentence for all three faces. CAUSE-NEUTRAL: the gap comes either from the
 *  stop halting the draw or from the credit line running out, and the copy must be true in both (it sits
 *  beside CyclingFace's credit-exhausted notice). Empty when there is no gap.
 *  ⚠ Pass `baselineUnfundedUsd` (the engine's `sim.baselineUnfundedUsd`) and the last sentence states the never-draw
 *  baseline's OWN measured gap — "the same gap" is not true under the support policy, which can leave bills unpaid
 *  where the baseline pays them. Two arguments keep today's sentence until the faces pass it (Run 2b), which then
 *  makes it required. */
export function unfundedNote(firstUnfundedMonth: number | null, totalUnfundedUsd: number, baselineUnfundedUsd?: number): string {
  if (firstUnfundedMonth === null) return '';
  const baseline = baselineUnfundedUsd === undefined
    ? 'The never-draw comparison has the same gap.'
    : baselineUnfundedUsd >= 0.5
      ? `The never-draw comparison leaves ${fmtUSD(baselineUnfundedUsd)} unpaid over the same run.`
      : 'The never-draw comparison pays every bill over the same run.';
  return `From month ${firstUnfundedMonth}, bills exceed what income and the credit line can cover — `
    + `${fmtUSD(totalUnfundedUsd)} over this run is paid by nothing in the model. ${baseline}`;
}

/** One sentence per strategy. ⚠ `hold` IS the never-draw baseline (C3) — the note says so, and no view may
 *  present "hold vs baseline" as a win or a loss. */
export const MODE_NOTE: Record<CyclingMode, string> = {
  cycle: 'Bills drawn on Strike, refinanced into Coinbase every N months, purchases routed to the Coinbase pool. With cap defense on, a breach pays Coinbase down from Strike and the refinance shifts it back.',
  hold: 'No draw, no refinance. Surplus buys into the Coinbase pool. ⚠ This IS the never-draw baseline — there is no second curve to compare against.',
  clearStrike: 'No draw. Surplus retires Strike, then buys.',
  clearBoth: 'No draw. Surplus retires Strike, then Coinbase, then buys.',
};
