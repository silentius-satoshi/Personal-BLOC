/**
 * Haptics adapter (Gesture & Motion System — P0) — capability-honest, no faking. Mostly pure; the
 * only side effect is a single lazily-created hidden DOM node on the iOS-switch path (guarded).
 *
 * Capability ladder (detected once at module load, cached):
 *   'vibrate'    — Android/Chromium `navigator.vibrate()` patterns.
 *   'ios-switch' — iOS ≥18 standalone: a hidden `<input type="checkbox" switch>` toggled
 *                  programmatically fires the ONE WebKit-sanctioned system haptic.
 *   'none'       — iOS <18 / unsupported → no-op (the visual channel carries the state alone; §5.4).
 *
 * USER-ACTIVATION REQUIRED (ios-switch path): WebKit fires the system haptic on switch toggle ONLY
 * within a user-gesture context. Call haptics.* from pointer/key event handlers exclusively — a call
 * from a timer/interval/rAF outside a gesture is a silent no-op on iOS by design, not a bug.
 *
 * Intensity is not controllable on the ios-switch path — tick/confirm/warn all map to the single
 * toggle there; only the vibrate path expresses distinct patterns.
 */

export type HapticsSupport = 'vibrate' | 'ios-switch' | 'none';

let cachedSupport: HapticsSupport | null = null;
let iosSwitchEl: HTMLInputElement | null = null;

function detectSupport(): HapticsSupport {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return 'none';

  if (typeof navigator.vibrate === 'function') return 'vibrate';

  // Probe for the `switch` attribute support (Safari 17.4+).
  try {
    const probe = document.createElement('input');
    probe.type = 'checkbox';
    if ('switch' in probe) return 'ios-switch';
  } catch {
    // createElement failed (non-DOM env) — fall through.
  }

  return 'none';
}

/** The detected haptics mechanism for this platform (cached). */
export function hapticsSupport(): HapticsSupport {
  if (cachedSupport === null) cachedSupport = detectSupport();
  return cachedSupport;
}

function ensureIosSwitch(): HTMLInputElement | null {
  if (iosSwitchEl) return iosSwitchEl;
  if (typeof document === 'undefined' || !document.body) return null;
  try {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.style.cssText =
      'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0;';
    document.body.appendChild(input);
    iosSwitchEl = input;
    return input;
  } catch {
    return null;
  }
}

function fireIosSwitch(): void {
  // USER-ACTIVATION REQUIRED (ios-switch path): WebKit fires the system haptic on switch toggle ONLY
  // within a user-gesture context. Call haptics.* from pointer/key event handlers exclusively — a call
  // from a timer/interval/rAF outside a gesture is a silent no-op on iOS by design, not a bug.
  const el = ensureIosSwitch();
  if (!el) return;
  try {
    el.click();
  } catch {
    // ignore — haptics are seasoning, never load-bearing.
  }
}

function fire(pattern: number | number[]): void {
  switch (hapticsSupport()) {
    case 'vibrate':
      try {
        navigator.vibrate(pattern);
      } catch {
        /* no-op */
      }
      return;
    case 'ios-switch':
      fireIosSwitch();
      return;
    default:
      return;
  }
}

/**
 * Honest per-platform haptics. Called at exactly two moment-types: a gesture crossing its `armed`
 * threshold (`tick`) and a `confirm` landing (`confirm`); `warn` on a blocked/dirty action. Never on
 * plain navigation.
 */
export const haptics = {
  tick: () => fire(10),
  confirm: () => fire([10, 30, 10]),
  warn: () => fire([30, 50, 30]),
};
