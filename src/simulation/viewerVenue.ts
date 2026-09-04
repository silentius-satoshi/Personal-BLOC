/**
 * Viewer venue split — PURE. No React, no store, no imports at all.
 *
 * Backs the viewer home's collateral-composition bar: what share of the stack sits on Strike vs Coinbase.
 * This is a COMPOSITION read, not a risk reading — there is no level, no threshold, and no lender rule that
 * says a given venue concentration is unsafe. Callers must not band it.
 *
 * Extracted (mirroring cyclingFaceView.ts) so it is unit-testable without a render harness — the repo has none.
 */

export interface VenueSplit {
  strikeBtc: number;
  cbBtc: number;
  combinedBtc: number;
  /** 0..1 */
  strikeShare: number;
  /** 0..1 */
  cbShare: number;
  /** false when combined <= 0 — the caller renders NOTHING (not an empty bar, not a zero state). */
  hasData: boolean;
}

/** Non-finite or negative inputs collapse to 0 before any arithmetic, so a share is never negative or NaN. */
const clean = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function deriveVenueSplit(strikeBtc: number, cbBtc: number): VenueSplit {
  const strike = clean(strikeBtc);
  const cb = clean(cbBtc);
  const combined = strike + cb;

  if (!(combined > 0)) {
    return { strikeBtc: strike, cbBtc: cb, combinedBtc: 0, strikeShare: 0, cbShare: 0, hasData: false };
  }

  // ⚠ EXACT quotients — no rounding here. Rounding is a formatting concern, and rounding at this layer
  // would stop the two rendered segment widths summing to 100%.
  return {
    strikeBtc: strike,
    cbBtc: cb,
    combinedBtc: combined,
    strikeShare: strike / combined,
    cbShare: cb / combined,
    hasData: true,
  };
}
