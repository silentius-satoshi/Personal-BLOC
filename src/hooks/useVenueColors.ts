import { useLayoutEffect } from 'react';
import { useStore } from '../store/useStore';
import { applyVenueColors } from '../lib/venueColors';

/**
 * BL15 (Customization) — the sink: the owner's venue colours (the `venueColors` pref) set on :root as the venue tokens,
 * before paint (a layout effect, so a reload never flashes the defaults). Cleaned and checked here, at the sink
 * (`applyVenueColors` → `resolveVenueColors`): only a well-formed '#rrggbb' that THE rule passes reaches CSS; a venue at
 * its default, refused, or unset falls back to tokens.css. On the way in (`incomingVenueColors`) a pref lands as it is.
 * Mounted once, at the top of AppShell, so it runs for the owner, a viewer and behind every gate.
 */
export function useVenueColors(): void {
  const venueColors = useStore((s) => s.venueColors);
  useLayoutEffect(() => {
    applyVenueColors(document.documentElement.style, venueColors);
  }, [venueColors]);
}
