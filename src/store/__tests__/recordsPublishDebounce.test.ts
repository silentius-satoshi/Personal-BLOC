import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The records publish is coalesced by a trailing ~400ms debounce (EventSheet fires two back-to-back
// addDayEvent → two publishRecordsNow, which must collapse to ONE publish snapshotting state at FIRE time).
// Mock publish.ts so we can count publishRecords invocations + inspect the coalesced payload. Kept in its OWN
// file — the module-level publish mock + fake timers would otherwise disturb dailyModeStore.test.ts.
const { publishRecords, publishViewerSnapshot } = vi.hoisted(() => ({
  publishRecords:        vi.fn().mockResolvedValue(1234),
  publishViewerSnapshot: vi.fn().mockResolvedValue(1),
}));

vi.mock('../../lib/nostr/publish', () => ({ publishRecords, publishViewerSnapshot }));

import { useStore } from '../useStore';
import { publishRecordsNow } from '../../lib/nostr/syncEngine';
import type { DayEvent } from '../../simulation/types';

const draw = (id: string, ts: number): DayEvent =>
  ({ id, date: '2026-07-01', ts, kind: 'draw', amount: 100 });

describe('records publish debounce (P3 coalescing)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publishRecords.mockClear();
    useStore.setState({
      isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk',
      viewerMode: false, viewers: [], nostrSigningMethod: 'local',
      nostrRelays: [], dayLog: [], monthlyLog: [], deletedMonths: {}, deletedDayEvents: {},
      recordsDirty: false,
    } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    useStore.setState({ isAuthenticated: false, nostrSigner: null, nostrPubkey: '', viewerMode: false } as never);
  });

  it('three rapid calls → exactly ONE publish, snapshotting state at fire time (includes an event added after scheduling)', async () => {
    useStore.setState({ dayLog: [draw('a', 1)] } as never);

    publishRecordsNow();
    publishRecordsNow();
    publishRecordsNow();
    expect(publishRecords).not.toHaveBeenCalled();   // all three coalesced, still pending

    // add a SECOND event after scheduling — it must land in the payload (snapshot at fire, not schedule, time)
    useStore.setState({ dayLog: [draw('a', 1), draw('b', 2)] } as never);

    await vi.advanceTimersByTimeAsync(400);

    expect(publishRecords).toHaveBeenCalledTimes(1);
    const payload = publishRecords.mock.calls[0][2];   // (signer, pubkey, payload, relays, opTimeout)
    expect(payload.dayLog).toHaveLength(2);
    expect(payload.dayLog.map((e: DayEvent) => e.id)).toEqual(['a', 'b']);
  });
});
