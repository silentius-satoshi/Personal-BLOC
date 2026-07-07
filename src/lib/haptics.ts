/**
 * Haptics adapter (Gesture & Motion System — P0; P1.2 lock-down) — capability-honest, no faking.
 *
 * Capability ladder (detected once at module load, cached):
 *   'vibrate' — Android/Chromium `navigator.vibrate()` patterns.
 *   'none'    — everything else, INCLUDING iOS.
 *
 * ⚠ iOS: WebKit provides NO programmatic haptic path as of iOS 18 — the `<input switch>` system haptic fires
 * ONLY on a physical user tap of the control, not on synthetic activation (device-verified Jul 2026; all three
 * `label.click()` / `input.click()` / `checked+dispatch` variants × both host states were silent). The earlier
 * ios-switch path is removed. The VISUAL channel is the primary feedback channel per design.md §5.4; haptics are
 * seasoning where the platform allows them.
 *
 * USER-ACTIVATION note (vibrate path): call `haptics.*` from pointer/key event handlers — some browsers gate
 * `navigator.vibrate` on a user gesture.
 */

export type HapticsSupport = 'vibrate' | 'none';

let cachedSupport: HapticsSupport | null = null;

function detectSupport(): HapticsSupport {
  if (typeof navigator === 'undefined') return 'none';
  if (typeof navigator.vibrate === 'function') return 'vibrate';
  return 'none';
}

/** The detected haptics mechanism for this platform (cached). */
export function hapticsSupport(): HapticsSupport {
  if (cachedSupport === null) cachedSupport = detectSupport();
  return cachedSupport;
}

function fire(pattern: number | number[]): void {
  if (hapticsSupport() !== 'vibrate') return; // 'none' (incl. iOS) → silent, visual channel carries it
  try {
    navigator.vibrate(pattern);
  } catch {
    // ignore — haptics are seasoning, never load-bearing.
  }
}

/**
 * Honest per-platform haptics. Called at exactly two moment-types: a gesture crossing its `armed` threshold
 * (`tick`) and a `confirm` landing (`confirm`); `warn` on a blocked/dirty action. Never on plain navigation.
 * On iOS these are no-ops (no programmatic path) — the same-instant visual twin is the real signal (§5.4).
 */
export const haptics = {
  tick: () => fire(10),
  confirm: () => fire([10, 30, 10]),
  warn: () => fire([30, 50, 30]),
};
