// Pure, store-free — stable per-device identity for NIP-46 connect names + diagnostics.

const KEY = 'bloc-device-tag';

/** Random 4-hex tag, generated once per device/origin and persisted in localStorage. NEVER synced — it exists to tell devices apart. */
export function getDeviceTag(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const tag = Math.random().toString(16).slice(2, 6);
    localStorage.setItem(KEY, tag);
    return tag;
  } catch { return 'anon'; }   // private mode / quota — degrade gracefully
}

/** e.g. 'iOS-a3f2', 'Android-09bc', 'Web-7c91' */
export function getDeviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const platform = /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : 'Web';
  return `${platform}-${getDeviceTag()}`;
}
