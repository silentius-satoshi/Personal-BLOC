import { PL_BAND_LABEL } from '../../simulation/powerLaw';
import type { DecisionPath } from './decisionView';
import type { PolicyCardState } from './supportPolicyView';

/**
 * The control dock's words (sticky controls — spec `pbloc-spec-sticky-controls-v1.md`). Pure: every tab's label and
 * value comes from here, so the faces compose none and the tests pin them. The dock itself (`ControlDock.tsx`) is
 * layout only.
 *
 * A phone tab is about 66 px wide at 390 (five to a row), so a value must fit in 8 characters of 12 px mono — the
 * path names are shortened for the tab only; the open panel and the cards keep the full names.
 */

export type DockTone = 'plain' | 'good' | 'bad';

/** One tab: a label over its current value. */
export interface DockTabView {
  id: string;
  label: string;
  value: string;
  tone: DockTone;
}

/** The inspected month on its tab — "today" at month 0, else the month's number. */
export function monthTabValue(monthIdx: number): string {
  return monthIdx === 0 ? 'today' : String(monthIdx);
}

/** The inspected month beside its slider — the scrubber card's words, unchanged. */
export function monthReadout(monthIdx: number): string {
  return monthIdx === 0 ? 'today' : `month ${monthIdx} · ${(monthIdx / 12).toFixed(1)} yr`;
}

/** The price stress as a signed percent (a true minus sign), or null when the lens is off (1×). */
export function stressPct(lens: number): string | null {
  if (lens === 1) return null;
  return `${lens > 1 ? '+' : '−'}${Math.abs((lens - 1) * 100).toFixed(0)}%`;
}

/** The stress on its tab — "0%" when off. */
export function stressTabValue(lens: number): string {
  return stressPct(lens) ?? '0%';
}

/** Up is green and down is red, as beside the slider. */
export function stressTone(lens: number): DockTone {
  if (lens === 1) return 'plain';
  return lens > 1 ? 'good' : 'bad';
}

/** The price path on its tab. Every DecisionPath has one (a Record, so a new path fails to compile without it). The
 *  band names are PL_BAND_LABEL's — the ONE user-facing word per band — so a renamed band can't leave the tab behind. */
export const PATH_TAB_VALUE: Record<DecisionPath, string> = {
  floor: PL_BAND_LABEL.floor,
  fair: PL_BAND_LABEL.fair,
  ceiling: 'Resist.',
  fourYear: '4-yr',
  worstStitched: 'Stitched',
  worstModeled: 'Worst',
};

/** The credit line on its tab, in thousands: $40k, $3.5k, $128k. Rounded to one decimal FIRST, then formatted — the
 *  owner's own line can be any value, and $99,950 must read "$100k", never "$100.0k". */
export function lineTabValue(usd: number): string {
  const k = Math.round(usd / 100) / 10;
  return Number.isInteger(k) || k >= 100 ? `$${Math.round(k)}k` : `$${k.toFixed(1)}k`;
}

/** The support policy on its tab — the card's own state (`policyCardState`). */
export function policyTabValue(state: PolicyCardState): string {
  if (state === 'on') return 'on';
  if (state === 'off') return 'off';
  if (state === 'notRun') return 'not run';
  return '—';
}

/** The Decision face's five tabs, in their order. */
export function decisionDockTabs(x: {
  monthIdx: number;
  lens: number;
  path: DecisionPath;
  lineUsd: number;
  policy: PolicyCardState;
}): DockTabView[] {
  return [
    { id: 'month', label: 'Month', value: monthTabValue(x.monthIdx), tone: 'plain' },
    { id: 'stress', label: 'Stress', value: stressTabValue(x.lens), tone: stressTone(x.lens) },
    { id: 'path', label: 'Path', value: PATH_TAB_VALUE[x.path], tone: 'plain' },
    { id: 'line', label: 'Line', value: lineTabValue(x.lineUsd), tone: 'plain' },
    { id: 'policy', label: 'Policy', value: policyTabValue(x.policy), tone: 'plain' },
  ];
}
