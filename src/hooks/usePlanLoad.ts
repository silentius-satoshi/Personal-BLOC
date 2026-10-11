// 5c (spec `pbloc-spec-plan-load-guard-v1`) — the plan-load state for the screens: is this device waiting for the plan
// (planLoad.planMissing — the store-side guard refuses the writes; these let the screens say so first), what did the
// last plan pull find, in plain words, and the one way a person ends the wait when the relays hold nothing: "Start a new
// plan".
import { useSyncExternalStore } from 'react';
import { useStore } from '../store/useStore';
import { isBackupGateSatisfied } from '../lib/backupGate';
import { getPlanPull, subscribePlanPull, planMissing, type PlanPull } from '../lib/nostr/planLoad';

/** True while this device must not write what depends on the plan. */
export function usePlanMissing(): boolean {
  return useStore((s) => planMissing(s));
}

/** The last plan pull's outcome (session state). */
export function usePlanPull(): PlanPull {
  return useSyncExternalStore(subscribePlanPull, getPlanPull, getPlanPull);
}

export const PLAN_NOT_LOADED_TITLE = 'Your plan hasn’t loaded on this device';

/** Why — in the person's words, not the protocol's. Null while no pull has settled it (and the key isn't waiting on its
 *  backup — a generated key that isn't backed up never pulls, so nothing else would ever say why). */
export function planNotLoadedWhy(p: PlanPull, backupGated = false): string | null {
  switch (p.status) {
    case 'unreadable':
      if (p.reason === 'decrypt') return 'This device’s signer couldn’t decrypt the plan saved on your relays.';
      if (p.reason === 'not-reached') return 'The sync stopped before it could read your plan.';
      if (p.reason === 'absent') return 'Your relays hold your journal but no plan — if none of your devices has it, restore a plan backup (Settings → Backup).';
      return 'The plan saved on your relays couldn’t be read on this device.';
    case 'unreachable':
      return 'Your relays couldn’t be reached to load your plan.';
    case 'none':
      return 'Your relays answered, but hold no plan for this key.';
    default:
      return backupGated ? 'Back up your Recovery Key first — until then this device can’t load your plan.' : null;
  }
}

/** planNotLoadedWhy for the screens: the last pull, and whether this key waits on its backup. */
export function usePlanNotLoadedWhy(): string | null {
  const pull = usePlanPull();
  const gated = useStore((s) => !isBackupGateSatisfied(s));
  return planNotLoadedWhy(pull, gated);
}

export const PLAN_NOT_LOADED_BODY =
  'Until it loads, this device won’t change your journal or your plan, so nothing is lost or overwritten. '
  + 'Open the app on a device where your plan loads, or try ↻ Sync now.';

/** After a pull that found nothing at all: a new key — or relays that didn't show the plan. Only the owner knows which. */
export const NO_PLAN_BODY =
  'If this key is new, start your plan here. If you expected your plan, don’t — open the app where it loads, '
  + 'or check your relays (Settings → Network).';

export const START_NEW_PLAN_LABEL = 'Start a new plan';

export const START_NEW_PLAN_CONFIRM =
  'Start a new plan on this key? Only if this key has never had one. If you expected your plan, it hasn’t loaded — '
  + 'starting a new one here could overwrite it once it does.';

/** The one way a person ends the wait: a pull found no plan and no journal for this key, and its owner says it's new.
 *  Only then (and only while waiting) — and only after a confirm. Returns whether the plan was started. */
export function startNewPlanHere(confirm: (msg: string) => boolean = (m) => window.confirm(m)): boolean {
  const s = useStore.getState();
  if (!planMissing(s) || getPlanPull().status !== 'none') return false;
  if (!confirm(START_NEW_PLAN_CONFIRM)) return false;
  s.setPlanLoaded(true);
  return true;
}

/** The one line the logging screens show while they're paused. */
export const LOGGING_PAUSED = 'Logging is paused until your plan loads on this device.';
