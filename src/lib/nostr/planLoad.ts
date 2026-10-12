// 5c (spec `pbloc-spec-plan-load-guard-v1`) — does this device hold the owner's plan, and what did the last plan pull
// find? The incident (5b's spec §16): a device signed in, could not apply the plan on the relays, and kept its seed
// plan — today's date as the strategy start — then rewrote the monthly log against it, and the sync carried the damage
// to every device.
//
// THE RULE: a signed-in owner device writes nothing that depends on the plan — no day event, no monthly-log write, no
// plan edit, no plan, journal or viewer publish — until it holds the plan. It holds the plan once it has applied the
// relays' plan, once a backup is restored on it, once it minted the key (a new plan's origin), or once its owner chose
// "Start a new plan" after a pull found no plan and no journal. The device never infers that on its own: relays that
// return nothing — slow, refusing, or not the ones that hold the plan — look exactly like a new key. A device that isn't
// signed in, and a viewer, have only their own copy — neither waits.
//
// `planLoaded` is the persisted half (a store field; it lives and dies with the store, so a store wiped while the
// identity stays — the escape hatch, a viewer's clear — holds no plan). The last pull's status is session state, kept here
// for the plain-words notices and DevPanel. Store-free, so the slices and the publish engine import it (the syncGuard
// pattern).
import { nostrLog } from './log';

export interface PlanGateState {
  nostrAuthEnabled: boolean;
  viewerMode:       boolean;
  planLoaded:       boolean;
}

/** True while this device must not write what depends on the plan — THE RULE above. */
export function planMissing(s: PlanGateState): boolean {
  return !!s.nostrAuthEnabled && !s.viewerMode && !s.planLoaded;
}

/** The store-side guard: true (and logged) when a plan-dependent write must be refused. Metadata only in the log. */
export function refuseWithoutPlan(s: PlanGateState, what: string): boolean {
  if (!planMissing(s)) return false;
  nostrLog('warn', `${what} refused — this device hasn't loaded the plan`);
  return true;
}

/** Why the relays' plan didn't apply: the signer couldn't decrypt it; it decrypted to something that isn't JSON; the
 *  JSON isn't a plan log; applying it threw; the pull stopped (a decrypt failure on another channel) before it; or the
 *  relays hold this key's journal but no plan at all ('absent' — the journal is what a seed plan would damage). */
export type PlanPullReason = 'decrypt' | 'parse' | 'shape' | 'apply' | 'not-reached' | 'absent';

export type PlanPull =
  | { status: 'pending' }                                                                   // no pull has settled it this session
  | { status: 'applied'; at: number; plainBytes: number }                                   // the relays' plan is applied here
  | { status: 'none'; at: number }                                                          // a relay answered; no plan and no journal — the owner decides
  | { status: 'unreachable'; at: number }                                                   // no relay answered
  | { status: 'unreadable'; at: number; reason: PlanPullReason; plainBytes?: number };      // the relays hold a plan this device didn't apply

let last: PlanPull = { status: 'pending' };
const listeners = new Set<() => void>();

export function recordPlanPull(p: PlanPull): void {
  last = p;
  for (const l of listeners) l();
}
/** The last plan pull's outcome — a stable reference until the next record, for useSyncExternalStore. */
export function getPlanPull(): PlanPull { return last; }
export function subscribePlanPull(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Tests only. */
export function resetPlanPull(): void { recordPlanPull({ status: 'pending' }); }

/** An error's name, never its message: a JSON.parse message can quote the payload (amounts) — the log's privacy rule. */
export function errorName(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}
