// 5b (spec `pbloc-spec-journal-pages-v1`) — THE KILL-CRITERION SWEEP (BL11: "the prototype loses or duplicates an entry
// or a deletion in any seeded mixed-version history → stop and re-decide"). Seeded histories of 2–4 devices sharing
// one key — some still on the pre-5b app (records:v1 only) — adding, editing (across months too), deleting, re-logging,
// publishing, syncing and pulling live, with clocks that disagree by seconds, over two relays that tear publishes,
// drop pages, and (one always, one sometimes) refuse an event past 64 KiB as a stock strfry does. The new devices run
// the REAL modules (syncNow → fetchAndSync → pullJournal; publishRecordsNowImmediate → publishJournal; publishEncrypted
// and its guard), one module instance per device, so each has its own session state. Checked after EVERY step, on
// every device: nothing held is lost without a newer tombstone, nothing deleted comes back, no id or month twice. At the
// end every device updates, relaunches and syncs until quiet, and must hold exactly the oracle's journal — the join of
// every version and tombstone ever written.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mergeRecords, type RecordsState } from '../../../simulation/mergeRecords';
import { normRecords, v1Payload, JOURNAL_V2_PREFIX, JOURNAL_MANIFEST_DTAG } from '../journalPages';

// onPageFetch: a write the user makes while a journal pull is waiting on the relays for pages (fires once).
const ctx = vi.hoisted(() => ({ state: null as any, pool: null as any, now: 0, skew: 0, onPageFetch: null as null | (() => void) }));
vi.mock('nostr-tools/pool', () => ({ SimplePool: vi.fn(function () { return ctx.pool; }) }));
vi.mock('../../../store/useStore', () => ({ useStore: { getState: () => ctx.state } }));

const RECORDS = 'personal-bloc:records:v1';
const URLS = ['wss://stock.example', 'wss://second.example'];
const EMPTY: RecordsState = { entries: [], deletions: {}, dayLog: [], dayLogDeletions: {} };
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// NIP-44 v2's padded payload length, base64 (version + nonce + length prefix + padded plaintext + MAC). This harness's
// signer doesn't encrypt; a relay measures the event as if it did.
const padded = (L: number): number => {
  if (L <= 32) return 32;
  const np = 2 ** (Math.floor(Math.log2(L - 1)) + 1);
  const chunk = np <= 256 ? 32 : np / 8;
  return chunk * (Math.floor((L - 1) / chunk) + 1);
};
const nip44Len = (plain: number): number => 4 * Math.ceil((padded(plain) + 67) / 3);
const utf8 = (s: string): number => new TextEncoder().encode(s).length;

interface Ev { id: string; pubkey: string; kind: number; created_at: number; tags: string[][]; content: string; sig: string }
interface Relay { events: Map<string, Ev>; failNext: number; stock: boolean }
interface Stats { [k: string]: number }
interface World {
  rng: () => number;
  relays: Map<string, Relay>;
  oracle: RecordsState;
  base: number;
  clock: number;
  seq: number;
  bloat: number;
  hot: number;
  stats: Stats;
  op: { pageWrites: number; manifestWrites: number; writes: number };
}
interface Device { name: string; old: boolean; skew: number; st: any; m: any; lastV1At: number }

const dTagOf = (ev: { tags: string[][] }): string => ev.tags.find(([t]) => t === 'd')![1];
const wireBytes = (ev: Ev): number => utf8(JSON.stringify({ ...ev, content: '' })) + nip44Len(utf8(ev.content));
const bump = (w: World, k: string, by = 1): void => { w.stats[k] = (w.stats[k] ?? 0) + by; };
const tick = (w: World): number => w.base + ++w.clock;   // the journal's version clock: strictly increasing, recent
const pick = <T,>(w: World, xs: T[]): T => xs[Math.floor(w.rng() * xs.length)];
const hexId = (w: World): string =>
  `${Math.floor(w.rng() * 2 ** 32).toString(16).padStart(8, '0')}${(++w.seq).toString(16).padStart(8, '0')}`;

