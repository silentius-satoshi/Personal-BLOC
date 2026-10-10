// 5b (spec `pbloc-spec-journal-pages-v1`) — the journal's v2 sync, one device, the real modules (syncNow, fetchAndSync,
// pullJournal, publishRecordsNowImmediate, publishEncrypted and its guard, liveSync) over mocked relays and store.
// Each case names the mechanism it pins; the spec's Appendix P lists the mutation that turns each one red.
// ⚠ SYNTHETIC figures throughout.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ctx = vi.hoisted(() => ({ state: null as any, pool: null as any }));
vi.mock('nostr-tools/pool', () => ({ SimplePool: vi.fn(function () { return ctx.pool; }) }));
vi.mock('../../../store/useStore', () => ({ useStore: { getState: () => ctx.state } }));

const RECORDS = 'personal-bloc:records:v1';
const MANIFEST = 'personal-bloc:records:v2:manifest';
const page = (key: string) => `personal-bloc:records:v2:${key}`;
const URLS = ['wss://a.example', 'wss://b.example'];
const STEP = 40_960;

interface Ev { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }
interface World {
  relays: Map<string, Map<string, Ev>>;
  attempts: string[];                       // d-tags in publish order (one per event, whatever the relays said)
  queries: string[][];                      // each querySync's #d list
  reject: (url: string, ev: Ev) => string | null;
  onPageFetch: null | (() => void);
  onPublish: null | ((dTag: string) => void);
  seq: number;
  live: null | ((ev: Ev) => void);
}
const dTagOf = (ev: { tags: string[][] }): string => ev.tags.find(([t]) => t === 'd')![1];
let w: World;
let m: any;

function makePool() {
  return {
    querySync: async (urls: string[], filter: { '#d': string[] }) => {
      w.queries.push([...filter['#d']]);
      if (w.onPageFetch && filter['#d'].some((d) => d.startsWith('personal-bloc:records:v2:') && d !== MANIFEST)) {
        const f = w.onPageFetch; w.onPageFetch = null; f();
      }
      const byId = new Map<string, Ev>();
      for (const url of urls) for (const d of filter['#d']) { const e = w.relays.get(url)?.get(d); if (e) byId.set(e.id, e); }
      return [...byId.values()];
    },
    publish: (urls: string[], ev: Ev) => {
      const d = dTagOf(ev);
      w.attempts.push(d);
      if (w.onPublish) { const f = w.onPublish; w.onPublish = null; f(d); }
      return urls.map((url) => {
        const why = w.reject(url, ev);
        if (why) return Promise.reject(new Error(why));
        const relay = w.relays.get(url)!;
        const cur = relay.get(d);
        if (!cur || ev.created_at > cur.created_at || (ev.created_at === cur.created_at && ev.id < cur.id)) relay.set(d, ev);
        return Promise.resolve('');
      });
    },
    subscribeMany: (_urls: string[], _filter: unknown, h: { onevent: (ev: Ev) => void }) => { w.live = h.onevent; return { close: () => {} }; },
    close: () => {},
  };
}

