import { describe, it, expect, vi, beforeEach } from 'vitest';

// applyViewerEvent is module-internal — we drive it through the exported fetchViewerSnapshot (querySync → applyViewerEvent).
// Mocks mirror sync.test.ts: SimplePool, the @nostrify NSecSigner (its nip44.decrypt returns the snapshot JSON), and the
// store module (getState/setState over a plain object). P3 focus: the viewer RAW-SETS cbCollateralBtc and never injects
// an event into its own dayLog (BUG3), and a revoked snapshot wipes without applying the scalar.

const { mockState, mockPool, decryptImpl } = vi.hoisted(() => ({
  mockState: {} as Record<string, any>,
  mockPool: {
    querySync:     vi.fn(),
    close:         vi.fn(),
    subscribeMany: vi.fn(),
  },
  decryptImpl: { fn: vi.fn() as ReturnType<typeof vi.fn> },
}));

vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return mockPool; }),
}));

vi.mock('@nostrify/nostrify', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  NSecSigner: vi.fn(function() { return { nip44: { decrypt: decryptImpl.fn } }; }),
}));

vi.mock('../../../store/useStore', () => ({
  useStore: {
    getState: () => mockState,
    setState: (patch: any) => Object.assign(mockState, typeof patch === 'function' ? patch(mockState) : patch),
  },
}));

import { fetchViewerSnapshot, setUnwrappedViewerKey } from '../viewerSync';

function resetStore(overrides: Partial<Record<string, any>> = {}) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    viewerMode:          true,
    viewerWriterPubkey:  'o'.repeat(64),
    viewerSecretKey:     null,            // holder populated separately (Phase 3 wrapped key)
    nostrSigningMethod:  'local',
    nostrRelays:         ['wss://r'],
    cbCollateralBtc:     0.5,             // sentinel — proves raw-set overwrites / revoked leaves it
    dayLog:              [],
    hydrateSettings:     vi.fn(),
    setMonthlyLog:       vi.fn(),
    setDeletedMonths:    vi.fn(),
    setStrikeUsdBalance: vi.fn(),
    setStrikeBtcAvailable: vi.fn(),
    setStrikeRate:       vi.fn(),
    setCbCollateralBtc:  vi.fn(),         // MUST stay uncalled — it would emit a cbCollateralReading into the viewer's dayLog
    setViewerDataLoaded: vi.fn(),
    setViewerUnlocked:   vi.fn(),
    clearViewerData:     vi.fn(),
    ...overrides,
  });
}

describe('viewerSync — applyViewerEvent (P3 scalar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    setUnwrappedViewerKey(new Uint8Array(32));   // populate the in-memory holder → getViewerSigner builds the mock NSecSigner
    mockPool.close.mockReturnValue(undefined);
    mockPool.querySync.mockResolvedValue([{ content: 'ct', created_at: 1, tags: [] }]);
  });

  it('BUG3: raw-sets cbCollateralBtc from the snapshot AND leaves dayLog empty (no spurious cbCollateralReading)', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      settings: {}, records: { entries: [], deletions: {} }, strike: null, cbCollateralBtc: 3.33,
    }));

    await fetchViewerSnapshot();

    expect(mockState.cbCollateralBtc).toBeCloseTo(3.33);   // raw set via useStore.setState
    expect(mockState.dayLog).toEqual([]);                  // viewer journal untouched
    expect(mockState.setCbCollateralBtc).not.toHaveBeenCalled();   // NEVER the emitting setter
    expect(mockState.setViewerDataLoaded).toHaveBeenCalledWith(true);
    expect(mockState.clearViewerData).not.toHaveBeenCalled();
  });

  it('a pre-P3 snapshot without cbCollateralBtc leaves the existing value (fallback)', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      settings: {}, records: { entries: [], deletions: {} }, strike: null,   // no cbCollateralBtc
    }));

    await fetchViewerSnapshot();

    expect(mockState.cbCollateralBtc).toBeCloseTo(0.5);    // unchanged — ?? fallback to the current value
    expect(mockState.setViewerDataLoaded).toHaveBeenCalledWith(true);
  });

  it('a revoked snapshot wipes via clearViewerData and does NOT apply the scalar', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      revoked: true, settings: {}, records: { entries: [], deletions: {} }, strike: null, cbCollateralBtc: 9.99,
    }));

    await fetchViewerSnapshot();

    expect(mockState.clearViewerData).toHaveBeenCalled();
    expect(mockState.cbCollateralBtc).toBeCloseTo(0.5);    // NOT overwritten — revoked returns before the scalar set
    expect(mockState.setViewerDataLoaded).not.toHaveBeenCalled();
  });
});