function makePool(w: World) {
  return {
    querySync: async (urls: string[], filter: { '#d': string[] }) => {
      if (ctx.onPageFetch && filter['#d'].some((d) => d.startsWith(JOURNAL_V2_PREFIX) && d !== JOURNAL_MANIFEST_DTAG)) {
        const write = ctx.onPageFetch;
        ctx.onPageFetch = null;
        write();
      }
      const byId = new Map<string, Ev>();
      for (const url of urls) {
        const r = w.relays.get(url);
        if (!r) continue;
        for (const d of filter['#d']) { const e = r.events.get(d); if (e) byId.set(e.id, e); }
      }
      return [...byId.values()];
    },
    publish: (urls: string[], ev: Ev) => urls.map((url) => {
      const r = w.relays.get(url)!;
      if (r.failNext > 0) { r.failNext--; bump(w, 'injectedFailures'); return Promise.reject(new Error('relay timeout')); }
      if (r.stock && wireBytes(ev) > 65_536) { bump(w, dTagOf(ev) === RECORDS ? 'v1Refused' : 'otherRefused'); return Promise.reject(new Error('invalid: event too large')); }
      const d = dTagOf(ev);
      const cur = r.events.get(d);
      if (!cur || ev.created_at > cur.created_at || (ev.created_at === cur.created_at && ev.id < cur.id)) r.events.set(d, ev);   // NIP-01 replaceable
      w.op.writes++;
      if (d === JOURNAL_MANIFEST_DTAG) w.op.manifestWrites++;
      else if (d.startsWith(JOURNAL_V2_PREFIX)) { w.op.pageWrites++; if (/\.\d+$/.test(d)) bump(w, 'splitPageWrites'); }
      else if (d === RECORDS && JSON.parse(ev.content).movedTo) bump(w, 'stubWrites');
      return Promise.resolve('');
    }),
    listConnectionStatus: () => new Map([...w.relays.keys()].map((u) => [u, true] as [string, boolean])),   // 5c — every relay answers
    close: () => {},
  };
}

function makeState(w: World): any {
  const signer = {
    nip44: { encrypt: async (_pk: string, pt: string) => pt, decrypt: async (_pk: string, ct: string) => ct },
    signEvent: async (e: any) => ({ ...e, pubkey: 'pk', id: hexId(w), sig: 'sig' }),
  };
  const st: any = {
    isAuthenticated: true, nostrSigner: signer, nostrPubkey: 'pk', viewerMode: false, keyProvenance: 'imported', backupVerifiedAt: null,
    nostrRelays: [...URLS], nostrSigningMethod: 'local', initialSettingsPullDone: false, nostrReconnectNeeded: false, nostrSyncing: false,
    recordsDirty: false, planDirty: false, prefsDirty: false, planEvents: [], viewers: [], pendingViewerRevocations: [],
    monthlyLog: [], deletedMonths: {}, dayLog: [], deletedDayEvents: {}, lastRecordsSyncAt: null, lastPrefsSyncAt: null,
    recordRemotePlanFound: () => {}, queueViewerRevocation: () => {}, clearViewerRevocation: () => {},
  };
  const setters: [string, string][] = [
    ['setMonthlyLog', 'monthlyLog'], ['setDeletedMonths', 'deletedMonths'], ['setDayLog', 'dayLog'], ['setDeletedDayEvents', 'deletedDayEvents'],
    ['setRecordsDirty', 'recordsDirty'], ['setLastRecordsSyncAt', 'lastRecordsSyncAt'], ['setNostrReconnectNeeded', 'nostrReconnectNeeded'],
    ['setNostrSyncing', 'nostrSyncing'], ['setInitialSettingsPullDone', 'initialSettingsPullDone'], ['setPlanDirty', 'planDirty'],
    ['setPrefsDirty', 'prefsDirty'], ['setPlanLoaded', 'planLoaded'],   // 5c
  ];
  for (const [setter, field] of setters) st[setter] = (v: unknown) => { st[field] = v; };
  return st;
}

const journalOf = (st: any): RecordsState =>
  ({ entries: st.monthlyLog, deletions: st.deletedMonths, dayLog: st.dayLog, dayLogDeletions: st.deletedDayEvents });
const record = (w: World, part: Partial<RecordsState>): void => { w.oracle = mergeRecords(w.oracle, { ...EMPTY, ...part }, { preferLocalOnTie: false }); };

/** A fresh app session for a new-app device: its own module instances (session state, journal lane, publish clocks). */
async function boot(dev: Device): Promise<void> {
  vi.resetModules();
  dev.m = {
    sync: await import('../sync'),
    engine: await import('../syncEngine'),
    syncNow: await import('../syncNow'),
    journalState: await import('../journalState'),
  };
  dev.st.initialSettingsPullDone = false;
  dev.st.nostrReconnectNeeded = false;
}

