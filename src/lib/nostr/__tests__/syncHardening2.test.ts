import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Hardening 2 — sync.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 * sync.test.ts's harness: the store is a plain object with spied setters, the pool and the engine mocked — nothing
 * reaches a relay. Round synthetic figures.
 */
const { mockStoreState, mockPool } = vi.hoisted(() => ({
  mockStoreState: {} as Record<string, any>,
  mockPool: {
    querySync: vi.fn(),
    publish:   vi.fn(),
    close:     vi.fn(),
    listConnectionStatus: vi.fn(() => new Map([['wss://relay.example', true]])),
  },
}));
vi.mock('nostr-tools/pool', () => ({ SimplePool: vi.fn(function() { return mockPool; }) }));
vi.mock('../../../store/useStore', () => ({ useStore: { getState: () => mockStoreState } }));
vi.mock('../syncEngine', () => ({ publishRecordsNowImmediate: vi.fn(), publishPlanEventsNow: vi.fn().mockResolvedValue(true) }));

import { pullJournal, applyRemoteEvent, fetchAndSync } from '../sync';
import { getPlanPull } from '../planLoad';

function resetStore(overrides: Record<string, any> = {}) {
  for (const k of Object.keys(mockStoreState)) delete mockStoreState[k];
  Object.assign(mockStoreState, {
    lastRecordsSyncAt: null, recordsDirty: false, initialSettingsPullDone: true, setInitialSettingsPullDone: vi.fn(),
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, advisorActualBtcHeld: 0,
    planEvents: [], lastPlanEventsSyncAt: null, lastPrefsSyncAt: null, setPlanEvents: vi.fn(), setPlanDirty: vi.fn(),
    applyPlanFold: vi.fn(), setLastPlanEventsSyncAt: vi.fn(), setPlanLoaded: vi.fn(), setLastPrefsSyncAt: vi.fn(),
    hydratePrefs: vi.fn(), setMonthlyLog: vi.fn(), setDeletedMonths: vi.fn(), setDayLog: vi.fn(),
    setDeletedDayEvents: vi.fn(), setRecordsDirty: vi.fn(), setLastRecordsSyncAt: vi.fn(), setNostrReconnectNeeded: vi.fn(),
    ...overrides,
  });
}
const makeEvent = (dTag: string, createdAt: number, payload: unknown = {}) => ({
  kind: 30078, pubkey: 'pk', created_at: createdAt, content: JSON.stringify(payload), tags: [['d', dTag]], id: 'id', sig: 'sig',
});
const makeLogEntry = (month: number, o: Record<string, any> = {}) =>
  ({ month, btcBought: 0.01, loggedAt: 1000 + month, btcHeld: 0, expensesActual: 3500, ...o });
const makeSigner = () => ({
  nip44: { encrypt: vi.fn().mockResolvedValue('cipher'), decrypt: vi.fn((_pk: string, ct: string) => Promise.resolve(ct)) },
  signEvent: vi.fn((e: any) => Promise.resolve({ ...e, id: 'signed', sig: 'sig' })),
}) as any;
const written = (): any[] => (mockStoreState.setMonthlyLog.mock.calls as any[][]).flat(2);

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('Hardening 2 — sync', () => {
  it('HY-10 · sync.md "Records merge" — recordsDirty breaks a tie in favour of the unpublished local edit', async () => {
    // The local month 1 and the relays' copy tie on their clock (updatedAt 1,000); only the figure differs.
    const relays = { v1: makeEvent('personal-bloc:records:v1', 700, { entries: [makeLogEntry(1, { updatedAt: 1_000, expensesActual: 200 })], deletions: {} }) };
    resetStore({ recordsDirty: true, monthlyLog: [makeLogEntry(1, { updatedAt: 1_000, expensesActual: 100 })] });
    await pullJournal(makeSigner(), 'pk', ['wss://r'], relays, 5_000);
    expect(written().find((e) => e.month === 1)?.expensesActual ?? 100, 'HY-10 the dirty local edit stands').toBe(100);
    // Premise — the tie is real: with nothing unpublished, the relays' copy wins it.
    resetStore({ recordsDirty: false, monthlyLog: [makeLogEntry(1, { updatedAt: 1_000, expensesActual: 100 })] });
    await pullJournal(makeSigner(), 'pk', ['wss://r'], relays, 5_000);
    expect(written().find((e) => e.month === 1)?.expensesActual, 'HY-10 premise: a clean device takes the relays\' copy').toBe(200);
  });

  it('HY-11 · sync.md "only the prefs are LWW" — a prefs copy no newer than the watermark (this device\'s own echo) is never re-applied', async () => {
    resetStore({ lastPrefsSyncAt: 100 });
    await applyRemoteEvent(makeSigner(), 'pk', makeEvent('personal-bloc:prefs:v1', 100, { simpleMode: true }), 5_000);
    expect(mockStoreState.hydratePrefs, 'HY-11 the copy already applied').not.toHaveBeenCalled();
    await applyRemoteEvent(makeSigner(), 'pk', makeEvent('personal-bloc:prefs:v1', 101, { simpleMode: true }), 5_000);
    expect(mockStoreState.hydratePrefs, 'HY-11 premise: a newer copy lands').toHaveBeenCalledTimes(1);
  });

  it('HY-15 · general.md "No plan-dependent write before the plan loads" — a pull that finds the v2 journal but no plan is "absent", never "none" (no "Start a new plan" over a journal)', async () => {
    mockPool.querySync.mockResolvedValue([makeEvent('personal-bloc:records:v2:manifest', 700, { v: 2, pages: {}, deletions: {}, dayLogDeletions: {} })]);
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);
    expect(getPlanPull(), 'HY-15 the journal is there: the plan is missing, not never made').toMatchObject({ status: 'unreadable', reason: 'absent' });
    // Premise — a relay with nothing at all is "none".
    mockPool.querySync.mockResolvedValue([]);
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);
    expect(getPlanPull().status, 'HY-15 premise: nothing found is none').toBe('none');
  });
});
