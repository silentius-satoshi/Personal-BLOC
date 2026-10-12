// 5c (spec `pbloc-spec-plan-load-guard-v1`) — Settings › SYNC: this device hasn't loaded the plan, why, and what that
// means, in plain words. When the relays answered with nothing at all, it offers the one way out a person decides:
// "Start a new plan". Renders nothing once the plan is loaded (or while no pull has settled why).
import {
  usePlanMissing, usePlanPull, usePlanNotLoadedWhy, startNewPlanHere,
  PLAN_NOT_LOADED_TITLE, PLAN_NOT_LOADED_BODY, NO_PLAN_BODY, START_NEW_PLAN_LABEL,
} from '../../hooks/usePlanLoad';
import styles from './SettingsMain.module.css';

export function PlanNotLoadedNotice() {
  const missing = usePlanMissing();
  const pull = usePlanPull();
  const why = usePlanNotLoadedWhy();
  if (!missing || !why) return null;
  const none = pull.status === 'none';
  return (
    <div className={styles.syncWarn} role="status">
      <span className={styles.syncWarnTitle}>⚠ {PLAN_NOT_LOADED_TITLE}</span>
      <span className={styles.syncWarnBody}>{why}</span>
      <span className={styles.syncWarnBody}>{none ? NO_PLAN_BODY : PLAN_NOT_LOADED_BODY}</span>
      {none && (
        <button className={styles.syncButton} onClick={() => { startNewPlanHere(); }}>{START_NEW_PLAN_LABEL}</button>
      )}
    </div>
  );
}
