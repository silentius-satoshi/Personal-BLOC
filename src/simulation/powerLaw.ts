export const PL_B         = 5.82;
export const PL_A_FAIR    = 1.16e-17;
export const PL_A_FLOOR   = 0.42e-17;
// ⚠ RESISTANCE, not an envelope. A band parallel to fair (they share PL_B) can never track cycle
// tops, because tops decay toward the trend every cycle — measured against the fair line they ran
// 19.3x (2011), 11.6x (2013), 6.0x (2017), 2.5x (2021), 0.99x (Oct 2025). So this constant is a
// CALIBRATION CHOICE, and it is calibrated to the recent era: 2.4e-17 = 2.07x fair, which sits
// between the 2021 and 2025 tops. The prior 10 ** -16.12 (6.54x fair) was calibrated to the 2017
// tops and by now overstates the upside ~3.2x — the dangerous direction for a leverage tool, since
// an inflated upside makes a levered plan look safer than it is. Burger's own resistance line uses
// a SHALLOWER exponent (5.029 vs 5.845) so it converges on its own; matching that would mean each
// band carrying its own B as well as its own A. Until then, expect to revisit this each cycle.
export const PL_A_CEILING = 2.4e-17;
export const GENESIS      = new Date('2009-01-03T00:00:00Z');

export function daysSinceGenesis(date: Date): number {
  return Math.floor((date.getTime() - GENESIS.getTime()) / 86_400_000);
}

export function plFairValue(date: Date): number {
  return PL_A_FAIR * Math.pow(daysSinceGenesis(date), PL_B);
}

export function plFloor(date: Date): number {
  return PL_A_FLOOR * Math.pow(daysSinceGenesis(date), PL_B);
}

export function plCeiling(date: Date): number {
  return PL_A_CEILING * Math.pow(daysSinceGenesis(date), PL_B);
}

// ── Band bundle + convergence price path (Almanac Cycling face) ───────────────────────────────────
// 🔴 §2 ISOLATION WALL: this module still imports NOTHING. The Cycling face's VIEW imports these and
// hands the resulting plain `number[]` to cyclingSim.ts, which has never heard of the power law —
// the same sanctioned crossing OutlookProjection/MonthBreakdown already use for their growth rate.

export type PlBand = 'floor' | 'fair' | 'ceiling';

/**
 * The ONE user-facing word for each band. The KEYS stay `floor`/`fair`/`ceiling` — renaming them
 * would ripple through every consumer for no functional gain — but nothing should ever render a key.
 * Views that printed `{band}` directly were leaking 'ceiling' into a sentence that says "Resistance"
 * two lines above it. Import this instead, so the vocabulary can't drift per component again.
 * (Still zero imports — this is data, not UI.)
 */
export const PL_BAND_LABEL: Record<PlBand, string> = {
  floor: 'Support',
  fair: 'Fair',
  ceiling: 'Resistance',
};

/** The three band prices at a date. Each uses its OWN independent A constant — never PL_A_FAIR × scalar. */
export function plBandsAt(date: Date): Record<PlBand, number> {
  return { floor: plFloor(date), fair: plFairValue(date), ceiling: plCeiling(date) };
}

/**
 * Calendar month arithmetic, UTC, day-of-month clamped (31 Jan + 1mo → 28/29 Feb). Local helper so the
 * module keeps zero imports; UTC accessors match GENESIS (…T00:00:00Z) and daysSinceGenesis.
 * Callers normalise their start date to UTC midnight — a local-midnight start west of UTC would land on
 * the previous UTC day and shift every band value by one day.
 */
function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), daysInTarget));
  return target;
}

/**
 * Price path that starts at `anchorPrice` (the live price — a FACT) and converges geometrically toward
 * the selected power-law band (a BELIEF — a destination, not a starting point) over `convergeMonths`.
 *
 *   m = 0                → exactly anchorPrice
 *   m >= convergeMonths  → exactly the band value at that date
 *
 * ⚠ The bands must be destinations, not anchors. A naive `anchor × (days_m / days_0) ** PL_B` carries no
 * band coefficient at all, so all three bands share one growth ratio and produce IDENTICAL simulations —
 * the band buttons would do nothing. The log-space weight is what makes them diverge.
 *
 * ⚠ m === 0 is special-cased deliberately: computing it arithmetically drifts ~0.3% off the anchor
 * through day-of-month clamping, and month 0 must equal the live price EXACTLY or the face disagrees
 * with the SafetyDashboard the moment it opens.
 */
export function plConvergencePath(
  anchorPrice: number,
  band: PlBand,
  startDate: Date,
  months: number,
  convergeMonths: number,
): number[] {
  const n = Math.max(0, Math.floor(months));
  const b0 = plBandsAt(startDate)[band];
  if (!(anchorPrice > 0) || !(b0 > 0) || convergeMonths <= 0) {
    return new Array(n + 1).fill(anchorPrice);
  }
  const logRatio0 = Math.log(anchorPrice / b0);
  const out: number[] = [];
  for (let m = 0; m <= n; m++) {
    if (m === 0) { out.push(anchorPrice); continue; }   // exactness, not arithmetic
    const bm = plBandsAt(addMonths(startDate, m))[band];
    const w = Math.max(0, 1 - m / convergeMonths);
    out.push(bm * Math.exp(logRatio0 * w));
  }
  return out;
}
