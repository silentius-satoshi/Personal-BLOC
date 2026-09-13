/**
 * The 4-year cycle price path — the Almanac Cycling and Ownership faces' fourth path kind, `'fourYear'`.
 *
 * Composes two BELIEF leaves the repo already ships and had never multiplied together:
 *   • powerLaw   — the fair line (the trend) and the support line (the fitted cycle-bottom floor);
 *   • cycleModel — the idealized turn schedule, CYCLE_TURNS (364-day falls, 1064-day rises).
 * Price at a date = plFairValue(date) × cycleMultAt(date): tops on the fair line, troughs on the support
 * line, log-linear in between.
 *
 * WHY IT EXISTS. plConvergencePath converges onto one band and then rides it monotonically, so over the
 * default horizon the Support path's deepest drawdown after month 1 is exactly 0% — it cannot fall.
 * Liquidation is a PATH property, not an endpoint property, so a monotone path never exercises the CB LTV
 * stop or the defense cascade, and never shows what the cold-storage sweep costs (coins moved to cold near
 * a peak are collateral the next bear no longer has).
 *
 * 🔴 §2 WALL. This module imports from BOTH belief leaves so that neither leaf gains an import — powerLaw
 * and cycleModel both stay zero-import. It is a belief, never a fact: nothing in the risk core (cyclingSim,
 * cbMetrics, emergencyModel, runAdvisor, safetyView, the store) may import it. The VIEW builds the path and
 * hands the engine a plain number[], exactly as it does with plConvergencePath.
 *
 * NAMING — a deliberate asymmetry, do not "harmonize" it. The MODEL is the cycle, so this file is
 * cyclePath.ts and its constants are CYCLE_*. The USER-FACING choice is 'fourYear' / "4-yr cycle", because
 * 'cycle' is already a CyclingMode value and OwnershipFace renders a Strategy button labelled "Cycle" on the
 * same card as the price-path picker.
 */
import { PL_A_FAIR, PL_A_FLOOR, plFairValue, addMonths, type PlBand } from './powerLaw';
import { CYCLE_TURNS } from './cycleModel';

export type PathKind = PlBand | 'fourYear';

/**
 * Cycle troughs, as a multiple of the FAIR line. DERIVED, never hard-coded: the trough IS the support line
 * by construction, so the power-law model and the cycle model can never disagree about where the bottom is,
 * and the one band fitted to actual cycle bottoms does double duty.
 */
export const CYCLE_LOW_MULT = PL_A_FLOOR / PL_A_FAIR;

/**
 * Cycle tops, as a multiple of the FAIR line.
 *
 * Tops decay toward the trend every cycle. Measured against the fair line they ran 19.3× (2011), 11.6×
 * (2013), 6.0× (2017), 2.5× (2021), 0.99× (Oct 2025) — roughly 40–60% of the prior top each time. By the
 * most recent observation tops have arrived AT the trend, so 1.00 is calibrated to the Oct-2025 top and is a
 * CALIBRATION CHOICE, exactly like PL_A_CEILING. Expect to revisit it each cycle.
 *
 * ⚠ PL_A_CEILING (2.07× fair) plays NO role here. It is a resistance line, not a cycle envelope; peaking
 * there would overstate the next top ~2× — the dangerous direction for a leverage tool, since an inflated
 * upside makes a levered plan look safer than it is.
 *
 * Because tops compress toward the trend, this model predicts SHALLOWER bears than history (−52%, not
 * −77%). That is internally coherent — a 77% drawdown came from a 2.5×-fair top falling to 0.36× fair —
 * and it is falsifiable. It is not a bug to "fix".
 */
export const CYCLE_TOP_MULT = 1.0;

/** The phase-shift control's range, in months either way. */
export const CYCLE_PHASE_SHIFT_MAX_MONTHS = 12;

