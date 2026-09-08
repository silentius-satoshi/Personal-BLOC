import { describe, it, expect } from 'vitest';
import { parseMorphoRate, MORPHO_REALIZED_APY } from '../useMorphoRate';

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

describe('MORPHO_REALIZED_APY — the observed band the faces cite', () => {
  it('is ordered and plausible', () => {
    const b = MORPHO_REALIZED_APY;
    expect(b.p10).toBeLessThan(b.median);
    expect(b.median).toBeLessThan(b.p90);
    expect(b.p90).toBeLessThanOrEqual(b.max);
    expect(b.p10).toBeGreaterThan(0);
    expect(b.max).toBeLessThan(200);          // the IRM's MAX_RATE_AT_TARGET — a sanity ceiling, not a claim
  });

  it('⭐ excludes the market warm-up: p10 sits above the 1.6–3.1% opening months', () => {
    // Oct/Nov 2024 ran at 1.63% and 3.14% on a brand-new market's thin utilization. Folding those in
    // would drag the floor down for a reason that is a property of a NEW MARKET, not of this rate.
    expect(MORPHO_REALIZED_APY.p10).toBeGreaterThan(3.2);
  });

  it('states its own window, so the copy can never imply more history than exists', () => {
    expect(MORPHO_REALIZED_APY.months).toBeGreaterThan(0);
    expect(MORPHO_REALIZED_APY.months).toBeLessThan(48);   // one cycle — if this grows, re-run the query
    expect(MORPHO_REALIZED_APY.since).toMatch(/\w{3} \d{4}/);
  });
});
