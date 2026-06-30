import { describe, it, expect } from 'vitest';
import { PROVIDERS, isPlausibleHeight } from '../useChainTip';

/**
 * Almanac P3 — pure bits of useChainTip (no React lifecycle, no fetch harness): each provider's parse
 * extracts a height from its raw response shape, and the plausibility guard brackets the valid range.
 */
describe('useChainTip — PROVIDERS parse', () => {
  it('has the four explorers in the documented order', () => {
    expect(PROVIDERS.map((p) => p.name)).toEqual([
      'mempool.space',
      'blockstream.info',
      'blockchain.info',
      'blockchair.com',
    ]);
  });

  it('plain-text providers parse a bare number', () => {
    for (const name of ['mempool.space', 'blockstream.info', 'blockchain.info']) {
      const p = PROVIDERS.find((x) => x.name === name)!;
      expect(p.parse('880000')).toBe(880_000);
      expect(p.parse('880000\n')).toBe(880_000); // trailing newline tolerated by parseInt
    }
  });

  it('blockchair parses data.blocks from JSON', () => {
    const p = PROVIDERS.find((x) => x.name === 'blockchair.com')!;
    expect(p.parse(JSON.stringify({ data: { blocks: 880_000 } }))).toBe(880_000);
  });

  it('blockchair returns undefined on a malformed shape (guarded downstream)', () => {
    const p = PROVIDERS.find((x) => x.name === 'blockchair.com')!;
    expect(p.parse(JSON.stringify({ nope: true }))).toBeUndefined();
  });
});

describe('useChainTip — isPlausibleHeight', () => {
  it('accepts an in-range height', () => {
    expect(isPlausibleHeight(880_000)).toBe(true);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isPlausibleHeight(700_000)).toBe(false);   // below the floor
    expect(isPlausibleHeight(2_500_000)).toBe(false);  // above the ceiling
    expect(isPlausibleHeight(NaN)).toBe(false);
    expect(isPlausibleHeight(undefined as unknown as number)).toBe(false);
  });
});
