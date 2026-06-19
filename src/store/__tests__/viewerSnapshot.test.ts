import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, buildSettingsPayload, buildViewerSnapshotPayload } from '../useStore';

describe('viewer snapshot builders', () => {
  beforeEach(() => {
    // Reset the viewer config between cases (other state is irrelevant to these assertions).
    useStore.getState().setViewerNpub(null);
    useStore.getState().setViewerPubkey(null);
  });

  it('buildSettingsPayload NEVER includes the viewer config (device-local, never synced)', () => {
    useStore.getState().setViewerNpub('npub1exampleviewer');
    useStore.getState().setViewerPubkey('a'.repeat(64));
    const payload = buildSettingsPayload(useStore.getState());
    expect('viewerNpub' in payload).toBe(false);
    expect('viewerPubkey' in payload).toBe(false);
    // sanity: it DOES carry real synced settings
    expect('income' in payload).toBe(true);
    expect('advisorMonthStartBalance' in payload).toBe(true);
  });

  it('buildViewerSnapshotPayload has the Option-B shape: settings + records + strike', () => {
    const snap = buildViewerSnapshotPayload(useStore.getState());
    expect(Object.keys(snap).sort()).toEqual(['records', 'settings', 'strike']);
    expect(snap.records).toHaveProperty('entries');
    expect(snap.records).toHaveProperty('deletions');
    expect(snap.strike).toHaveProperty('usd');
    expect(snap.strike).toHaveProperty('btcAvail');
    expect(snap.strike).toHaveProperty('rate');
  });

  it("the snapshot's settings deep-equal buildSettingsPayload (single source — cannot drift)", () => {
    const s = useStore.getState();
    expect(buildViewerSnapshotPayload(s).settings).toEqual(buildSettingsPayload(s));
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
