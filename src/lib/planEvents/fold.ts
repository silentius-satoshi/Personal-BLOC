// Phase 4b — plan-events pure core: fold + union. Design authority: phase-4a-plan-events-design-lock §5/§9.
// Pure, node-testable, no store/runtime dependency (types only).
import type { PlanEvent, PlanState } from './types';

// Deterministic total order: ts ascending, id string-compare as the tie-break (the dayLog discipline).
const byTsThenId = (a: PlanEvent, b: PlanEvent): number =>
  (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Fold an event log to the latest value per field. Sort (ts, id), take the last event per field.
 * ABSENT fields are ABSENT from the output — fold never seeds defaults (that is the store's seed layer).
 * A set-to-empty event (viewers=[], blocStatementMinimum=null) DOES appear in the output (§6). Pure; the
 * input is not mutated. Values are `unknown` (the type authority is the 4c emit layer), assigned via a
 * Record cast.
 */
export function foldPlanEvents(events: PlanEvent[]): Partial<PlanState> {
  const sorted = [...events].sort(byTsThenId);
  const out: Record<string, unknown> = {};
  for (const e of sorted) out[e.field] = e.value;   // ascending order → last write per field wins
  return out as Partial<PlanState>;
}

/**
 * Union two logs by id. Append-only means ids are unique by construction, so a duplicated id is a self-pull
 * echo of the IDENTICAL event → keep the first (deliberately UNLIKE mergeRecords' higher-ts-wins, which
 * exists because dayLog events are edited in place; plan events are never edited — a new value is a new
 * event with a new id). Deterministic (ts, id) sorted output. Pure.
 */
export function unionPlanEvents(a: PlanEvent[], b: PlanEvent[]): PlanEvent[] {
  const byId = new Map<string, PlanEvent>();
  for (const e of a) if (!byId.has(e.id)) byId.set(e.id, e);
  for (const e of b) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort(byTsThenId);
}
