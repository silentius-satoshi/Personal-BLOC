import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStoreState, mockPool } = vi.hoisted(() => ({
  mockStoreState: {} as Record<string, any>,
  mockPool: {
    subscribeMany: vi.fn(),
    close:         vi.fn(),
  },
}));

vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return mockPool; }),
}));

vi.mock('../../../store/useStore', () => ({
  useStore: { getState: () => mockStoreState },
}));

import { openLiveSync, closeLiveSync } from '../liveSync';

describe('liveSync singleton', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    closeLiveSync();   // reset module-singleton state from the previous test
    vi.clearAllMocks();
    mockPool.subscribeMany.mockReturnValue({ close: vi.fn() });
    Object.assign(mockStoreState, { nostrPubkey: 'pk', nostrRelays: ['wss://r1', 'wss://r2'] });
  });

  it('double open → a single subscription', () => {
    openLiveSync();
    openLiveSync();
    expect(mockPool.subscribeMany).toHaveBeenCalledTimes(1);
  });

  it('close tears down sub + pool; reopen re-subscribes', () => {
    openLiveSync();
    const subCloser = mockPool.subscribeMany.mock.results[0].value;
    closeLiveSync();
    expect(subCloser.close).toHaveBeenCalled();
    expect(mockPool.close).toHaveBeenCalledWith(['wss://r1', 'wss://r2']);
    openLiveSync();
    expect(mockPool.subscribeMany).toHaveBeenCalledTimes(2);
  });

  it('no pubkey → no subscription', () => {
    mockStoreState.nostrPubkey = '';
    openLiveSync();
    expect(mockPool.subscribeMany).not.toHaveBeenCalled();
  });
});
