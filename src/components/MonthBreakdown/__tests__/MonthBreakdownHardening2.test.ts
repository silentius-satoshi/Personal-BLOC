import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCollateralForTier } from '../../../simulation/runBlocYearOne';

/**
 * Hardening 2 — MonthBreakdown.tsx's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HE.json).
 * A component with no render harness, so its one call is pinned in the source; the helper's figure checked beside it.
 */
const SRC = readFileSync(join(process.cwd(), 'src/components/MonthBreakdown/MonthBreakdown.tsx'), 'utf8');

describe('Hardening 2 — MonthBreakdown', () => {
  it('HE-39 · engine.md "`getCollateralForTier` uses starting `btcPrice` — not per-month price" — the table sizes the tier at today\'s price, never the projected one', () => {
    expect(SRC, 'HE-39 the call reads the starting btcPrice')
      .toContain('const collateralBtc = getCollateralForTier(activeTier, expenses, btcPrice, sandboxBtc);');
    expect(SRC, 'HE-39 no projected price in the sizing').not.toMatch(/getCollateralForTier\([^)]*projectedPrice/);
    // What it would cost: the minimum tier (15%) for $5,000 a month at $100,000 is 1/3 ₿; at a bull path's $180,000 it
    // would read 1/1.8 of that.
    expect(getCollateralForTier('min', 5_000, 100_000, 0)).toBeCloseTo(5_000 / (0.15 * 100_000), 12);
  });
});
