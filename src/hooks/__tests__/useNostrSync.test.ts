import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The hook's React/DOM lifecycle (useEffect wiring, document.visibilityState, focus/online listeners)
// is DEVICE-verified — the node test env has no DOM/renderHook. Only the pure, injectable
// scheduleDirtyRetry backoff logic is unit-tested here. The mocks below keep importing the hook module
// from pulling in the real store (whose module init reads localStorage, absent under node).
vi.mock('../../store/useStore', () => ({ useStore: { getState: () => ({}) } }));
vi.mock('../../lib/nostr/syncNow', () => ({ syncNow: vi.fn() }));
vi.mock('../../lib/nostr/liveSync', () => ({ openLiveSync: vi.fn(), closeLiveSync: vi.fn() }));
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: {} }) }));

import { scheduleDirtyRetry } from '../useNostrSync';

describe('scheduleDirtyRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('dirty=true schedules and fires triggerSync at 5s then 10s', () => {
    const onTick = vi.fn();
    scheduleDirtyRetry(
      { dirty: true, live: true, viewerMode: false, backupGateOk: true },
      { isVisible: () => true, onTick },
    );

    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('flags clearing cancels the chain (cleanup clears the pending tick)', () => {
    const onTick = vi.fn();
    const cleanup = scheduleDirtyRetry(
      { dirty: true, live: true, viewerMode: false, backupGateOk: true },
      { isVisible: () => true, onTick },
    );

    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);

    cleanup(); // models the effect teardown when recordsDirty/settingsDirty go false
    vi.advanceTimersByTime(60000);
    expect(onTick).toHaveBeenCalledTimes(1); // no further ticks after cleanup
  });

  it('live=false never schedules', () => {
    const onTick = vi.fn();
    const cleanup = scheduleDirtyRetry(
      { dirty: true, live: false, viewerMode: false, backupGateOk: true },
      { isVisible: () => true, onTick },
    );

    vi.advanceTimersByTime(60000);
    expect(onTick).not.toHaveBeenCalled();
    expect(cleanup).toBeTypeOf('function'); // no-op cleanup
  });

  it('viewerMode never schedules', () => {
    const onTick = vi.fn();
    scheduleDirtyRetry(
      { dirty: true, live: true, viewerMode: true, backupGateOk: true },
      { isVisible: () => true, onTick },
    );

    vi.advanceTimersByTime(60000);
    expect(onTick).not.toHaveBeenCalled();
  });

  // Backup gate (R2a-1): a generated-but-unverified key runs no retry chain — the engine is silent end to end.
  it('backupGateOk=false never schedules', () => {
    const onTick = vi.fn();
    scheduleDirtyRetry(
      { dirty: true, live: true, viewerMode: false, backupGateOk: false },
      { isVisible: () => true, onTick },
    );

    vi.advanceTimersByTime(60000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('hidden ticks skip onTick but keep the chain alive at the current delay', () => {
    const onTick = vi.fn();
    let visible = false;
    scheduleDirtyRetry(
      { dirty: true, live: true, viewerMode: false, backupGateOk: true },
      { isVisible: () => visible, onTick },
    );

    // Hidden: the 5s tick fires but skips the call; the chain reschedules at the SAME 5s delay.
    vi.advanceTimersByTime(5000);
    expect(onTick).not.toHaveBeenCalled();
    visible = true;
    vi.advanceTimersByTime(5000); // still 5s (backoff did not advance while hidden)
    expect(onTick).toHaveBeenCalledTimes(1);
  });
});
