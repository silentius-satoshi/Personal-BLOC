import { useEffect, useState } from 'react';

/**
 * True when the app is backgrounded/blurred — drives the opaque PrivacyScreen.
 *
 * A PWA can't hook iOS's native pre-snapshot callback, so we listen to the EARLIEST web signals: `blur` and
 * `pagehide` fire sooner than `visibilitychange` on iOS, maximizing app-switcher-snapshot coverage. Biased toward
 * showing: ANY of blur/pagehide/visibility-hidden → cover; only a genuine return (visible + focused) reveals — a
 * spurious cover that clears on focus is harmless, a missed cover is the failure. (Snapshot coverage is
 * best-effort / iOS-timing-dependent; the overlay-until-focus return protection is solid.)
 */
export function useAppHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const hide = () => setHidden(true);
    const show = () => { if (document.visibilityState === 'visible' && document.hasFocus()) setHidden(false); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') hide(); else show(); };
    window.addEventListener('blur', hide);
    window.addEventListener('pagehide', hide);
    window.addEventListener('focus', show);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', hide);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('focus', show);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return hidden;
}
