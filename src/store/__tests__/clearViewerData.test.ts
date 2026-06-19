import { describe, it, expect } from 'vitest';
import { useStore } from '../useStore';
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
