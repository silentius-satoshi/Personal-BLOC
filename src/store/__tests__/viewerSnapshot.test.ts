import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, buildSettingsPayload, buildViewerSnapshotPayload, type ViewerSlot } from '../useStore';
import { deriveCbCollateral, deriveStrikeCollateral } from '../../simulation/logUtils';
import { previewSafeSnapFromPayload } from '../../simulation/safetyView';

const LEVELS = ['safe', 'watch', 'act'];

// A trusted-tier slot 0 — forces buildViewerSnapshotPayload down its C-trusted branch (Multi-viewer M1:
// the tier is read from viewers[0]).
const trustedSlot: ViewerSlot = { index: 0, pubkeyHex: 'a'.repeat(64), npub: 'npub1exampleviewer', label: "Dad's iPhone", tier: 'trusted', keyVersion: 1 };

describe('viewer snapshot builders', () => {
  beforeEach(() => {
    // Reset the roster between cases (empty ⇒ the default C-safe branch). Raw set — no publish side effects.
    useStore.setState({ viewers: [], nextViewerIndex: 0 } as never);
  });

  it("buildSettingsPayload INCLUDES the owner's viewer roster (synced in the owner's own settings:v1)", () => {
    useStore.getState().addViewerSlot({ pubkeyHex: 'a'.repeat(64), npub: 'npub1exampleviewer', label: "Dad's iPhone", tier: 'safe', keyVersion: 1 });
    const payload = buildSettingsPayload(useStore.getState());
    expect('viewers' in payload).toBe(true);
    expect('nextViewerIndex' in payload).toBe(true);
    const roster = payload.viewers as ViewerSlot[];
    expect(roster.length).toBe(1);
    expect(roster[0]).toMatchObject({ index: 0, pubkeyHex: 'a'.repeat(64), npub: 'npub1exampleviewer', label: "Dad's iPhone", tier: 'safe', keyVersion: 1 });
    expect(payload.nextViewerIndex).toBe(1);
    // sanity: it also carries real synced settings
    expect('income' in payload).toBe(true);
    expect('advisorMonthStartBalance' in payload).toBe(true);
  });

  // ── Viewer V2 — C-SAFE (default / empty roster): the by-construction privacy proof ──────────────────
  it('C-safe (default) payload has EXACTLY the safe keys — NO settings/records/strike/cbCollateralBtc', () => {
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(Object.keys(snap).sort()).toEqual(
      ['asOf', 'btcPriceAtSnapshot', 'hasCbLoan', 'privacyMode', 'safety', 'snapshotVersion', 'thresholds'],
    );
    // the absolutes must be absent BY CONSTRUCTION
    expect('settings' in snap).toBe(false);
    expect('records' in snap).toBe(false);
    expect('strike' in snap).toBe(false);
    expect('cbCollateralBtc' in snap).toBe(false);
    expect('strikeCollateralBtc' in snap).toBe(false);   // C-P4 — the Strike scalar is trusted-only
  });

  it('C-safe payload: every leaf is a number / level-string / mode flag — and NO $ absolutes in safety', () => {
    useStore.setState({ hasCbLoan: true } as never);
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(snap.snapshotVersion).toBe(2);
    expect(snap.privacyMode).toBe('safe');
    expect(typeof snap.asOf).toBe('number');
    expect(typeof snap.hasCbLoan).toBe('boolean');
    expect(typeof snap.btcPriceAtSnapshot).toBe('number');
    // thresholds — three config ratios
    for (const v of Object.values(snap.thresholds!)) expect(typeof v).toBe('number');
    // safety — ratios + level strings only
    const safety = snap.safety!;
    for (const k of ['capacityUsed', 'strikeLtv', 'crashLtv', 'cbLtv', 'cbLiqFrac'] as const) {
      expect(typeof safety[k]).toBe('number');
    }
    for (const k of ['creditLevel', 'strikeLevel', 'cbLevel', 'overall'] as const) {
      expect(LEVELS).toContain(safety[k]);
    }
    // ⚠ the privacy correction — the two $ absolutes from SafetyView must NOT ride the safe block
    expect('accruedBalance' in safety).toBe(false);
    expect('cbLiqPrice' in safety).toBe(false);
  });

  // ── Per-tier build (M1): slot-0 tier selects the branch ──────────────────────────────────────────
  it("a slot-0 tier:'safe' builds the safe payload; tier:'trusted' builds the trusted payload", () => {
    useStore.setState({ viewers: [{ ...trustedSlot, tier: 'safe' }], nextViewerIndex: 1 } as never);
    expect(buildViewerSnapshotPayload(useStore.getState()).privacyMode).toBe('safe');
    useStore.setState({ viewers: [trustedSlot], nextViewerIndex: 1 } as never);
    expect(buildViewerSnapshotPayload(useStore.getState()).privacyMode).toBe('trusted');
  });

  // ── C-TRUSTED (opt-in): today's full payload ──────────────────────────────────────────────────
  it("C-trusted payload STRIPS the owner's viewer roster from settings", () => {
    useStore.setState({ viewers: [trustedSlot], nextViewerIndex: 1 } as never);
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(snap.privacyMode).toBe('trusted');
    const snapSettings = snap.settings as Record<string, unknown>;
    expect('viewers' in snapSettings).toBe(false);
    expect('nextViewerIndex' in snapSettings).toBe(false);
    expect('nostrRelays' in snapSettings).toBe(false);
    // but still carries the real settings the viewer needs
    expect('income' in snapSettings).toBe(true);
  });

  it('C-trusted has the Option-B shape: version/mode/asOf + settings + records + strike + cbCollateralBtc (P3) + strikeCollateralBtc (C-P4)', () => {
    useStore.setState({ viewers: [trustedSlot], nextViewerIndex: 1 } as never);
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(Object.keys(snap).sort()).toEqual(
      ['asOf', 'cbCollateralBtc', 'privacyMode', 'records', 'settings', 'snapshotVersion', 'strike', 'strikeCollateralBtc'],
    );
    expect(snap.records).toHaveProperty('entries');
    expect(snap.records).toHaveProperty('deletions');
    expect(snap.strike).toHaveProperty('usd');
    expect(snap.strike).toHaveProperty('btcAvail');
    expect(snap.strike).toHaveProperty('rate');
  });

  it('P3 (BUG2): C-trusted snapshot carries cbCollateralBtc derived from dayLog (scalar, not the journal)', () => {
    useStore.setState({
      viewers: [trustedSlot], nextViewerIndex: 1,
      dayLog: [{ id: 'c1', date: '2026-01-05', ts: 5000, kind: 'cbCollateralReading', cbCollateral: 2.25 }],
      cbCollateralBtc: 0.99,
    } as never);
    const s = useStore.getState();
    const snap = buildViewerSnapshotPayload(s);
    expect(snap.cbCollateralBtc).toBe(deriveCbCollateral(s.dayLog, s.cbCollateralBtc));   // single source — cannot drift
    expect(snap.cbCollateralBtc).toBeCloseTo(2.25);   // newest reading, not the 0.99 cache
  });

  it('C-P4 (BUG2 mirror): C-trusted snapshot carries strikeCollateralBtc derived from dayLog (scalar, not the cache)', () => {
    useStore.setState({
      viewers: [trustedSlot], nextViewerIndex: 1,
      dayLog: [{ id: 's1', date: '2026-01-05', ts: 5000, kind: 'balanceReading', reading: { strikeBal: 3000, strikeLtv: 0.1, strikeCollateral: 0.83 } }],
      strikeCollateralBtc: 0.11,
    } as never);
    const s = useStore.getState();
    const snap = buildViewerSnapshotPayload(s);
    expect(snap.strikeCollateralBtc).toBe(deriveStrikeCollateral(s.dayLog, s.strikeCollateralBtc));   // single source — cannot drift
    expect(snap.strikeCollateralBtc).toBeCloseTo(0.83);   // the reading's strikeCollateral, not the 0.11 cache
  });

  it("P3: the C-trusted snapshot's records carry entries + deletions but NOT the raw dayLog journal", () => {
    useStore.setState({
      viewers: [trustedSlot], nextViewerIndex: 1,
      dayLog: [{ id: 'c1', date: '2026-01-05', ts: 5000, kind: 'cbCollateralReading', cbCollateral: 2.25 }],
    } as never);
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(snap.records).toHaveProperty('entries');
    expect(snap.records).toHaveProperty('deletions');
    expect('dayLog' in (snap.records as object)).toBe(false);
  });

  it("C-trusted settings deep-equal buildSettingsPayload minus the viewer roster + nostrRelays", () => {
    useStore.setState({ viewers: [trustedSlot], nextViewerIndex: 1 } as never);
    const s = useStore.getState();
    const { viewers: _vs, nextViewerIndex: _ni, nostrRelays: _r, ...ownerMinusRoster } = buildSettingsPayload(s);
    expect(buildViewerSnapshotPayload(s).settings).toEqual(ownerMinusRoster);
  });

  it('viewer-side fields (Phase 2) are device-local — never in the settings payload', () => {
    useStore.getState().setViewerMode(true);
    useStore.getState().setViewerWriterPubkey('b'.repeat(64));
    useStore.getState().setViewerSecretKey('c'.repeat(64));
    const payload = buildSettingsPayload(useStore.getState());
    expect('viewerMode' in payload).toBe(false);
    expect('viewerWriterPubkey' in payload).toBe(false);
    expect('viewerSecretKey' in payload).toBe(false);
    // reset so other suites see a clean store
    useStore.getState().setViewerMode(false);
    useStore.getState().setViewerWriterPubkey(null);
    useStore.getState().setViewerSecretKey(null);
  });

  it('V3: viewerDisplayName is device-local — absent from BOTH payload builders (settings + snapshot)', () => {
    useStore.getState().setViewerDisplayName('Dad');
    // owner settings payload
    expect('viewerDisplayName' in buildSettingsPayload(useStore.getState())).toBe(false);
    // C-safe snapshot (empty roster ⇒ no settings block at all)
    useStore.setState({ viewers: [] } as never);
    const safe = buildViewerSnapshotPayload(useStore.getState());
    expect('settings' in safe).toBe(false);
    expect('viewerDisplayName' in safe).toBe(false);
    // C-trusted snapshot settings
    useStore.setState({ viewers: [trustedSlot], nextViewerIndex: 1 } as never);
    const trusted = buildViewerSnapshotPayload(useStore.getState());
    expect('viewerDisplayName' in (trusted.settings as Record<string, unknown>)).toBe(false);
    // reset for other suites
    useStore.setState({ viewers: [] } as never);
    useStore.getState().setViewerDisplayName(null);
  });

  // Owner "Preview as viewer" — the SafeSnapshot the preview injects can NEVER show more than the wire payload
  // (it IS the safe branch of buildViewerSnapshotPayload). Trusted mode → null (preview uses live-derive).
  it('previewSafeSnapFromPayload: safe payload → SafeSnapshot deep-equals the payload safe fields; trusted → null', () => {
    useStore.setState({ viewers: [], hasCbLoan: true } as never);
    const payload = buildViewerSnapshotPayload(useStore.getState());
    expect(payload.privacyMode).toBe('safe');
    const snap = previewSafeSnapFromPayload(payload);
    expect(snap).toEqual({
      safety: payload.safety,
      thresholds: payload.thresholds,
      btcPriceAtSnapshot: payload.btcPriceAtSnapshot,
      hasCbLoan: payload.hasCbLoan,
    });

    useStore.setState({ viewers: [trustedSlot], nextViewerIndex: 1 } as never);
    const trustedPayload = buildViewerSnapshotPayload(useStore.getState());
    expect(previewSafeSnapFromPayload(trustedPayload)).toBeNull();

    useStore.setState({ viewers: [], hasCbLoan: false } as never);
  });

  // Preview-local override fidelity — even when the REAL slot-0 tier is trusted, a forced-safe preview (the spread
  // { ...state, viewers: [] }) can never show more than the safe wire payload would.
  it('preview override: forced-safe payload (from a trusted store) → SafeSnapshot deep-equals the safe wire fields', () => {
    useStore.setState({ viewers: [trustedSlot], nextViewerIndex: 1, hasCbLoan: true } as never);
    const forcedSafePayload = buildViewerSnapshotPayload({ ...useStore.getState(), viewers: [] });
    expect(forcedSafePayload.privacyMode).toBe('safe');
    const snap = previewSafeSnapFromPayload(forcedSafePayload);
    expect(snap).toEqual({
      safety: forcedSafePayload.safety,
      thresholds: forcedSafePayload.thresholds,
      btcPriceAtSnapshot: forcedSafePayload.btcPriceAtSnapshot,
      hasCbLoan: forcedSafePayload.hasCbLoan,
    });

    useStore.setState({ viewers: [], hasCbLoan: false } as never);
  });
});