function makeState(): any {
  const signer = {
    nip44: { encrypt: vi.fn(async (_pk: string, pt: string) => pt), decrypt: vi.fn(async (_pk: string, ct: string) => ct) },
    signEvent: vi.fn(async (e: any) => ({ ...e, pubkey: 'pk', id: `id${String(++w.seq).padStart(6, '0')}`, sig: 'sig' })),
  };
  const st: any = {
    isAuthenticated: true, nostrSigner: signer, nostrPubkey: 'pk', viewerMode: false, keyProvenance: 'imported', backupVerifiedAt: null,
    nostrRelays: [...URLS], nostrSigningMethod: 'local', initialSettingsPullDone: false, nostrReconnectNeeded: false, nostrSyncing: false,
    recordsDirty: false, planDirty: false, prefsDirty: false, planEvents: [], viewers: [], pendingViewerRevocations: [],
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, lastRecordsSyncAt: null, lastPrefsSyncAt: null,
    recordRemotePlanFound: () => {}, queueViewerRevocation: () => {}, clearViewerRevocation: () => {},
  };
  for (const [setter, field] of [
    ['setMonthlyLog', 'monthlyLog'], ['setDeletedMonths', 'deletedMonths'], ['setDayLog', 'dayLog'], ['setDeletedDayEvents', 'deletedDayEvents'],
    ['setRecordsDirty', 'recordsDirty'], ['setLastRecordsSyncAt', 'lastRecordsSyncAt'], ['setNostrReconnectNeeded', 'nostrReconnectNeeded'],
    ['setNostrSyncing', 'nostrSyncing'], ['setInitialSettingsPullDone', 'initialSettingsPullDone'], ['setPlanDirty', 'planDirty'], ['setPrefsDirty', 'prefsDirty'],
  ]) st[setter] = (v: unknown) => { st[field] = v; };
  return st;
}

/** A fresh app session: new module instances (session state, journal lane, publish clocks), the same store and relays. */
async function boot(): Promise<void> {
  vi.resetModules();
  m = {
    sync: await import('../sync'), engine: await import('../syncEngine'), syncNow: await import('../syncNow'),
    live: await import('../liveSync'), publish: await import('../publish'), journalState: await import('../journalState'),
    guard: await import('../syncGuard'), pages: await import('../journalPages'),
  };
  ctx.state.initialSettingsPullDone = false;
  ctx.state.nostrReconnectNeeded = false;
}
const idle = () => m.journalState.journalIdle();
const sync = async () => { const ok = await m.syncNow.syncNow({} as never); await idle(); return ok; };
const publishNow = async () => { const ok = await m.engine.publishRecordsNowImmediate(); await idle(); return ok; };

const ev = (id: string, date: string, ts: number, extra: Record<string, unknown> = {}) => ({ id, date, ts, kind: 'draw', amount: 100, ...extra });
const NOW = Date.now();
const write = (dayLog: any[], extra: Partial<Record<string, unknown>> = {}) => Object.assign(ctx.state, { dayLog, recordsDirty: true, ...extra });
/** Put an event straight on both relays, as another device would. */
function seed(dTag: string, payload: unknown, created_at: number, id = `x${++w.seq}`): void {
  for (const relay of w.relays.values()) relay.set(dTag, { id, pubkey: 'pk', kind: 30078, created_at, tags: [['d', dTag]], content: JSON.stringify(payload), sig: 's' });
}
const onRelay = (dTag: string) => { const e = w.relays.get(URLS[0])!.get(dTag); return e ? JSON.parse(e.content) : undefined; };
const pageAttempts = () => w.attempts.filter((d) => d.startsWith('personal-bloc:records:v2:') && d !== MANIFEST);

