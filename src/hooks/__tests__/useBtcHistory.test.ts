import { describe, it, expect } from 'vitest';
import { parseCandles, RANGE_CFG } from '../useBtcHistory';

// Coinbase candles: [time(s), low, high, open, close, volume], returned NEWEST-FIRST.
const rows: number[][] = [
  [1700000180, 60, 70, 62, 68, 1.2],   // newest
  [1700000120, 59, 69, 61, 66, 1.0],
  [1700000060, 58, 68, 60, 64, 0.9],
  [1700000000, 57, 67, 59, 62, 0.8],   // oldest
];

describe('parseCandles', () => {
  it('sorts ascending by time, maps close (index 4), converts s → ms', () => {
    const out = parseCandles(rows, 10);
    expect(out.map((c) => c.t)).toEqual([
      1700000000000, 1700000060000, 1700000120000, 1700000180000,
    ]);
    expect(out.map((c) => c.price)).toEqual([62, 64, 66, 68]);   // close, ascending
    expect(out[0].t).toBe(rows[3][0] * 1000);
  });

  it('keeps only the newest `count` (after ascending sort)', () => {
    const out = parseCandles(rows, 2);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.price)).toEqual([66, 68]);   // the two most-recent closes
  });

  it('returns [] for empty/non-array input', () => {
    expect(parseCandles([], 10)).toEqual([]);
    expect(parseCandles(undefined as unknown as number[][], 10)).toEqual([]);
  });

  it('returns all rows when fewer than count, and filters malformed rows', () => {
    const out = parseCandles([[1700000000, 1, 2, 3, 50], [1, 2] as number[]], 10);
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe(50);
  });
});

describe('RANGE_CFG', () => {
  it('maps each range to a ≤300 granularity/count window', () => {
    expect(RANGE_CFG['1H']).toEqual({ granularity: 60,   count: 60  });
    expect(RANGE_CFG['1D']).toEqual({ granularity: 900,  count: 96  });
    expect(RANGE_CFG['1W']).toEqual({ granularity: 3600, count: 168 });
    for (const k of ['1H', '1D', '1W'] as const) {
      expect(RANGE_CFG[k].count).toBeLessThanOrEqual(300);
    }
  });
});
