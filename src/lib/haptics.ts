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

/** ios-switch firing variant (TEMPORARY — the DevPanel probe selects at runtime; the device tells us which
 *  fires the system haptic, then we lock it in and delete the selector). */
export type IosHapticVariant = 'a' | 'b' | 'c';

let cachedSupport: HapticsSupport | null = null;
let iosSwitchEl: HTMLInputElement | null = null;
let iosLabelEl: HTMLLabelElement | null = null;
let iosVariant: IosHapticVariant = 'a';
let hostInteractive = false;

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

function hostStyle(): string {
  // pointer-events togglable — some WebKit builds suppress haptics on non-interactable elements, so the
  // probe can flip this to test. Kept 1px/opacity:0/off-screen either way (never visible/tabbable).
  const pe = hostInteractive ? 'auto' : 'none';
  return `position:fixed;width:1px;height:1px;opacity:0;pointer-events:${pe};left:-9999px;top:0;`;
}

function ensureIosSwitch(): HTMLInputElement | null {
  if (iosSwitchEl) {
    iosLabelEl!.style.cssText = hostStyle();   // re-apply in case hostInteractive changed
    return iosSwitchEl;
  }
  if (typeof document === 'undefined' || !document.body) return null;
  try {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = hostStyle();
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);   // label wraps input → label.click() toggles the switch (variant a)
    document.body.appendChild(label);
    iosSwitchEl = input;
    iosLabelEl = label;
    return input;
  } catch {
    return null;
  }
}

function fireIosSwitch(): void {
  // USER-ACTIVATION REQUIRED (ios-switch path): WebKit fires the system haptic on switch toggle ONLY
  // within a user-gesture context. Call haptics.* from pointer/key event handlers exclusively — a call
  // from a timer/interval/rAF outside a gesture is a silent no-op on iOS by design, not a bug.
  const input = ensureIosSwitch();
  if (!input) return;
  try {
    switch (iosVariant) {
      case 'a':
        iosLabelEl!.click();
        break;
      case 'b':
        input.click();
        break;
      case 'c':
        input.checked = !input.checked;
        input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        break;
    }
  } catch {
    // ignore — haptics are seasoning, never load-bearing.
  }
}

/** TEMPORARY (Bug C diagnosis) — runtime controls the DevPanel Haptics probe uses to find the firing variant. */
export function setHapticsVariant(v: IosHapticVariant): void { iosVariant = v; }
export function getHapticsVariant(): IosHapticVariant { return iosVariant; }
export function setHapticsHostInteractive(on: boolean): void {
  hostInteractive = on;
  if (iosLabelEl) iosLabelEl.style.cssText = hostStyle();
}
export function getHapticsHostInteractive(): boolean { return hostInteractive; }

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
