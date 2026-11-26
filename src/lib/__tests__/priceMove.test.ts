import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineChangePct, lineRange } from '../priceMove';

/**
 * ⚠ A price line's move (BL67) — ONE expression for the Dashboard chart's "(1D)" and the Engine's price bar, so the two
 * never disagree. Synthetic, round prices. Each assertion carries its tag.
 */
const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('⭐ a price line\'s move', () => {
  it('⭐ MOVE — the last price against the first, in percent; none with under two prices or a first that isn\'t above 0', () => {
    expect(lineChangePct([{ price: 100 }, { price: 99 }, { price: 102 }]), 'MOVE up 2%').toBeCloseTo(2, 12);
    expect(lineChangePct([{ price: 100 }, { price: 99 }]), 'MOVE down 1%').toBeCloseTo(-1, 12);
    expect(lineChangePct([{ price: 100 }, { price: 100 }]), 'MOVE flat').toBe(0);
    expect([lineChangePct([]), lineChangePct([{ price: 100 }]), lineChangePct([{ price: 0 }, { price: 5 }])], 'MOVE none')
      .toEqual([null, null, null]);
  });

  it('⭐ RANGE — the lowest and the highest price on the line, wherever they fall', () => {
    expect(lineRange([{ price: 3 }, { price: 1 }, { price: 5 }, { price: 2 }]), 'RANGE').toEqual({ lo: 1, hi: 5 });
    expect(lineRange([{ price: 3 }, { price: 1 }, { price: 7 }]), 'RANGE the live price last can be the high').toEqual({ lo: 1, hi: 7 });
    expect(lineRange([{ price: 3 }, { price: 4 }, { price: 1 }]), 'RANGE …or the low').toEqual({ lo: 1, hi: 4 });
    expect([lineRange([]), lineRange([{ price: 4 }])], 'RANGE none under two prices').toEqual([null, null]);
  });

  it('⭐ ONE MOVE — the Dashboard chart and the Engine\'s bar read the one expression; neither computes its own', () => {
    const chart = read('src/components/SimpleMode/PriceChart.tsx');
    expect(chart, 'ONE MOVE the chart\'s "(1D)"').toContain('const changePct = lineChangePct(series) ?? 0;');
    expect(chart, 'ONE MOVE no move of its own').not.toMatch(/\(last - first\)|\/ first/);
    const view = read('src/components/Engine/engineView.ts');
    expect(view, 'ONE MOVE the bar\'s pill').toContain('const pct = line !== null ? lineChangePct(line) : null;');
    expect(view, 'ONE MOVE the bar\'s range').toContain("const range = feed === 'live' && line !== null ? lineRange(line) : null;");
    const plate = read('src/components/Engine/EnginePlate.tsx');
    expect(plate, 'ONE MOVE the chart\'s 1D history').toContain("const { candles, asOf } = useBtcHistory('1D');");
    expect(plate, 'ONE MOVE the chart\'s line: the live price last, while the history is fresh')
      .toMatch(/if \(asOf !== null\) return null;[\s\S]*return withLivePoint\(candles, tick, true\);/);
    expect(read('src/components/SimpleMode/PriceChart.tsx'), 'ONE MOVE premise: the chart\'s own line')
      .toContain('withLivePoint(candles, live, asOf === null)');
  });
});
