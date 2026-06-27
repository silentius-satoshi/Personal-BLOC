import { useState, useEffect } from 'react';

export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(!document.hidden);
  useEffect(() => {
    // Self-correcting visibility: iOS PWAs fire `visibilitychange` unreliably on launch/resume, which can
    // strand `isVisible` at false across a foreground (killing the consumer poll). Re-read !document.hidden
    // from MULTIPLE signals — visibilitychange + window focus/pageshow (iOS fires these more reliably on
    // resume) + a low-frequency interval re-read (recovers even if no event ever fires). A bare
    // setIsVisible(!document.hidden) bails out when the primitive is unchanged, so this adds no re-renders
    // while foreground. Still genuinely pauses when backgrounded (not hardcoded true).
    const sync = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    const id = setInterval(sync, 20_000);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
      clearInterval(id);
    };
  }, []);
  return isVisible;
}
