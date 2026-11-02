import { describe, it, expect } from 'vitest';
import { useStore } from '../useStore';
import { resetViewerSession, applyViewerSnapshot } from '../../lib/nostr/viewerSync';
import { viewerTier } from '../../components/Layout/viewerAccess';
import type { MonthlyLogEntry } from '../../simulation/types';

// Data-remanence fix: clearViewerData() must wipe every viewer-hydrated financial/records/strike field back to
// its seed so decrypted data never outlives the authorizing key.
describe('clearViewerData', () => {
  it('⭐ WIPE — resets viewer-hydrated fields (financial settings, records, strike) to their seeds; since BL48 the owner\'s cold moves and colours too', () => {
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
    useStore.setState({
      dayLog: [{ id: 'day-1', date: '2026-01-01', ts: 1, kind: 'draw', amount: 1 }],
      deletedDayEvents: { 'day-1': 2 }, coldStorageBtc: 0.4, coldStorageBtcAsOf: 1_700_000_000_000, pinnedScenario: { label: 'old', pinnedAt: 1, btcPrice: 1, inputs: {} } as never,
      planEvents: [{ id: 'plan-1', ts: 1, device: 'd', kind: 'set', field: 'income', value: 9 }],
      planDirty: true, prefsDirty: true, recordsDirty: true,
      viewerColdMovedByMonth: { 1: 0.1 }, venueColors: { strike: '#38bdf8' }, simpleMode: false,   // BL48
    } as never);
    s.setViewerDataLoaded(true);

    useStore.getState().clearViewerData();
    const after = useStore.getState();

    // records + strike
    expect(after.monthlyLog).toEqual([]);
    expect(after.deletedMonths).toEqual({});
    expect(after.strikeUsdBalance).toBeNull();
    expect(after.strikeBtcAvailable).toBeNull();
    expect(after.strikeRate).toBeNull();
    expect(after.dayLog).toEqual([]);
    expect(after.deletedDayEvents).toEqual({});
    expect(after.coldStorageBtc).toBe(0);
    expect(after.coldStorageBtcAsOf).toBeNull();
    expect(after.planEvents).toEqual([]);
    expect(after.planDirty).toBe(false);
    expect(after.prefsDirty).toBe(false);
    expect(after.recordsDirty).toBe(false);
    // representative financial settings → seeds
    expect(after.income).toBe(4000);
    expect(after.expenses).toBe(3500);
    expect(after.cbLoanBalance).toBe(60000);
    expect(after.advisorActualBlocBalance).toBe(0);
    // the loaded gate flag
    expect(after.viewerDataLoaded).toBe(false);
    // ⭐ WIPE (BL48 — a demotion runs it first, V6 A) — the owner's cold moves (V2 A) and his colours leave with the
    // figures; the layout stays (a viewer's pages don't follow it). mutations: either line dropped from clearViewerData → red
    expect(after.viewerColdMovedByMonth, 'WIPE the cold moves').toBeNull();
    expect(after.venueColors, 'WIPE the colours').toBeUndefined();
    expect(after.simpleMode, 'WIPE the layout kept').toBe(false);
  });
});

// BL48 — the apply fails closed: a trusted snapshot that throws part-way (a malformed one) leaves the device wiped — never
// loaded without its safe block, which the tier reads as trusted: the Almanac opened for a safe viewer on the seed's figures.
describe('applyViewerSnapshot fails closed (BL48)', () => {
  it('⭐ CLOSED — a trusted snapshot that can\'t apply wipes the device: never loaded without the safe block, never a tier', () => {
    const s = useStore.getState();
    s.setViewerMode(true);
    applyViewerSnapshot({ snapshotVersion: 2, privacyMode: 'safe', asOf: 1, hasCbLoan: false, btcPriceAtSnapshot: 100000,
      thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: 0.86 }, safety: {} } as never);
    const was = useStore.getState();
    expect([was.viewerDataLoaded, was.viewerSafeSnapshot !== null, viewerTier(was)], 'CLOSED premise: a safe viewer').toEqual([true, true, 'safe']);
    // A trusted-shaped snapshot whose settings aren't an object: applyViewerSettings throws after the safe block went.
    expect(() => applyViewerSnapshot({ snapshotVersion: 2, privacyMode: 'trusted', asOf: 2, settings: 'x' } as never), 'CLOSED premise: it throws')
      .toThrow();
    const now = useStore.getState();
    expect([now.viewerDataLoaded, now.viewerSafeSnapshot, viewerTier(now)], 'CLOSED wiped: not loaded, no safe block, no tier')
      .toEqual([false, null, null]);
    s.setViewerMode(false);
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
    s.setViewerDisplayName('Viewer');
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
