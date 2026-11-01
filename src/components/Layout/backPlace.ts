import type { StoreState } from '../../store/types';

/**
 * BL47 — the simple-mode header's way out says where it goes (spec `pbloc-spec-back-label-v1`). Settings (Branch H)
 * and the Almanac (Branch I) head their page with "←" and the name of the page that button opens — never a bare
 * "← Back", which couldn't say which of the owner's two places it returns to, and on an Almanac face read as "back to
 * the grid" (the header's "Almanac" goes there; "←" leaves). Pure: AppShell passes in the fields it reads.
 */

/** The pages the header's "←" can open, named as the app names them. */
export type BackPlace = 'Dashboard' | 'Journal' | 'Home' | 'Preview' | 'Almanac';

/** Besides the tab, what decides the page a tab opens in simple mode — AppShell's branches read these three. */
export interface BackState {
  viewerMode:    StoreState['viewerMode'];
  viewerPreview: StoreState['viewerPreview'];
  simpleView:    StoreState['simpleView'];
}

/**
 * The name of the page `setActiveTab(to)` opens in simple mode, in AppShell's own order: 'almanac' is Branch I, for
 * anyone; any other tab is, for a viewer, the read-only home (Branch G — "Home", as its bottom bar says); for the
 * owner previewing as a viewer, the preview (Branch J — "Preview", as its banner says); else the owner's journal
 * (Branch J) — the Dashboard, or the Journal on its Daily or Monthly tab (THIS MONTH): the nav's two icons.
 */
export function backPlace(to: StoreState['previousTab'], s: BackState): BackPlace {
  if (to === 'almanac') return 'Almanac';
  if (s.viewerMode) return 'Home';
  if (s.viewerPreview) return 'Preview';
  return s.simpleView === 'dashboard' ? 'Dashboard' : 'Journal';
}

/**
 * The Almanac's way out — its "←", and its edge swipe from the grid: `previousTab`, but never the Almanac itself.
 * Settings opened from inside the Almanac — by a corner notice ("⚠ Plan not loaded", "⚠ Too large to sync"), which
 * opens Settings from any page, or by full mode's brand menu on the Almanac tab — sets `previousTab` to 'almanac', and
 * it is persisted. In simple mode Settings then went back to the Almanac, whose "← Back" opened the page it was on
 * and did nothing, nor did its swipe from the grid. The app's first tab instead, 'living': the journal (a viewer's
 * home).
 */
export function almanacExit(previousTab: StoreState['previousTab']): StoreState['previousTab'] {
  return previousTab === 'almanac' ? 'living' : previousTab;
}
