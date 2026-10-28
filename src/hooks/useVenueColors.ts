import { useLayoutEffect } from 'react';
import { useStore } from '../store/useStore';
import { applyVenueColors } from '../lib/venueColors';

/**
 * BL15 (Customization) — the sink: the owner's venue colours (the `venueColors` pref) set on :root as the venue tokens,
 * before paint (a layout effect, so a reload never flashes the defaults). Cleaned on the way in (`applyVenueColors`):
 * only a well-formed '#rrggbb' reaches CSS; a venue at its default, or unset, falls back to tokens.css. Mounted once, at
 * the top of AppShell, so it runs for the owner, a viewer and behind every gate.
 */
export function useVenueColors(): void {
  const venueColors = useStore((s) => s.venueColors);
  useLayoutEffect(() => {
    applyVenueColors(document.documentElement.style, venueColors);
  }, [venueColors]);
}
