import { describe, it, expect, afterEach, vi } from 'vitest';
import { useStore } from '../useStore';
import { publishPlanEventsNow, publishPrefsNow } from '../../lib/nostr/syncEngine';

// Fresh-Install Settings Clobber — the initialSettingsPullDone gate. A benign post-auth setter fired the instant auth
// flipped true could publish SEED defaults over the owner's real relay plan. Until Phase 4e two store-level defenses
// guarded the settings:v1 bridge (Fix C: syncSettingsToNostr would not dirty pre-pull; Fix D: publishSettingsNow refused
// a seed-identical payload pre-pull) — both retired with the bridge. What remains, and is pinned here: NO plan or prefs
// publish before this session's first pull. On the plan channel a fresh device's seed is ABSENT from its log (§6), so
// there is nothing seed-valued to publish anyway; this gate keeps a pre-pull edit local until the pull has run.

const authed = (overrides: Record<string, unknown> = {}) =>
  useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', keyProvenance: 'imported', ...overrides } as never);
const realSetNostrSyncing = useStore.getState().setNostrSyncing;

afterEach(() => {
  vi.restoreAllMocks();
  // leave a clean store so sibling suites don't see fake auth / a stuck flag
  useStore.setState({
    isAuthenticated: false, nostrSigner: null, nostrPubkey: '', initialSettingsPullDone: false,
    planDirty: false, prefsDirty: false, setNostrSyncing: realSetNostrSyncing,
  } as never);
});

describe('the pull gate — no plan or prefs publish before the initial pull (4e: the successor to Fix C/D)', () => {
  it('!initialSettingsPullDone → both publishes refuse at the gate, before setNostrSyncing', async () => {
    authed({ initialSettingsPullDone: false, planDirty: true, prefsDirty: true });
    const syncSpy = vi.fn();
    useStore.setState({ setNostrSyncing: syncSpy } as never);
    expect(await publishPlanEventsNow()).toBe(false);
    expect(await publishPrefsNow()).toBe(false);
    expect(syncSpy).not.toHaveBeenCalled();
    expect(useStore.getState().planDirty).toBe(true);    // the edit waits for the pull
  });

  it('after the pull (initialSettingsPullDone true) → the plan publish passes the gate (publishing not broken)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authed({ initialSettingsPullDone: true, planDirty: true });
    const syncSpy = vi.fn();
    useStore.setState({ setNostrSyncing: syncSpy } as never);
    // the stub signer has no nip44 → the real publish fails downstream (network-free) → false, but past the gate
    await publishPlanEventsNow();
    expect(syncSpy).toHaveBeenCalledWith(true);
  });
});
