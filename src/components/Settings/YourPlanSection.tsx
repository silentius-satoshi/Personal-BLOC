import { useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { SupportPolicySliders } from '../Almanac/SupportPolicyCard';
import { DEFAULT_SUPPORT_POLICY_SETTINGS, effectivePolicySettings } from '../Almanac/supportPolicyView';
import { usePlanPolicy } from '../Almanac/usePlanPolicy';
import { PLAN_CLAMP } from '../Almanac/planClamp';

/**
 * Settings → "Your plan" — the plan of record's ONE editor (Run 1, D2). The owner's SAVED support policy: the faces'
 * own six sliders over the saved plan itself, read through the plan's one clamp (planClamp.ts). "Back to the defaults
 * (C1)" emits all six; there is no off switch (D1 — policy-off is a face what-if). Every Almanac face starts from what
 * is set here, and a face's sliders stay a what-if that never writes it.
 * ⚠ Owner-only: SettingsMain mounts it inside its `!viewerMode` tree. `emitPlanSets` has no viewer guard of its own, so
 * a viewer must never reach this section.
 */
export default function YourPlanSection({ styles }: { styles: Record<string, string> }) {
  const plan = usePlanPolicy();
  const expenses = useStore((s) => s.expenses);
  const setPlanPolicy = useStore((s) => s.setPlanPolicy);
  const resetPlanPolicy = useStore((s) => s.resetPlanPolicy);
  const raw = useMemo(() => ({ ...DEFAULT_SUPPORT_POLICY_SETTINGS, ...plan }), [plan]);
  const settings = useMemo(() => effectivePolicySettings(raw, PLAN_CLAMP), [raw]);
  return (
    <div className={styles.section}>
      <div className={styles.setupGroup}>
        <div className={styles.setupGroupLabel}>SUPPORT POLICY</div>
        <p className={styles.fieldHint}>
          The limits and zones your plan follows, synced with your plan. The Almanac faces start from them; a face's
          sliders are a what-if that never changes them.
        </p>
        <SupportPolicySliders
          raw={raw} settings={settings} onChange={setPlanPolicy} onReset={resetPlanPolicy} expenses={expenses}
          resetLabel="Back to the defaults (C1)" offSwitch={false}
        />
      </div>
    </div>
  );
}
