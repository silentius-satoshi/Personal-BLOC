import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { SupportPolicySliders } from '../Almanac/SupportPolicyCard';
import { DEFAULT_SUPPORT_POLICY_SETTINGS, effectivePolicySettings } from '../Almanac/supportPolicyView';
import { usePlanPolicy } from '../Almanac/usePlanPolicy';
import { PLAN_CLAMP } from '../Almanac/planClamp';
import { planGoalOf, parseGoalInput } from '../../lib/planGoal';
import inputStyles from '../ui/NumberInput.module.css';
import goalStyles from './YourPlanSection.module.css';

/** BL14 — the goal's words in Settings (the rule BL14 decided, said once). δ-L9: the bills go income → cash reserve →
 *  unpaid (the engine's own order in a month that doesn't borrow); a loan over its limit is repaid first; and a crash
 *  defense still runs — the only borrowing at the goal. */
export const GOAL_HINT =
  'Net coins: every coin you hold — on Strike, on Coinbase and in cold storage — minus what you owe, in bitcoin at the '
  + "month's price. At your goal the plan buys nothing and borrows only to defend Coinbase in a crash: your paycheck pays "
  + "the bills, then your cash reserve if you set one, and any they can't cover go unpaid; spare income repays a loan "
  + 'over its limit first, then Strike, then Coinbase, and once both are repaid it stays with you. If a price drop takes '
  + 'you back under the goal while a loan is open, borrowing and buying resume. Empty: no goal.';
export const GOAL_BAD = 'Type an amount of bitcoin above zero, like 2 or 0.5 — or leave it empty for no goal.';
export const GOAL_CLEAR = 'No goal';

/** The goal as the field shows it: empty for none, else the satoshi-exact figure without float noise. */
const goalText = (g: number | null): string => (g === null ? '' : String(g));

/**
 * BL14 (Batch 1, build 2) — "Your goal": one field, saved when it is left or Enter is pressed — never on each keystroke, so
 * typing "2.5" never sends "2" and "2." to the plan (and the sync). Empty clears it; anything that isn't an amount above
 * zero changes nothing and says so.
 */
function GoalField() {
  const goal = useStore((s) => planGoalOf(s.planGoalNetBtc));
  const setGoal = useStore((s) => s.setPlanGoalNetBtc);
  const [raw, setRaw] = useState(goalText(goal));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  // Another device's edit (or a restore) lands while the field isn't being typed in: show it.
  useEffect(() => { if (!focused.current) setRaw(goalText(goal)); }, [goal]);
  // δ-L10 — the field shows what the plan KEPT: an edit refused before the plan loads (5c) snaps back, as the sliders do.
  const shown = () => goalText(planGoalOf(useStore.getState().planGoalNetBtc));
  const commit = () => {
    const v = parseGoalInput(raw);
    if (v === undefined) { setBad(true); return; }
    setBad(false);
    setGoal(v);
    setRaw(shown());
  };
  return (
    <div className={goalStyles.goalField}>
      <div className={inputStyles.root}>
        <span className={inputStyles.label}>Your goal — net coins</span>
        <div className={inputStyles.inputWrap}>
          <span className={inputStyles.prefix}>₿</span>
          <input
            type="text"
            inputMode="decimal"
            className={inputStyles.input}
            value={raw}
            placeholder={GOAL_CLEAR}
            aria-label="Your goal in net coins"
            aria-invalid={bad}
            onChange={(e) => { setRaw(e.target.value); setBad(false); }}
            onFocus={() => { focused.current = true; }}
            onBlur={() => { focused.current = false; commit(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
          />
        </div>
      </div>
      {goal !== null && (
        <button type="button" className={goalStyles.goalBtn} onClick={() => { setBad(false); setGoal(null); setRaw(shown()); }}>
          {GOAL_CLEAR}
        </button>
      )}
      {bad && <p className={goalStyles.goalBad} role="alert">{GOAL_BAD}</p>}
    </div>
  );
}

/**
 * Settings → "Your plan" — the plan of record's ONE editor (Run 1, D2). The owner's SAVED support policy: the faces'
 * own six sliders over the saved plan itself, read through the plan's one clamp (planClamp.ts). "Back to the defaults
 * (C1)" emits all six; there is no off switch (D1 — policy-off is a face what-if). Every Almanac face starts from what
 * is set here, and a face's sliders stay a what-if that never writes it. BL14: and the plan's goal, in net coins.
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
      {/* BL14 (Batch 1, build 2) — the plan's goal amount, synced with the plan like the six above. */}
      <div className={styles.setupGroup}>
        <div className={styles.setupGroupLabel}>GOAL</div>
        <p className={styles.fieldHint}>{GOAL_HINT}</p>
        <GoalField />
      </div>
    </div>
  );
}
