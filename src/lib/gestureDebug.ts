/**
 * ⚠ TEMPORARY (P1.3) — on-device gesture debug. Deletable scaffolding for diagnosing the DraggableSheet
 * scroll/drag handoff on real iOS (where the harness can't reach). A plain mutable singleton + subscribe;
 * NO store field. `publishGestureDebug` is a no-op when disabled → zero cost when off. Remove once the
 * handoff is device-confirmed (this module + GestureDebugOverlay + the DevPanel toggle).
 */

export interface GestureDebugState {
  phase: string;             // 'idle' | 'down' | 'move' | 'end' | 'cancel'
  dy: number;
  scrollTopAtDown: number;
  claimed: boolean;
  activeTagAtDown: string;
  lastBail: 'focus' | 'none' | '';
  cancelCount: number;
}

const INITIAL: GestureDebugState = {
  phase: 'idle', dy: 0, scrollTopAtDown: 0, claimed: false, activeTagAtDown: '', lastBail: '', cancelCount: 0,
};

let enabled = false;
let state: GestureDebugState = INITIAL;
const subs = new Set<() => void>();

function notify() { subs.forEach((f) => f()); }

export function isGestureDebugEnabled(): boolean { return enabled; }

export function setGestureDebugEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  notify();
}

export function subscribeGestureDebug(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

export function getGestureDebugSnapshot(): GestureDebugState { return state; }

export function publishGestureDebug(patch: Partial<GestureDebugState>): void {
  if (!enabled) return; // zero cost when off
  state = { ...state, ...patch };
  notify();
}
