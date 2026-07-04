import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStoreState, mockPool, mockPublishRecordsImmediate } = vi.hoisted(() => ({
  mockStoreState: {} as Record<string, any>,
  mockPool: {
    querySync: vi.fn(),
    publish:   vi.fn(),
    close:     vi.fn(),
  },
  mockPublishRecordsImmediate: vi.fn(),   // sync.ts's repair-on-detect fires this (a named import from useStore)
}));

vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return mockPool; }),
}));

vi.mock('../../../store/useStore', () => ({
  useStore: { getState: () => mockStoreState },
  publishRecordsNowImmediate: mockPublishRecordsImmediate,
}));

function resetStore(overrides: Partial<Record<string, any>> = {}) {
  mockPublishRecordsImmediate.mockClear();
  Object.assign(mockStoreState, {
    lastSettingsSyncAt:      null,
    lastRecordsSyncAt:       null,
    recordsDirty:            false,
    settingsDirty:           false,
    initialSettingsPullDone: true,   // default = established session (past the first pull); the first-pull case sets this false explicitly
    setInitialSettingsPullDone: vi.fn(),
    monthlyLog:              [],
    deletedMonths:           {},
    dayLog:                  [],
    deletedDayEvents:        {},
    advisorActualBtcHeld:    0,
    hydrateSettings:         vi.fn(),
    setMonthlyLog:           vi.fn(),
    setDeletedMonths:        vi.fn(),
    setDayLog:               vi.fn(),
    setDeletedDayEvents:     vi.fn(),
    setRecordsDirty:         vi.fn(),
    setSettingsDirty:        vi.fn(),
    setLastSettingsSyncAt:   vi.fn(),
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

// Minimal log entry for merge flows (fields beyond these have safe fallbacks in recomputeBtcHeld/merge).
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

  it('uses independent watermarks — records merge-applies even when settings:v1 is stale', async () => {
    resetStore({
      lastSettingsSyncAt: 1000,
      lastRecordsSyncAt:  500,
    });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:settings:v1', 900),
      makeEvent('personal-bloc:records:v1',  700, { entries: [makeLogEntry(1)], deletions: {} }),
    ]);

    const { fetchAndSync } = await import('../sync');
    await expect(fetchAndSync(makeSigner(), 'pk', ['wss://r'])).resolves.toBe(true);

    expect(mockStoreState.hydrateSettings).not.toHaveBeenCalled();
    expect(mockStoreState.setMonthlyLog).toHaveBeenCalledOnce();
    expect(mockStoreState.setLastRecordsSyncAt).toHaveBeenCalledWith(700);
  });

  it('settings watermark blocks hydration when remote is older', async () => {
    resetStore({ lastSettingsSyncAt: 500 });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:settings:v1', 400),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.hydrateSettings).not.toHaveBeenCalled();
  });

  it('settings watermark allows hydration when remote is newer', async () => {
    resetStore({ lastSettingsSyncAt: 500 });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:settings:v1', 800),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.hydrateSettings).toHaveBeenCalledOnce();
    expect(mockStoreState.setLastSettingsSyncAt).toHaveBeenCalledWith(800);
  });

  it('settingsDirty blocks hydration even when remote is newer (unpublished local toggles win)', async () => {
    resetStore({ settingsDirty: true, lastSettingsSyncAt: 500 });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:settings:v1', 700),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.hydrateSettings).not.toHaveBeenCalled();
  });

  it('FIRST pull (!initialSettingsPullDone) hydrates real remote settings even when settingsDirty is spuriously true (seed-clobber fix B)', async () => {
    // Fresh-install race: a benign post-auth setter seed-dirtied the store BEFORE the first pull.
    // The relaxed guard must still hydrate the real remote data (no genuine edits exist yet to protect).
    resetStore({ settingsDirty: true, initialSettingsPullDone: false, lastSettingsSyncAt: null });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:settings:v1', 700, { income: 9999 }),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.hydrateSettings).toHaveBeenCalledOnce();
    expect(mockStoreState.hydrateSettings.mock.calls[0][0]).toEqual({ income: 9999 });
    expect(mockStoreState.setLastSettingsSyncAt).toHaveBeenCalledWith(700);
  });

  it('settingsDirty false → same newer remote hydrates + stamps the watermark', async () => {
    resetStore({ settingsDirty: false, lastSettingsSyncAt: 500 });
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:settings:v1', 700),
    ]);

    const { fetchAndSync } = await import('../sync');
    await fetchAndSync(makeSigner(), 'pk', ['wss://r']);

    expect(mockStoreState.hydrateSettings).toHaveBeenCalledOnce();
    expect(mockStoreState.setLastSettingsSyncAt).toHaveBeenCalledWith(700);
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

  it('decrypt failure → resolves false, nothing applied', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});   // silence the nostrLog mirror
    resetStore();
    mockPool.querySync.mockResolvedValue([
      makeEvent('personal-bloc:settings:v1', 800),
      makeEvent('personal-bloc:records:v1',  700, { entries: [makeLogEntry(1)], deletions: {} }),
    ]);
    const signer = makeSigner();
    signer.nip44.decrypt = vi.fn().mockRejectedValue(new Error('signer offline'));

    const { fetchAndSync } = await import('../sync');
    await expect(fetchAndSync(signer, 'pk', ['wss://r'])).resolves.toBe(false);

    expect(mockStoreState.hydrateSettings).not.toHaveBeenCalled();
    expect(mockStoreState.setMonthlyLog).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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
    await expect(fetchAndSync(makeSigner(), 'pk', ['wss://r'])).resolves.toBe(true);

    expect(mockStoreState.setMonthlyLog).toHaveBeenCalledOnce();   // entries applied
    expect(mockStoreState.setDayLog).toHaveBeenCalledWith([]);     // dayLog defaulted to [] (no throw)
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
