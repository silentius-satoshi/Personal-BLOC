import { describe, it, expect, vi, beforeEach } from 'vitest';

// Multi-viewer M2 — publishViewerSnapshotNow fans OUT one publish per roster slot; publishViewerRevocationNow
// tombstones ONE slot. Mock publish.ts (dynamic-imported by the store) so we can count + inspect the calls.
// Kept in its own file (module-level publish mock) like recordsPublishDebounce.test.ts.
const { publishViewerSnapshot } = vi.hoisted(() => ({
  publishViewerSnapshot: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../lib/nostr/publish', () => ({ publishViewerSnapshot }));

import { useStore, publishViewerSnapshotNow, publishViewerRevocationNow, type ViewerSlot } from '../useStore';

const pkSafe    = 's'.repeat(64);
const pkSafe2   = 'u'.repeat(64);
const pkTrusted = 't'.repeat(64);
const slot = (i: number, pubkeyHex: string, tier: 'safe' | 'trusted'): ViewerSlot =>
  ({ index: i, pubkeyHex, npub: `npub1${pubkeyHex.slice(0, 6)}`, label: `V${i}`, tier, keyVersion: 1 });

// The 2nd positional arg to publishViewerSnapshot is the target pubkey; the 3rd is the payload.
const callFor = (pubkey: string) => publishViewerSnapshot.mock.calls.find((c) => c[1] === pubkey);

describe('viewer fan-out (M2)', () => {
  beforeEach(() => {
    publishViewerSnapshot.mockReset();
    publishViewerSnapshot.mockResolvedValue(1);
    useStore.setState({
      isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'ownerpk', nostrSigningMethod: 'local',
      nostrRelays: [], viewerMode: false,
      viewers: [], nextViewerIndex: 0,
    } as never);
  });

  it('publishes ONCE PER SLOT to the right pubkey with the tier-matched payload', async () => {
    useStore.setState({ viewers: [slot(0, pkSafe, 'safe'), slot(1, pkTrusted, 'trusted')], nextViewerIndex: 2 } as never);
    await publishViewerSnapshotNow();
    expect(publishViewerSnapshot).toHaveBeenCalledTimes(2);
    // distinct pubkeys ⇒ distinct viewerDTag(pubkey) d-tags (viewerDTag is a pure fn of the pubkey — unit-tested in viewerSync.test.ts)
    expect(callFor(pkSafe)?.[2]).toMatchObject({ privacyMode: 'safe' });
    expect(callFor(pkTrusted)?.[2]).toMatchObject({ privacyMode: 'trusted' });
  });

  it('builds the payload ONCE PER TIER — two same-tier slots receive the reference-equal payload', async () => {
    useStore.setState({ viewers: [slot(0, pkSafe, 'safe'), slot(1, pkSafe2, 'safe'), slot(2, pkTrusted, 'trusted')], nextViewerIndex: 3 } as never);
    await publishViewerSnapshotNow();
    expect(publishViewerSnapshot).toHaveBeenCalledTimes(3);
    const safeA = callFor(pkSafe)?.[2];
    const safeB = callFor(pkSafe2)?.[2];
    expect(safeA).toBe(safeB);   // SAME object → built once for the 'safe' tier
    expect(callFor(pkTrusted)?.[2]).not.toBe(safeA);   // trusted is a distinct build
  });

  it('FAILURE ISOLATION — one slot rejecting does not abort the rest (allSettled), never throws', async () => {
    publishViewerSnapshot.mockImplementation((_s: unknown, pubkey: string) =>
      pubkey === pkSafe ? Promise.reject(new Error('relay down')) : Promise.resolve(1));
    useStore.setState({ viewers: [slot(0, pkSafe, 'safe'), slot(1, pkTrusted, 'trusted')], nextViewerIndex: 2 } as never);
    await expect(publishViewerSnapshotNow()).resolves.toBeUndefined();   // fire-and-forget, no throw
    expect(callFor(pkSafe)).toBeTruthy();      // slot A was attempted
    expect(callFor(pkTrusted)).toBeTruthy();   // slot B still published
  });

  it('empty roster → no-op (no publish)', async () => {
    await publishViewerSnapshotNow();
    expect(publishViewerSnapshot).not.toHaveBeenCalled();
  });

  it('revocation targets ONLY the given slot (its pubkey → its d-tag) with a revoked tombstone', async () => {
    useStore.setState({ viewers: [slot(0, pkSafe, 'safe'), slot(1, pkTrusted, 'trusted')], nextViewerIndex: 2 } as never);
    await publishViewerRevocationNow(pkSafe);
    expect(publishViewerSnapshot).toHaveBeenCalledTimes(1);
    expect(callFor(pkSafe)?.[2]).toMatchObject({ revoked: true });
    expect(callFor(pkTrusted)).toBeUndefined();   // the other slot is untouched
  });
});
