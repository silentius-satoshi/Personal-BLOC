// BL14 (G1-C, G2-A) — the Dashboard's goal tile: net coins TODAY against the owner's goal, for the owner and a trusted
// viewer only. Its words are pure (`goalTileView`); the tile composes nothing. ⚠ SYNTHETIC round figures (public repo).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { goalTileView, goalNowView, GOAL_TILE_TITLE } from '../goalTileView';
import { GoalTile } from '../GoalTile';
import { GOAL_EPS } from '../../../simulation/goal';

describe('⭐ GOAL TILE — the words', () => {
  it('⭐ GOAL TILE — under, at and past the goal: the figure, the share, and never a plan move', () => {
    expect(goalTileView(0.5, 2)).toEqual({
      value: '₿0.500 of ₿2.000', sub: 'net coins today · 25%', fill: 0.25,
      aria: 'Your goal: 0.500 bitcoin in net coins today, of 2.000 — 25%.',
    });
    expect(goalTileView(2, 2)).toEqual({
      value: '₿2.000 of ₿2.000', sub: 'net coins today · at or past your goal', fill: 1,
      aria: 'Your goal: 2.000 bitcoin in net coins today, of 2.000 — at or past it.',
    });
    expect(goalTileView(3, 2)?.fill, 'past: the bar is full, never over').toBe(1);
    expect(goalTileView(1.9996, 2)?.value, 'under never prints as the goal').toBe('₿1.9996 of ₿2.0000');
    expect(goalTileView(1.9996, 2)?.sub).toBe('net coins today · 99%');
    // At by the engine's own rule (float dust forgiven) — so the tile and the plan never disagree on "at".
    expect(goalTileView(2 * (1 - GOAL_EPS / 2), 2)?.sub).toBe('net coins today · at or past your goal');
    // Owing more than every coin is worth: the sign before the ₿, an empty bar, 0%.
    expect(goalTileView(-0.2, 2)).toEqual({
      value: '−₿0.200 of ₿2.000', sub: 'net coins today · 0%', fill: 0,
      aria: 'Your goal: minus 0.200 bitcoin in net coins today, of 2.000 — 0%.',
    });
    for (const v of [goalTileView(0.5, 2), goalTileView(3, 2)]) {
      expect(JSON.stringify(v), 'never a plan move').not.toMatch(/borrow|buy|repay|hold|plan/i);
    }
  });

  it('⭐ GOAL TILE — nothing to show: no goal, or net coins that can\'t be read', () => {
    expect(goalTileView(0.5, null)).toBeNull();
    expect(goalTileView(null, 2)).toBeNull();
    expect(goalTileView(Number.NaN, 2)).toBeNull();
  });

  it('⭐ GOAL TILE — the tile renders exactly the view: its title, figure, bar and line, named for a screen reader', () => {
    const view = goalTileView(0.5, 2);
    if (view === null) throw new Error('premise');
    const html = renderToStaticMarkup(<GoalTile view={view} />);
    expect(html).toContain(`>${GOAL_TILE_TITLE}<`);
    expect(html).toContain('>₿0.500 of ₿2.000<');
    expect(html).toContain('>net coins today · 25%<');
    expect(html).toContain('width:25.0%');
    expect(html).toContain('aria-label="Your goal: 0.500 bitcoin in net coins today, of 2.000 — 25%."');
  });
});

describe('⭐ GOAL NOW — Settings → Your plan\'s reading (BL33): the tile\'s view, or net coins alone', () => {
  it('⭐ GOAL NOW — with a goal it IS the tile\'s view, under, at and past it', () => {
    for (const [net, goal] of [[0.5, 2], [2, 2], [3, 2], [1.9996, 2], [-0.2, 2], [2 * (1 - GOAL_EPS / 2), 2]] as const) {
      expect(goalNowView(net, goal), `${net} of ${goal}`).toEqual(goalTileView(net, goal));
    }
  });

  it('⭐ GOAL NOW — no goal: net coins today alone, no bar; a dust debt never reads as a negative zero', () => {
    expect(goalNowView(1.8, null)).toEqual({
      value: '₿1.800', sub: 'net coins today', fill: null, aria: 'Net coins today: 1.800 bitcoin.',
    });
    expect(goalNowView(-0.2, null)).toEqual({
      value: '−₿0.200', sub: 'net coins today', fill: null, aria: 'Net coins today: minus 0.200 bitcoin.',
    });
    expect(goalNowView(-0.0001, null)?.value, 'dust').toBe('₿0.000');
    expect(goalNowView(-0.0001, null)?.aria, 'dust').toBe('Net coins today: 0.000 bitcoin.');
    expect(JSON.stringify(goalNowView(1.8, null)), 'never a plan move').not.toMatch(/borrow|buy|repay|hold|plan/i);
  });

  it('⭐ GOAL NOW — nothing to show when net coins can\'t be read', () => {
    expect(goalNowView(null, 2)).toBeNull();
    expect(goalNowView(null, null)).toBeNull();
    expect(goalNowView(Number.NaN, null)).toBeNull();
    expect(goalNowView(Number.POSITIVE_INFINITY, 2)).toBeNull();
  });
});
