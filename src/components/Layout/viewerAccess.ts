import type { StoreState } from '../../store/types';

/**
 * BL48 — trusted viewers in the Almanac (BL40's second piece; spec `pbloc-spec-trusted-viewers-v1`). A viewer's tier
 * is the shape of the snapshot it last applied (`viewerSync.ts`): a safe snapshot sets `viewerSafeSnapshot`, a trusted
 * one (or a pre-V2 one, read as trusted) clears it — and until one has applied (`viewerDataLoaded`, transient), a
 * viewer has no tier at all. Pure: AppShell passes in the three fields it reads.
 */

/** Besides the tier, what decides it — the three fields AppShell reads. */
export interface ViewerAccessState {
  viewerMode:         StoreState['viewerMode'];
  viewerDataLoaded:   StoreState['viewerDataLoaded'];
  viewerSafeSnapshot: StoreState['viewerSafeSnapshot'];
}

/** 'trusted' or 'safe' by the last snapshot applied; null for the owner, and for a viewer before its first snapshot. */
export type ViewerTier = 'trusted' | 'safe' | null;

export function viewerTier(s: ViewerAccessState): ViewerTier {
  if (!s.viewerMode || !s.viewerDataLoaded) return null;
  return s.viewerSafeSnapshot === null ? 'trusted' : 'safe';
}

/**
 * Who the Almanac opens for: the owner, and a trusted viewer — every face reads his figures from the trusted snapshot
 * (BL9's third kill criterion). Never a safe viewer: his device holds no amount of the owner's, and a face would print
 * the store's seed as if it were a plan (G2-A). Never a viewer before his first snapshot either — a demoted viewer's
 * device keeps nothing to show once the safe snapshot has wiped it (`viewerSync.ts`), and a reload starts every viewer
 * there.
 */
export function almanacOpensFor(s: ViewerAccessState): boolean {
  return !s.viewerMode || viewerTier(s) === 'trusted';
}