/**
 * ⚠ THE PHASE SHIFT IS A FIXED NUMBER OF MILLISECONDS, NOT addMonths. One shifted month is the mean
 * Gregorian month, 30.4375 days = 2,629,800,000 ms — a whole number, so a shift and its inverse round-trip
 * exactly. addMonths clamps day-of-month and so is NOT invertible: shiftedCycleTurns moves turns FORWARD
 * while cycleMultAt moves its probe BACK, and on the 2034-07-31 turn an addMonths shift makes the two
 * disagree for 5 of 12 shift values (by up to 3 days). Milestones would then mark a row where cycleMultAt is
 * not actually at the extremum. With a millisecond offset the two consumers agree by construction.
 */
export const CYCLE_SHIFT_MONTH_MS = 30.4375 * 86_400_000;

export interface CycleTurnAt {
  date: Date;
  kind: 'high' | 'low';
}

export interface HorizonTurn extends CycleTurnAt {
  /** The Milestones row the turn is marked on (≥ 1 — see cycleTurnsInHorizon). */
  month: number;
}

const multOf = (kind: 'high' | 'low'): number => (kind === 'high' ? CYCLE_TOP_MULT : CYCLE_LOW_MULT);

/**
 * The cycle multiple of the FAIR line at `date`: CYCLE_TOP_MULT at a high turn, CYCLE_LOW_MULT at a low
 * turn, log-linear in days between the two turns that bracket it.
 *
 * `phaseShiftMonths` shifts the PROBE, never the schedule: the probe is `date − shift × CYCLE_SHIFT_MONTH_MS`,
 * so a POSITIVE shift means the cycle runs LATE.
 */
export function cycleMultAt(date: Date, phaseShiftMonths = 0): number {
  const probe = date.getTime() - phaseShiftMonths * CYCLE_SHIFT_MONTH_MS;
  // A NaN here would poison the whole path and every downstream LTV — fall back to the fair line instead.
  if (!Number.isFinite(probe)) return CYCLE_TOP_MULT;

  // Clamp outside the schedule (CYCLE_TURNS runs to 2050-03-21). ⚠ A `+N mo late` shift makes the earliest
  // months probe dates BEFORE the first turn (the Oct-2025 top), where this clamps to CYCLE_TOP_MULT rather
  // than rising toward it. Negligible — month 0 is pinned to the live price anyway — but not obvious here.
  const first = CYCLE_TURNS[0];
  const last = CYCLE_TURNS[CYCLE_TURNS.length - 1];
  if (probe <= first.date) return multOf(first.kind);
  if (probe >= last.date) return multOf(last.kind);

  for (let i = 1; i < CYCLE_TURNS.length; i++) {
    const b = CYCLE_TURNS[i];
    // Exact turn hit: return the turn's own multiple rather than trusting exp(log(x)) to round-trip. It
    // happens to be exact for CYCLE_LOW_MULT today; the shortcut keeps that from resting on an accident.
    if (probe === b.date) return multOf(b.kind);
    if (probe < b.date) {
      const a = CYCLE_TURNS[i - 1];
      const t = (probe - a.date) / (b.date - a.date);
      const la = Math.log(multOf(a.kind));
      const lb = Math.log(multOf(b.kind));
      return Math.exp(la + t * (lb - la));
    }
  }
  return multOf(last.kind);
}

/**
 * Price path that starts at `anchorPrice` (the live price — a FACT) and converges geometrically toward the
 * cycle curve (a BELIEF) over `convergeMonths`. A STRUCTURAL MIRROR of plConvergencePath — same guard, same
 * m === 0 special case, same log-space weight — with the cycle curve as the destination instead of a band.
 *
 * ⚠ m === 0 is special-cased deliberately (as in plConvergencePath): month 0 must equal the live price
 * EXACTLY, or the face disagrees with the SafetyDashboard the moment it opens.
 */
