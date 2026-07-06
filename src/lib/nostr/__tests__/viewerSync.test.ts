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

import { fetchViewerSnapshot, setUnwrappedViewerKey, getViewerPubkeyHex } from '../viewerSync';
import { viewerDTag } from '../publish';

function resetStore(overrides: Partial<Record<string, any>> = {}) {
  Object.keys(mockState).forEach((k) => delete mockState[k]);
  Object.assign(mockState, {
    viewerMode:          true,
    viewerWriterPubkey:  'o'.repeat(64),
    viewerSecretKey:     null,            // holder populated separately (Phase 3 wrapped key)
    nostrSigningMethod:  'local',
    nostrRelays:         ['wss://r'],
    cbCollateralBtc:     0.5,             // sentinel — proves raw-set overwrites / revoked leaves it
    strikeCollateralBtc: 0.7,             // C-P4 sentinel — same raw-set/fallback/revoked semantics
    dayLog:              [],
    hydrateSettings:     vi.fn(),
    setMonthlyLog:       vi.fn(),
    setDeletedMonths:    vi.fn(),
    setStrikeUsdBalance: vi.fn(),
    setStrikeBtcAvailable: vi.fn(),
    setStrikeRate:       vi.fn(),
    setCbCollateralBtc:  vi.fn(),         // MUST stay uncalled — it would emit a cbCollateralReading into the viewer's dayLog
    setViewerDataLoaded: vi.fn(),
    setViewerLastSyncAt: vi.fn(),
    setViewerSafeSnapshot: vi.fn(),       // Viewer V2 — the C-safe transient
    setViewerUnlocked:   vi.fn(),
    clearViewerData:     vi.fn(),
    ...overrides,
  });
}

