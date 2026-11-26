import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Hardening 2 — syncNow.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 * The store a plain object (sync.test.ts's pattern); the signer rebuild, the pull and the engine mocked — the rebuild
 * decision (syncNow.ts, before any network step) is all this reads.
 */
const { st, restoreSigner } = vi.hoisted(() => ({ st: {} as Record<string, any>, restoreSigner: vi.fn() }));
vi.mock('../../../store/useStore', () => ({ useStore: { getState: () => st } }));
vi.mock('../session', () => ({ restoreSigner }));
vi.mock('../sync', () => ({ fetchAndSync: vi.fn().mockResolvedValue({ ok: true, planFound: true }) }));
vi.mock('../syncEngine', () => ({
  publishRecordsNowImmediate: vi.fn().mockResolvedValue(true), publishPlanEventsNow: vi.fn().mockResolvedValue(true),
  publishPrefsNow: vi.fn().mockResolvedValue(true), flushViewerRevocations: vi.fn().mockResolvedValue(undefined),
  refusedForSize: vi.fn(() => false), heldWithoutPlan: vi.fn(() => false),
}));
vi.mock('../firstPull', () => ({ firstPullStarts: vi.fn(), firstPullLands: vi.fn() }));

import { syncNow, markSignerFresh } from '../syncNow';

const T0 = 1_800_000_000_000;
function signedIn(method: 'local' | 'nip46') {
  for (const k of Object.keys(st)) delete st[k];
  Object.assign(st, {
    nostrPubkey: 'pk', nostrSigningMethod: method, keyProvenance: 'imported', backupVerifiedAt: null, viewerMode: false,
    nostrSigner: {}, nostrRelays: ['wss://r'], recordsDirty: false, planDirty: false, prefsDirty: false,
    pendingViewerRevocations: [], setNostrSyncing: vi.fn(), setNostrReconnectNeeded: vi.fn(), recordRemotePlanFound: vi.fn(),
    setInitialSettingsPullDone: vi.fn(), setNostrRelays: vi.fn(), setLastSyncAt: vi.fn(), setNostrLastSyncAt: vi.fn(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  restoreSigner.mockReset();
  restoreSigner.mockResolvedValue({});
});
afterEach(() => { vi.useRealTimers(); });

describe('Hardening 2 — syncNow', () => {
  it('HY-14 · sync.md "Nostr reliability fix" — the throttled foreground signer rebuild is NIP-46 only: a local key with a signer is never rebuilt (no passkey sheet per foreground)', async () => {
    signedIn('local');
    markSignerFresh();
    vi.setSystemTime(T0 + 30_000);   // past the 20 s throttle
    await syncNow({} as never).catch(() => {});
    expect(restoreSigner, 'HY-14 a local key keeps its signer').not.toHaveBeenCalled();
    // Premise — the throttle path is live: a NIP-46 session 30 s on IS rebuilt.
    signedIn('nip46');
    markSignerFresh();
    vi.setSystemTime(T0 + 60_000);
    await syncNow({} as never).catch(() => {});
    expect(restoreSigner, 'HY-14 premise: NIP-46 is rebuilt').toHaveBeenCalledTimes(1);
  });
});
