// Phase 4b — plan-events pure core: the id/ts helpers. Design authority: §4/§13.
// Phase 4e: genesis synthesis (the one-time seed of a log from a pulled settings:v1) is RETIRED with the channel it
// read — the file keeps its name so the emit layer's imports don't move. Zero runtime imports; types from './types'.
import type { PlanField } from './types';

// Per-device monotonic ts guard (§4): never regress, always strictly advance. Injectable `now` for tests.
export function nextPlanEventTs(lastTs: number, now: number = Date.now()): number {
  return Math.max(now, lastTs + 1);
}

// `${field}-${ts}-${rand4}`. rand injectable (the recoveryQuiz.ts convention) — default Math.random.
export function makePlanEventId(field: PlanField, ts: number, rand: () => number = Math.random): string {
  const rand4 = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `${field}-${ts}-${rand4}`;
}
