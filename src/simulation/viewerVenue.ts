/**
 * Viewer venue split — PURE. No React, no store, no imports at all.
 *
 * Backs the viewer home's composition bar: what share of the stack sits on Strike, on Coinbase, and in
 * COLD STORAGE. This is a COMPOSITION read, not a risk reading — there is no level, no threshold, and no
 * lender rule that says a given concentration is unsafe. Callers must not band it.
 *
 * ⚠ Cold is the one venue that is NOT collateral: it backs no loan and no lender can reach it. It still
 * belongs in the denominator here, because the question this bar answers is "where are my coins", and a
 * split that omitted the unpledged share would overstate how much of the stack is pledged.
 * ⚠ `coldBtc` is a REAL owner-entered balance (`store.coldStorageBtc`) — never the Almanac's projected
 * cold-storage sweep, which is a simulation and must not leak into a viewer's reading of actual holdings.
 *
 * Extracted (mirroring cyclingFaceView.ts) so it is unit-testable without a render harness — the repo has none.
 */

export interface VenueSplit {
  strikeBtc: number;
  cbBtc: number;
  coldBtc: number;
  combinedBtc: number;
  /** 0..1 */
  strikeShare: number;
  /** 0..1 */
  cbShare: number;
  /** 0..1 */
  coldShare: number;
  /** false when combined <= 0 — the caller renders NOTHING (not an empty bar, not a zero state). */
  hasData: boolean;
}

/** Non-finite or negative inputs collapse to 0 before any arithmetic, so a share is never negative or NaN. */
const clean = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function deriveVenueSplit(strikeBtc: number, cbBtc: number, coldBtc = 0): VenueSplit {
  const strike = clean(strikeBtc);
  const cb = clean(cbBtc);
  const cold = clean(coldBtc);
  const combined = strike + cb + cold;

  if (!(combined > 0)) {
    return {
      strikeBtc: strike, cbBtc: cb, coldBtc: cold, combinedBtc: 0,
      strikeShare: 0, cbShare: 0, coldShare: 0, hasData: false,
    };
  }

  // ⚠ EXACT quotients — no rounding here. Rounding is a formatting concern, and rounding at this layer
  // would stop the two rendered segment widths summing to 100%.
  return {
    strikeBtc: strike,
    cbBtc: cb,
    coldBtc: cold,
    combinedBtc: combined,
    strikeShare: strike / combined,
    cbShare: cb / combined,
    coldShare: cold / combined,
    hasData: true,
  };
}
