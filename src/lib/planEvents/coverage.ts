// Phase 4e — plan-log COVERAGE (read-only telemetry for DevPanel). Since 4e the plan log is the only plan channel: a
// new device, or an escape-hatch reset, rebuilds the plan from the fold alone, so a plan field this device holds at a
// non-seed value that the log never carried comes back as its SEED there. Parity can't see it (it compares fold-present
// keys only); before 4e the settings:v1 bridge carried such a field. Names only (DevPanel's metadata rule). Expected on
// an owner device: none — or backupVerifiedAt (a pre-auth stamp rides no channel, F14) or nostrRelays (discovered
// relays stay device-local). Anything else: re-save that field once so it emits.
import { PLAN_EVENT_FIELDS } from '../../store/settingsFields';
import { foldPlanEvents } from './fold';
import type { PlanEvent } from './types';

export function planLogGaps(
  events: PlanEvent[],
  live: Record<string, unknown>,
  seed: Record<string, unknown>,
): string[] {
  const folded = foldPlanEvents(events) as Record<string, unknown>;
  return PLAN_EVENT_FIELDS.filter((f) => !(f in folded) && JSON.stringify(live[f]) !== JSON.stringify(seed[f]));
}
