import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the pool so importing ../publish doesn't pull a live SimplePool. awaitAckQuorum itself takes plain
// promises (no pool), so these tests drive it directly with controllable deferreds.
vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return { publish: vi.fn(() => []), close: vi.fn() }; }),
}));

import { awaitAckQuorum } from '../publish';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('awaitAckQuorum', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('(1) 2 of 4 acks resolves', async () => {
    const d = [deferred(), deferred(), deferred(), deferred()];
    let resolved = false;
    const done = awaitAckQuorum(d.map((x) => x.promise), 2, 12000).then(() => { resolved = true; });
    d[0].resolve();
    d[1].resolve();
    await done;
    expect(resolved).toBe(true);
  });

  it('(2) 3 rejections of 4 with quorum 2 rejects early (unreachable) with an AggregateError', async () => {
    const d = [deferred(), deferred(), deferred(), deferred()];
    let err: unknown;
    const done = awaitAckQuorum(d.map((x) => x.promise), 2, 12000).catch((e) => { err = e; });
    d[0].reject(new Error('r0'));
    d[1].reject(new Error('r1'));
    d[2].reject(new Error('r2'));   // 4 - 3 = 1 < 2 → unreachable; the 4th never settles
    await done;
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).errors).toHaveLength(3);
    expect((err as AggregateError).message).toMatch(/quorum unreachable/);
  });

  it('(3) single-relay set: quorum 1, one ack resolves', async () => {
    const d = deferred();
    let resolved = false;
    const done = awaitAckQuorum([d.promise], 1, 12000).then(() => { resolved = true; });
    d.resolve();
    await done;
    expect(resolved).toBe(true);
  });

  it('(4) timeout rejects when quorum is never reached', async () => {
    const d = [deferred(), deferred()];
    const assertion = expect(awaitAckQuorum(d.map((x) => x.promise), 2, 1000))
      .rejects.toThrow('publish timeout — quorum not reached');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('(5) onOutcome fires per settle with the correct ok flag', async () => {
    const d = [deferred(), deferred(), deferred()];
    const outcomes: { i: number; ok: boolean }[] = [];
    const done = awaitAckQuorum(d.map((x) => x.promise), 2, 12000, (i, ok) => outcomes.push({ i, ok }));
    d[0].resolve();
    d[1].reject(new Error('x'));
    d[2].resolve();   // acks reach 2 → resolves; all three onOutcome fire
    await done;
    expect(outcomes).toContainEqual({ i: 0, ok: true });
    expect(outcomes).toContainEqual({ i: 1, ok: false });
    expect(outcomes).toContainEqual({ i: 2, ok: true });
    expect(outcomes).toHaveLength(3);
  });

  it('rejects immediately on an empty relay set', async () => {
    await expect(awaitAckQuorum([], 2, 12000)).rejects.toThrow('no relays');
  });
});
