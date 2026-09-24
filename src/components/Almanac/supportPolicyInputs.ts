import { plBandAt } from '../../simulation/powerLaw';
import type { CyclingMode, SupportPolicyInputs } from '../../simulation/cyclingSim';
import { STRIKE_CURE_LTV, STRIKE_RETRIEVE_MAX_LTV } from '../../simulation/strikeCredit';
import { strikeLiqLtvOf } from './cyclingFaceView';
import { DEFAULT_BREAKER_REARM_MONTHS, type EffectivePolicySettings } from './supportPolicyView';

/**
 * The faces' ONE §2 crossing for the support-anchored policy (Run 2). The ONLY module in `src/components/` that
 * builds a support path, so it may import the power law; the view helpers may not (the cyclingFaceView rule).
 *
 * 🔴 The support path is a BELIEF handed to the engine as a plain `number[]`. A face builds it here and nowhere else,
 * and never stresses or phase-shifts it: the stress lens moves the price, not the line.
 */

/** support[m] = `plBandAt('floor', startDate, m)` for m = 0..max(0, floor(months)) — the SAME function the price path
 *  and the faces' "Support line at this month" readout use, so it is bit-aligned with an on-the-line price path.
 *  A non-finite horizon gives month 0 only. */
export function buildSupportPath(startDate: Date, months: number): number[] {
  const n = Number.isFinite(months) ? Math.max(0, Math.floor(months)) : 0;
  return Array.from({ length: n + 1 }, (_, m) => plBandAt('floor', startDate, m));
}

/**
 * The engine's policy input, as a face builds it — `undefined` when the policy is off or the mode is not `cycle` (the
 * engine then runs byte-identically to today). The stops, zones and buffer come from the range-clamped settings; the
 * engine clamps the stops to the defense lines itself, through the same `effectivePolicyStops` the readout uses.
 * The cash reserve is months of the face's effective bills. The re-arm key is present only while
 * `DEFAULT_BREAKER_REARM_MONTHS` is defined, so a latched run is the same object shape as Run 1's.
 * It never sets the engine's test-only inputs.
 */
export function supportPolicyFor(
  settings: EffectivePolicySettings,
  supportPath: number[],
  expenses: number,
  strikeLiquidationLtvPct: number,
  mode: CyclingMode,
): SupportPolicyInputs | undefined {
  if (!settings.enabled || mode !== 'cycle') return undefined;
  const bills = Number.isFinite(expenses) && expenses > 0 ? expenses : 0;
  const policy: SupportPolicyInputs = {
    supportPath,
    cbStopAtSupportPct: settings.cbStopAtSupportPct,
    strikeStopAtSupportPct: settings.strikeStopAtSupportPct,
    accumulateBelow: settings.accumulateBelow,
    payDownAbove: settings.payDownAbove,
    bearBufferMonths: settings.bearBufferMonths,
    openingCashUsd: settings.cashReserveMonths * bills,
    strikeCureLtv: STRIKE_CURE_LTV,
    strikePartialLiqLtv: strikeLiqLtvOf(strikeLiquidationLtvPct),
    strikeRetrieveMaxLtv: STRIKE_RETRIEVE_MAX_LTV,
  };
  if (DEFAULT_BREAKER_REARM_MONTHS !== undefined) policy.breakerRearmMonths = DEFAULT_BREAKER_REARM_MONTHS;
  return policy;
}
