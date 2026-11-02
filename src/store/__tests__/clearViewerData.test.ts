import { describe, it, expect } from 'vitest';
import { useStore } from '../useStore';
import { buildViewerSnapshotPayload } from '../payloads';
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

// BL48 — the apply fails closed: a trusted snapshot that can't apply leaves the device wiped — never loaded without its safe
// block, which the tier reads as trusted: the Almanac opened for a safe viewer on the seed's figures. Twice since the
// independent check: one that isn't well-formed is refused before any of it applies (SHAPE — `settings: null` threw
// nothing and got through), and one that still throws part-way wipes in the catch (CLOSED).
const SAFE = { snapshotVersion: 2, privacyMode: 'safe', asOf: 1, hasCbLoan: false, btcPriceAtSnapshot: 100000,
  thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: 0.86 }, safety: {} };

/** The owner's trusted payload as his viewer's device receives it: the real builder over a store with his figures — a
 *  logged month, an income and a Strike rate of his own — then JSON, as the relay path decrypts it. */
function ownersPayload(): Record<string, any> {
  const s = useStore.getState();
  s.setViewerMode(false);
  s.setIncome(5200);
  s.setMonthlyLog([{ month: 1, date: '2026-01-01', btcBought: 0.01, income: 5200, paydown: 0, strikeBal: 0, strikeLtv: 0,
    loggedAt: 1, expensesActual: 3500 }]);
  s.setStrikeRate(95000);
  return JSON.parse(JSON.stringify(buildViewerSnapshotPayload(useStore.getState(), 'trusted')));
}

/** A safe viewer — the premise each case starts from. */
function asSafeViewer(tag: string): void {
  applyViewerSnapshot(SAFE as never);
  const was = useStore.getState();
  expect([was.viewerDataLoaded, was.viewerSafeSnapshot !== null, viewerTier(was)], `${tag} premise: a safe viewer`)
    .toEqual([true, true, 'safe']);
}

function expectWiped(tag: string): void {
  const now = useStore.getState();
  expect([now.viewerDataLoaded, now.viewerSafeSnapshot, viewerTier(now)], `${tag} wiped: not loaded, no safe block, no tier`)
    .toEqual([false, null, null]);
}

