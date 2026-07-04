import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the pool so importing ../publish doesn't pull a live SimplePool. awaitAckQuorum itself takes plain
// promises (no pool), so these tests drive it directly with controllable deferreds.
vi.mock('nostr-tools/pool', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  SimplePool: vi.fn(function() { return { publish: vi.fn(() => []), close: vi.fn() }; }),
}));

import { awaitAckQuorum, isConnectionFailure } from '../publish';

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

describe('isConnectionFailure', () => {
  it('true only for the "connection failure:" string prefix', () => {
    expect(isConnectionFailure('connection failure: timeout')).toBe(true);
    expect(isConnectionFailure('connection failure: x')).toBe(true);
  });
  it('false for genuine resolutions and non-strings', () => {
    expect(isConnectionFailure('')).toBe(false);
    expect(isConnectionFailure('ok')).toBe(false);
    expect(isConnectionFailure('connectionfailure')).toBe(false);
    expect(isConnectionFailure(undefined)).toBe(false);
    expect(isConnectionFailure(null)).toBe(false);
    expect(isConnectionFailure(42)).toBe(false);
  });
});

// The exact map publishSignedToRelays applies to pool.publish's promises before the quorum: a nostr-tools
// "connection failure: …" string RESOLUTION becomes a rejection so it can't count as a fake ack.
const normalize = (p: Promise<unknown>) =>
  p.then((r) => { if (isConnectionFailure(r)) throw new Error(String(r)); return r; });

describe('connection-failure normalization → quorum', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('all four resolving with "connection failure: …" → unreachable reject, onOutcome ok=false each', async () => {
    const pubs = [0, 1, 2, 3].map(() => normalize(Promise.resolve('connection failure: dial timeout')));
    const outcomes: { i: number; ok: boolean; err?: unknown }[] = [];
    let err: unknown;
    await awaitAckQuorum(pubs, 2, 12000, (i, ok, e) => outcomes.push({ i, ok, err: e })).catch((e) => { err = e; });
    await Promise.allSettled(pubs);
    await Promise.resolve();

    expect(err).toBeInstanceOf(AggregateError);
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
    expect(outcomes.every((o) => o.ok === false)).toBe(true);
    expect(String((outcomes[0].err as Error).message)).toMatch(/connection failure/);
  });

  it('2 genuine resolutions ("" / undefined) + 2 connection-failures → resolves on the 2 real acks', async () => {
    const pubs = ['', undefined, 'connection failure: a', 'connection failure: b']
      .map((r) => normalize(Promise.resolve(r)));
    const outcomes: { i: number; ok: boolean }[] = [];
    let resolved = false;
    await awaitAckQuorum(pubs, 2, 12000, (i, ok) => outcomes.push({ i, ok })).then(() => { resolved = true; });
    await Promise.allSettled(pubs);
    await Promise.resolve();

    expect(resolved).toBe(true);
    expect(outcomes.filter((o) => o.ok === true)).toHaveLength(2);   // '' and undefined are real acks
    expect(outcomes.filter((o) => o.ok === false)).toHaveLength(2);  // both connection-failures rejected
  });
});