async function on(w: World, dev: Device, fn: () => Promise<unknown>): Promise<void> {
  ctx.state = dev.st;
  ctx.skew = dev.skew;
  w.op = { pageWrites: 0, manifestWrites: 0, writes: 0 };
  await fn();
  if (!dev.old) await dev.m.journalState.journalIdle();
}

// ── The journal's writes, as the store's slices make them (dayLogSlice, advisorJournalSlice) ──
const pickMonth = (w: World): string => (w.rng() < 0.6 ? MONTHS[w.hot + Math.floor(w.rng() * 2)] : pick(w, MONTHS));
const dateIn = (w: World, month: string): string => `${month}-${String(1 + Math.floor(w.rng() * 28)).padStart(2, '0')}`;

function addEvent(w: World, st: any): void {
  const ev: any = { id: `ev${++w.seq}`, date: w.rng() < 0.03 ? 'someday' : dateIn(w, pickMonth(w)), ts: tick(w), kind: 'draw', amount: Math.floor(w.rng() * 5000) };
  if (w.rng() < 0.7) ev.memo = 'm'.repeat(Math.floor(w.rng() * w.bloat));
  st.dayLog = [...st.dayLog, ev];
  st.recordsDirty = true;
  record(w, { dayLog: [ev] });
}
function editEvent(w: World, st: any): void {
  if (!st.dayLog.length) return addEvent(w, st);
  const e = pick(w, st.dayLog as any[]);
  const moved = w.rng() < 0.25;
  const v = { ...e, ts: tick(w), amount: Math.floor(w.rng() * 5000), ...(moved ? { date: dateIn(w, pickMonth(w)) } : {}) };
  if (moved && v.date.slice(0, 7) !== String(e.date).slice(0, 7)) bump(w, 'moves');
  st.dayLog = st.dayLog.map((x: any) => (x.id === e.id ? v : x));
  st.recordsDirty = true;
  record(w, { dayLog: [v] });
}
function deleteEvent(w: World, st: any): void {
  if (!st.dayLog.length) return;
  const e = pick(w, st.dayLog as any[]);
  const d = tick(w);
  st.dayLog = st.dayLog.filter((x: any) => x.id !== e.id);
  st.deletedDayEvents = { ...st.deletedDayEvents, [e.id]: d };
  st.recordsDirty = true;
  record(w, { dayLogDeletions: { [e.id]: d } });
}
function upsertEntry(w: World, st: any): void {
  const month = 1 + Math.floor(w.rng() * 12);
  const t = tick(w);
  const e = { month, date: `2026-${String(month).padStart(2, '0')}-01`, btcBought: 0.01, income: 4000, paydown: 0, strikeBal: Math.floor(w.rng() * 9000), strikeLtv: 0.1, loggedAt: t, updatedAt: t, expensesActual: 3000 };
  st.monthlyLog = [...st.monthlyLog.filter((x: any) => x.month !== month), e];
  const { [month]: _gone, ...rest } = st.deletedMonths;   // re-log clears the tombstone (upsertLogEntry)
  st.deletedMonths = rest;
  st.recordsDirty = true;
  record(w, { entries: [e] });
}
function deleteEntry(w: World, st: any): void {
  if (!st.monthlyLog.length) return;
  const e = pick(w, st.monthlyLog as any[]);
  const d = tick(w);
  st.monthlyLog = st.monthlyLog.filter((x: any) => x.month !== e.month);
  st.deletedMonths = { ...st.deletedMonths, [e.month]: d };
  st.recordsDirty = true;
  record(w, { deletions: { [e.month]: d } });
}
/** A busy stretch — a day of many entries, an import — in one of the seed's hot months: what pushes a month past the
 *  page budget and the journal past the records:v1 step. */
function burst(w: World, st: any): void {
  const month = MONTHS[w.hot + Math.floor(w.rng() * 2)];
  const n = 15 + Math.floor(w.rng() * 30);
  for (let i = 0; i < n; i++) {
    const ev: any = { id: `ev${++w.seq}`, date: dateIn(w, month), ts: tick(w), kind: 'buy', amount: 0.001, memo: 'b'.repeat(Math.floor(w.rng() * w.bloat)) };
    st.dayLog = [...st.dayLog, ev];
    record(w, { dayLog: [ev] });
  }
  st.recordsDirty = true;
  bump(w, 'bursts');
}
function write(w: World, st: any): void {
  const r = w.rng();
  if (r < 0.06) burst(w, st);
  else if (r < 0.5) addEvent(w, st);
  else if (r < 0.68) editEvent(w, st);
  else if (r < 0.84) deleteEvent(w, st);
  else if (r < 0.94) upsertEntry(w, st);
  else deleteEntry(w, st);
}