describe('applyViewerSnapshot fails closed (BL48)', () => {
  it('⭐ CLOSED — a well-formed trusted snapshot that still throws part-way wipes the device: never loaded without the safe block, never a tier', () => {
    const owner = ownersPayload();
    const s = useStore.getState();
    s.setViewerMode(true);
    asSafeViewer('CLOSED');
    // The months' write throws — after the safe block went and the settings landed. The shape check passed: the throw is
    // the setter's own.
    const setMonthlyLog = s.setMonthlyLog;
    useStore.setState({ setMonthlyLog: () => { throw new Error('part-way'); } } as never);
    try {
      expect(() => applyViewerSnapshot(owner as never), 'CLOSED premise: it throws part-way, past the shape check').toThrow('part-way');
    } finally {
      useStore.setState({ setMonthlyLog } as never);
    }
    expectWiped('CLOSED');
    s.setViewerMode(false);
  });

  it('⭐ SHAPE — a trusted snapshot that isn\'t well-formed wipes before any of it applies, thrown or not; the owner\'s own payload applies', () => {
    const owner = ownersPayload();
    const { settings: st, records: rec, strike: sk } = owner;
    const s = useStore.getState();
    s.setViewerMode(true);
    const cases: [string, unknown][] = [
      // not an object — no tombstone, no mode (42 and [] are two of the independent check's nine)
      ['null', null], ['a number', 42], ['a list', []], ['a string', 'x'],
      // the rest of its nine: all but `settings: 5` threw nothing and opened the Almanac on the seed's figures
      ['no settings, no records', { snapshotVersion: 2, privacyMode: 'trusted', asOf: 2 }],
      ['settings null', { ...owner, settings: null }], ['settings a list', { ...owner, settings: [] }],
      ['settings a number', { ...owner, settings: 5 }], ['income a string', { ...owner, settings: { ...st, income: 'abc' } }],
      ['records a string', { ...owner, records: 'x' }], ['entries a string', { ...owner, records: { ...rec, entries: 'abc' } }],
      // their kin — a case for each rule: the plan missing or wrong, a privacy mode no build sends, and what an older
      // owner's snapshot may lack, there but not what the apply takes
      ['privacyMode unknown', { ...owner, privacyMode: 'x' }],
      ['no settings', { ...owner, settings: undefined }], ['settings empty', { ...owner, settings: {} }],
      ['no expenses', { ...owner, settings: { ...st, expenses: undefined } }],
      ['no line', { ...owner, settings: { ...st, creditLine: undefined } }],
      ['the rate null', { ...owner, settings: { ...st, blocApr: null } }],
      ['income past a number\'s range (JSON reads 1e400 as Infinity)', { ...owner, settings: { ...st, income: JSON.parse('1e400') } }],
      ['no start date', { ...owner, settings: { ...st, advisorStartDate: undefined } }],
      ['hasCbLoan a string', { ...owner, settings: { ...st, hasCbLoan: 'yes' } }],
      ['no records', { ...owner, records: undefined }], ['records null', { ...owner, records: null }],
      ['no entries', { ...owner, records: { ...rec, entries: undefined } }],
      ['deletions a list', { ...owner, records: { ...rec, deletions: [] } }],
      ['a deletion not a number', { ...owner, records: { ...rec, deletions: { 3: 'x' } } }],
      ['strike a number', { ...owner, strike: 5 }], ['the Strike rate a string', { ...owner, strike: { ...sk, rate: 'x' } }],
      ['the Strike balance missing', { ...owner, strike: { ...sk, usd: undefined } }],
      ['the Strike holdings a string', { ...owner, strike: { ...sk, btcAvail: 'x' } }],
      ['the Coinbase collateral a string', { ...owner, cbCollateralBtc: 'x' }],
      ['the Strike collateral a string', { ...owner, strikeCollateralBtc: 'x' }],
      ['the cold total a string', { ...owner, coldStorageBtc: 'x' }],
      ['the deposit date a number', { ...owner, strikeLastDepositISO: 5 }],
    ];
    for (const [name, bad] of cases) {
      asSafeViewer(`SHAPE ${name}`);
      expect(() => applyViewerSnapshot(bad as never), `SHAPE ${name}: refused`).toThrow();
      expectWiped(`SHAPE ${name}`);
    }
    // A revocation is no trusted snapshot: it wipes and returns before the check, never refused — so its event counts
    // (refused, it would leave the event clock where it was, and an older snapshot could put the figures back).
    asSafeViewer('SHAPE a revocation');
    expect(() => applyViewerSnapshot({ revoked: true } as never), 'SHAPE a revocation returns, never refused').not.toThrow();
    expectWiped('SHAPE a revocation');
    // Non-vacuity: the owner's own payload passes and applies — trusted, his figures on the device.
    asSafeViewer('SHAPE the owner\'s');
    applyViewerSnapshot(owner as never);
    const now = useStore.getState();
    expect([viewerTier(now), now.income, now.monthlyLog.length, now.strikeRate], 'SHAPE the owner\'s payload: trusted, his figures')
      .toEqual(['trusted', 5200, 1, 95000]);
    // ...and an older owner's, without what it may lack (the deletions, the Strike block, the collateral and cold figures,
    // the deposit date): it applies, those falling back as before.
    asSafeViewer('SHAPE an older owner\'s');
    applyViewerSnapshot({ ...owner, records: { entries: rec.entries }, strike: undefined, cbCollateralBtc: undefined,
      strikeCollateralBtc: undefined, coldStorageBtc: undefined, strikeLastDepositISO: undefined } as never);
    const old = useStore.getState();
    expect([viewerTier(old), old.income, old.monthlyLog.length], 'SHAPE an older owner\'s payload: trusted, the plan his')
      .toEqual(['trusted', 5200, 1]);
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
