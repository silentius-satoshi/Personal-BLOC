// Phase 4b — plan-events pure core: id/ts helpers + genesis synthesis. Design authority: §4/§10/§13.
// Leaf module: runtime import ONLY from settingsFields (a zero-import leaf); types from './types'.
import { PLAN_EVENT_FIELDS } from '../../store/settingsFields';
import type { PlanEvent, PlanField, PlanState } from './types';

// Per-device monotonic ts guard (§4): never regress, always strictly advance. Injectable `now` for tests.
export function nextPlanEventTs(lastTs: number, now: number = Date.now()): number {
  return Math.max(now, lastTs + 1);
}

// `${field}-${ts}-${rand4}`. rand injectable (the recoveryQuiz.ts convention) — default Math.random.
export function makePlanEventId(field: PlanField, ts: number, rand: () => number = Math.random): string {
  const rand4 = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `${field}-${ts}-${rand4}`;
}

/**
 * Synthesize the genesis log from a legacy plan partition (§10). One `kind:'set'` per PRESENT key — absent
 * keys stay absent (genesis must NOT invent seed values). Iterates PLAN_EVENT_FIELDS for a STABLE field
 * order; ts is STAGGERED monotonically (baseTs, baseTs+1, …) so the log has a total order and ids are unique.
 * ids are field-qualified `genesis-${field}-${ts}` — field-qualification + per-field staggering together are
 * the §13 genesis-collision answer (no rand needed). Pure.
 */
export function synthesizeGenesisEvents(
  fields: Partial<PlanState>,
  baseTs: number,
  device: string,
): PlanEvent[] {
  const events: PlanEvent[] = [];
  let ts = baseTs;
  for (const field of PLAN_EVENT_FIELDS) {
    if (!(field in fields)) continue;   // present-keys-only — never seed an absent field
    events.push({
      id:    `genesis-${field}-${ts}`,
      ts,
      device,
      kind:  'set',
      field,
      value: (fields as Record<string, unknown>)[field],
    });
    ts += 1;   // stagger so every genesis event has a unique, monotonically-increasing ts
  }
  return events;
}
