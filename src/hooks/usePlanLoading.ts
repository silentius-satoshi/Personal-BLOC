// 5e (F1) — the "Loading your plan…" screen's state for AppShell: up while the session's first pull runs on a device
// without its plan, and whether it offers "Open the app" yet (lib/nostr/firstPull). Module state read through
// useSyncExternalStore, like 5b's useSyncBlocked and 5c's usePlanPull — the third argument too, so a server render works.
import { useSyncExternalStore } from 'react';
import { getPlanScreen, subscribePlanScreen, type PlanScreen } from '../lib/nostr/firstPull';

export function usePlanLoading(): PlanScreen {
  return useSyncExternalStore(subscribePlanScreen, getPlanScreen, getPlanScreen);
}
