import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { planPolicyOf, type PlanPolicySettings } from '../../lib/planPolicy';

/**
 * The owner's SAVED support policy — the plan of record (Run 1, D1). Every face starts its policy from it:
 * `{ ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...plan, ...overlay.supportPolicy }` — so a face's sliders are a what-if over
 * the plan, "Back to your plan" drops the what-if, and no face ever writes the plan (D2; Settings' "Your plan" does).
 * A read-only hook: the six fields through `useShallow`, so the object keeps its identity until one of them changes.
 */
export function usePlanPolicy(): PlanPolicySettings {
  return useStore(useShallow((st) => planPolicyOf(st)));
}
