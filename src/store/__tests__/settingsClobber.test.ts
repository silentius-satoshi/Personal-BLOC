import { describe, it, expect, afterEach, vi } from 'vitest';
import { useStore } from '../useStore';
import { publishSettingsNow } from '../../lib/nostr/syncEngine';

// Fresh-Install Settings Clobber Fix — the initialSettingsPullDone gate. A benign post-auth setter
// (setSimpleMode) fired syncSettingsToNostr the instant auth flipped true, dirtying the SEED store →
// which both blocked the real-data hydrate AND published seed defaults over the relay. These pin the
// two store-level defenses: Fix C (syncSettingsToNostr won't dirty pre-pull) + Fix D (publishSettingsNow
// refuses a seed-identical payload pre-pull).

const authed = (overrides: Record<string, unknown> = {}) =>
  useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', settingsDirty: false, ...overrides } as never);

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // leave a clean store so sibling suites don't see fake auth / a stuck flag
  useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '', settingsDirty: false, initialSettingsPullDone: false } as never);
});

describe('Fix C — syncSettingsToNostr does not dirty before the initial pull', () => {
  it('!initialSettingsPullDone → a benign setter does NOT mark settingsDirty (prevents seed-clobber)', () => {
    vi.useFakeTimers();   // swallow the 2s debounce
    authed({ initialSettingsPullDone: false });

    useStore.getState().syncSettingsToNostr();

    expect(useStore.getState().settingsDirty).toBe(false);
  });

  it('after the pull (initialSettingsPullDone true) → a legitimate edit still dirties (publishing not broken)', () => {
    vi.useFakeTimers();
    authed({ initialSettingsPullDone: true });

    useStore.getState().syncSettingsToNostr();

    expect(useStore.getState().settingsDirty).toBe(true);
  });
});

describe('Fix D — publishSettingsNow refuses a seed-identical payload before the initial pull', () => {
  it('seed defaults + !initialSettingsPullDone → refuses (returns false, warns, no state change)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authed({ initialSettingsPullDone: false, income: 4000, expenses: 3500, creditLine: 10000, advisorActualBtcHeld: 0 });

    const ok = await publishSettingsNow();

    expect(ok).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toContain('refused');
    expect(useStore.getState().settingsDirty).toBe(false);   // never touched
  });

  it('after the pull (initialSettingsPullDone true) → the seed-guard does NOT fire even for seed values', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // fake signer has no nip44 → the real publish fails downstream (network-free) → false, but NOT the "refused" branch
    authed({ initialSettingsPullDone: true, income: 4000, expenses: 3500, creditLine: 10000, advisorActualBtcHeld: 0 });

    await publishSettingsNow();

    expect(warn.mock.calls.flat().join(' ')).not.toContain('refused');
  });
});