describe('viewerSync — applyViewerEvent (P3 scalar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    setUnwrappedViewerKey(new Uint8Array(32).fill(1));   // VALID scalar → getViewerPubkeyHex (real getPublicKey) works; getViewerSigner builds the mock NSecSigner
    mockPool.close.mockReturnValue(undefined);
    mockPool.querySync.mockResolvedValue([{ content: 'ct', created_at: 1, tags: [] }]);
  });

  it('BUG3: raw-sets cb+strike collateral scalars from the snapshot AND leaves dayLog empty (no spurious readings)', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      settings: {}, records: { entries: [], deletions: {} }, strike: null, cbCollateralBtc: 3.33, strikeCollateralBtc: 4.44,
    }));

    await fetchViewerSnapshot();

    expect(mockState.cbCollateralBtc).toBeCloseTo(3.33);     // raw set via useStore.setState
    expect(mockState.strikeCollateralBtc).toBeCloseTo(4.44); // C-P4 — raw set in the SAME setState
    expect(mockState.dayLog).toEqual([]);                    // viewer journal untouched
    expect(mockState.setCbCollateralBtc).not.toHaveBeenCalled();   // NEVER the emitting setter
    expect(mockState.setViewerDataLoaded).toHaveBeenCalledWith(true);
    expect(mockState.clearViewerData).not.toHaveBeenCalled();
  });

  it('a pre-P3/pre-C-P4 snapshot without the scalars leaves the existing values (fallback)', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      settings: {}, records: { entries: [], deletions: {} }, strike: null,   // no cbCollateralBtc / strikeCollateralBtc
    }));

    await fetchViewerSnapshot();

    expect(mockState.cbCollateralBtc).toBeCloseTo(0.5);      // unchanged — ?? fallback to the current value
    expect(mockState.strikeCollateralBtc).toBeCloseTo(0.7);  // C-P4 — unchanged fallback
    expect(mockState.setViewerDataLoaded).toHaveBeenCalledWith(true);
  });

  it('a revoked snapshot wipes via clearViewerData and does NOT apply either scalar', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      revoked: true, settings: {}, records: { entries: [], deletions: {} }, strike: null, cbCollateralBtc: 9.99, strikeCollateralBtc: 8.88,
    }));

    await fetchViewerSnapshot();

    expect(mockState.clearViewerData).toHaveBeenCalled();
    expect(mockState.cbCollateralBtc).toBeCloseTo(0.5);      // NOT overwritten — revoked returns before the scalar set
    expect(mockState.strikeCollateralBtc).toBeCloseTo(0.7);  // C-P4 — likewise untouched
    expect(mockState.setViewerDataLoaded).not.toHaveBeenCalled();
  });

  // ── Viewer V2 — mode-aware hydrate ──────────────────────────────────────────────────────────────
  it('C-safe snapshot stores the safe block and does NOT hydrateSettings/records/strike', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      snapshotVersion: 2, privacyMode: 'safe', asOf: 1, hasCbLoan: true,
      btcPriceAtSnapshot: 100_000,
      thresholds: { strikeLiqLtv: 0.85, cbLtvTriggerPct: 75, cbLiqFrac: 0.86 },
      safety: { capacityUsed: 0.7, creditLevel: 'safe', strikeLtv: 0.5, strikeLevel: 'safe', crashLtv: 2.5, cbLtv: 0.5, cbLevel: 'safe', cbLiqFrac: 0.86, overall: 'safe' },
    }));

    await fetchViewerSnapshot();

    expect(mockState.setViewerSafeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ hasCbLoan: true, btcPriceAtSnapshot: 100_000 }),
    );
    expect(mockState.hydrateSettings).not.toHaveBeenCalled();   // no absolutes to hydrate in safe mode
    expect(mockState.setMonthlyLog).not.toHaveBeenCalled();
    expect(mockState.setViewerDataLoaded).toHaveBeenCalledWith(true);
    expect(mockState.clearViewerData).not.toHaveBeenCalled();
  });

  it('C-trusted snapshot hydrates the full store and clears the safe snapshot', async () => {
    decryptImpl.fn.mockResolvedValue(JSON.stringify({
      snapshotVersion: 2, privacyMode: 'trusted',
      settings: { income: 5000 }, records: { entries: [], deletions: {} }, strike: null, cbCollateralBtc: 1.1,
    }));

    await fetchViewerSnapshot();

    expect(mockState.setViewerSafeSnapshot).toHaveBeenCalledWith(null);
    expect(mockState.hydrateSettings).toHaveBeenCalled();
    expect(mockState.setViewerDataLoaded).toHaveBeenCalledWith(true);
  });
});

describe('viewerSync — M2 per-viewer d-tag filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    setUnwrappedViewerKey(new Uint8Array(32).fill(1));   // valid scalar → real getPublicKey
    mockPool.close.mockReturnValue(undefined);
    mockPool.querySync.mockResolvedValue([]);   // no events → fetch returns after querySync; the filter is still recorded
  });

  it("fetchViewerSnapshot queries with authors=[writer] and #d = viewerDTag(the viewer's OWN pubkey)", async () => {
    await fetchViewerSnapshot();
    expect(mockPool.querySync).toHaveBeenCalledTimes(1);
    const filterArg = mockPool.querySync.mock.calls[0][1] as Record<string, unknown>;
    const myHex = getViewerPubkeyHex()!;   // the viewer's own pubkey (from the in-memory holder)
    expect(filterArg['#d']).toEqual([viewerDTag(myHex)]);
    expect(filterArg.authors).toEqual(['o'.repeat(64)]);   // the writer (owner) pubkey — authors, NOT the d-tag
    expect(filterArg.kinds).toEqual([30078]);
  });

  it('viewerDTag is v2 + per-pubkey — two pubkeys yield two DISTINCT d-tags', () => {
    expect(viewerDTag('abc')).toBe('personal-bloc:viewer:v2:abc');
    expect(viewerDTag('aaa')).not.toBe(viewerDTag('bbb'));
  });
});
