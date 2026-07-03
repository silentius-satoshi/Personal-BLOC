import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, buildSettingsPayload, buildViewerSnapshotPayload } from '../useStore';
import { deriveCbCollateral } from '../../simulation/logUtils';
import { previewSafeSnapFromPayload } from '../../simulation/safetyView';

const LEVELS = ['safe', 'watch', 'act'];

describe('viewer snapshot builders', () => {
  beforeEach(() => {
    // Reset the viewer config + privacy mode between cases (other state is irrelevant to these assertions).
    useStore.getState().setViewerNpub(null);
    useStore.getState().setViewerPubkey(null);
    useStore.getState().setViewerLabel(null);
    useStore.setState({ viewerPrivacyTrusted: false });   // default = C-safe
  });

  it("buildSettingsPayload INCLUDES the owner's viewer config (synced in the owner's own settings:v1)", () => {
    useStore.getState().setViewerNpub('npub1exampleviewer');
    useStore.getState().setViewerPubkey('a'.repeat(64));
    useStore.getState().setViewerLabel("Dad's iPhone");
    const payload = buildSettingsPayload(useStore.getState());
    expect('viewerNpub' in payload).toBe(true);
    expect('viewerPubkey' in payload).toBe(true);
    expect('viewerLabel' in payload).toBe(true);
    expect('viewerPrivacyTrusted' in payload).toBe(true);   // V2 — the sharing toggle syncs across owner devices
    expect(payload.viewerNpub).toBe('npub1exampleviewer');
    expect(payload.viewerPubkey).toBe('a'.repeat(64));
    expect(payload.viewerLabel).toBe("Dad's iPhone");
    // sanity: it also carries real synced settings
    expect('income' in payload).toBe(true);
    expect('advisorMonthStartBalance' in payload).toBe(true);
  });

  // ── Viewer V2 — C-SAFE (default): the by-construction privacy proof ──────────────────────────────
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

  // ── C-TRUSTED (opt-in): today's full payload ──────────────────────────────────────────────────
  it("C-trusted payload STRIPS the owner's viewer config + viewerPrivacyTrusted from settings", () => {
    useStore.setState({ viewerPrivacyTrusted: true });
    useStore.getState().setViewerNpub('npub1exampleviewer');
    useStore.getState().setViewerPubkey('a'.repeat(64));
    useStore.getState().setViewerLabel("Dad's iPhone");
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(snap.privacyMode).toBe('trusted');
    const snapSettings = snap.settings as Record<string, unknown>;
    expect('viewerNpub' in snapSettings).toBe(false);
    expect('viewerPubkey' in snapSettings).toBe(false);
    expect('viewerLabel' in snapSettings).toBe(false);
    expect('viewerPrivacyTrusted' in snapSettings).toBe(false);
    expect('nostrRelays' in snapSettings).toBe(false);
    // but still carries the real settings the viewer needs
    expect('income' in snapSettings).toBe(true);
  });

  it('C-trusted has the Option-B shape: version/mode/asOf + settings + records + strike + cbCollateralBtc (P3)', () => {
    useStore.setState({ viewerPrivacyTrusted: true });
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(Object.keys(snap).sort()).toEqual(
      ['asOf', 'cbCollateralBtc', 'privacyMode', 'records', 'settings', 'snapshotVersion', 'strike'],
    );
    expect(snap.records).toHaveProperty('entries');
    expect(snap.records).toHaveProperty('deletions');
    expect(snap.strike).toHaveProperty('usd');
    expect(snap.strike).toHaveProperty('btcAvail');
    expect(snap.strike).toHaveProperty('rate');
  });

  it('P3 (BUG2): C-trusted snapshot carries cbCollateralBtc derived from dayLog (scalar, not the journal)', () => {
    useStore.setState({
      viewerPrivacyTrusted: true,
      dayLog: [{ id: 'c1', date: '2026-01-05', ts: 5000, kind: 'cbCollateralReading', cbCollateral: 2.25 }],
      cbCollateralBtc: 0.99,
    } as never);
    const s = useStore.getState();
    const snap = buildViewerSnapshotPayload(s);
    expect(snap.cbCollateralBtc).toBe(deriveCbCollateral(s.dayLog, s.cbCollateralBtc));   // single source — cannot drift
    expect(snap.cbCollateralBtc).toBeCloseTo(2.25);   // newest reading, not the 0.99 cache
  });

  it("P3: the C-trusted snapshot's records carry entries + deletions but NOT the raw dayLog journal", () => {
    useStore.setState({
      viewerPrivacyTrusted: true,
      dayLog: [{ id: 'c1', date: '2026-01-05', ts: 5000, kind: 'cbCollateralReading', cbCollateral: 2.25 }],
    } as never);
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(snap.records).toHaveProperty('entries');
    expect(snap.records).toHaveProperty('deletions');
    expect('dayLog' in (snap.records as object)).toBe(false);
  });

  it("C-trusted settings deep-equal buildSettingsPayload minus viewer config + viewerPrivacyTrusted + nostrRelays", () => {
    useStore.setState({ viewerPrivacyTrusted: true });
    const s = useStore.getState();
    const { viewerNpub: _n, viewerPubkey: _p, viewerLabel: _l, viewerPrivacyTrusted: _t, nostrRelays: _r, ...ownerMinusViewerConfig } = buildSettingsPayload(s);
    expect(buildViewerSnapshotPayload(s).settings).toEqual(ownerMinusViewerConfig);
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
    // C-safe snapshot (no settings block at all)
    useStore.setState({ viewerPrivacyTrusted: false });
    const safe = buildViewerSnapshotPayload(useStore.getState());
    expect('settings' in safe).toBe(false);
    expect('viewerDisplayName' in safe).toBe(false);
    // C-trusted snapshot settings
    useStore.setState({ viewerPrivacyTrusted: true });
    const trusted = buildViewerSnapshotPayload(useStore.getState());
    expect('viewerDisplayName' in (trusted.settings as Record<string, unknown>)).toBe(false);
    // reset for other suites
    useStore.setState({ viewerPrivacyTrusted: false });
    useStore.getState().setViewerDisplayName(null);
  });

  // Owner "Preview as viewer" — the SafeSnapshot the preview injects can NEVER show more than the wire payload
  // (it IS the safe branch of buildViewerSnapshotPayload). Trusted mode → null (preview uses live-derive).
  it('previewSafeSnapFromPayload: safe payload → SafeSnapshot deep-equals the payload safe fields; trusted → null', () => {
    useStore.setState({ viewerPrivacyTrusted: false, hasCbLoan: true } as never);
    const payload = buildViewerSnapshotPayload(useStore.getState());
    expect(payload.privacyMode).toBe('safe');
    const snap = previewSafeSnapFromPayload(payload);
    expect(snap).toEqual({
      safety: payload.safety,
      thresholds: payload.thresholds,
      btcPriceAtSnapshot: payload.btcPriceAtSnapshot,
      hasCbLoan: payload.hasCbLoan,
    });

    useStore.setState({ viewerPrivacyTrusted: true } as never);
    const trustedPayload = buildViewerSnapshotPayload(useStore.getState());
    expect(previewSafeSnapFromPayload(trustedPayload)).toBeNull();

    useStore.setState({ viewerPrivacyTrusted: false, hasCbLoan: false } as never);
  });
});
