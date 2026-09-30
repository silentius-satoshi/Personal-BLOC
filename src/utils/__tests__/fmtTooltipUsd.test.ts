import { describe, it, expect } from 'vitest';
import { fmtTooltipUsd } from '../format';

/**
 * P1 (Power Law polish spec) — ONE tooltip price formatter, shared by the Decision and Power Law tooltips. `fmtUSD`
 * rounds to whole dollars, so both tooltips printed "$0" for a real sub-50¢ price (blockchain.info's series reads
 * $0.07 from 2010-08-18), and the power-law bands near GENESIS reach ~1e-12, where a naive String() prints exponent
 * notation. Round synthetic figures only.
 */

/** A positive price that prints with no digit 1–9 reads as zero. */
const readsZero = (s: string): boolean => !/[1-9]/.test(s);

describe('⭐ fmtTooltipUsd — never "$0" for a positive price (P1)', () => {
  it('⭐ whole dollars from $1; two significant digits below; "under $0.01" below a cent; "—" for nothing', () => {
    // mutations: fmtUSD for every value → "$0" at $0.04; drop the sub-cent branch → 1e-12 prints 13 decimals
    expect(fmtTooltipUsd(0.04)).toBe('$0.04');
    expect(fmtTooltipUsd(0.07)).toBe('$0.07');
    expect(fmtTooltipUsd(0.045)).toBe('$0.045');
    expect(fmtTooltipUsd(0.5)).toBe('$0.50');
    expect(fmtTooltipUsd(0.996)).toBe('$1');          // rounds up to a dollar, never "$1.0"
    expect(fmtTooltipUsd(1)).toBe('$1');
    expect(fmtTooltipUsd(64_468.2)).toBe('$64,468');
    expect(fmtTooltipUsd(0.004)).toBe('under $0.01');
    expect(fmtTooltipUsd(1e-12)).toBe('under $0.01');
    for (const junk of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(fmtTooltipUsd(junk), `${junk}`).toBe('—');
  });

  it('⭐ a log-spaced sweep, 1e-15 … 1e7: nothing reads as zero, nothing prints in exponent notation', () => {
    // mutations: fmtUSD for every value → "$0" reads as zero; String(v) below a cent → "$1e-12"
    let checked = 0;
    for (let e = -15; e <= 7; e += 0.25) {
      const v = 10 ** e;
      const s = fmtTooltipUsd(v);
      expect(readsZero(s), `${v} → ${s}`).toBe(false);
      expect(s, `${v} → ${s}`).not.toMatch(/\de[+-]?\d/i);
      checked++;
    }
    expect(checked).toBeGreaterThan(80);   // non-vacuous: 89 prices from 1e-15 to 1e7
  });
});