export function cycleConvergencePath(
  anchorPrice: number,
  startDate: Date,
  months: number,
  convergeMonths: number,
  phaseShiftMonths = 0,
): number[] {
  const n = Math.max(0, Math.floor(months));
  const destination0 = plFairValue(startDate) * cycleMultAt(startDate, phaseShiftMonths);
  if (!(anchorPrice > 0) || !(destination0 > 0) || convergeMonths <= 0) {
    return new Array(n + 1).fill(anchorPrice);
  }
  const logRatio0 = Math.log(anchorPrice / destination0);
  const out: number[] = [];
  for (let m = 0; m <= n; m++) {
    if (m === 0) { out.push(anchorPrice); continue; }   // exactness, not arithmetic
    const dm = addMonths(startDate, m);
    const destination = plFairValue(dm) * cycleMultAt(dm, phaseShiftMonths);
    const w = Math.max(0, 1 - m / convergeMonths);
    out.push(destination * Math.exp(logRatio0 * w));
  }
  return out;
}

/**
 * The FULL shifted schedule — unclipped. The single source both the Milestones turn rows and the path note
 * derive from, so the two can never disagree. Each turn moves by exactly `shift × CYCLE_SHIFT_MONTH_MS`, the
 * inverse of cycleMultAt's probe shift, so `cycleMultAt(shiftedCycleTurns(n)[i].date, n)` lands exactly on
 * the turn. A non-finite shift returns the unshifted schedule rather than a list of Invalid Dates.
 */
export function shiftedCycleTurns(phaseShiftMonths = 0): CycleTurnAt[] {
  const offset = Number.isFinite(phaseShiftMonths) ? phaseShiftMonths * CYCLE_SHIFT_MONTH_MS : 0;
  return CYCLE_TURNS.map((t) => ({ date: new Date(t.date + offset), kind: t.kind }));
}

/**
 * The next `count` shifted turns strictly after `after`, from the UNCLIPPED schedule — what the path note
 * names ("next low …, next high …").
 *
 * ⚠ Never derive the path note from cycleTurnsInHorizon: the Horizon slider's minimum is 12 months, and a
 * 12-month horizon from mid-September 2026 holds only the October low, so "next high" would silently vanish.
 */
export function upcomingCycleTurns(after: Date, count: number, phaseShiftMonths = 0): CycleTurnAt[] {
  const t0 = after.getTime();
  return shiftedCycleTurns(phaseShiftMonths).filter((t) => t.date.getTime() > t0).slice(0, Math.max(0, count));
}

/**
 * The shifted turns that fall inside `[startDate, addMonths(startDate, months)]`, each mapped to the NEAREST
 * Milestones row.
 *
 * - Ties go to the LATER row. They are real: for the 2026-10-05 low, a 2026-09-20 start puts the turn exactly
 *   15 days from row 0 and from row 1, and a 2026-08-20 start puts it exactly 15 days from rows 1 and 2.
 * - ⚠ A turn nearest row 0 SNAPS to row 1 — it is never dropped. Row 0 is the live spot price, not the
 *   model, so it must never carry a "trough" label; but dropping the turn would hide the most imminent
 *   trough, and the path note (which reads the unclipped schedule) would still name it. Snapping costs
 *   16–31 days of date error, so every turn row must display the turn's real `date`.
 * - No turn-vs-turn de-duplication: turns are ≥ 364 days apart and rows one month apart, so two turns can
 *   never share a row.
 */
export function cycleTurnsInHorizon(startDate: Date, months: number, phaseShiftMonths = 0): HorizonTurn[] {
  const n = Math.max(0, Math.floor(months));
  if (n < 1) return [];
  const rowMs: number[] = [];
  for (let m = 0; m <= n; m++) rowMs.push(addMonths(startDate, m).getTime());
  const lo = rowMs[0];
  const hi = rowMs[n];

  const out: HorizonTurn[] = [];
  for (const t of shiftedCycleTurns(phaseShiftMonths)) {
    const ms = t.date.getTime();
    if (ms < lo || ms > hi) continue;
    // Rows ascend, so distance to the turn is V-shaped: `<=` walks to the LAST row at the minimum distance,
    // which is the later-row tie-break.
    let nearest = 0;
    for (let m = 1; m <= n; m++) {
      if (Math.abs(rowMs[m] - ms) <= Math.abs(rowMs[nearest] - ms)) nearest = m;
    }
    out.push({ month: Math.max(1, nearest), kind: t.kind, date: t.date });
  }
  return out;
}
