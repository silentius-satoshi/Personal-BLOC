import { describe, it, expect } from 'vitest';
import { parseMorphoRate } from '../useMorphoRate';

describe('parseMorphoRate', () => {
  it('coerces the fraction borrowApy/netBorrowApy to percent (×100)', () => {
    const json = { data: { marketById: { state: { borrowApy: 0.0612, netBorrowApy: 0.05 } } } };
    expect(parseMorphoRate(json)).toEqual({ borrowApy: 6.12, netBorrowApy: 5.0 });
  });

  it('returns nulls (no crash) for malformed / empty / null shapes', () => {
    const nulls = { borrowApy: null, netBorrowApy: null };
    expect(parseMorphoRate(null)).toEqual(nulls);
    expect(parseMorphoRate(undefined)).toEqual(nulls);
    expect(parseMorphoRate({})).toEqual(nulls);
    expect(parseMorphoRate({ data: {} })).toEqual(nulls);
    expect(parseMorphoRate({ data: { marketById: { state: {} } } })).toEqual(nulls);
    expect(parseMorphoRate({ data: { marketById: { state: { borrowApy: 'x', netBorrowApy: NaN } } } })).toEqual(nulls);
    expect(parseMorphoRate('garbage')).toEqual(nulls);
  });

  it('coerces each field independently (one present, one missing)', () => {
    const json = { data: { marketById: { state: { borrowApy: 0.07 } } } };
    const out = parseMorphoRate(json);
    expect(out.borrowApy).toBeCloseTo(7, 6);
    expect(out.netBorrowApy).toBeNull();
  });
});
