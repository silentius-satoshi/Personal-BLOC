import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, migrateState, type ViewerSlot } from '../useStore';

// Multi-viewer M1 — the roster (viewers + nextViewerIndex) replaces the 5 single-viewer scalars.
// Migration v21 is CLEAN-CUT (no back-compat): the old scalars are DROPPED, the roster starts empty.

describe('migrateState v21 — roster replaces the single-viewer scalars', () => {
  it('a v20 blob WITH the old scalars → they are dropped, roster empty', () => {
    const out: any = migrateState({
      monthlyLog: [],
      viewerNpub: 'npub1old', viewerPubkey: 'a'.repeat(64), viewerLabel: 'Dad',
      viewerPrivacyTrusted: true, viewerKeyVersion: 3,
    });
    expect(out.viewers).toEqual([]);
    expect(out.nextViewerIndex).toBe(0);
    // the old scalars must NOT leak through ...rest
    expect('viewerNpub' in out).toBe(false);
    expect('viewerPubkey' in out).toBe(false);
    expect('viewerLabel' in out).toBe(false);
    expect('viewerPrivacyTrusted' in out).toBe(false);
    expect('viewerKeyVersion' in out).toBe(false);
  });

  it('a blob WITHOUT the old scalars → same empty roster', () => {
    const out: any = migrateState({ monthlyLog: [] });
    expect(out.viewers).toEqual([]);
    expect(out.nextViewerIndex).toBe(0);
  });
});

describe('roster setters', () => {
  beforeEach(() => { useStore.setState({ viewers: [], nextViewerIndex: 0 } as never); });

  const slot = (label: string): Omit<ViewerSlot, 'index'> =>
    ({ pubkeyHex: label.repeat(1).padEnd(64, '0'), npub: `npub1${label}`, label, tier: 'safe', keyVersion: 1 });

  it('addViewerSlot assigns MONOTONIC indices + increments nextViewerIndex', () => {
    useStore.getState().addViewerSlot(slot('a'));
    useStore.getState().addViewerSlot(slot('b'));
    const { viewers, nextViewerIndex } = useStore.getState();
    expect(viewers.map((v) => v.index)).toEqual([0, 1]);
    expect(nextViewerIndex).toBe(2);
  });

  it('removeViewerSlot does NOT reuse an index (add→remove→add gives index 2, not 1)', () => {
    useStore.getState().addViewerSlot(slot('a'));   // index 0
    useStore.getState().addViewerSlot(slot('b'));   // index 1
    useStore.getState().removeViewerSlot(1);
    useStore.getState().addViewerSlot(slot('c'));   // index 2 (nextViewerIndex never regressed)
    const { viewers, nextViewerIndex } = useStore.getState();
    expect(viewers.map((v) => v.index)).toEqual([0, 2]);
    expect(nextViewerIndex).toBe(3);
  });

  it('updateViewerSlot merges a patch by index', () => {
    useStore.getState().addViewerSlot(slot('a'));   // index 0, tier safe, keyVersion 1
    useStore.getState().updateViewerSlot(0, { tier: 'trusted', keyVersion: 2 });
    const s0 = useStore.getState().viewers[0];
    expect(s0.tier).toBe('trusted');
    expect(s0.keyVersion).toBe(2);
    expect(s0.label).toBe('a');   // untouched fields preserved
  });
});

describe('the roster on the plan channel (4e — the hydrateSettings skip-guard retired)', () => {
  const incoming: ViewerSlot[] = [{ index: 5, pubkeyHex: 'b'.repeat(64), npub: 'npub1b', label: 'Sis', tier: 'trusted', keyVersion: 2 }];

  it('a folded roster pair applies (replace-on-fold) — viewers and nextViewerIndex together', () => {
    useStore.setState({ viewers: [], nextViewerIndex: 0 } as never);
    useStore.getState().applyPlanFold({ viewers: incoming, nextViewerIndex: 6 });
    expect(useStore.getState().viewers).toEqual(incoming);
    expect(useStore.getState().nextViewerIndex).toBe(6);
  });

  it('a fold without the roster leaves a populated local roster alone (absent = not set, §6)', () => {
    useStore.setState({ viewers: incoming, nextViewerIndex: 6 } as never);
    useStore.getState().applyPlanFold({ income: 1234 });
    expect(useStore.getState().viewers).toEqual(incoming);
    expect(useStore.getState().nextViewerIndex).toBe(6);
  });
});