beforeEach(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  w = { relays: new Map(URLS.map((u) => [u, new Map()])), attempts: [], queries: [], reject: () => null, onPageFetch: null, onPublish: null, seq: 0, live: null };
  ctx.pool = makePool();
  ctx.state = makeState();
  await boot();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('5b — migrating a records:v1 journal', () => {
  it('LAZY — relays holding records:v1 that carries the whole journal: the pull merges and publishes nothing', async () => {
    const dayLog = [ev('a', '2026-01-02', NOW)];
    seed(RECORDS, { entries: [], deletions: {}, dayLog, dayLogDeletions: {} }, 100);
    ctx.state.dayLog = dayLog;
    expect(await sync()).toBe(true);
    expect(w.attempts, 'LAZY').toEqual([]);
    expect(ctx.state.recordsDirty).toBe(false);
    expect(m.journalState.peekJournalKnown().check).toMatchObject({ manifest: false, v1: 'full' });
  });

  it('MIGRATE — the first write after the update publishes every page, THEN the manifest, THEN records:v1', async () => {
    seed(RECORDS, { entries: [], deletions: {}, dayLog: [ev('a', '2026-01-02', NOW)], dayLogDeletions: {} }, 100);
    expect(await sync()).toBe(true);
    write([...ctx.state.dayLog, ev('b', '2026-02-03', NOW + 1), ev('c', '2026-03-04', NOW + 2)]);
    expect(await publishNow()).toBe(true);
    expect(w.attempts, 'ORDER').toEqual([page('2026-01'), page('2026-02'), page('2026-03'), MANIFEST, RECORDS]);
    const manifest = onRelay(MANIFEST);
    for (const key of ['2026-01', '2026-02', '2026-03']) {
      expect(manifest.pages[key], `${key} listed at the copy on the relays`).toEqual({ n: 1, h: await m.pages.fingerprint(onRelay(page(key))) });
    }
    expect(onRelay(RECORDS).dayLog.map((e: any) => e.id)).toEqual(['a', 'b', 'c']);
    expect(ctx.state.recordsDirty).toBe(false);
  });
});

describe('5b — what a pull fetches', () => {
  async function twoMonths(): Promise<void> {
    write([ev('a', '2026-01-02', NOW), ev('b', '2026-02-03', NOW + 1)]);
    await sync();   // no journal on the relays → nothing to merge; then the dirty journal publishes as v2
    expect(onRelay(MANIFEST), 'set-up: v2 on the relays').toBeDefined();
  }

  it('FULL — the session\'s first pull fetches every listed page; a later pull, only the page that changed', async () => {
    await twoMonths();
    await boot();   // a new session
    w.queries = [];
    await sync();
    expect(w.queries[1], 'FULL').toEqual([page('2026-01'), page('2026-02')]);
    // another device changes February
    const feb = { v: 2, key: '2026-02', entries: [], dayLog: [ev('b', '2026-02-03', NOW + 1), ev('z', '2026-02-09', NOW + 5)] };
    const manifest = onRelay(MANIFEST);
    seed(page('2026-02'), feb, 9_000_000_000);
    seed(MANIFEST, { ...manifest, pages: { ...manifest.pages, '2026-02': { n: 2, h: await m.pages.fingerprint(feb) } } }, 9_000_000_000);
    w.queries = [];
    await m.sync.pullJournalNow();
    await idle();
    expect(w.queries[1], 'PARTIAL').toEqual([page('2026-02')]);
    expect(ctx.state.dayLog.map((e: any) => e.id).sort()).toEqual(['a', 'b', 'z']);
  });

  it('MISSING-HELD — a listed page every relay dropped is retried once, then republished from this device\'s copy', async () => {
    await twoMonths();
    for (const relay of w.relays.values()) relay.delete(page('2026-01'));
    await boot();
    w.queries = []; w.attempts = [];
    await sync();
    expect(w.queries.filter((q) => q.includes(page('2026-01'))), 'RETRY').toHaveLength(2);
    expect(m.journalState.peekJournalKnown().check.missing).toEqual(['2026-01']);
    expect(pageAttempts(), 'REPUBLISH').toEqual([page('2026-01')]);
    expect(onRelay(page('2026-01')).dayLog.map((e: any) => e.id)).toEqual(['a']);
  });

  it('CARRY — a listed page this device cannot read and does not hold stays listed in every manifest it publishes', async () => {
    const dec = { v: 2, key: '2025-12', entries: [], dayLog: [ev('d', '2025-12-24', NOW - 5)] };
    const h = await m.pages.fingerprint(dec);
    seed(MANIFEST, { v: 2, pages: { '2025-12': { n: 1, h } }, deletions: {}, dayLogDeletions: {} }, 100);   // the page itself never arrives
    await sync();
    expect([...m.journalState.peekJournalKnown().unreadable.keys()]).toEqual(['2025-12']);
    write([ev('a', '2026-01-02', NOW)]);
    await publishNow();
    expect(onRelay(MANIFEST).pages['2025-12'], 'CARRY').toEqual({ n: 1, h });
    expect(Object.keys(onRelay(MANIFEST).pages)).toEqual(['2025-12', '2026-01']);
  });
});

describe('5b — publishing', () => {
  it('TORN — a page that fails stops the run before the manifest; the next publish resumes at that page', async () => {
    await sync();
    write([ev('a', '2026-01-02', NOW), ev('b', '2026-02-03', NOW + 1), ev('c', '2026-03-04', NOW + 2)]);
    w.reject = (url, e) => (url === URLS[1] && dTagOf(e) === page('2026-02') ? 'relay timeout' : null);
    expect(await publishNow()).toBe(false);
    expect(w.attempts, 'TORN').toEqual([page('2026-01'), page('2026-02')]);
    expect(ctx.state.nostrReconnectNeeded).toBe(true);
    expect(ctx.state.recordsDirty).toBe(true);
    w.reject = () => null; w.attempts = [];
    expect(await publishNow()).toBe(true);
    expect(w.attempts, 'RESUME').toEqual([page('2026-02'), page('2026-03'), MANIFEST, RECORDS]);
  });

  it('GUARD — a page past the step is refused before it is encrypted; the rest publishes; no Reconnect; the app is told', async () => {
    await sync();
    const giant = ev('giant', '2026-03-05', NOW + 2, { memo: 'g'.repeat(STEP) });
    write([ev('a', '2026-01-02', NOW), giant]);
    w.reject = (_url, e) => (e.content.length > STEP ? 'invalid: event too large' : null);   // a stock relay
    expect(await publishNow()).toBe(false);
    const encrypted = ctx.state.nostrSigner.nip44.encrypt.mock.calls.map((c: any[]) => c[1].length);
    expect(Math.max(...encrypted), 'GUARD — nothing past the step reaches the signer').toBeLessThanOrEqual(STEP);
    expect(pageAttempts()).toEqual([page('2026-01')]);
    expect(onRelay(MANIFEST).pages, 'the refused page is not listed — the relays hold no copy').toEqual({ '2026-01': expect.any(Object) });
    expect(m.engine.refusedForSize('records')).toBe(true);
    expect(ctx.state.nostrReconnectNeeded, 'NO-RECONNECT').toBe(false);
    expect(ctx.state.recordsDirty, 'no retry loop for the same payload').toBe(false);
    expect(m.guard.getBlockedChannels(), 'WARN').toEqual(['journal']);
    // the giant entry deleted: its month empties, and the warning goes with it
    write([ev('a', '2026-01-02', NOW)], { deletedDayEvents: { giant: NOW + 3 } });
    expect(await publishNow()).toBe(true);
    expect(m.guard.getBlockedChannels(), 'PRUNE').toEqual([]);
  });

  it('STUB — past the step, records:v1 carries the stub, once; back under it, the whole journal again', async () => {
    await sync();
    const big = Array.from({ length: 6 }, (_, i) => ev(`b${i}`, `2026-0${1 + i}-05`, NOW + i, { memo: 'm'.repeat(8_000) }));
    write(big);
    expect(await publishNow()).toBe(true);
    expect(onRelay(RECORDS), 'STUB').toMatchObject({ movedTo: MANIFEST, dayLog: [] });
    write([...big, ev('s', '2026-01-09', NOW + 9)]);
    w.attempts = [];
    expect(await publishNow()).toBe(true);
    expect(w.attempts, 'the stub is not republished').toEqual([page('2026-01'), MANIFEST]);
    write([ev('s', '2026-01-09', NOW + 9)], { deletedDayEvents: Object.fromEntries(big.map((e) => [e.id, NOW + 20])) });
    expect(await publishNow()).toBe(true);
    expect(onRelay(RECORDS).dayLog.map((e: any) => e.id), 'FULL AGAIN').toEqual(['s']);
  });

  it('PRE-PULL — before the session\'s pull: records:v1 only, and recordsDirty stays set so the pull\'s publish writes v2', async () => {
    write([ev('a', '2026-01-02', NOW)]);
    expect(await publishNow()).toBe(true);
    expect(w.attempts).toEqual([RECORDS]);
    expect(ctx.state.recordsDirty, 'PRE-PULL-DIRTY').toBe(true);
    await sync();
    expect(w.attempts).toEqual([RECORDS, page('2026-01'), MANIFEST]);   // the bridge already matches: not sent twice
    expect(ctx.state.recordsDirty).toBe(false);
  });

  it('PRE-PULL-TOO-LARGE — a journal past the step waits for the pull: nothing sent, no Reconnect', async () => {
    write(Array.from({ length: 6 }, (_, i) => ev(`b${i}`, `2026-0${1 + i}-05`, NOW + i, { memo: 'm'.repeat(8_000) })));
    expect(await publishNow()).toBe(false);
    expect(w.attempts).toEqual([]);
    expect(ctx.state.nostrReconnectNeeded).toBe(false);
    expect(ctx.state.recordsDirty).toBe(true);
  });

  it('WRITE-DURING-PUBLISH — a write made while the pages go out keeps recordsDirty set', async () => {
    await sync();
    write([ev('a', '2026-01-02', NOW)]);
    w.onPublish = () => { write([...ctx.state.dayLog, ev('late', '2026-01-03', NOW + 1)]); };
    expect(await publishNow()).toBe(true);
    expect(ctx.state.recordsDirty, 'DIRTY-KEPT').toBe(true);
  });
});

describe('5b — clocks', () => {
  it('SKEW — a device whose clock is behind still replaces what it read: every journal publish goes out newer than it', async () => {
    // Another device, its clock 10 minutes ahead, wrote the manifest; this device's own clock would date its manifest
    // earlier, and a relay keeps the newer of two copies.
    const ahead = Math.floor(Date.now() / 1000) + 600;
    seed(MANIFEST, { v: 2, pages: {}, deletions: {}, dayLogDeletions: {} }, ahead);
    seed(RECORDS, { entries: [], deletions: {}, dayLog: [], dayLogDeletions: {} }, ahead - 5);
    await sync();
    write([ev('a', '2026-01-02', NOW)]);
    expect(await publishNow()).toBe(true);
    const relayManifest = w.relays.get(URLS[0])!.get(MANIFEST)!;
    expect(relayManifest.created_at, 'FLOOR — newer than the manifest it read').toBeGreaterThan(ahead);
    expect(Object.keys(JSON.parse(relayManifest.content).pages), 'the relays keep this device\'s manifest').toEqual(['2026-01']);
    expect(w.relays.get(URLS[0])!.get(page('2026-01'))!.created_at, 'its pages too').toBeGreaterThan(ahead);
    expect(w.relays.get(URLS[0])!.get(RECORDS)!.created_at, 'and the bridge').toBeGreaterThan(ahead);
    expect(relayManifest.created_at, 'the manifest newer than its page').toBeGreaterThan(w.relays.get(URLS[0])!.get(page('2026-01'))!.created_at);
  });
});

describe('5b — pulling', () => {
  it('WRITE-DURING-PULL — a write made while the pull waits on the relays for pages survives the pull\'s merge', async () => {
    const feb = { v: 2, key: '2026-02', entries: [], dayLog: [ev('r', '2026-02-02', NOW)] };
    seed(page('2026-02'), feb, 100);
    seed(MANIFEST, { v: 2, pages: { '2026-02': { n: 1, h: await m.pages.fingerprint(feb) } }, deletions: {}, dayLogDeletions: {} }, 100);
    w.onPageFetch = () => write([ev('mine', '2026-01-05', NOW + 1)]);
    await sync();
    expect(ctx.state.dayLog.map((e: any) => e.id).sort(), 'MID-PULL').toEqual(['mine', 'r']);
  });

  it('DECRYPT — a page that won\'t decrypt fails the pull (Reconnect), applies nothing, and keeps the v2 publish off', async () => {
    const feb = { v: 2, key: '2026-02', entries: [], dayLog: [ev('r', '2026-02-02', NOW)] };
    seed(page('2026-02'), feb, 100, 'badpage');
    seed(MANIFEST, { v: 2, pages: { '2026-02': { n: 1, h: await m.pages.fingerprint(feb) } }, deletions: {}, dayLogDeletions: {} }, 100);
    ctx.state.nostrSigner.nip44.decrypt.mockImplementation(async (_pk: string, ct: string) => {
      if (ct.includes('"key":"2026-02"')) throw new Error('signer offline');
      return ct;
    });
    expect(await sync()).toBe(false);
    expect(ctx.state.nostrReconnectNeeded).toBe(true);
    expect(ctx.state.dayLog).toEqual([]);
    expect(m.journalState.peekJournalKnown().pulled).toBe(false);
    write([ev('a', '2026-01-02', NOW)]);
    w.attempts = [];
    await publishNow();
    expect(w.attempts, 'v1 only until a pull reads the relays').toEqual([RECORDS]);
  });

  it('TOMBSTONES — a deletion rides the manifest to a device that still holds the entry', async () => {
    write([ev('a', '2026-01-02', NOW), ev('b', '2026-01-03', NOW + 1)]);
    await sync();
    const jan = { v: 2, key: '2026-01', entries: [], dayLog: [ev('a', '2026-01-02', NOW)] };
    const manifest = onRelay(MANIFEST);
    seed(page('2026-01'), jan, 9_000_000_000);
    seed(MANIFEST, { ...manifest, pages: { '2026-01': { n: 1, h: await m.pages.fingerprint(jan) } }, dayLogDeletions: { b: NOW + 5 } }, 9_000_000_000);
    await m.sync.pullJournalNow();
    await idle();
    expect(ctx.state.dayLog.map((e: any) => e.id)).toEqual(['a']);
    expect(ctx.state.deletedDayEvents).toEqual({ b: NOW + 5 });
  });
});

describe('5b — live and Reconnect', () => {
  it('LIVE — a manifest from another device schedules one debounced journal pull; this device\'s own echo does not', async () => {
    await sync();
    write([ev('a', '2026-01-02', NOW)]);
    await publishNow();
    vi.useFakeTimers();
    m.live.openLiveSync();
    expect(w.live).toBeTypeOf('function');
    const own = w.relays.get(URLS[0])!.get(MANIFEST)!;
    expect(own.id).toBe(m.publish.ownLatestEventId(MANIFEST));
    w.queries = [];
    w.live!(own);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.queries, 'ECHO-SKIP').toEqual([]);
    w.live!({ ...own, id: 'another-device' });
    w.live!({ ...own, id: 'another-device-2' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.queries[0], 'LIVE-PULL').toEqual([RECORDS, MANIFEST]);
    expect(w.queries.filter((q) => q.includes(MANIFEST)), 'debounced: one pull for the burst').toHaveLength(1);
    m.live.closeLiveSync();
  });

  it('RECONNECT — a size refusal leaves Reconnect down; a relay failure raises it', async () => {
    await sync();
    write([ev('giant', '2026-03-05', NOW, { memo: 'g'.repeat(STEP) })]);
    expect(await sync()).toBe(false);
    expect(ctx.state.nostrReconnectNeeded, 'SIZE-NOT-SIGNER').toBe(false);
    write([ev('a', '2026-01-02', NOW + 1)]);
    w.reject = () => 'relay timeout';
    expect(await sync()).toBe(false);
    expect(ctx.state.nostrReconnectNeeded).toBe(true);
  });
});
