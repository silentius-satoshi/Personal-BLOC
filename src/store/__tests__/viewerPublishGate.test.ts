import { describe, it, expect, afterEach, vi } from 'vitest';
import { useStore, publishRecordsNowImmediate } from '../useStore';

// Read-only-viewer backstop: the records publish must NEVER publish in viewerMode (a viewer is authenticated with its
// own nsec, so the auth gate alone wouldn't stop it). setNostrSyncing(true) fires only AFTER the gate, so it's the
// clean discriminator between "blocked at the gate" and "passed the gate". The dynamic publishRecords import is NOT
// mocked (mirrors existing tests) — the owner path proceeds to the real publish and fails on the stub signer.
// NB: publishRecordsNow is now a fire-and-forget trailing debounce; the gate + boolean live on the immediate variant.
describe('publishRecordsNowImmediate — viewerMode gate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '', viewerMode: false } as never);
  });

  it('Case A — a read-only viewer is BLOCKED (returns false at the gate, never reaches the publish attempt)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Full publish credentials AND viewerMode true — only the new gate should stop it.
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', viewerMode: true } as never);
    const syncSpy = vi.spyOn(useStore.getState(), 'setNostrSyncing');

    const result = await publishRecordsNowImmediate();

    expect(result).toBe(false);
    expect(syncSpy).not.toHaveBeenCalled();   // returned at the gate, before the publish path's setNostrSyncing(true)
  });

  it('Case B — the OWNER (viewerMode false) is NOT blocked by the viewerMode gate (passes it; baseline unchanged)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useStore.setState({ isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', viewerMode: false } as never);
    const syncSpy = vi.spyOn(useStore.getState(), 'setNostrSyncing');

    const result = await publishRecordsNowImmediate();

    // Passed the viewerMode gate → reached the publish path (setNostrSyncing(true)); then returns false at the real
    // publish step because the stub signer has no nip44. The point: viewerMode false does NOT block (pre-change baseline).
    expect(syncSpy).toHaveBeenCalledWith(true);
    expect(result).toBe(false);
  });
});
