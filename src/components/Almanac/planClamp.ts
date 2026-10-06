import { effectiveStrikeCapPct } from '../../simulation/cyclingSim';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { DEFAULT_STRIKE_CAP_PCT, DEFAULT_STRIKE_CAP_ON } from './cyclingFaceView';

/**
 * The plan of record's ONE clamp (spec §4.2) — the Decision face's engine context: Coinbase defended at 70%, Strike's
 * cap at its default. The Decision face runs on it; Settings' "Your plan" reads the plan's effective stops through it
 * (Run 1), and the main screens will (Run 2). A parent face's own cap slider stays a what-if on that face.
 */
export const PLAN_CB_LTV_CAP_PCT = 70;
export const PLAN_STRIKE_CAP_PCT = DEFAULT_STRIKE_CAP_ON ? DEFAULT_STRIKE_CAP_PCT : 0;
export const PLAN_STRIKE_CAP_EFF = effectiveStrikeCapPct(PLAN_STRIKE_CAP_PCT, STRIKE_MARGIN_CALL_LTV);
export const PLAN_CLAMP: Readonly<{ cbLtvCapPct: number; strikeCapEffPct: number }> = Object.freeze({
  cbLtvCapPct: PLAN_CB_LTV_CAP_PCT,
  strikeCapEffPct: PLAN_STRIKE_CAP_EFF,
});
