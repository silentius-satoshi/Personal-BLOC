import { describe, it, expect } from 'vitest';
import {
  monthTabValue, monthReadout, stressPct, stressTabValue, stressTone, PATH_TAB_VALUE, lineTabValue, policyTabValue,
  decisionDockTabs,
} from '../controlDockView';
import { policyCardState } from '../supportPolicyView';
import { PL_BAND_LABEL } from '../../../simulation/powerLaw';
import type { DecisionPath } from '../decisionView';

/**
 * The control dock's words (sticky controls — spec `pbloc-spec-sticky-controls-v1.md` v1.1). Round synthetic figures
 * only. The e2e pins where the dock sits; this file pins what its tabs say.
 */

describe('the month', () => {
  it('⭐ TODAY — the tab says "today" at month 0, else the month\'s number', () => {
    expect(monthTabValue(0)).toBe('today');
    expect(monthTabValue(1)).toBe('1');
    expect(monthTabValue(60)).toBe('60');
  });
  it('⭐ READOUT — the scrubber card\'s, word for word', () => {
    expect(monthReadout(0)).toBe('today');
    expect(monthReadout(1)).toBe('month 1 · 0.1 yr');
    expect(monthReadout(18)).toBe('month 18 · 1.5 yr');
  });
});

describe('the stress', () => {
  it('⭐ OFF — at 1×: no percent, "0%" on the tab, plain', () => {
    expect(stressPct(1)).toBeNull();
    expect(stressTabValue(1)).toBe('0%');
    expect(stressTone(1)).toBe('plain');
  });
  it('⭐ MINUS — signed with a true minus; down is bad, up is good; the slider\'s ends included', () => {
    expect(stressPct(0.7)).toBe('−30%');
    expect(stressPct(0.35)).toBe('−65%');
    expect(stressPct(1.25)).toBe('+25%');
    expect(stressPct(2.2)).toBe('+120%');
    expect(stressTabValue(0.7)).toBe('−30%');
    expect(stressTone(0.7)).toBe('bad');
    expect(stressTone(1.25)).toBe('good');
  });
});

describe('the path, the line and the policy', () => {
  const ALL: DecisionPath[] = ['floor', 'fair', 'ceiling', 'fourYear', 'worstStitched', 'worstModeled'];

  it('⭐ LENGTH — every path has a tab value that fits a phone tab (8 characters), no two are the same, and the band names are PL_BAND_LABEL\'s', () => {
    expect(Object.keys(PATH_TAB_VALUE).sort()).toEqual([...ALL].sort());
    for (const p of ALL) expect(PATH_TAB_VALUE[p].length, p).toBeLessThanOrEqual(8);
    expect(new Set(Object.values(PATH_TAB_VALUE)).size).toBe(ALL.length);
    // BAND (Δ6) — PL_BAND_LABEL is the ONE user-facing word per band; a typed copy could drift from it.
    expect(PATH_TAB_VALUE.floor, 'BAND').toBe(PL_BAND_LABEL.floor);
    expect(PATH_TAB_VALUE.fair, 'BAND').toBe(PL_BAND_LABEL.fair);
  });

  it('⭐ THOUSANDS — the line: whole, one decimal under $100k, rounded above — rounded to one decimal first', () => {
    expect(lineTabValue(40_000)).toBe('$40k');
    expect(lineTabValue(3_500)).toBe('$3.5k');
    expect(lineTabValue(12_500)).toBe('$12.5k');
    expect(lineTabValue(250_000)).toBe('$250k');
    expect(lineTabValue(127_500)).toBe('$128k');
    // Δ7 — the owner's own line can be any value: never "$100.0k" or "$1.0k".
    expect(lineTabValue(99_950)).toBe('$100k');
    expect(lineTabValue(999)).toBe('$1k');
  });

  it('⭐ STATES — the policy says what the card says: the card\'s own four states', () => {
    expect(policyCardState('cycle', true, true)).toBe('on');
    expect(policyCardState('cycle', false, false)).toBe('off');
    expect(policyCardState('cycle', false, true)).toBe('off');
    expect(policyCardState('cycle', true, false)).toBe('notRun');
    expect(policyCardState('hold', true, true)).toBe('notCycle');
    expect(policyTabValue('on')).toBe('on');
    expect(policyTabValue('off')).toBe('off');
    expect(policyTabValue('notRun')).toBe('not run');
    expect(policyTabValue('notCycle')).toBe('—');
  });
});

describe('⭐ the Decision face\'s five tabs', () => {
  it('⭐ FIVE-TABS — in their order, each from its own helper', () => {
    const tabs = decisionDockTabs({ monthIdx: 19, lens: 0.7, path: 'ceiling', lineUsd: 40_000, policy: 'on' });
    expect(tabs).toEqual([
      { id: 'month', label: 'Month', value: '19', tone: 'plain' },
      { id: 'stress', label: 'Stress', value: '−30%', tone: 'bad' },
      { id: 'path', label: 'Path', value: 'Resist.', tone: 'plain' },
      { id: 'line', label: 'Line', value: '$40k', tone: 'plain' },
      { id: 'policy', label: 'Policy', value: 'on', tone: 'plain' },
    ]);
  });
});
