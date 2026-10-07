// Phase 4b — plan-events pure core: compaction. Design authority: phase-4a-plan-events-design-lock §7.
// 5a (spec `pbloc-spec-plan-log-size-v1`) adds two rules so the ONE plan payload stays publishable: a burst of edits to
// one field keeps only its last event, and the history beyond the latest per field is trimmed, oldest first, to a byte
// budget. Pure, node-testable, no store/runtime dependency (types only).
import type { PlanEvent } from './types';

const SUPERSEDED_TTL_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days — mirror of mergeRecords TOMBSTONE_TTL_MS

/** 5a — a superseded event whose field is set again within this window is a burst's middle, not a decision: a slider
 *  drag emits one event per notch it crosses (Living's income slider: 59 in a 1-second drag, 173 in 3 seconds), and a
 *  typed number one per keystroke. Measured between an event and the NEXT event for the same field, so a long drag
 *  collapses to its last value. Device-blind: `device` is never a merge input. */
export const BURST_WINDOW_MS = 10_000;

/** 5a — the budget for the plan payload's plain JSON, `{"events":[…]}` (the log plus 11 bytes around it). The plan
 *  publishes as ONE NIP-44 event: up to 40,960 B of plain JSON it goes out at ~55 KB, but past it the padding steps to
 *  49,152 B and the event to ~66 KB — over a 64 KiB relay limit — and a publish that fails keeps failing until the
 *  history ages out. 32 KiB is a full padding step below. History is trimmed oldest first until the payload fits; the
 *  latest per field is never trimmed. */
export const PLAN_LOG_BUDGET_BYTES = 32_768;
const PAYLOAD_WRAPPER_BYTES = 11;   // '{"events":' and '}' — the publish sends { events: log }

const byTsThenId = (a: PlanEvent, b: PlanEvent): number =>
  (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const utf8 = new TextEncoder();
const byteLen = (s: string): number => utf8.encode(s).length;

/**
 * Compact an event log: keep the LATEST event per field FOREVER; keep a SUPERSEDED event (audit history) only while it
 * is younger than 90 days AND its field's next event follows more than BURST_WINDOW_MS later; then trim that history,
 * oldest first, until the payload `{"events":[…]}` fits PLAN_LOG_BUDGET_BYTES. Deterministic (ts, id) output.
 *
 * Merge-safety (§7): fold reads only the latest-per-field by (ts, id), and every rule here drops only superseded
 * events, so fold(compact(e, now)) ≡ fold(e). A stale device re-introducing a compacted-away event via union is
 * harmless — fold still picks the true latest, and the next compaction sweeps it again. Idempotent: an event kept once
 * keeps its next event (trimming is oldest first), so a second pass changes nothing.
 * Bounded: the payload ≤ max(PLAN_LOG_BUDGET_BYTES, the latests alone) — one event per plan field is about 5 KB.
 */
export function compactPlanEvents(events: PlanEvent[], now: number): PlanEvent[] {
  const sorted = [...events].sort(byTsThenId);
  const nextTs: (number | undefined)[] = new Array(sorted.length);
  const following = new Map<string, number>();   // field → ts of the event after this one (walking backwards)
  for (let i = sorted.length - 1; i >= 0; i--) {
    nextTs[i] = following.get(sorted[i].field);
    following.set(sorted[i].field, sorted[i].ts);
  }
  const cutoff = now - SUPERSEDED_TTL_MS;
  const kept = sorted.filter((e, i) => {
    const next = nextTs[i];
    if (next === undefined) return true;                              // the latest for its field — kept forever
    return e.ts >= cutoff && next - e.ts > BURST_WINDOW_MS;           // history: under 90 days and not a burst's middle
  });
  return trimToBudget(kept);
}

// The history (superseded events) goes oldest first until the payload fits the budget. `total` is the payload's byte
// length: the wrapper + '[' + the events joined by ',' + ']'.
function trimToBudget(log: PlanEvent[]): PlanEvent[] {
  const sizes = log.map((e) => byteLen(JSON.stringify(e)));
  let total = PAYLOAD_WRAPPER_BYTES + 2 + sizes.reduce((sum, n) => sum + n, 0) + Math.max(0, log.length - 1);
  if (total <= PLAN_LOG_BUDGET_BYTES) return log;
  const latest = new Map<string, number>();     // field → index of its latest event (ascending order → last wins)
  log.forEach((e, i) => latest.set(e.field, i));
  const drop = new Set<number>();
  for (let i = 0; i < log.length && total > PLAN_LOG_BUDGET_BYTES; i++) {
    if (latest.get(log[i].field) === i) continue;   // never the latest per field
    drop.add(i);
    total -= sizes[i] + 1;                          // the event and its comma
  }
  return log.filter((_, i) => !drop.has(i));
}
