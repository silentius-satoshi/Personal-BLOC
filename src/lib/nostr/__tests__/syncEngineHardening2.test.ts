import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Hardening 2 — syncEngine.ts's GAPs from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 * The real store, signed in with a stub signer; `publishEncrypted` mocked, so nothing reaches a relay. A memory
 * localStorage as planLogEmit.test.ts sets one. Round synthetic figures.
 */
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
});
vi.mock('../publish', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../publish')>();
  return { ...actual, publishEncrypted: vi.fn() };
});

import { useStore } from '../../../store/useStore';
import { publishPlanEventsNow, publishRecordsNowImmediate } from '../syncEngine';
import { publishEncrypted, PLAN_EVENTS_DTAG, RECORDS_DTAG } from '../publish';
import { journalKnown } from '../journalState';
import { PayloadTooLargeError } from '../syncGuard';
import type { PlanEvent } from '../../planEvents/types';

const T0 = 1_800_000_000_000;
const publish = vi.mocked(publishEncrypted);
const ev = (i: number, ts: number): PlanEvent =>
  ({ id: `income-${i}`, ts, device: 'd', kind: 'set', field: 'income' as PlanEvent['field'], value: 1_000 + i });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  publish.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useStore.setState({
    isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', keyProvenance: 'imported',
    initialSettingsPullDone: true, viewerMode: false, nostrRelays: [], planEvents: [], planDirty: true,
    nostrReconnectNeeded: false,
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Hardening 2 — syncEngine', () => {
  it('HY-03 · sync.md "The plan log stays inside one publishable event" — the publish sends the compacted log it persists', async () => {
    publish.mockResolvedValue(1_800_000_000 as never);
    // One burst on one field (2 s apart, inside BURST_WINDOW_MS): compaction keeps its last event only.
    useStore.setState({ planEvents: [ev(0, T0 - 2_000), ev(1, T0 - 1_000), ev(2, T0)] } as never);
    expect(await publishPlanEventsNow(), 'HY-03 premise: the publish goes out').toBe(true);
    const call = publish.mock.calls.find((c) => c[2] === PLAN_EVENTS_DTAG);
    expect(call, 'HY-03 premise: the plan channel published').toBeDefined();
    const sent = (call![3] as { events: PlanEvent[] }).events.map((e) => e.id);
    expect(sent, 'HY-03 the compacted log goes out').toEqual(['income-2']);
    expect(sent, 'HY-03 the same log it keeps').toEqual(useStore.getState().planEvents.map((e) => e.id));
  });

  it('HY-05 · sync.md "nothing is published past NIP-44\'s step" (the minCreatedAt floor) — past the step, the records:v1 stub goes out newer than every journal event seen', async () => {
    publish.mockResolvedValue(1 as never);   // each publish "lands" at created_at 1: seenAt stays the relays' copy
    // A journal past the step: 600 Strike draws in one month (~45 KB as records:v1), so the bridge is the stub.
    const dayLog = Array.from({ length: 600 }, (_, i) =>
      ({ id: `d${String(i).padStart(3, '0')}`, ts: i + 1, date: '2026-06-10', kind: 'draw', amount: 1_000 }));
    useStore.setState({ monthlyLog: [], deletedMonths: {}, dayLog, deletedDayEvents: {} } as never);
    // This session pulled the journal, and the relays' newest copy is dated ahead of this device's clock.
    const known = journalKnown('pk');
    known.pulled = true;
    known.seenAt = 2_000_000_000;
    known.v1 = null;
    await publishRecordsNowImmediate();
    const stub = publish.mock.calls.find((c) => c[2] === RECORDS_DTAG);
    expect(stub, 'HY-05 premise: the stub went out').toBeDefined();
    expect(stub![6], 'HY-05 the stub carries the floor').toBe(2_000_000_001);
  });

  it('HY-07 · sync.md "nothing is published past NIP-44\'s step" (never raise Reconnect for it) — a plan size refusal clears planDirty and raises no Reconnect', async () => {
    publish.mockRejectedValue(new PayloadTooLargeError(PLAN_EVENTS_DTAG, 50_000));
    useStore.setState({ planEvents: [ev(0, T0)] } as never);
    expect(await publishPlanEventsNow(), 'HY-07 premise: refused').toBe(false);
    const s = useStore.getState();
    expect([s.planDirty, s.nostrReconnectNeeded], 'HY-07 no retry of the same payload, and no blame on the signer').toEqual([false, false]);
  });
});
