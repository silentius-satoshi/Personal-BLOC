import { createContext, useContext } from 'react';
import { useStore } from '../../store/useStore';

/**
 * BL50 — "Preview as viewer", trusted (spec `pbloc-spec-preview-bar-v1`): from the preview's bar the owner opens the
 * Almanac as his trusted viewer reads it. AppShell provides `true` around the hub then, and only then; everywhere else
 * the context is `false`, so the owner's own Almanac is as it was. The hub's GATES read `useSeenAsViewer()` — FIRE's
 * tile (BL48 V1), the what-if note (V4 B), Scenario's Pin row, its drift line and its words, the copies off the app
 * (V5 A). A face's DATA still reads `viewerMode` — the device's own copy of the owner's figures (`coldMovedOf`,
 * `strikeDepositOf`): in the preview that is the owner's own, equal to his viewer's copy by construction (BL48's
 * PARITY).
 */
export const PreviewAsViewer = createContext(false);

/** The Almanac as a viewer sees it — on a viewer's device, or in the owner's trusted preview. */
export function useSeenAsViewer(): boolean {
  const viewerMode = useStore((s) => s.viewerMode);
  const preview = useContext(PreviewAsViewer);
  return viewerMode || preview;
}
