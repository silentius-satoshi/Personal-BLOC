import { createContext, useContext } from 'react';
import { useStore } from '../../store/useStore';

/**
 * BL48 (V4 B) — inside the Almanac a trusted viewer may try the faces' what-ifs. Every control on a face there is a
 * session overlay that writes nothing (each face's own READ-ONLY rule) or the viewer's own device tool (Mining, BL48 V3
 * A), so there the shared inputs' viewer lock lifts: `AlmanacView` provides `true` around its faces. FIRE's face, whose
 * inputs DO save — `fireInputs` and `inflationRate` (D3 A) — provides `false` around its own (and a viewer has no FIRE
 * face until its assumptions sync, BL48 V1). Outside the Almanac the lock stands: no provider, `false`.
 */
export const ViewerWhatIf = createContext(false);

/** The shared inputs' one read: true when this device is a viewer's and no what-if place lifts the lock here — the
 *  input is then read-only (NumberInput), disabled (SliderInput, Toggle). */
export function useViewerLocked(): boolean {
  const viewerMode = useStore((s) => s.viewerMode);
  const whatIf = useContext(ViewerWhatIf);
  return viewerMode && !whatIf;
}
