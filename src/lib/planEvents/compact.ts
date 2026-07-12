// Phase 4b — plan-events pure core: compaction. Design authority: phase-4a-plan-events-design-lock §7.
// Pure, node-testable, no store/runtime dependency (types only).
import type { PlanEvent } from './types';

const SUPERSEDED_TTL_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days — mirror of mergeRecords TOMBSTONE_TTL_MS

const byTsThenId = (a: PlanEvent, b: PlanEvent): number =>
  (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Compact an event log: keep the LATEST event per field FOREVER; keep SUPERSEDED events younger than 90 days
 * (audit history); drop older ones. Deterministic (ts, id) output.
 *
 * Merge-safety (§7): fold reads only the latest-per-field by (ts, id); superseded events are audit-only. A
 * stale device re-introducing a compacted-away event via union is harmless — fold still picks the true
 * latest, and the next compaction sweeps the re-introduced event. Bounded: ≤ ~33 field-latests + 90d of edits.
 */
export function compactPlanEvents(events: PlanEvent[], now: number): PlanEvent[] {
  const sorted = [...events].sort(byTsThenId);
  const latestId = new Map<string, string>();   // field → id of its latest event (ascending sort → last seen wins)
  for (const e of sorted) latestId.set(e.field, e.id);

  const cutoff = now - SUPERSEDED_TTL_MS;
  return sorted.filter((e) => latestId.get(e.field) === e.id || e.ts >= cutoff);
}
