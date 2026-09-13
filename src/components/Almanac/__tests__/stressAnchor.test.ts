import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { isAnchorHeld, stressAnchorPrice, anchorDrift, applyPathStress } from '../cyclingFaceView';
import { plConvergencePath } from '../../../simulation/powerLaw';

/**
 * ⚠ REGRESSION GUARD — the price-stress lens used to die on its own.
 *
 * `useBtcPrice` polls spot every 10s and pushes to the store on a 0.1% move OR after 60s, whichever
 * comes first. Every push rewrote `s.btcPrice` → rebuilt `pricePath` → tripped both faces' "an input
 * changed, drop the stale scenario" effect. So an engaged lens reset to "as modeled" within a minute
 * and typically within seconds, discarding the whole scenario the owner was reading.
 */
describe('stress anchor', () => {
  const LIVE = 80_000;

  describe('isAnchorHeld', () => {
    it('holds only while the lens is engaged AND the price is coming from the live feed', () => {
      expect(isAnchorHeld(0.8, 'live')).toBe(true);
      expect(isAnchorHeld(1.4, 'live')).toBe(true);
      expect(isAnchorHeld(1, 'live')).toBe(false);      // "as modeled" — nothing to protect
    });

    it('⭐ never holds in manual mode — there every price change IS the owner, and must still reset', () => {
      // Nothing polls in manual mode (the store push is gated on btcPriceMode === 'live'), so a change
      // there is a deliberate edit. Pinning it would swallow the owner's own input.
      expect(isAnchorHeld(0.8, 'manual')).toBe(false);
      expect(isAnchorHeld(1, 'manual')).toBe(false);
    });
  });

  describe('stressAnchorPrice', () => {
    it('tracks the live quote when nothing is held', () => {
      expect(stressAnchorPrice(LIVE, null, false)).toBe(LIVE);
      expect(stressAnchorPrice(LIVE, 77_000, false)).toBe(LIVE);   // a stale anchor never leaks through
    });

    it('⭐ ignores the live quote while held — this is the whole fix', () => {
      expect(stressAnchorPrice(80_120, 80_000, true)).toBe(80_000);
      expect(stressAnchorPrice(91_000, 80_000, true)).toBe(80_000);
    });

    it('⭐ falls back to live on the latching render, so ENGAGING the lens never moves the path', () => {
      // The anchor is latched in an effect, which runs after the render that engages the lens: on that
      // render held is already true while anchor is still null. Falling back reproduces the price the
      // previous render used, so pricePath is byte-identical and the reset effect cannot fire.
      expect(stressAnchorPrice(LIVE, null, true)).toBe(LIVE);
    });

    it('a corrupt anchor degrades to the live quote rather than poisoning the path', () => {
      for (const bad of [NaN, 0, -1, Number.POSITIVE_INFINITY]) {
        expect(stressAnchorPrice(LIVE, bad, true)).toBe(LIVE);
      }
    });
  });

  describe('⭐ end to end: a scenario survives the poll it used to die on', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const path = (p: number) => plConvergencePath(p, 'fair', start, 24, 12);

    it('the live poll used to rebuild pricePath — reproducing the defect', () => {
      // A 0.1% move is the push threshold. Before the anchor, this reached plConvergencePath directly.
      const before = path(LIVE);
      const after  = path(LIVE * 1.001);
      expect(after).not.toEqual(before);   // ← the input change the reset effect was reacting to
    });

    it('with the anchor held, the same poll leaves the path identical — so the lens survives', () => {
      const engaged = path(stressAnchorPrice(LIVE, null, true));           // latching render
      const latched = path(stressAnchorPrice(LIVE, LIVE, true));           // anchor stored
      const ticked  = path(stressAnchorPrice(LIVE * 1.001, LIVE, true));   // poll lands
      const jumped  = path(stressAnchorPrice(LIVE * 1.14, LIVE, true));    // a big move lands
      expect(latched).toEqual(engaged);
      expect(ticked).toEqual(engaged);
      expect(jumped).toEqual(engaged);
      // ...and the stressed path the owner is reading is therefore stable too.
      expect(applyPathStress(ticked, 6, 0.7)).toEqual(applyPathStress(engaged, 6, 0.7));
    });

    it('⭐ releasing the lens returns the face to live — the anchor is not sticky', () => {
      const moved = LIVE * 1.14;
      expect(path(stressAnchorPrice(moved, LIVE, isAnchorHeld(1, 'live')))).toEqual(path(moved));
    });

    it('⭐ a deliberate change still resets: manual mode is never pinned', () => {
      const typed = 65_000;
      expect(stressAnchorPrice(typed, LIVE, isAnchorHeld(0.8, 'manual'))).toBe(typed);
      expect(path(typed)).not.toEqual(path(LIVE));   // ← reset effect still fires, as it must
    });
  });
});

describe('⭐ no face feeds the live quote straight into the path again', () => {
  it('both Almanac faces build plConvergencePath from the anchor, never from s.btcPrice', () => {
    // The regression is a one-token edit away: swapping `anchorPrice` back for `s.btcPrice` compiles
    // clean, passes every other test, and silently restores the self-resetting lens.
    const hits = execSync(
      'grep -rn "plConvergencePath(s\\.btcPrice" src/components/ --exclude-dir=__tests__ || true',
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    expect(hits, `live quote wired into the path:\n${hits.join('\n')}`).toEqual([]);
  });

  it('both faces do call it with the anchor', () => {
    const hits = execSync(
      'grep -rln "plConvergencePath(anchorPrice" src/components/Almanac/ --exclude-dir=__tests__ || true',
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean).sort();
    expect(hits).toEqual([
      'src/components/Almanac/CyclingFace.tsx',
      'src/components/Almanac/OwnershipFace.tsx',
    ]);
  });
});

describe('⭐ anchorDrift — the scenario freezes, the market readout does not', () => {
  const LIVE = 80_000;

  it('reports how far spot has run from the held anchor', () => {
    expect(anchorDrift(81_200, 80_000, true)).toBeCloseTo(0.015, 9);
    expect(anchorDrift(78_400, 80_000, true)).toBeCloseTo(-0.02, 9);
    expect(anchorDrift(80_000, 80_000, true)).toBe(0);
  });

  it('is 0 when nothing is held — there is no anchor to drift from', () => {
    expect(anchorDrift(81_200, 80_000, false)).toBe(0);
  });

  it('never divides by a junk anchor', () => {
    for (const bad of [0, -1, NaN, Number.POSITIVE_INFINITY]) {
      expect(anchorDrift(LIVE, bad, true)).toBe(0);
    }
    expect(anchorDrift(NaN, 80_000, true)).toBe(0);
  });

  it('⭐ the two live side by side: the path is frozen while spot and drift keep moving', () => {
    // This is the whole point of the pair — one poll, two different answers, both correct.
    const anchor = stressAnchorPrice(90_000, LIVE, true);
    expect(anchor).toBe(LIVE);                                 // scenario: unmoved
    expect(anchorDrift(90_000, anchor, true)).toBeCloseTo(0.125, 9);   // market: +12.5%, reported live

    // ...and a later quote moves the readout again without touching the anchor.
    expect(stressAnchorPrice(95_000, LIVE, true)).toBe(LIVE);
    expect(anchorDrift(95_000, LIVE, true)).toBeCloseTo(0.1875, 9);
  });
});
