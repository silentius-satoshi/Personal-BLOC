// 5e (F1, spec `pbloc-spec-batch-1-v1` §2.1) — "Loading your plan…": the session's first plan pull on a signed-in owner
// device that doesn't hold its plan (5c's planMissing). The screen is up while that pull runs — the plan, then the journal
// (fetchAndSync) — and goes when it lands, with a plan, with nothing, or failed; never longer. It keeps its own state, not
// 5c's: planLoaded and the pull's status settle when the plan applies, before the journal, and the red flash lived exactly
// in between — the Strike balance arrives with the plan, its collateral with the journal, and debt over no collateral is
// an infinite LTV (the Dashboard's "Strike BLOC LTV" gauge, full and red).
//
// Never a trap: PLAN_SCREEN_SLOW_MS into the pull, the screen offers "Open the app", which releases it for the session
// while the pull carries on. Never late: a first pull that starts once the app has been on screen signed in — an unlock
// path that doesn't sync, Reconnect, the backup ceremony's wake — never raises it, so the screen is only ever the first
// thing a signed-in session shows.
//
// Display only. Nothing here writes the store or reads the plan: 5c's guard (planLoad.ts) is untouched, and still refuses
// every plan-dependent write until the plan loads. Store-free, like planLoad and syncGuard, so syncNow imports it.
import { planMissing, type PlanGateState } from './planLoad';

/** When the screen offers "Open the app" (BL23's time limit). */
export const PLAN_SCREEN_SLOW_MS = 15_000;

/** The session's first pull: not started; running on a device without its plan; or settled (landed — or started on a
 *  device that held its plan, which never waits). One way only. */
export type FirstPull = 'idle' | 'running' | 'settled';

/** What the screen shows: whether it is up, and whether it offers "Open the app". */
export interface PlanScreen {
  up:   boolean;
  slow: boolean;
}

let pull: FirstPull = 'idle';
let slow = false;
let released = false;
let appOnScreen = false;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let snapshot: PlanScreen = { up: false, slow: false };
const listeners = new Set<() => void>();

function refresh(): void {
  const up = pull === 'running' && !released && !appOnScreen;
  const next: PlanScreen = { up, slow: up && slow };
  if (next.up === snapshot.up && next.slow === snapshot.slow) return;
  snapshot = next;   // a new object only when it changes — a stable snapshot for useSyncExternalStore
  for (const l of listeners) l();
}

function stopSlowTimer(): void {
  if (slowTimer !== null) { clearTimeout(slowTimer); slowTimer = null; }
}

/** The session's first sync reached its pull (syncNow). The screen goes up only if this device doesn't hold its plan now,
 *  and only once a session. */
export function firstPullStarts(s: PlanGateState): void {
  if (pull !== 'idle') return;
  pull = planMissing(s) ? 'running' : 'settled';
  if (pull === 'running') slowTimer = setTimeout(() => { slowTimer = null; slow = true; refresh(); }, PLAN_SCREEN_SLOW_MS);
  refresh();
}

/** The pull landed — with a plan, with nothing, or failed — or the sync ended on the way. The screen goes for the session. */
export function firstPullLands(): void {
  if (pull !== 'running') return;
  pull = 'settled';
  stopSlowTimer();
  refresh();
}

/** The app has been on screen in a signed-in session (AppShell). A first pull that starts after this never raises the
 *  screen. */
export function markAppOnScreen(): void {
  if (appOnScreen) return;
  appOnScreen = true;
  refresh();
}

/** "Open the app": the screen goes for the session. The pull carries on, and 5c still refuses every write it guards. */
export function openTheApp(): void {
  if (released) return;
  released = true;
  stopSlowTimer();
  refresh();
}

/** The screen's state — a stable reference until it changes. */
export function getPlanScreen(): PlanScreen { return snapshot; }

export function subscribePlanScreen(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The first pull's own state (tests, diagnostics). */
export function getFirstPull(): FirstPull { return pull; }

/** Tests only: back to a session's start. */
export function resetFirstPull(): void {
  stopSlowTimer();
  pull = 'idle';
  slow = false;
  released = false;
  appOnScreen = false;
  refresh();
}