// ── The pre-5b app: records:v1 only — its records branch and its publish, as they were (a494e97) ──
async function oldPublish(w: World, dev: Device): Promise<void> {
  const created_at = Math.max(Math.floor(Date.now() / 1000), dev.lastV1At + 1);
  dev.lastV1At = created_at;
  const ev: Ev = { kind: 30078, created_at, tags: [['d', RECORDS]], content: JSON.stringify(v1Payload(journalOf(dev.st))), pubkey: 'pk', id: hexId(w), sig: 'sig' };
  const res = await Promise.allSettled(ctx.pool.publish(URLS, ev));
  if (res.some((r) => r.status === 'fulfilled')) bump(w, 'oldV1Landed');
  if (res.every((r) => r.status === 'fulfilled')) dev.st.recordsDirty = false;
}
async function oldPull(w: World, dev: Device): Promise<void> {
  const evs: Ev[] = await ctx.pool.querySync(URLS, { '#d': [RECORDS] });
  const ev = evs.sort((a, b) => b.created_at - a.created_at)[0];
  if (!ev) return;
  const data = JSON.parse(ev.content);
  const remote: RecordsState = Array.isArray(data)
    ? { entries: data, deletions: {}, dayLog: [], dayLogDeletions: {} }
    : { entries: data.entries ?? [], deletions: data.deletions ?? {}, dayLog: data.dayLog ?? [], dayLogDeletions: data.dayLogDeletions ?? {} };
  const local = journalOf(dev.st);
  const merged = mergeRecords(local, remote, { preferLocalOnTie: dev.st.recordsDirty });
  if (normRecords(merged) !== normRecords(local)) Object.assign(dev.st, { monthlyLog: merged.entries, deletedMonths: merged.deletions, dayLog: merged.dayLog, deletedDayEvents: merged.dayLogDeletions });
  if (normRecords(merged) !== normRecords(remote)) { dev.st.recordsDirty = true; await oldPublish(w, dev); }
}

// ── Per-step invariants ──
interface Holdings { items: Map<string, number>; tombs: Map<string, number>; months: Map<number, number>; monthTombs: Map<number, number> }
const holdings = (st: any): Holdings => ({
  items: new Map(st.dayLog.map((e: any) => [e.id, e.ts])),
  tombs: new Map(Object.entries(st.deletedDayEvents).map(([k, v]) => [k, v as number])),
  months: new Map(st.monthlyLog.map((e: any) => [e.month, e.updatedAt ?? e.loggedAt ?? 0])),
  monthTombs: new Map(Object.entries(st.deletedMonths).map(([k, v]) => [Number(k), v as number])),
});
function checkStep(w: World, dev: Device, before: Holdings, localWrite: boolean, where: string): void {
  const st = dev.st;
  const ids = st.dayLog.map((e: any) => e.id);
  expect(new Set(ids).size, `${where}: an id twice on ${dev.name}`).toBe(ids.length);
  const months = st.monthlyLog.map((e: any) => e.month);
  expect(new Set(months).size, `${where}: a month twice on ${dev.name}`).toBe(months.length);
  const now = holdings(st);
  for (const [id, ts] of before.items) {
    const held = now.items.get(id);
    if (held !== undefined) { expect(held, `${where}: ${id} went back to an older version on ${dev.name}`).toBeGreaterThanOrEqual(ts); continue; }
    const tomb = now.tombs.get(id);
    expect(tomb !== undefined && tomb > ts, `${where}: ${id} LOST on ${dev.name} (no newer tombstone)`).toBe(true);
    if (!localWrite) bump(w, 'remoteDeletesApplied');
  }
  for (const [id, d] of before.tombs) {
    const held = now.items.get(id);
    if (held !== undefined) expect(held, `${where}: ${id} DELETED, BACK on ${dev.name}`).toBeGreaterThan(d);
  }
  for (const [m, u] of before.months) {
    const held = now.months.get(m);
    if (held !== undefined) { expect(held, `${where}: month ${m} older on ${dev.name}`).toBeGreaterThanOrEqual(u); continue; }
    const tomb = now.monthTombs.get(m);
    expect(tomb !== undefined && tomb > u, `${where}: month ${m} LOST on ${dev.name}`).toBe(true);
  }
  for (const [m, d] of before.monthTombs) {
    const held = now.months.get(m);
    if (held !== undefined) expect(held, `${where}: month ${m} DELETED, BACK on ${dev.name}`).toBeGreaterThan(d);
  }
}

