import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNostrLog, clearNostrLog } from '../log';
import { getPlanPull, resetPlanPull } from '../planLoad';
import { PLAIN_STEP_BYTES } from '../payloadSize';

// 5c (spec `pbloc-spec-plan-load-guard-v1`) — what a pull records about the relays' plan, and the trimmed republish of
// a plan past NIP-44's padding step. The store, the pool and the publish engine are mocked (the sync.test.ts pattern).

const { st, pool, publishPlan } = vi.hoisted(() => ({
  st: {} as Record<string, any>,
  pool: { querySync: vi.fn(), close: vi.fn(), listConnectionStatus: vi.fn() },
  publishPlan: vi.fn().mockResolvedValue(true),
}));
vi.mock('nostr-tools/pool', () => ({ SimplePool: vi.fn(function () { return pool; }) }));
vi.mock('../../../store/useStore', () => ({ useStore: { getState: () => st } }));
vi.mock('../syncEngine', () => ({ publishRecordsNowImmediate: vi.fn().mockResolvedValue(true), publishPlanEventsNow: publishPlan }));

import { applyRemoteEvent, fetchAndSync } from '../sync';

const PLAN = 'personal-bloc:plan-events:v1';
const PREFS = 'personal-bloc:prefs:v1';
const ev = (dTag: string, content: string, created_at = 100) => ({ kind: 30078, created_at, content, tags: [['d', dTag]], id: `id-${dTag}` });
const planEv = (id: string, value: unknown) => ({ id, ts: 1, device: 'd', kind: 'set', field: 'income', value });
/** A signer whose decrypt returns the content (or throws / returns garbage, per the test). */
const signer = (decrypt: (ct: string) => Promise<unknown> = async (ct) => ct) => ({ nip44: { encrypt: vi.fn(), decrypt: vi.fn((_pk: string, ct: string) => decrypt(ct)) } }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  clearNostrLog();
  resetPlanPull();
  for (const k of Object.keys(st)) delete st[k];
  Object.assign(st, {
    planEvents: [], lastPrefsSyncAt: null, nostrSigningMethod: 'local',
    setPlanEvents: vi.fn(), applyPlanFold: vi.fn(), setPlanDirty: vi.fn(), setLastPlanEventsSyncAt: vi.fn(),
    setPlanLoaded: vi.fn(), hydratePrefs: vi.fn(), setLastPrefsSyncAt: vi.fn(),
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {},
    setMonthlyLog: vi.fn(), setDeletedMonths: vi.fn(), setDayLog: vi.fn(), setDeletedDayEvents: vi.fn(),   // the journal pull's applies
    setRecordsDirty: vi.fn(), setLastRecordsSyncAt: vi.fn(), setNostrReconnectNeeded: vi.fn(),
  });
  pool.listConnectionStatus.mockReturnValue(new Map([['wss://a', true]]));
});

describe('⭐ STATUS — applyRemoteEvent records the plan\'s outcome', () => {
  it('applied: the log and fold land, planLoaded is set, the status carries the plain size', async () => {
    const content = JSON.stringify({ events: [planEv('a', 4000)] });
    expect(await applyRemoteEvent(signer(), 'pk', ev(PLAN, content), 1000)).toBe(true);
    expect(st.setPlanEvents).toHaveBeenCalledOnce();
    expect(st.setPlanLoaded).toHaveBeenCalledWith(true);
    expect(getPlanPull()).toMatchObject({ status: 'applied', plainBytes: content.length });
  });

  it('decrypt fails (Alby\'s "expected string result, got undefined"): unreadable · decrypt; false (a signer failure, as before)', async () => {
    const bad = signer(async () => { throw new Error('expected string result, got undefined'); });
    expect(await applyRemoteEvent(bad, 'pk', ev(PLAN, 'x'), 1000)).toBe(false);
    expect(getPlanPull()).toMatchObject({ status: 'unreadable', reason: 'decrypt' });
    expect(st.setPlanLoaded).not.toHaveBeenCalled();
  });

  it('decrypts to garbage: unreadable · parse — logged by error NAME and size, never the payload (privacy)', async () => {
    const secret = 'income 123456 not json';
    expect(await applyRemoteEvent(signer(async () => secret), 'pk', ev(PLAN, 'x'), 1000)).toBe(true);
    expect(getPlanPull()).toMatchObject({ status: 'unreadable', reason: 'parse', plainBytes: secret.length });
    const entry = getNostrLog().find((e) => e.msg.startsWith('plan unreadable'))!;
    expect(entry.data).toContain('SyntaxError');
    expect(entry.data).not.toContain('123456');
    expect(entry.data).not.toContain('income');
    expect(st.setPlanLoaded).not.toHaveBeenCalled();
  });

  it('JSON that is not a plan log: unreadable · shape (it used to change nothing, silently)', async () => {
    await applyRemoteEvent(signer(), 'pk', ev(PLAN, JSON.stringify({ income: 1 })), 1000);
    expect(getPlanPull()).toMatchObject({ status: 'unreadable', reason: 'shape' });
    expect(st.setPlanEvents).not.toHaveBeenCalled();
  });

  it('applying it throws: unreadable · apply, and planLoaded stays unset', async () => {
    st.applyPlanFold.mockImplementation(() => { throw new TypeError('boom'); });
    await applyRemoteEvent(signer(), 'pk', ev(PLAN, JSON.stringify({ events: [planEv('a', 1)] })), 1000);
    expect(getPlanPull()).toMatchObject({ status: 'unreadable', reason: 'apply' });
    expect(st.setPlanLoaded).not.toHaveBeenCalled();
  });

  it('prefs never touch the plan\'s status', async () => {
    await applyRemoteEvent(signer(), 'pk', ev(PREFS, JSON.stringify({ simpleMode: true })), 1000);
    expect(getPlanPull()).toEqual({ status: 'pending' });
    expect(st.hydratePrefs).toHaveBeenCalledOnce();
  });
});

