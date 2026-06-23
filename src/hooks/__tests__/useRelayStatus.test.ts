import { describe, it, expect } from 'vitest';
import { readyStateToStatus } from '../useRelayStatus';

// The hook's socket lifecycle is DEVICE-verified (mocking websocket-ts event emission is high-effort, low-value);
// only the pure readyState → status mapping is unit-tested here.
describe('readyStateToStatus', () => {
  it('1 (OPEN) → connected', () => {
    expect(readyStateToStatus(1)).toBe('connected');
  });

  it('0 (CONNECTING) → connecting', () => {
    expect(readyStateToStatus(0)).toBe('connecting');
  });

  it('2 (CLOSING) → offline', () => {
    expect(readyStateToStatus(2)).toBe('offline');
  });

  it('3 (CLOSED) → offline', () => {
    expect(readyStateToStatus(3)).toBe('offline');
  });

  it('any other value → offline (defensive fallback)', () => {
    expect(readyStateToStatus(99)).toBe('offline');
  });
});
