import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_RELAYS } from '../relays';
import { getNostrLog, clearNostrLog } from '../log';

const { mockStoreState, mockPool, mockPublishRecordsImmediate, mockPublishPlanEvents } = vi.hoisted(() => ({
  mockStoreState: {} as Record<string, any>,
  mockPool: {
    querySync: vi.fn(),
    publish:   vi.fn(),
    close:     vi.fn(),
  },
  mockPublishRecordsImmediate: vi.fn(),   // sync.ts's repair-on-detect fires this (1b: now a named import from syncEngine)
  mockPublishPlanEvents:       vi.fn().mockResolvedValue(true),   // 4c: plan-events repair-on-detect
}));

vi.mock('nostr-tools/pool', () => ({
  SimplePool: vi.fn(function() { return mockPool; }),
}));

vi.mock('../../../store/useStore', () => ({
  useStore: { getState: () => mockStoreState },
}));

// 1b: publishRecordsNowImmediate moved to syncEngine; sync.ts imports it from './syncEngine' (same module this resolves to).
vi.mock('../syncEngine', () => ({
  publishRecordsNowImmediate: mockPublishRecordsImmediate,
  publishPlanEventsNow:       mockPublishPlanEvents,
}));

function resetStore(overrides: Partial<Record<string, any>> = {}) {
  mockPublishRecordsImmediate.mockClear();
  Object.assign(mockStoreState, {
    lastRecordsSyncAt:       null,
    recordsDirty:            false,
    initialSettingsPullDone: true,   // default = established session (past the first pull); the first-pull case sets this false explicitly
    setInitialSettingsPullDone: vi.fn(),
    monthlyLog:              [],
    deletedMonths:           {},
    dayLog:                  [],
    deletedDayEvents:        {},
    advisorActualBtcHeld:    0,
    // Phase 4c — the plan-events branch uses these setters (4e: the only plan channel).
    planEvents:              [],
    lastPlanEventsSyncAt:    null,
    lastPrefsSyncAt:         null,
    setPlanEvents:           vi.fn(),
    setPlanDirty:            vi.fn(),
    applyPlanFold:           vi.fn(),
    setLastPlanEventsSyncAt: vi.fn(),
    setLastPrefsSyncAt:      vi.fn(),
    hydratePrefs:            vi.fn(),   // 4e — the prefs:v1 apply (the retired hydrateSettings' narrow successor)
    setMonthlyLog:           vi.fn(),
    setDeletedMonths:        vi.fn(),
    setDayLog:               vi.fn(),
    setDeletedDayEvents:     vi.fn(),
    setRecordsDirty:         vi.fn(),
    setLastRecordsSyncAt:    vi.fn(),
    setNostrReconnectNeeded: vi.fn(),
    ...overrides,
  });
}

function makeEvent(dTag: string, createdAt: number, payload: unknown = {}) {
  return {
    kind:       30078,
    pubkey:     'pk',
    created_at: createdAt,
    content:    JSON.stringify(payload),
    tags:       [['d', dTag]],
    id:         'id',
    sig:        'sig',
  };
}

// Minimal log entry for merge flows (fields beyond these have safe fallbacks in merge; btcHeld is RECORDED per entry
// and applied verbatim — nothing recomputes it).
function makeLogEntry(month: number, overrides: Partial<Record<string, any>> = {}) {
  return { month, btcBought: 0.01, loggedAt: 1000 + month, btcHeld: 0, expensesActual: 3500, ...overrides };
}

function makeSigner() {
  return {
    nip44: {
      encrypt: vi.fn().mockResolvedValue('cipher'),
      decrypt: vi.fn((_pk: string, ct: string) => Promise.resolve(ct)),
    },
    signEvent: vi.fn((e: any) => Promise.resolve({ ...e, id: 'signed', sig: 'sig' })),
  } as any;
}

