import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CB_APR_SEED_PCT, CB_MARKET_APR_SEED_PCT, CB_PLATFORM_FEE_PCT, cbNetApr,
} from '../../simulation/runCoinbaseLoan';

/**
 * ⚠ REGRESSION GUARD for a defect the platform-fee change shipped with.
 *
 * That change moved the store's initial `cbAprPct` from 4.77 (a raw Morpho market rate) to the all-in
 * 6.27 — but FOUR other seed sites still hard-coded 4.77, and one of them (the OnboardingModal draft)
 * writes over the store default on first launch. So the "new owners get the corrected rate" claim was
 * false: every new owner still got the understated one, and the escape-hatch reset silently downgraded
 * anyone who used it.
 *
 * The fix was not to edit four literals — it was to stop having four literals. These tests fail if
 * anyone reintroduces one.
 */
const SEED_SITES = [
  'src/store/slices/cbLoanSlice.ts',        // fresh-install initial state
  'src/store/slices/viewerSlice.ts',        // clearViewerData + resetPlanToSeeds
  'src/components/Onboarding/OnboardingModal.tsx',  // the draft that overwrites the default
  'src/lib/demo/demoSeed.ts',               // demo mode
];

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('cbAprPct seed — one constant, four sites', () => {
  it('the seed is DERIVED from the platform fee, not typed', () => {
    expect(CB_APR_SEED_PCT).toBeCloseTo(CB_MARKET_APR_SEED_PCT + CB_PLATFORM_FEE_PCT, 10);
    expect(CB_APR_SEED_PCT).toBeCloseTo(6.27, 10);
    expect(cbNetApr(CB_MARKET_APR_SEED_PCT)).toBeCloseTo(CB_APR_SEED_PCT, 10);
    // Direction: the seed is the ALL-IN rate, so it must exceed the market rate it was built from.
    expect(CB_APR_SEED_PCT).toBeGreaterThan(CB_MARKET_APR_SEED_PCT);
  });

  it('⭐ no seed site hard-codes an APR — they all reference CB_APR_SEED_PCT', () => {
    for (const site of SEED_SITES) {
      const src = read(site);
      // Every cbAprPct assignment in a seed site must be the constant, never a number literal.
      const literals = [...src.matchAll(/cbAprPct:\s*([0-9][0-9.]*)/g)].map((m) => m[1]);
      expect(literals, `${site} hard-codes a cbAprPct literal: ${literals.join(', ')}`).toEqual([]);
      expect(src, `${site} does not use CB_APR_SEED_PCT`).toContain('CB_APR_SEED_PCT');
    }
  });

  it('⭐ the onboarding draft in particular — it OVERWRITES the store default on first launch', () => {
    // Singled out because it is the one that made the original fix a no-op for new owners.
    const src = read('src/components/Onboarding/OnboardingModal.tsx');
    expect(src).toContain('cbAprPct: CB_APR_SEED_PCT');
    expect(src).toContain('setCbAprPct(draft.cbAprPct)');   // still the write path this guards
  });
});
