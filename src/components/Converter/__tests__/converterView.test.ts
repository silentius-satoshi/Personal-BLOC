import { describe, it, expect } from 'vitest';
import { rateRows, RATE_SATS } from '../converterView';

/**
 * The Sats face's rates (spec `pbloc-spec-sats-rates-v1.md`): the rows under the converter, pure. D1 — the cells carry
 * no unit words (the column headers name them). S4 — with no price the dollar column reads "—", never "$0.000000".
 * Round figures only. Each ⭐ names the mutation that turns it red.
 */

describe('⭐ rateRows — the nine rows under the converter', () => {
  it('⭐ at $82,000: 1 → 100,000,000 sats, every cell exact, no unit words (D1)', () => {
    // mutation V3: the unit words back ("丰 1,000 Satoshis", "₿ 0.00001000 BTC") → red
    // The dollar column covers fmtUsdLocal's three bands: 6 decimals under a cent, 4 under a dollar, then 2, grouped.
    expect(rateRows(82_000).map((r) => [r.sats, r.satsText, r.btcText, r.usdText])).toEqual([
      [1,           '丰 1',           '₿ 0.00000001', '$0.000820'],
      [10,          '丰 10',          '₿ 0.00000010', '$0.008200'],
      [100,         '丰 100',         '₿ 0.00000100', '$0.0820'],
      [1_000,       '丰 1,000',       '₿ 0.00001000', '$0.8200'],
      [10_000,      '丰 10,000',      '₿ 0.00010000', '$8.20'],
      [100_000,     '丰 100,000',     '₿ 0.00100000', '$82.00'],
      [1_000_000,   '丰 1,000,000',   '₿ 0.01000000', '$820.00'],
      [10_000_000,  '丰 10,000,000',  '₿ 0.10000000', '$8,200.00'],
      [100_000_000, '丰 100,000,000', '₿ 1.00000000', '$82,000.00'],
    ]);
  });

  it('⭐ S4 — with no price every dollar cell is "—"; the sats and bitcoin cells keep their text', () => {
    // mutations V1: the guard dropped ("$0.000000" at 0); V2: `> 0` → `>= 0` (red at 0); V2b: `Number.isFinite`
    // dropped ("$∞" at Infinity) → red. The other two cells are compared with the priced rows, never with literals,
    // so V3 turns only the test above red.
    const priced = rateRows(82_000).map((r) => [r.sats, r.satsText, r.btcText]);
    for (const price of [0, -1, NaN, Infinity]) {
      const rows = rateRows(price);
      expect(rows.map((r) => r.usdText), `price ${price}`).toEqual(RATE_SATS.map(() => '—'));
      expect(rows.map((r) => [r.sats, r.satsText, r.btcText]), `price ${price}`).toEqual(priced);
    }
  });
});
