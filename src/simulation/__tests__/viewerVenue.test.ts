import { describe, it, expect } from 'vitest';
import { deriveVenueSplit } from '../viewerVenue';
import { useStore } from '../../store/useStore';
import { buildViewerSnapshotPayload } from '../../store/payloads';

describe('deriveVenueSplit', () => {
  it('splits evenly when both venues hold the same amount', () => {
    const v = deriveVenueSplit(1, 1);
    expect(v.strikeShare).toBeCloseTo(0.5, 12);
    expect(v.cbShare).toBeCloseTo(0.5, 12);
    expect(v.combinedBtc).toBeCloseTo(2, 12);
    expect(v.hasData).toBe(true);
  });

  it('reports the real position (0.966 / 1.728) as ~36% Strike / ~64% Coinbase', () => {
    const v = deriveVenueSplit(0.96589757, 1.72572674);
    expect(v.strikeShare).toBeCloseTo(0.359, 3);
    expect(v.cbShare).toBeCloseTo(0.641, 3);
    expect(v.combinedBtc).toBeCloseTo(2.69162431, 8);
  });

  it('a single-venue stack is 100% / 0%', () => {
    const only = deriveVenueSplit(2.5, 0);
    expect(only.strikeShare).toBe(1);
    expect(only.cbShare).toBe(0);
    expect(only.hasData).toBe(true);

    const inverse = deriveVenueSplit(0, 2.5);
    expect(inverse.strikeShare).toBe(0);
    expect(inverse.cbShare).toBe(1);
    expect(inverse.hasData).toBe(true);
  });

  it('an empty stack reports hasData:false with NO NaN anywhere in the object', () => {
    const v = deriveVenueSplit(0, 0);
    expect(v.hasData).toBe(false);
    for (const [k, n] of Object.entries(v)) {
      if (typeof n === 'number') expect(Number.isFinite(n), `${k} must be finite`).toBe(true);
    }
    expect(v).toEqual({
      strikeBtc: 0, cbBtc: 0, combinedBtc: 0, strikeShare: 0, cbShare: 0, hasData: false,
    });
  });

  it('clamps negative inputs to 0 rather than producing negative or out-of-range shares', () => {
    const v = deriveVenueSplit(-5, 2);
    expect(v.strikeBtc).toBe(0);
    expect(v.strikeShare).toBe(0);
    expect(v.cbShare).toBe(1);
    expect(v.combinedBtc).toBe(2);

    const both = deriveVenueSplit(-5, -2);
    expect(both.hasData).toBe(false);
    expect(both.strikeShare).toBeGreaterThanOrEqual(0);
    expect(both.cbShare).toBeGreaterThanOrEqual(0);
  });

  it('survives non-finite inputs without emitting NaN', () => {
    for (const v of [deriveVenueSplit(NaN, 1), deriveVenueSplit(1, Infinity), deriveVenueSplit(NaN, NaN)]) {
      expect(Number.isFinite(v.strikeShare)).toBe(true);
      expect(Number.isFinite(v.cbShare)).toBe(true);
      expect(Number.isFinite(v.combinedBtc)).toBe(true);
    }
  });

  it('shares always sum to 1 whenever hasData is true', () => {
    const cases: [number, number][] = [[1, 1], [0.96589757, 1.72572674], [3, 0], [0, 3], [0.00001, 99]];
    for (const [a, b] of cases) {
      const v = deriveVenueSplit(a, b);
      expect(v.hasData).toBe(true);
      expect(v.strikeShare + v.cbShare).toBeCloseTo(1, 12);
      expect(v.strikeShare).toBeGreaterThanOrEqual(0);
      expect(v.cbShare).toBeLessThanOrEqual(1);
    }
  });
});

describe('the safe-mode gate is structural, not cosmetic', () => {
  it('⭐ a C-safe snapshot carries NEITHER collateral scalar — the venue bar cannot render there', () => {
    // The bar needs two ABSOLUTE BTC figures. The C-safe branch carries no absolutes by construction, so
    // "safe mode hides the bar" is not a UI decision that could be forgotten — the inputs do not exist.
    // Deliberately overlaps viewerSnapshot.test.ts's own Object.keys audit; this one fails with a message
    // naming the venue bar, so a future widening of the safe branch surfaces THIS coupling too.
    const snap = buildViewerSnapshotPayload(useStore.getState(), 'safe');
    expect(snap.privacyMode).toBe('safe');
    expect('strikeCollateralBtc' in snap, 'C-P4: the Strike scalar is trusted-only').toBe(false);
    expect('cbCollateralBtc' in snap, 'BUG2: the CB scalar is trusted-only').toBe(false);
  });

  it('a C-trusted snapshot carries both — which is why the bar can render there', () => {
    const snap = buildViewerSnapshotPayload(useStore.getState(), 'trusted');
    expect(snap.privacyMode).toBe('trusted');
    expect(typeof snap.strikeCollateralBtc).toBe('number');
    expect(typeof snap.cbCollateralBtc).toBe('number');
  });
});