async function publishNow(w: World, dev: Device): Promise<void> {
  if (dev.old) return oldPublish(w, dev);
  await dev.m.engine.publishRecordsNowImmediate();
}
async function syncDev(w: World, dev: Device): Promise<void> {
  if (dev.old) { await oldPull(w, dev); if (dev.st.recordsDirty) await oldPublish(w, dev); return; }
  await dev.m.syncNow.syncNow({} as never);
}
async function livePull(w: World, dev: Device): Promise<void> {
  if (dev.old) return oldPull(w, dev);
  await dev.m.sync.pullJournalNow();
}

function notePull(w: World, dev: Device): void {
  if (dev.old) return;
  const k = dev.m.journalState.peekJournalKnown();
  if (k.check?.missing.length) bump(w, 'missingSeen');
  if (k.unreadable.size) bump(w, 'carried');
  if (k.check && !k.check.manifest && k.check.v1 === 'full' && w.op.writes === 0) bump(w, 'lazyPulls');
}

async function runSeed(seed: number, steps: number): Promise<{ stats: Stats; devices: Device[]; w: World }> {
  const rng = mulberry32(seed);
  ctx.now = 1_780_000_000_000 + seed * 1_000_000;
  const w: World = {
    rng, relays: new Map(), oracle: EMPTY, base: ctx.now, clock: 0, seq: 0,
    bloat: 300 + Math.floor(rng() * 900), hot: Math.floor(rng() * (MONTHS.length - 1)), stats: {},
    op: { pageWrites: 0, manifestWrites: 0, writes: 0 },
  };
  w.relays.set(URLS[0], { events: new Map(), failNext: 0, stock: true });
  w.relays.set(URLS[1], { events: new Map(), failNext: 0, stock: rng() < 0.5 });
  ctx.pool = makePool(w);
  const n = 2 + Math.floor(rng() * 3);
  const devices: Device[] = [];
  for (let i = 0; i < n; i++) {
    const dev: Device = { name: `d${i}`, old: i > 0 && rng() < 0.4, skew: Math.floor((rng() - 0.5) * 20_000), st: makeState(w), m: null, lastV1At: 0 };
    if (!dev.old) await boot(dev);
    devices.push(dev);
  }

  for (let step = 0; step < steps; step++) {
    ctx.now += Math.floor(rng() * 2500);   // 0–2.5 s apart: same-second publishes happen
    const dev = pick(w, devices);
    const before = devices.map((d) => holdings(d.st));
    const r = rng();
    let localWrite = false;
    let where = `seed ${seed} step ${step}`;
    if (r < 0.45) {
      localWrite = true;
      where += ' write';
      await on(w, dev, async () => { write(w, dev.st); if (rng() < 0.7) await publishNow(w, dev); });
      if (!dev.old && w.op.pageWrites > 0 && w.op.manifestWrites === 0 && dev.st.nostrReconnectNeeded) bump(w, 'tornRuns');
    } else if (r < 0.62) {
      where += ' sync';
      await on(w, dev, () => syncDev(w, dev));
      if (!dev.old && w.op.pageWrites > 0 && w.op.manifestWrites === 0 && dev.st.nostrReconnectNeeded) bump(w, 'tornRuns');
      notePull(w, dev);
    } else if (r < 0.74) {
      where += ' live';
      await on(w, dev, () => livePull(w, dev));
      notePull(w, dev);
    } else if (r < 0.79 && !dev.old) {
      // The user writes while a pull waits on the relays for pages: the write must survive the pull's apply.
      localWrite = true;
      where += ' write-during-pull';
      let afterWrite: Holdings | null = null;
      ctx.onPageFetch = () => { write(w, dev.st); afterWrite = holdings(dev.st); };
      await on(w, dev, () => (rng() < 0.5 ? syncDev(w, dev) : livePull(w, dev)));
      ctx.onPageFetch = null;
      if (afterWrite) { bump(w, 'writesDuringPull'); checkStep(w, dev, afterWrite, true, `${where} (the write made mid-pull)`); }
      notePull(w, dev);
    } else if (r < 0.83) {
      pick(w, [...w.relays.values()]).failNext += 1 + Math.floor(rng() * 3);
    } else if (r < 0.88) {
      const relay = pick(w, [...w.relays.values()]);
      const pages = [...relay.events.keys()].filter((d) => d.startsWith(JOURNAL_V2_PREFIX) && d !== JOURNAL_MANIFEST_DTAG);
      if (pages.length) {
        const d = pick(w, pages);
        relay.events.delete(d);
        if (rng() < 0.5) for (const other of w.relays.values()) other.events.delete(d);   // gone from every relay
        bump(w, 'prunes');
      }
    } else if (r < 0.93) {
      if (!dev.old) { await boot(dev); bump(w, 'restarts'); }
    } else if (dev.old && r < 0.96) {
      dev.old = false;
      await boot(dev);
      bump(w, 'upgrades');
    } else {
      where += ' sync';
      await on(w, dev, () => syncDev(w, dev));
      notePull(w, dev);
    }
    devices.forEach((d, i) => checkStep(w, d, before[i], localWrite && d === dev, where));
  }

  // A last-minute loss: half the seeds drop one page from EVERY relay just before the end, so no later edit can restore
  // it — only a device that holds it can, after it finds it missing (the session's full check).
  if (rng() < 0.5) {
    const pages = [...new Set([...w.relays.values()].flatMap((r) => [...r.events.keys()]))]
      .filter((d) => d.startsWith(JOURNAL_V2_PREFIX) && d !== JOURNAL_MANIFEST_DTAG);
    if (pages.length) { const d = pick(w, pages); for (const relay of w.relays.values()) relay.events.delete(d); bump(w, 'lastMinutePrunes'); }
  }
  // Every device updates and relaunches; the relays heal; everyone syncs until a round writes nothing.
  for (const relay of w.relays.values()) relay.failNext = 0;
  for (const dev of devices) { dev.old = false; await boot(dev); }
  let quiet = false;
  for (let round = 0; round < 10 && !quiet; round++) {
    let writes = 0;
    for (const dev of devices) {
      ctx.now += 1500;
      const before = holdings(dev.st);
      await on(w, dev, () => syncDev(w, dev));
      writes += w.op.writes;
      checkStep(w, dev, before, false, `seed ${seed} converge ${round}`);
    }
    const norms = devices.map((d) => normRecords(journalOf(d.st)));
    quiet = writes === 0 && norms.every((x) => x === norms[0]);
  }
  expect(quiet, `seed ${seed}: did not converge in 10 rounds`).toBe(true);
  const want = normRecords(w.oracle);
  for (const dev of devices) expect(normRecords(journalOf(dev.st)), `seed ${seed}: ${dev.name} differs from the oracle`).toBe(want);
  // And the relays hold it all: a new device, signed in now with nothing of its own, gets the whole journal from them.
  const fresh: Device = { name: 'fresh', old: false, skew: 0, st: makeState(w), m: null, lastV1At: 0 };
  await boot(fresh);
  ctx.now += 1500;
  await on(w, fresh, () => syncDev(w, fresh));
  expect(normRecords(journalOf(fresh.st)), `seed ${seed}: a new device can't get the whole journal from the relays`).toBe(want);
  return { stats: w.stats, devices, w };
}

