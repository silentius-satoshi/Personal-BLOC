import { describe, it, expect, afterEach, vi } from 'vitest';
import { useStore, buildSettingsPayload, buildViewerSnapshotPayload } from '../useStore';
import { DEFAULT_RELAYS } from '../../lib/nostr/relays';

// Option C — relay list cross-device sync. The guard tests drive the REAL store's hydrateSettings (the single apply
// chokepoint): seed local via setNostrRelays, hydrate an incoming payload, assert the resulting nostrRelays.
const A = 'wss://a.example';
const B = 'wss://b.example';
const C = 'wss://c.example';
const D = 'wss://d.example';

const relays = () => useStore.getState().nostrRelays;
const seedLocal = (list: string[]) => useStore.getState().setNostrRelays(list);
const hydrate = (data: Record<string, unknown>) => useStore.getState().hydrateSettings(data);

describe('Option C — settings payload carries nostrRelays (owner sync), viewer snapshot strips it', () => {
  it('buildSettingsPayload INCLUDES nostrRelays (syncs across the owner devices)', () => {
    seedLocal([A, B, C]);
    const payload = buildSettingsPayload(useStore.getState());
    expect('nostrRelays' in payload).toBe(true);
    expect(payload.nostrRelays).toEqual([A, B, C]);
  });

  it("buildViewerSnapshotPayload's settings does NOT carry nostrRelays (owner transport config)", () => {
    seedLocal([A, B, C]);
    const snapSettings = buildViewerSnapshotPayload(useStore.getState()).settings as Record<string, unknown>;
    expect('nostrRelays' in snapSettings).toBe(false);
    // sanity: it still carries the real synced settings a viewer needs
    expect('income' in snapSettings).toBe(true);
  });
});

describe('Option C — hydrateSettings relay guard (replace-on-hydrate, default-looking incoming guarded)', () => {
  it('(a) custom incoming replaces a custom local list (add + remove both propagate)', () => {
    seedLocal([A, B, C]);
    hydrate({ nostrRelays: [A, B, D] });
    expect(relays()).toEqual([A, B, D]);   // C removed, D added
  });

  it('(b) empty incoming is guarded — a real custom local list is kept', () => {
    seedLocal([A, B, C]);
    hydrate({ nostrRelays: [] });
    expect(relays()).toEqual([A, B, C]);
  });

  it('(c) DEFAULT_RELAYS incoming is guarded — a real custom local list is kept', () => {
    seedLocal([A, B, C]);
    hydrate({ nostrRelays: [...DEFAULT_RELAYS] });
    expect(relays()).toEqual([A, B, C]);
  });

  it('(d) custom incoming applies when local is just DEFAULT_RELAYS (not a protected custom list)', () => {
    seedLocal([...DEFAULT_RELAYS]);
    hydrate({ nostrRelays: [A, B, D] });
    expect(relays()).toEqual([A, B, D]);
  });

  it('(d2) custom incoming applies when local is empty', () => {
    seedLocal([]);
    hydrate({ nostrRelays: [A, B, D] });
    expect(relays()).toEqual([A, B, D]);
  });

  it('(e) order-independent: incoming = DEFAULT_RELAYS shuffled is still treated as defaults → guarded', () => {
    seedLocal([A, B, C]);
    hydrate({ nostrRelays: [...DEFAULT_RELAYS].reverse() });
    expect(relays()).toEqual([A, B, C]);   // sorted-join compare sees the shuffle as defaults
  });

  it('(f) skip-FIELD not skip-all: a guarded relays field does not block other fields (income applies)', () => {
    seedLocal([A, B, C]);
    useStore.getState().setIncome(1234);
    hydrate({ income: 7777, nostrRelays: [...DEFAULT_RELAYS] });
    expect(useStore.getState().income).toBe(7777);   // income applied
    expect(relays()).toEqual([A, B, C]);              // relays skipped (guarded)
  });
});

describe('Option C follow-on — relay edits publish on their own', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    // restore a clean store so other suites don't see the fake auth state.
    useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '', settingsDirty: false } as never);
  });

  it('setNostrRelaysAndSync sets the list AND marks settingsDirty (user-edit publish path)', () => {
    // syncSettingsToNostr early-returns unless authed; fake timers swallow the 2s debounce publish.
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', settingsDirty: false } as never);
    vi.useFakeTimers();

    useStore.getState().setNostrRelaysAndSync([A, B]);

    expect(relays()).toEqual([A, B]);
    expect(useStore.getState().settingsDirty).toBe(true);
  });

  it('plain setNostrRelays sets the list but leaves settingsDirty untouched (bootstrap path)', () => {
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', settingsDirty: false } as never);
    vi.useFakeTimers();

    useStore.getState().setNostrRelays([A]);

    expect(relays()).toEqual([A]);
    expect(useStore.getState().settingsDirty).toBe(false);   // no publish trigger — discovery must stay silent
  });
});
