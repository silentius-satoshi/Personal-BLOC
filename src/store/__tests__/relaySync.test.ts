import { describe, it, expect, afterEach, vi } from 'vitest';
import { useStore } from '../useStore';
import { buildSettingsPayload, buildViewerSnapshotPayload } from '../payloads';
import { DEFAULT_RELAYS } from '../../lib/nostr/relays';

// Option C — relay list cross-device sync, on the REAL store. Phase 4e retired hydrateSettings' relay guard with
// settings:v1: a peer's relay list now arrives only as a plan event (folded), and discovery never emits one.
const A = 'wss://a.example';
const B = 'wss://b.example';
const C = 'wss://c.example';
const D = 'wss://d.example';

const relays = () => useStore.getState().nostrRelays;
const seedLocal = (list: string[]) => useStore.getState().setNostrRelays(list);

describe('Option C — settings payload carries nostrRelays (owner sync), viewer snapshot strips it', () => {
  it('buildSettingsPayload INCLUDES nostrRelays (syncs across the owner devices)', () => {
    seedLocal([A, B, C]);
    const payload = buildSettingsPayload(useStore.getState());
    expect('nostrRelays' in payload).toBe(true);
    expect(payload.nostrRelays).toEqual([A, B, C]);
  });

  it("buildViewerSnapshotPayload's settings does NOT carry nostrRelays (owner transport config)", () => {
    seedLocal([A, B, C]);
    // Multi-viewer M2 — the C-trusted branch (only it carries a settings block) via the explicit tier param.
    const snapSettings = buildViewerSnapshotPayload(useStore.getState(), 'trusted').settings as Record<string, unknown>;
    expect('nostrRelays' in snapSettings).toBe(false);
    // sanity: it still carries the real synced settings a viewer needs
    expect('income' in snapSettings).toBe(true);
    useStore.setState({ viewers: [], nextViewerIndex: 0 } as never);   // restore default for other suites
  });
});

describe('Option C on the plan channel (4e) — a peer\'s relay list arrives only through the fold', () => {
  it('a folded nostrRelays event replaces the local list (add + remove both propagate)', () => {
    seedLocal([A, B, C]);
    useStore.getState().applyPlanFold({ nostrRelays: [A, B, D] });
    expect(relays()).toEqual([A, B, D]);   // C removed, D added
    // Restore defaults on a peer: a folded DEFAULT_RELAYS replaces a custom list (the retired relay guard kept it)
    useStore.getState().applyPlanFold({ nostrRelays: [...DEFAULT_RELAYS] });
    expect(relays(), 'RELAYS defaults').toEqual([...DEFAULT_RELAYS]);
  });

  it('a fold without the field leaves the local list alone (absent = not set, §6) — and a sibling field still lands', () => {
    seedLocal([A, B, C]);
    useStore.getState().applyPlanFold({ income: 7777 });
    expect(relays()).toEqual([A, B, C]);
    expect(useStore.getState().income).toBe(7777);
  });
});

describe('Option C follow-on — relay edits publish on their own', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    // restore a clean store so other suites don't see the fake auth state.
    useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '', initialSettingsPullDone: false } as never);
  });

  it('setNostrRelaysAndSync sets the list AND marks planDirty (4c: emits a plan event; user-edit publish path)', () => {
    // emitPlanSets appends + marks planDirty synchronously; fake timers swallow the 2s debounce kick.
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', planDirty: false, planEvents: [], initialSettingsPullDone: true } as never);
    vi.useFakeTimers();

    useStore.getState().setNostrRelaysAndSync([A, B]);

    expect(relays()).toEqual([A, B]);
    expect(useStore.getState().planDirty).toBe(true);
    expect(useStore.getState().planEvents.some((e) => e.field === 'nostrRelays')).toBe(true);
  });

  it('plain setNostrRelays sets the list but leaves planDirty untouched (bootstrap path — discovery must stay silent)', () => {
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', planDirty: false, planEvents: [] } as never);
    vi.useFakeTimers();

    useStore.getState().setNostrRelays([A]);

    expect(relays()).toEqual([A]);
    expect(useStore.getState().planDirty).toBe(false);   // no emit — discovery must stay silent (no plan event)
    expect(useStore.getState().planEvents.length).toBe(0);
  });
});