describe('fetchAndSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockPool.close.mockReturnValue(undefined);
  });

  // Phase 4e — settings:v1 is retired: the pull no longer asks for it, and a copy that still arrives (a stale relay, a
  // pre-4e client, the live sub's overlap) matches no branch — no plan scalar, no pref, no stamp moves.
  it('4e: the pull asks for records, plan-events and prefs only — never settings:v1', async () => {
    resetStore();
    mockPool.querySync.mockResolvedValue([]);
    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);
    expect(mockPool.querySync).toHaveBeenCalledOnce();
    expect([...mockPool.querySync.mock.calls[0][1]['#d']].sort()).toEqual(
      ['personal-bloc:plan-events:v1', 'personal-bloc:prefs:v1', 'personal-bloc:records:v1']);
  });

  it('4e: a settings:v1 event that still arrives changes nothing — on an empty-log device and on a migrated one', async () => {
    for (const planEvents of [[], [{ id: 'income-5-a', ts: 5, device: 'd', kind: 'set', field: 'income', value: 42 }]]) {
      vi.clearAllMocks();
      clearNostrLog();
      resetStore({ planEvents, initialSettingsPullDone: false });   // even the first pull of a session
      mockPool.querySync.mockResolvedValue([
        makeEvent('personal-bloc:settings:v1', 900, { income: 9999, simpleMode: true, viewers: [], backupVerifiedAt: null }),
        makeEvent('personal-bloc:records:v1',  700, { entries: [makeLogEntry(1)], deletions: {} }),
      ]);
      const { fetchAndSync } = await import('../sync');
      await expect(fetchAndSync(makeSigner(), 'pk', ['wss://r'])).resolves.toMatchObject({ ok: true, planFound: true });
      expect(mockStoreState.applyPlanFold).not.toHaveBeenCalled();
      expect(mockStoreState.setPlanEvents).not.toHaveBeenCalled();
      expect(mockStoreState.hydratePrefs).not.toHaveBeenCalled();
      expect(mockStoreState.setLastPrefsSyncAt).not.toHaveBeenCalled();
      expect(mockStoreState.setMonthlyLog).toHaveBeenCalledOnce();   // the records beside it still merge
      // the premise: only the records branch touched the store, and nothing threw. applyRemoteEvent swallows a throw as
      // a parse failure, so a branch calling a setter this mock lacks would pass the "not called" checks above — HEAD's
      // own settings branch did exactly that.
      const touched = Object.entries(mockStoreState)
        .filter(([, v]) => typeof v === 'function' && (v as { mock?: { calls: unknown[] } }).mock?.calls.length)
        .map(([k]) => k).sort();
      expect(touched, 'IGNORED').toEqual(['setDayLog', 'setDeletedDayEvents', 'setDeletedMonths', 'setLastRecordsSyncAt', 'setMonthlyLog']);
      expect(getNostrLog().map((e) => e.msg), 'IGNORED').not.toContain('payload parse failed (skipped)');
    }
  });

  it('legacy bare-array records payload still applies (v1 read)', async () => {
    resetStore();
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:records:v1', 700, [makeLogEntry(2)]),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.setMonthlyLog).toHaveBeenCalledOnce();
    const applied = mockStoreState.setMonthlyLog.mock.calls[0][0];
    expect(applied.map((e: any) => e.month)).toEqual([2]);
  });

  it('remote-only month merges in alongside an existing local month (sorted)', async () => {
    resetStore({ monthlyLog: [makeLogEntry(1)] });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:records:v1', 700, { entries: [makeLogEntry(2)], deletions: {} }),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.setMonthlyLog).toHaveBeenCalledOnce();
    const applied = mockStoreState.setMonthlyLog.mock.calls[0][0];
    expect(applied.map((e: any) => e.month)).toEqual([1, 2]);
  });

  it('a merge applies entries VERBATIM — btcHeld is the recorded value, never recomputed off the baseline', async () => {
    // ⚠ SYNTHETIC figures. The old apply rebuilt btcHeld as advisorActualBtcHeld + Σ btcBought (≈ 5.01 / 5.02).
    // Mutation: reinstate that recompute at the records apply → month 1 reads ≈5.01 → red.
    resetStore({ monthlyLog: [makeLogEntry(1, { btcHeld: 0.3 })], advisorActualBtcHeld: 5 });
    const { btcHeld: _omit, ...unrecorded } = makeLogEntry(2);
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:records:v1', 700, { entries: [unrecorded], deletions: {} }),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    const applied = mockStoreState.setMonthlyLog.mock.calls[0][0];
    expect(applied.find((e: any) => e.month === 1).btcHeld).toBe(0.3);
    expect('btcHeld' in applied.find((e: any) => e.month === 2)).toBe(false);
  });

  it('local month the relay lacks → setRecordsDirty(true), no local apply', async () => {
    const e1 = makeLogEntry(1);
    resetStore({ monthlyLog: [e1, makeLogEntry(2)] });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:records:v1', 700, { entries: [e1], deletions: {} }),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.setRecordsDirty).toHaveBeenCalledWith(true);
    expect(mockStoreState.setMonthlyLog).not.toHaveBeenCalled();   // merged === local
    expect(mockPublishRecordsImmediate).toHaveBeenCalled();        // repair-on-detect: relay is behind → publish now
  });

  // R2b-2: ok=false, but planFound stays TRUE — an unreachable signer must NEVER be reported as "no plan
  // found on this key" (that would fire the NoPlanNotice on a user whose plan is sitting right there).
  it('decrypt failure → ok:false, nothing applied, but planFound stays true (events existed)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});   // silence the nostrLog mirror
    resetStore();
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:plan-events:v1', 800, { events: [] }),
      makeEvent('personal-bloc:records:v1',  700, { entries: [makeLogEntry(1)], deletions: {} }),
    ]);
    const signer = makeSigner();
    signer.nip44.decrypt = vi.fn().mockRejectedValue(new Error('signer offline'));

    const { fetchAndSync } = await import('../sync');
    await expect(fetchAndSync(signer, 'pk', ['wss://r'])).resolves.toMatchObject({ ok: false, planFound: true });

    expect(mockStoreState.applyPlanFold).not.toHaveBeenCalled();
    expect(mockStoreState.setMonthlyLog).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // R2b-2: the case the whole notice exists for — a valid key with nothing published under it.
  it('empty relay → ok:true, planFound:false, nothing applied', async () => {
    resetStore();
    mockPool.querySync.mockResolvedValue([]);

    const { fetchAndSync } = await import('../sync');
    await expect(fetchAndSync(makeSigner(), 'pk', ['wss://r'])).resolves.toMatchObject({ ok: true, planFound: false });

    expect(mockStoreState.applyPlanFold).not.toHaveBeenCalled();
    expect(mockStoreState.setMonthlyLog).not.toHaveBeenCalled();
  });

  // An event with no `d` tag is skipped by the latestByDTag loop, so it must not count as a plan either.
  it('a d-tag-less event does not count as a plan (planFound:false)', async () => {
    resetStore();
    const noDTag = { ...makeEvent('personal-bloc:plan-events:v1', 800), tags: [] };
    mockPool.querySync.mockResolvedValue([noDTag]);

    const { fetchAndSync } = await import('../sync');
    await expect(fetchAndSync(makeSigner(), 'pk', ['wss://r'])).resolves.toMatchObject({ ok: true, planFound: false });
  });

  it('remote payload identical to local state → no apply, no dirty', async () => {
    const e1 = makeLogEntry(1);
    resetStore({ monthlyLog: [e1] });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:records:v1', 700, { entries: [e1], deletions: {} }),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.setMonthlyLog).not.toHaveBeenCalled();
    expect(mockStoreState.setRecordsDirty).not.toHaveBeenCalled();
    expect(mockPublishRecordsImmediate).not.toHaveBeenCalled();   // relay already in sync → no repair publish
    expect(mockStoreState.setLastRecordsSyncAt).toHaveBeenCalledWith(700);   // observability stamp still fires
  });

  it('P3: records payload carrying dayLog → setDayLog + setDeletedDayEvents called with the merged values', async () => {
    resetStore();   // local dayLog [] / deletedDayEvents {}
    const recent = Date.now() - 1000;   // within the 90-day TTL so it survives GC
    const dl = [{ id: 'd1', date: '2026-01-05', ts: 111, kind: 'cbCollateralReading', cbCollateral: 1.7 }];
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:records:v1', 700, { entries: [], deletions: {}, dayLog: dl, dayLogDeletions: { gone: recent } }),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.setDayLog).toHaveBeenCalledOnce();
    expect(mockStoreState.setDayLog.mock.calls[0][0].map((e: any) => e.id)).toEqual(['d1']);
    expect(mockStoreState.setDeletedDayEvents).toHaveBeenCalledWith({ gone: recent });
  });

  it('P3: legacy records payload without dayLog hydrates safely (defaults [] / {}, no throw)', async () => {
    resetStore();
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:records:v1', 700, [makeLogEntry(3)]),   // legacy bare array, no dayLog field
    ]);

    const { fetchAndSync } = await import('../sync');
    await expect(fetchAndSync(makeSigner(), 'pk', ['wss://r'])).resolves.toMatchObject({ ok: true, planFound: true });

    expect(mockStoreState.setMonthlyLog).toHaveBeenCalledOnce();   // entries applied
    expect(mockStoreState.setDayLog).toHaveBeenCalledWith([]);     // dayLog defaulted to [] (no throw)
  });

  // ── 4c plan-events / prefs pull paths ──
  const planEvt = (id: string, ts: number, field: string, value: unknown) => ({ id, ts, device: 'd', kind: 'set', field, value });

  it('4c: a plan-events log unions + folds into state (setPlanEvents + applyPlanFold + stamp)', async () => {
    resetStore();   // local planEvents []
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:plan-events:v1', 700, { events: [planEvt('income-5-a', 5, 'income', 8888)] }),
    ]);
    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);
    expect(mockStoreState.setPlanEvents).toHaveBeenCalledOnce();
    expect(mockStoreState.setPlanEvents.mock.calls[0][0].map((e: any) => e.id)).toEqual(['income-5-a']);
    expect(mockStoreState.applyPlanFold).toHaveBeenCalledWith({ income: 8888 });
    expect(mockStoreState.setLastPlanEventsSyncAt).toHaveBeenCalledWith(700);
  });

  it('4e: an empty roster and a default relay list reach applyPlanFold unfiltered (no skip-guard on the pull)', async () => {
    resetStore({ viewers: [{ index: 0, pubkeyHex: 'aa' }], nextViewerIndex: 1, nostrRelays: ['wss://custom.example'] });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:plan-events:v1', 700, { events: [
        planEvt('viewers-5-a', 5, 'viewers', []), planEvt('nextViewerIndex-5-b', 5, 'nextViewerIndex', 1),
        planEvt('nostrRelays-5-c', 5, 'nostrRelays', [...DEFAULT_RELAYS]),
      ] }),
    ]);
    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);
    expect(mockStoreState.applyPlanFold, 'ROSTER pull').toHaveBeenCalledWith({ viewers: [], nextViewerIndex: 1, nostrRelays: [...DEFAULT_RELAYS] });
  });

  it('4c: local log ⊃ remote → setPlanDirty(true) + repair publish (mirrors records)', async () => {
    resetStore({ planEvents: [planEvt('income-5-a', 5, 'income', 1), planEvt('expenses-6-b', 6, 'expenses', 2)] });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:plan-events:v1', 700, { events: [planEvt('income-5-a', 5, 'income', 1)] }),
    ]);
    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);
    expect(mockStoreState.setPlanDirty).toHaveBeenCalledWith(true);
    expect(mockPublishPlanEvents).toHaveBeenCalled();
    expect(mockStoreState.setPlanEvents).not.toHaveBeenCalled();   // merged === local → no re-set
  });

  it('4c: prefs:v1 hydrates via hydratePrefs (4e) + stamps lastPrefsSyncAt', async () => {
    resetStore();
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:prefs:v1', 800, { simpleMode: true, tabOrder: ['x'] }),
    ]);
    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);
    expect(mockStoreState.hydratePrefs).toHaveBeenCalledWith({ simpleMode: true, tabOrder: ['x'] });
    expect(mockStoreState.setLastPrefsSyncAt).toHaveBeenCalledWith(800);
  });

});

