import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⭐ STRIKE 85 (BL53, Sweep 2b) — the Ownership face says what the engine does (`supportPolicy.ts`, the terms the owner
 * confirmed on 2026-09-22): at the 70% margin call the owner has 72 hours to cure; at the liquidation LTV (85% by
 * default) Strike sells at once. Its tile and its disclaimer gave the 72-hour cure to 85%; v1.1 — so did the CB Loan
 * tab's Strike-vs-Coinbase table ("after failed margin call") and six lines of the book.
 */
describe('STRIKE 85 — the 72-hour cure is the 70% call\'s, not 85%\'s: the Ownership face, the CB Loan tab, the book (BL53)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/Almanac/OwnershipFace.tsx'), 'utf8');
  const flat = src.replace(/\s+/g, ' ');
  it('⭐ STRIKE 85 — the Strike LTV tile: the liquidation LTV the price is figured at, instant', () => {
    expect(src, 'STRIKE 85 the tile').toContain('`liq ${fmtLiqK(strikeLiq)} · ${Math.round(strikeLiqLtv * 100)}% instant`');
    expect(src, 'STRIKE 85 the tile\'s cure gone').not.toContain('85%, 72h cure');
  });
  it('⭐ STRIKE 85 — the disclaimer, the CB Loan table and the book: the call\'s 72-hour cure, the liquidation\'s none', () => {
    expect(flat, 'STRIKE 85 the disclaimer').toContain('margin call at {Math.round(STRIKE_MARGIN_CALL_LTV * 100)}% with a '
      + '72-hour cure, partial liquidation at {Math.round(strikeLiqLtv * 100)}% with no cure window.');
    expect(flat, 'STRIKE 85 the disclaimer\'s cure at liquidation gone').not.toContain('% with a 72-hour cure. Coinbase');
    const tab = readFileSync(join(process.cwd(), 'src/components/CoinbaseLoan/CoinbaseLoanMain.tsx'), 'utf8');
    expect(tab, 'STRIKE 85 the CB Loan table').toContain("'85% — at once, no cure window'");
    expect(tab, 'STRIKE 85 the CB Loan table\'s failed call gone').not.toContain('after failed margin call');
    const BOOK: [string, string, string][] = [
    ['ch00-about.md', 'margin-calls at 70%, and partially liquidates at 85% on a 72-hour window.', 'margin-calls at 70% with 72 hours to cure, and partially liquidates at 85% at once, with no cure window.'],
    ['ch01-introduction.md', 'Strike 65% warn / 70% margin call / 85% partial liquidation (72h)', 'Strike 65% warn / 70% margin call (72 hours to cure) / 85% partial liquidation (at once, no cure — BL53)'],
    ['ch09-safety-dashboard.md', 'margin-call at 70%, and partially liquidate at 85% with a 72-hour window.', 'margin-call at 70% with 72 hours to cure, and partially liquidate at 85% at once.'],
    ['ch09-safety-dashboard.md', '65 warn / 70 margin call / 85 partial liq (72h)', '65 warn / 70 margin call (72h cure) / 85 partial liq (at once)'],
    ['ch09-safety-dashboard.md', 'Strike terms 65 / 70 / 85 (72h)', 'Strike terms 65 / 70 (72h cure) / 85 (at once)'],
    ['ch19-appendix-data-and-events.md', 'the 0.85 partial liquidation runs on a 72-hour window', 'the 0.70 margin call gives 72 hours to cure; the 0.85 partial liquidation sells at once'],
    ];
    for (const [f, gone, now] of BOOK) {
      const text = readFileSync(join(process.cwd(), 'book', f), 'utf8');
      expect(text, `STRIKE 85 the book, ${f}`).toContain(now);
      expect(text, `STRIKE 85 the book, ${f}: the cure at 85% gone`).not.toContain(gone);
    }
  });
});