describe('5b — journal pages: seeded mixed-version multi-device sweep', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => ctx.now + ctx.skew);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('SWEEP — no loss, no duplicate, no resurrection, and every device converges to the oracle', async () => {
    const total: Stats = {};
    const SEEDS = Number(process.env.SWEEP_SEEDS ?? 40);   // the LAST seed (SWEEP_FROM is the first); the spec: 1–1,500 in runs of 250
    for (let seed = Number(process.env.SWEEP_FROM ?? 1); seed <= SEEDS; seed++) {
      const { stats } = await runSeed(seed, 120);
      for (const [k, v] of Object.entries(stats)) total[k] = (total[k] ?? 0) + v;
    }
    // Non-vacuity: the sweep reached every state it claims to cover.
    const covered = ['splitPageWrites', 'stubWrites', 'tornRuns', 'prunes', 'missingSeen', 'carried', 'oldV1Landed', 'v1Refused',
      'restarts', 'upgrades', 'lazyPulls', 'remoteDeletesApplied', 'moves', 'injectedFailures', 'bursts', 'writesDuringPull',
      'lastMinutePrunes'];
    expect(covered.filter((k) => !(total[k] > 0)), `the sweep never reached these (totals: ${JSON.stringify(total)})`).toEqual([]);
    if (process.env.SWEEP_TOTALS) (await import('node:fs')).writeFileSync(process.env.SWEEP_TOTALS, JSON.stringify({ seeds: SEEDS, ...total }));
  }, 600_000);
});
