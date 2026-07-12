// Phase 4b — plan-events pure core: shared types. Design authority: phase-4a-plan-events-design-lock §4.
// Leaf module: type-only imports from the store; NO runtime store dependency.
import type { StoreState } from '../../store/types';
import type { PlanField } from '../../store/settingsFields';

/**
 * A single append-only plan event. Mirrors DayEvent's `{id, ts}` base + the (ts, id) total-order discipline
 * DELIBERATELY (one merge mental model, not two) — but carries NO `date` field; a plan edit has no calendar day.
 *
 * DESIGN CALLS (locked, §4):
 *  - Total order is (ts, id): ts ascending, id string-compare as the deterministic tie-break (the dayLog rule).
 *  - `viewers` / `nostrRelays` values are WHOLE ARRAYS on a `set` event, NOT op-events (rosterAdd/…). Under D2
 *    (single active writer) concurrent roster edits cannot occur; op-events are the documented multi-writer
 *    upgrade path — additive on this substrate, rejected now.
 *  - AsOf pairs (cbLoanBalance + cbLoanBalanceAsOf, …) stay 1:1 field events emitted with the SAME ts in one
 *    action (the paired-emit helper is 4c). Composite {value, asOf} fields are the multi-writer upgrade path.
 *  - `kind: 'set'` ONLY. There is NO delete/tombstone concept: a field ABSENT from the log = its seed default;
 *    a field SET TO EMPTY (viewers=[], blocStatementMinimum=null) = an EVENT. That distinction is the whole
 *    point (§6) — it is what lets a fresh/stale session publish nothing and therefore never clobber.
 */
export interface PlanEvent {
  id:     string;       // `${field}-${ts}-${rand4}`; genesis: `genesis-${field}-${ts}`
  ts:     number;       // ms · per-device monotonic guard: ts = max(Date.now(), lastTs + 1)
  device: string;       // getDeviceTag() — diagnostics only, NEVER a merge input
  kind:   'set';        // v1 taxonomy is 'set' only
  field:  PlanField;
  value:  unknown;      // JSON value incl. arrays (nostrRelays, viewers)
}

// The slice of store state the plan-events channel owns (the 33 PLAN_EVENT_FIELDS). Type-only.
export type PlanState = Pick<StoreState, PlanField>;

// Re-exported so sibling planEvents modules import PlanField from './types' (one local surface).
export type { PlanField };
