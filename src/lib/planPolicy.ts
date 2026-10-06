// The plan of record (Run 1, spec `pbloc-spec-plan-of-record-v1` D1) — the support policy's settings as the owner's
// SAVED plan: six synced plan fields on plan-events:v1. PURE, ZERO imports (the backupGate.ts precedent), so the store,
// the faces, Settings and the Emergency Console read ONE source. The C1 defaults (BL6) and the slider ranges live HERE;
// supportPolicyView re-exports them as DEFAULT_SUPPORT_POLICY_SETTINGS (plus `enabled`, a face what-if only) and
// SUPPORT_POLICY_RANGES.
//
// ⚠ No off switch in the plan (D1): policy-off stays a what-if on the faces, so there is no seventh field.
// ⚠ One flat key per setting: the persist `merge` is shallow, and one key per setting makes one event per change, so two
//   devices editing different settings fold cleanly. Absent from the log = the C1 default (spec §4.1).

export interface PlanPolicySettings {
  cbStopAtSupportPct: number;
  strikeStopAtSupportPct: number;
  accumulateBelow: number;
  payDownAbove: number;
  bearBufferMonths: number;
  cashReserveMonths: number;
}

/** C1 (BL6): Coinbase 45% and Strike 50% at support, buy with the line up to 2.0× support, pay down above 3.0×,
 *  12 months of borrowing room kept, no cash reserve. */
export const PLAN_POLICY_DEFAULTS: Readonly<PlanPolicySettings> = Object.freeze({
  cbStopAtSupportPct: 45,
  strikeStopAtSupportPct: 50,
  accumulateBelow: 2.0,
  payDownAbove: 3.0,
  bearBufferMonths: 12,
  cashReserveMonths: 0,
});

/** The sliders' ranges — the plan's clamp on write, and the faces' clamp at run time (effectivePolicySettings). */
export const PLAN_POLICY_RANGES = {
  cbStopAtSupportPct:     { min: 40,  max: 70,  step: 1 },
  strikeStopAtSupportPct: { min: 30,  max: 60,  step: 1 },
  accumulateBelow:        { min: 1.0, max: 2.5, step: 0.05 },
  payDownAbove:           { min: 1.5, max: 5.0, step: 0.05 },
  bearBufferMonths:       { min: 0,   max: 48,  step: 1 },
  cashReserveMonths:      { min: 0,   max: 12,  step: 1 },
} as const;

/** Each setting's store field. */
export const PLAN_POLICY_FIELD = {
  cbStopAtSupportPct:     'policyCbStopAtSupportPct',
  strikeStopAtSupportPct: 'policyStrikeStopAtSupportPct',
  accumulateBelow:        'policyAccumulateBelow',
  payDownAbove:           'policyPayDownAbove',
  bearBufferMonths:       'policyBearBufferMonths',
  cashReserveMonths:      'policyCashReserveMonths',
} as const;

export type PlanPolicyKey = keyof PlanPolicySettings;
export type PlanPolicyField = (typeof PLAN_POLICY_FIELD)[PlanPolicyKey];

export const PLAN_POLICY_KEYS: readonly PlanPolicyKey[] = Object.freeze(Object.keys(PLAN_POLICY_FIELD) as PlanPolicyKey[]);

/** The six store fields at their defaults — the seed resets (clearViewerData, resetPlanToSeeds) spread it. */
export const PLAN_POLICY_SEED: Readonly<Record<PlanPolicyField, number>> = Object.freeze(
  Object.fromEntries(PLAN_POLICY_KEYS.map((k) => [PLAN_POLICY_FIELD[k], PLAN_POLICY_DEFAULTS[k]])) as Record<PlanPolicyField, number>,
);

/** Into its range; junk (not a finite number) → the default. The same rule as the faces' run-time clamp; the pay-down
 *  push (≥ accumulateBelow + 0.1) stays the faces' run-time rule, so a saved pair can never read differently. */
export function clampPlanPolicy(k: PlanPolicyKey, v: unknown): number {
  const r = PLAN_POLICY_RANGES[k];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : PLAN_POLICY_DEFAULTS[k];
}

/** The plan's six settings, read from store-shaped state THROUGH the clamp — so every reader (the faces, Settings, the
 *  console) sees the same in-range plan. The write clamps already; this covers what no setter wrote: a backup restore
 *  (its validator checks keys, never values). */
export function planPolicyOf(s: Readonly<Record<PlanPolicyField, unknown>>): PlanPolicySettings {
  return {
    cbStopAtSupportPct:     clampPlanPolicy('cbStopAtSupportPct',     s.policyCbStopAtSupportPct),
    strikeStopAtSupportPct: clampPlanPolicy('strikeStopAtSupportPct', s.policyStrikeStopAtSupportPct),
    accumulateBelow:        clampPlanPolicy('accumulateBelow',        s.policyAccumulateBelow),
    payDownAbove:           clampPlanPolicy('payDownAbove',           s.policyPayDownAbove),
    bearBufferMonths:       clampPlanPolicy('bearBufferMonths',       s.policyBearBufferMonths),
    cashReserveMonths:      clampPlanPolicy('cashReserveMonths',      s.policyCashReserveMonths),
  };
}
