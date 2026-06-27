import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, buildSettingsPayload, buildViewerSnapshotPayload } from '../useStore';
import { deriveCbCollateral } from '../../simulation/logUtils';

describe('viewer snapshot builders', () => {
  beforeEach(() => {
    // Reset the viewer config between cases (other state is irrelevant to these assertions).
    useStore.getState().setViewerNpub(null);
    useStore.getState().setViewerPubkey(null);
    useStore.getState().setViewerLabel(null);
  });

  it("buildSettingsPayload INCLUDES the owner's viewer config (synced in the owner's own settings:v1)", () => {
    useStore.getState().setViewerNpub('npub1exampleviewer');
    useStore.getState().setViewerPubkey('a'.repeat(64));
    useStore.getState().setViewerLabel("Dad's iPhone");
    const payload = buildSettingsPayload(useStore.getState());
    expect('viewerNpub' in payload).toBe(true);
    expect('viewerPubkey' in payload).toBe(true);
    expect('viewerLabel' in payload).toBe(true);
    expect(payload.viewerNpub).toBe('npub1exampleviewer');
    expect(payload.viewerPubkey).toBe('a'.repeat(64));
    expect(payload.viewerLabel).toBe("Dad's iPhone");
    // sanity: it also carries real synced settings
    expect('income' in payload).toBe(true);
    expect('advisorMonthStartBalance' in payload).toBe(true);
  });

  it("buildViewerSnapshotPayload STRIPS the owner's viewer config (the viewer must not see who else is shared with)", () => {
    useStore.getState().setViewerNpub('npub1exampleviewer');
    useStore.getState().setViewerPubkey('a'.repeat(64));
    useStore.getState().setViewerLabel("Dad's iPhone");
    const snapSettings = buildViewerSnapshotPayload(useStore.getState()).settings as Record<string, unknown>;
    expect('viewerNpub' in snapSettings).toBe(false);
    expect('viewerPubkey' in snapSettings).toBe(false);
    expect('viewerLabel' in snapSettings).toBe(false);
    // but still carries the real settings the viewer needs
    expect('income' in snapSettings).toBe(true);
  });

  it('buildViewerSnapshotPayload has the Option-B shape: settings + records + strike + cbCollateralBtc (P3)', () => {
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(Object.keys(snap).sort()).toEqual(['cbCollateralBtc', 'records', 'settings', 'strike']);
    expect(snap.records).toHaveProperty('entries');
    expect(snap.records).toHaveProperty('deletions');
    expect(snap.strike).toHaveProperty('usd');
    expect(snap.strike).toHaveProperty('btcAvail');
    expect(snap.strike).toHaveProperty('rate');
  });

  it('P3 (BUG2): snapshot carries cbCollateralBtc derived from dayLog (the viewer gets the scalar, not the journal)', () => {
    useStore.setState({
      dayLog: [{ id: 'c1', date: '2026-01-05', ts: 5000, kind: 'cbCollateralReading', cbCollateral: 2.25 }],
      cbCollateralBtc: 0.99,
    } as never);
    const s = useStore.getState();
    const snap = buildViewerSnapshotPayload(s);
    expect(snap.cbCollateralBtc).toBe(deriveCbCollateral(s.dayLog, s.cbCollateralBtc));   // single source — cannot drift
    expect(snap.cbCollateralBtc).toBeCloseTo(2.25);   // newest reading, not the 0.99 cache
  });

  it("P3: the snapshot's records carry entries + deletions but NOT the raw dayLog journal", () => {
    useStore.setState({
      dayLog: [{ id: 'c1', date: '2026-01-05', ts: 5000, kind: 'cbCollateralReading', cbCollateral: 2.25 }],
    } as never);
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(snap.records).toHaveProperty('entries');
    expect(snap.records).toHaveProperty('deletions');
    expect('dayLog' in snap.records).toBe(false);
  });

  it("the snapshot's settings deep-equal buildSettingsPayload minus the owner's viewer config + nostrRelays (single source — cannot drift)", () => {
    const s = useStore.getState();
    // nostrRelays is ALSO stripped from the viewer snapshot (owner transport config) — see buildViewerSnapshotPayload.
    const { viewerNpub: _n, viewerPubkey: _p, viewerLabel: _l, nostrRelays: _r, ...ownerMinusViewerConfig } = buildSettingsPayload(s);
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
});
