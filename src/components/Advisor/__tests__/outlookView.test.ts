import { describe, it, expect } from 'vitest';
import { scenarioSubtitle, lineStep, footerCbLtv } from '../outlookView';

describe('scenarioSubtitle', () => {
  it('⭐ the 4-yr cycle has its own label — never the old ternary fall-through to the bull case', () => {
    expect(scenarioSubtitle('fourYear', 33)).toBe('4-yr cycle');
    expect(scenarioSubtitle('fourYear', 33)).not.toBe(scenarioSubtitle('bull', 33));
  });

  it('keeps the four existing labels byte-identical', () => {
    expect(scenarioSubtitle('flat', 33)).toBe('Flat BTC');
    expect(scenarioSubtitle('bear', 33)).toBe('−30%/yr bear');
    expect(scenarioSubtitle('powerlaw', 33)).toBe('Power Law ~33%/yr');
    expect(scenarioSubtitle('bull', 33)).toBe('+80%/yr bull');
  });
});

// ⚠ NAMED TRAP — the month-1 step. The sign depends on the anchor, so the copy prints this value and never
// words a direction. Synthetic round figures.
describe('lineStep — the month-1 step, signed and computed', () => {
  it('⭐ a step DOWN carries a typographic minus', () => {
    expect(lineStep([80_000, 65_280]).stepPct).toBe('−18.4%');
  });

  it('⭐ a step UP carries a plus', () => {
    expect(lineStep([60_000, 65_280]).stepPct).toBe('+8.8%');
  });

  it('degenerate paths are a zero step, never NaN', () => {
    for (const p of [[], [80_000], [0, 65_000], [80_000, NaN]]) {
      expect(lineStep(p).step).toBe(0);
      expect(lineStep(p).stepPct).toBe('+0.0%');
    }
  });
});

describe('footerCbLtv', () => {
  it('is the LAST ROW\'s own cbLtv — not a re-pricing of the final balance at some other price', () => {
    // A re-price at a live price would give 30_000 / (1 × 80_000) = 0.375; the row says 0.42.
    expect(footerCbLtv([{ cbLtv: 0.5 }, { cbLtv: 0.42 }])).toBe(0.42);
  });

  it('is 0 for an empty projection', () => {
    expect(footerCbLtv([])).toBe(0);
  });
});
