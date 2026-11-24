import { useEffect, useState } from 'react';
import { todayLocalISO } from '../utils/format';

/**
 * The clocks for what reads the time as it draws (BL64 v1.1). Until the live price, `useBtcPrice()` in the app's frame
 * re-drew the open screen every 10 s, every 30 s and on every show, which kept each screen's "now" and its day current by
 * accident. The live price never re-draws the frame on a tick (its FRAME pin), so the two clocks are said here: a screen
 * that ages a figure keeps its own (`useNow`), and the frame re-draws the open screen when the local day turns
 * (`useLocalDay`).
 */

/** Calls `fn` whenever the app may have been shown again — the signals usePageVisibility reads (an iOS PWA misfires
 *  visibilitychange on resume; focus and pageshow come). */
function onShown(fn: () => void): () => void {
  const run = (): void => { if (!document.hidden) fn(); };
  document.addEventListener('visibilitychange', run);
  window.addEventListener('focus', run);
  window.addEventListener('pageshow', run);
  return () => {
    document.removeEventListener('visibilitychange', run);
    window.removeEventListener('focus', run);
    window.removeEventListener('pageshow', run);
  };
}

/** Milliseconds from `nowMs` to the next local midnight, in the device's time zone (a daylight-saving day is 23 or 25
 *  hours long; the Date constructor counts it). */
export function msToNextLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - nowMs;
}

/** Now — every `everyMs`, and at once when the app is shown again. For a screen that ages a figure as it draws (the
 *  Emergency Console's "Price: 16m old"); it re-renders its own component alone. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const sync = (): void => setNow(Date.now());
    const id = setInterval(sync, everyMs);
    const off = onShown(sync);
    return () => { clearInterval(id); off(); };
  }, [everyMs]);
  return now;
}

/** The local day (`todayLocalISO()`): it changes a second after local midnight and is read again when the app is shown.
 *  Held by the app's frame, it re-draws the open screen when the day turns — and only then: the same day bails out. */
export function useLocalDay(): string {
  const [day, setDay] = useState(todayLocalISO);
  useEffect(() => {
    const sync = (): void => setDay(todayLocalISO());
    let t: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => { t = setTimeout(() => { sync(); arm(); }, msToNextLocalDay(Date.now()) + 1_000); };
    arm();
    const off = onShown(sync);
    return () => { if (t !== null) clearTimeout(t); off(); };
  }, []);
  return day;
}
