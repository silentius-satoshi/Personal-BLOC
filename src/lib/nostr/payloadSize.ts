// 5a (spec `pbloc-spec-plan-log-size-v1`) — a relay payload's size, judged where NIP-44's padding steps sit. Each channel
// publishes ONE event: up to 40,960 B of plain JSON it goes out at ~55 KB, but past it the padding steps to 49,152 B and
// the event to ~66 KB — over a 64 KiB relay limit (strfry's default). The wire size can't warn before that step (it
// jumps across 60,000 B at the step itself), so the plain size decides. Pure; read by DevPanel's size rows.
import { PLAN_LOG_BUDGET_BYTES } from '../planEvents/compact';

/** The largest plain JSON whose padded event stays under 64 KiB on the wire. */
export const PLAIN_STEP_BYTES = 40_960;
/** A payload with no plain size (the public kind-10002 relay list) keeps the old wire budget. */
export const WIRE_WARN_BYTES = 60_000;

export type PayloadSizeLevel = 'ok' | 'near' | 'over';

/** By the plain size when there is one: 'over' past the step (relays with a 64 KiB limit reject it), 'near' past the
 *  plan log's budget, a full padding step below (for the plan, compaction is trimming history there), else 'ok'. With
 *  no plain size, the wire budget. Takes a PublishReport as it is. */
export function payloadSizeLevel(size: { eventBytes?: number; plainBytes?: number }): PayloadSizeLevel {
  if (size.plainBytes !== undefined) {
    if (size.plainBytes > PLAIN_STEP_BYTES) return 'over';
    return size.plainBytes > PLAN_LOG_BUDGET_BYTES ? 'near' : 'ok';
  }
  return (size.eventBytes ?? 0) > WIRE_WARN_BYTES ? 'near' : 'ok';
}
