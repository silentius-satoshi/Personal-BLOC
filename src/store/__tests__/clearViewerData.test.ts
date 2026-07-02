import { describe, it, expect } from 'vitest';
import { useStore } from '../useStore';
import { resetViewerSession } from '../../lib/nostr/viewerSync';
import type { MonthlyLogEntry } from '../../simulation/types';

// Data-remanence fix: clearViewerData() must wipe every viewer-hydrated financial/records/strike field back to
// its seed so decrypted data never outlives the authorizing key.
describe('clearViewerData', () => {
  it('resets viewer-hydrated fields (financial settings, records, strike) to their seeds', () => {
    const s = useStore.getState();
    // Simulate a previous valid viewer session having hydrated real data.
    s.setIncome(9999);
    s.setExpenses(8888);
    s.setCbLoanBalance(123456);
    s.setAdvisorActualBlocBalance(50000);
    s.setMonthlyLog([{ month: 1, btcBought: 0.01, btcHeld: 0.01 } as MonthlyLogEntry]);
    s.setDeletedMonths({ 3: Date.now() });
    s.setStrikeUsdBalance(4321);
    s.setStrikeBtcAvailable(0.5);
    s.setStrikeRate(95000);
    s.setViewerDataLoaded(true);

    useStore.getState().clearViewerData();
    const after = useStore.getState();

    // records + strike
    expect(after.monthlyLog).toEqual([]);
    expect(after.deletedMonths).toEqual({});
    expect(after.strikeUsdBalance).toBeNull();
    expect(after.strikeBtcAvailable).toBeNull();
    expect(after.strikeRate).toBeNull();
    // representative financial settings → seeds
    expect(after.income).toBe(4000);
    expect(after.expenses).toBe(3500);
    expect(after.cbLoanBalance).toBe(60000);
    expect(after.advisorActualBlocBalance).toBe(0);
    // the loaded gate flag
    expect(after.viewerDataLoaded).toBe(false);
  });
});

// Viewer V4 — the shared sign-out/reset teardown must clear EVERYTHING the connect created (name, key,
// mode, writer) so a signed-out device retains no residue and lands undecided → the fork.
describe('resetViewerSession (viewer sign-out teardown)', () => {
  it('clears viewerDisplayName + viewerMode + writer pubkey + wrapped key + re-arms onboarding', () => {
    const s = useStore.getState();
    s.setViewerMode(true);
    s.setViewerWriterPubkey('o'.repeat(64));
    s.setViewerKeyWrapped('wrapped-ciphertext');
    s.setViewerDisplayName('Dad');
    s.setOnboardingComplete(true);

    resetViewerSession();
    const after = useStore.getState();

    expect(after.viewerDisplayName).toBeNull();     // V3 name — no residue
    expect(after.viewerMode).toBe(false);
    expect(after.viewerWriterPubkey).toBeNull();
    expect(after.viewerKeyWrapped).toBeNull();      // wrapped key cleared
    expect(after.viewerUnlocked).toBe(false);       // in-memory holder cleared (setUnwrappedViewerKey(null))
    expect(after.onboardingComplete).toBe(false);   // undecided device → the fork renders
  });
});
