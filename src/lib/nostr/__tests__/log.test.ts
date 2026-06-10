import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nostrLog, getNostrLog, clearNostrLog } from '../log';

// sessionStorage is absent in the node test env — log.ts guards all access in try/catch,
// so the ring works purely in-memory here.

describe('nostrLog ring buffer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    clearNostrLog();
  });

  it('caps at 50 entries, keeping the newest', () => {
    for (let i = 0; i < 60; i++) nostrLog('info', `msg-${i}`);
    const log = getNostrLog();
    expect(log).toHaveLength(50);
    expect(log[0].msg).toBe('msg-10');     // oldest surviving
    expect(log[49].msg).toBe('msg-59');    // newest last
  });

  it('appends newest last with level + serialized error data', () => {
    nostrLog('info', 'first');
    nostrLog('error', 'second', new Error('boom'));
    const log = getNostrLog();
    expect(log).toHaveLength(2);
    expect(log[1].msg).toBe('second');
    expect(log[1].level).toBe('error');
    expect(log[1].data).toBe('boom');
  });

  it('clearNostrLog empties the buffer', () => {
    nostrLog('warn', 'something');
    expect(getNostrLog()).toHaveLength(1);
    clearNostrLog();
    expect(getNostrLog()).toHaveLength(0);
  });
});