describe('publishEncrypted', () => {
  it('resolves to a number (the created_at timestamp)', async () => {
    mockPool.publish.mockReturnValue([Promise.resolve('ok')]);
    const signer = makeSigner();

    const { publishEncrypted } = await import('../publish');
    const before = Math.floor(Date.now() / 1000);
    const result = await publishEncrypted(signer, 'pk', 'd-tag', { x: 1 });
    const after  = Math.floor(Date.now() / 1000);

    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('rejects when every relay rejects', async () => {
    mockPool.publish.mockReturnValue([Promise.reject(new Error('x'))]);
    const signer = makeSigner();

    const { publishEncrypted } = await import('../publish');
    await expect(publishEncrypted(signer, 'pk', 'd-tag', { x: 1 })).rejects.toThrow();
  });

  // Same-second race guard: two publishes of the SAME d-tag within one second must not tie on created_at
  // (a NIP-01 replaceable tie randomly keeps the older payload). Per-d-tag monotonic → strictly ordered.
  it('same d-tag, same second → second created_at === first + 1 (no tie); different d-tags do not interfere', async () => {
    mockPool.publish.mockReturnValue([Promise.resolve('ok')]);
    const signer = makeSigner();
    const FIXED = 1_700_000_000_000;                          // fixed wall clock → both floor() to the same second
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(FIXED);
    const sec = Math.floor(FIXED / 1000);

    const { publishEncrypted } = await import('../publish');
    // unique tags so the module-level per-d-tag counter can't leak across other tests in this file
    const a1 = await publishEncrypted(signer, 'pk', 'mono-x', { n: 1 });
    const a2 = await publishEncrypted(signer, 'pk', 'mono-x', { n: 2 });   // same d-tag, same second
    const b1 = await publishEncrypted(signer, 'pk', 'mono-y', { n: 3 });   // different d-tag

    expect(a1).toBe(sec);
    expect(a2).toBe(sec + 1);        // bumped past the tie
    expect(b1).toBe(sec);            // independent counter — not pushed by mono-x

    nowSpy.mockRestore();
  });
});
