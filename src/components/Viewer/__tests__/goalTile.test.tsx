// BL14 (G1-C, G2-A) — the Dashboard's goal tile: net coins TODAY against the owner's goal, for the owner and a trusted
// viewer only. Its words are pure (`goalTileView`); the tile composes nothing. ⚠ SYNTHETIC round figures (public repo).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { goalTileView, GOAL_TILE_TITLE } from '../goalTileView';
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