describe('⭐ TRIM — a plan past the padding step is republished trimmed', () => {
  const big = (n: number) => JSON.stringify({ events: [planEv('a', 'x'.repeat(n))] });

  it('past 40,960 B plain: dirty + publish, even when this device already holds every event', async () => {
    const content = big(PLAIN_STEP_BYTES);
    expect(content.length).toBeGreaterThan(PLAIN_STEP_BYTES);
    st.planEvents = JSON.parse(content).events;                    // merged === remote: the old repair would not fire
    await applyRemoteEvent(signer(), 'pk', ev(PLAN, content), 1000);
    expect(st.setPlanDirty).toHaveBeenCalledWith(true);
    expect(publishPlan).toHaveBeenCalledOnce();
    expect(getNostrLog().some((e) => e.msg.includes('republishing it trimmed'))).toBe(true);
  });

  it('within the step and identical: no publish (non-vacuity)', async () => {
    const content = big(1000);
    st.planEvents = JSON.parse(content).events;
    await applyRemoteEvent(signer(), 'pk', ev(PLAN, content), 1000);
    expect(publishPlan).not.toHaveBeenCalled();
  });
});

describe('⭐ PULL — fetchAndSync settles the plan\'s status', () => {
  it('nothing of this key\'s on the relays, a relay answered: none — and the device still waits (its owner decides)', async () => {
    pool.querySync.mockResolvedValue([ev(PREFS, JSON.stringify({ simpleMode: true }))]);   // prefs alone don't count
    await fetchAndSync(signer(), 'pk', ['wss://a']);
    expect(getPlanPull()).toMatchObject({ status: 'none' });
    expect(st.setPlanLoaded).not.toHaveBeenCalled();   // slow, refusing or other relays look the same as a new key
  });

  it('a journal but no plan event: unreadable · absent — the journal is what a seed plan would damage, so it waits', async () => {
    pool.querySync.mockResolvedValue([ev('personal-bloc:records:v1', JSON.stringify({ entries: [], deletions: {} }))]);
    await fetchAndSync(signer(), 'pk', ['wss://a']);
    expect(getPlanPull()).toMatchObject({ status: 'unreadable', reason: 'absent' });
    expect(st.setPlanLoaded).not.toHaveBeenCalled();
    expect(st.setPlanDirty).not.toHaveBeenCalled();   // this device has no plan to put back
  });

  it('⭐ PUT BACK — the relays hold the journal but lost the plan: a device that holds the plan marks it to re-send', async () => {
    Object.assign(st, { planLoaded: true, planEvents: [planEv('a', 4000)] });
    pool.querySync.mockResolvedValue([ev('personal-bloc:records:v1', JSON.stringify({ entries: [], deletions: {} }))]);
    await fetchAndSync(signer(), 'pk', ['wss://a']);
    expect(st.setPlanDirty).toHaveBeenCalledWith(true);
  });

  it('PUT BACK empty — a plan nobody ever changed (an empty log) is put back too, or every other device waits forever', async () => {
    Object.assign(st, { planLoaded: true, planEvents: [] });
    pool.querySync.mockResolvedValue([ev('personal-bloc:records:v1', JSON.stringify({ entries: [], deletions: {} }))]);
    await fetchAndSync(signer(), 'pk', ['wss://a']);
    expect(st.setPlanDirty).toHaveBeenCalledWith(true);
  });

  it('no plan event, no relay answered: unreachable — planLoaded is NOT set (an offline fresh device keeps waiting)', async () => {
    pool.querySync.mockResolvedValue([]);
    pool.listConnectionStatus.mockReturnValue(new Map());
    await fetchAndSync(signer(), 'pk', ['wss://a']);
    expect(getPlanPull()).toMatchObject({ status: 'unreachable' });
    expect(st.setPlanLoaded).not.toHaveBeenCalled();
  });

  it('a decrypt failure on prefs stops the loop before the plan: unreadable · not-reached', async () => {
    pool.querySync.mockResolvedValue([ev(PREFS, 'p', 100), ev(PLAN, 'q', 90)]);   // prefs first in the map
    const bad = signer(async () => { throw new Error('locked'); });
    const r = await fetchAndSync(bad, 'pk', ['wss://a']);
    expect(r.ok).toBe(false);
    expect(getPlanPull()).toMatchObject({ status: 'unreadable', reason: 'not-reached' });
  });

  it('the plan applies in the pull: applied (the end-of-pull settle leaves it)', async () => {
    pool.querySync.mockResolvedValue([ev(PLAN, JSON.stringify({ events: [planEv('a', 4000)] }))]);
    await fetchAndSync(signer(), 'pk', ['wss://a']);
    expect(getPlanPull()).toMatchObject({ status: 'applied' });
    expect(st.setPlanLoaded).toHaveBeenCalledWith(true);
  });
});
