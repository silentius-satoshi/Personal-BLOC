/**
 * ONE definition of "what's yours" — the ownership split (S2′).
 *
 * Two surfaces, one formula, one name (B1): the Almanac Cycling face's lens/gain math and the viewer
 * ownership bar (S4) both read `yoursBtc` from HERE. Before this, the same subtraction lived in
 * `cyclingFaceView.ts` (under two other names) and again in the proposed Ownership face — four copies of
 * one user-facing number under two names, while the Daily ledger already used one of those names for
 * something else.
 *
 * 🔴 Caller-enforced: the result is DISPLAY-ONLY and is never a denominator for lender LTV math — that
 * routes through cbMetrics / computeStrikeLtv (architecture invariant 2). This module imports NOTHING;
 * it is a leaf like viewerVenue.ts.
 *
 * ⚠ Shares are a share of `btcHeld` — the COIN COUNT, never the value. `yoursBtc + lendersBtc ≡ btcHeld`
 * exactly (both derive from the same price), so the pre-clamp ratios sum to 1 identically; clamping each
 * to [0,1] therefore preserves the sum in every case — including underwater, where one goes negative and
 * the other exceeds 1, landing on 0 and 1.
 */

export interface Ownership {
  /** btcHeld − debt/price — exact, may be negative (underwater). */
  yoursBtc: number;
  /** debt/price — exact; together with `yoursBtc`, ≡ `btcHeld`. */
  lendersBtc: number;
  /** clamp01(yoursBtc / btcHeld); 0 when !hasData. */
  yoursShare: number;
  /** clamp01(lendersBtc / btcHeld); 0 when !hasData. */
  lendersShare: number;
  /** A denominator exists (btcHeld > 0) — the shares are meaningful and sum to 1. */
  hasData: boolean;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function deriveOwnership(btcHeld: number, debt: number, price: number): Ownership {
  // Zero-price guard mirrors btcGained/applyPriceLens: the debt term contributes 0 when a dollar figure
  // can't be priced, so `yoursBtc` degenerates to `btcHeld` rather than blowing up.
  const lendersBtc = price > 0 ? debt / price : 0;
  const yoursBtc = btcHeld - lendersBtc;
  const hasData = btcHeld > 0;
  return {
    yoursBtc,
    lendersBtc,
    yoursShare: hasData ? clamp01(yoursBtc / btcHeld) : 0,
    lendersShare: hasData ? clamp01(lendersBtc / btcHeld) : 0,
    hasData,
  };
}
