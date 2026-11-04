import { describe, it, expect, beforeEach } from 'vitest';
import {
  VERSION_URL, OPEN_DELAY_MS, FOREGROUND_GAP_MS, HOURLY_MS, RELOAD_FALLBACK_MS, CHECK_TIMEOUT_MS,
  deployedStamp, compareBuild, fetchDeployedStamp, checkForUpdate, applyUpdate, startUpdateChecks, ownStamp,
  getUpdateState, subscribeUpdate, resetUpdateStateForTests, type ApplyEnv, type CheckEnv,
} from '../appUpdate';

/**
 * ⚠ BL51 — app updates (spec `pbloc-spec-app-updates-v1`): "New version ready · Update", one tap, never a restart by
 * itself. The module is pure but for its two browser envs, which every test here replaces: a fake `fetch` for the
 * stamp, a fake registration and worker for the tap, a fake clock and page for the schedule. appUpdateWiring.test.ts
 * reads where it is started and who may reach the worker; e2e/appUpdate.spec.ts runs it in a browser against a routed
 * `/version.json`. Each assertion carries its tag.
 */

type Body = { status?: number; type?: string; body?: unknown; throws?: boolean; hangs?: boolean };
/** A `fetch` that answers every call with the next body, and records each call (a hung one ends only on its signal). */
function fakeFetch(...bodies: Body[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const b = bodies.length > 1 ? bodies.shift()! : bodies[0];
    if (b.hangs) {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    if (b.throws) throw new TypeError('Failed to fetch');
    const status = b.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (b.type ?? 'application/json') : null) },
      json: async () => b.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const live = (sha: string, time = '2026-11-03T00:00:00.000Z'): Body => ({ body: { sha, time } });
const OWN = (): Body => ({ body: ownStamp() });
const OTHER = `${__BUILD_SHA__}x`;

beforeEach(() => resetUpdateStateForTests());

describe('⭐ which build is live', () => {
  it('⭐ STAMP — version.json\'s sha and time, trimmed; anything else is no stamp; the bundle\'s own is its two constants', () => {
    expect(deployedStamp({ sha: 'abc1234', time: 't1' }), 'STAMP a stamp').toEqual({ sha: 'abc1234', time: 't1' });
    expect(deployedStamp({ sha: ' abc1234\n', time: ' t1 ' }), 'STAMP trimmed').toEqual({ sha: 'abc1234', time: 't1' });
    for (const body of [null, undefined, 42, 'abc1234', [], {}, { sha: '' }, { sha: '   ', time: 't1' }, { sha: 1234567, time: 't1' },
      { sha: null }, { sha: 'abc1234' }, { sha: 'abc1234', time: '' }, { sha: 'abc1234', time: 7 }]) {
      expect(deployedStamp(body), `STAMP none: ${JSON.stringify(body)}`).toBeNull();
    }
    expect(ownStamp(), 'STAMP the bundle\'s own').toEqual({ sha: __BUILD_SHA__, time: __BUILD_TIME__ });
    expect(__BUILD_SHA__ !== '' && __BUILD_TIME__ !== '', 'STAMP premise: both constants set').toBe(true);
  });

  it('⭐ COMPARE — another build → available, a rebuild of the same commit too; this one → current; no stamp → unknown', () => {
    const own = { sha: 'abc1234', time: 't1' };
    expect(compareBuild(own, { sha: 'abc1234', time: 't1' }), 'COMPARE the same build').toBe('current');
    expect(compareBuild(own, { sha: 'def5678', time: 't2' }), 'COMPARE another commit').toBe('available');
    expect(compareBuild(own, { sha: 'abc1234', time: 't2' }), 'COMPARE the same commit built again (a redeploy)').toBe('available');
    expect(compareBuild(own, null), 'COMPARE no stamp').toBe('unknown');
  });

  it('⭐ FETCH — asks past every cache, within a time limit; an older deploy\'s page (the SPA rewrite), an error, no network or no answer is no stamp', async () => {
    const ok = fakeFetch(live('def5678', 't2'));
    expect(await fetchDeployedStamp(ok.impl), 'FETCH the stamp').toEqual({ sha: 'def5678', time: 't2' });
    expect(ok.calls[0].url.startsWith(`${VERSION_URL}?t=`), 'FETCH the file, a fresh query each time').toBe(true);
    expect(ok.calls[0].init?.cache, 'FETCH past the HTTP cache').toBe('no-store');
    expect(ok.calls[0].init?.signal, 'FETCH within a time limit').toBeInstanceOf(AbortSignal);
    expect(CHECK_TIMEOUT_MS, 'FETCH the limit: 15 s').toBe(15_000);
    // An older deploy has no version.json: Vercel's SPA rewrite answers with index.html — 200, text/html.
    expect(await fetchDeployedStamp(fakeFetch({ type: 'text/html; charset=utf-8', body: '<!doctype html>' }).impl),
      'FETCH the page is no stamp').toBeNull();
    expect(await fetchDeployedStamp(fakeFetch({ status: 404, body: { sha: 'def5678', time: 't2' } }).impl), 'FETCH a 404').toBeNull();
    expect(await fetchDeployedStamp(fakeFetch({ status: 500, body: { sha: 'def5678', time: 't2' } }).impl), 'FETCH a 500').toBeNull();
    expect(await fetchDeployedStamp(fakeFetch({ throws: true }).impl), 'FETCH offline').toBeNull();
    expect(await fetchDeployedStamp(fakeFetch({ body: { time: 'x' } }).impl), 'FETCH json with no sha').toBeNull();
    const t0 = Date.now();
    expect(await fetchDeployedStamp(fakeFetch({ hangs: true }).impl, 30), 'FETCH a request that never answers: none, at its limit').toBeNull();
    expect(Date.now() - t0, 'FETCH ended by the limit').toBeLessThan(2_000);
  });
});

describe('⭐ a check', () => {
  it('⭐ CHECK — this build → current; another → available; no stamp → unknown; the state moves through checking', async () => {
    const seen: string[] = [];
    const off = subscribeUpdate(() => seen.push(getUpdateState().status));
    expect(getUpdateState().status, 'CHECK before any check').toBe('idle');
    expect(await checkForUpdate(fakeFetch(OWN()).impl), 'CHECK this build').toBe('current');
    expect(seen, 'CHECK through checking').toEqual(['checking', 'current']);
    expect(getUpdateState().checkedAt, 'CHECK stamped').not.toBeNull();
    expect(await checkForUpdate(fakeFetch(live(OTHER)).impl), 'CHECK another build').toBe('available');
    resetUpdateStateForTests();
    expect(await checkForUpdate(fakeFetch({ body: { sha: __BUILD_SHA__, time: `${__BUILD_TIME__}x` } }).impl),
      'CHECK this commit built again').toBe('available');
    resetUpdateStateForTests();
    expect(await checkForUpdate(fakeFetch({ throws: true }).impl), 'CHECK offline').toBe('unknown');
    resetUpdateStateForTests();
    expect(await checkForUpdate(fakeFetch({ hangs: true }).impl, 30), 'CHECK no answer: unknown, at the limit').toBe('unknown');
    expect(await checkForUpdate(fakeFetch(live(OTHER)).impl), 'CHECK the next one goes out').toBe('available');
    off();
  });

  it('⭐ CHECK — an update found stays offered when a later check can\'t reach the file; one that finds this build takes it away', async () => {
    expect(await checkForUpdate(fakeFetch(live(OTHER)).impl)).toBe('available');
    const seen: string[] = [];
    const off = subscribeUpdate(() => seen.push(getUpdateState().status));
    expect(await checkForUpdate(fakeFetch({ throws: true }).impl), 'CHECK offline keeps the offer').toBe('available');
    expect(seen, 'CHECK the card never blinks off while it checks').toEqual(['available']);
    expect(await checkForUpdate(fakeFetch({ type: 'text/html', body: '' }).impl), 'CHECK no stamp keeps it').toBe('available');
    expect(await checkForUpdate(fakeFetch(OWN()).impl), 'CHECK a rollback takes it away').toBe('current');
    // v1.1 (Claude Code's note 3) — a failed tap's offer is kept the same way, its words with it until the next tap
    expect(await checkForUpdate(fakeFetch(live(OTHER)).impl)).toBe('available');
    await applyUpdate(fakeEnv('fails').env);
    expect(getUpdateState().status, 'CHECK premise: a failed tap').toBe('failed');
    seen.length = 0;
    expect(await checkForUpdate(fakeFetch({ throws: true }).impl), 'CHECK offline keeps a failed tap\'s offer').toBe('failed');
    expect(await checkForUpdate(fakeFetch(live(OTHER)).impl), 'CHECK its words until the next tap').toBe('failed');
    expect(seen, 'CHECK its card never blinks off while it checks').toEqual(['failed', 'failed']);
    expect(await checkForUpdate(fakeFetch(OWN()).impl), 'CHECK a rollback takes it away too').toBe('current');
    off();
  });

  it('⭐ CHECK — two at once share one request; none while an update applies; a tap during a check keeps its own state', async () => {
    const f = fakeFetch(live(OTHER));
    const [a, b] = await Promise.all([checkForUpdate(f.impl), checkForUpdate(f.impl)]);
    expect([a, b, f.calls.length], 'CHECK one request').toEqual(['available', 'available', 1]);
    const pending: ApplyEnv = { getRegistration: () => new Promise(() => {}), watch: () => {}, reload: () => {}, later: () => {} };
    void applyUpdate(pending);
    const g = fakeFetch(OWN());
    expect(await checkForUpdate(g.impl), 'CHECK while updating').toBe('updating');
    expect(g.calls.length, 'CHECK no request while updating').toBe(0);
    // A check out when the tap lands (a click into a window fires `focus`, then the tap): its answer never undoes the tap.
    resetUpdateStateForTests();
    let answer: (v: Response) => void = () => {};
    const slow = (() => new Promise<Response>((r) => { answer = r; })) as unknown as typeof fetch;
    const out = checkForUpdate(slow);
    void applyUpdate(pending);
    answer({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ sha: OTHER, time: 't' }) } as unknown as Response);
    expect(await out, 'CHECK the tap\'s state stands').toBe('updating');
    expect(getUpdateState().status, 'CHECK still updating').toBe('updating');
    // …and a tap that fails while a check is out: the check's answer keeps the failure's words (v1.1, note 3)
    resetUpdateStateForTests();
    expect(await checkForUpdate(fakeFetch(live(OTHER)).impl)).toBe('available');
    let reply: (v: Response) => void = () => {};
    const out2 = checkForUpdate((() => new Promise<Response>((r) => { reply = r; })) as unknown as typeof fetch);
    await applyUpdate(fakeEnv('fails').env);
    reply({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ sha: OTHER, time: 't' }) } as unknown as Response);
    expect(await out2, 'CHECK a failed tap\'s words stand').toBe('failed');
  });
});

/** A registration whose `update()` finds a new worker (installing), or nothing, or fails; the worker's states fed by the
 *  test. */
function fakeEnv(reg: 'none' | 'found' | 'nothing' | 'fails' | 'pending', first: ServiceWorkerState = 'installing') {
  const log: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let onState: (s: ServiceWorkerState) => void = () => {};
  const worker = { state: first } as ServiceWorker;
  const registration = {
    installing: null as unknown,
    waiting: null as unknown,
    update: async () => {
      log.push('update');
      if (reg === 'fails') throw new TypeError('Failed to fetch');
      if (reg === 'found') registration.installing = worker;
    },
  };
  const env: ApplyEnv = {
    getRegistration: () => {
      log.push('getRegistration');
      if (reg === 'pending') return new Promise(() => {});
      return Promise.resolve(reg === 'none' ? undefined : registration as unknown as ServiceWorkerRegistration);
    },
    watch: (w, fn) => { log.push('watch'); onState = fn; fn(w.state); },
    reload: () => log.push('reload'),
    later: (fn, ms) => { timers.push({ fn, ms }); },
  };
  const to = (s: ServiceWorkerState) => { (worker as { state: ServiceWorkerState }).state = s; onState(s); };
  return { env, log, timers, to };
}

describe('⭐ the tap', () => {
  it('⭐ APPLY — a new worker found: no restart while it installs; once it is active, registerSW\'s own — the tap\'s 5 s later', async () => {
    const { env, log, timers, to } = fakeEnv('found');
    await applyUpdate(env);
    expect(getUpdateState().status, 'APPLY updating').toBe('updating');
    expect(log, 'APPLY the worker checked and watched, no restart').toEqual(['getRegistration', 'update', 'watch']);
    for (const s of ['installed', 'activating'] as const) to(s);
    expect([log.includes('reload'), timers.length], 'APPLY never while it installs — a slow link\'s minutes too').toEqual([false, 0]);
    to('activated');
    expect(timers.map((t) => t.ms), 'APPLY active: the fallback armed').toEqual([RELOAD_FALLBACK_MS]);
    expect(RELOAD_FALLBACK_MS, 'APPLY the fallback is 5 s').toBe(5_000);
    timers[0].fn();
    expect(log.filter((l) => l === 'reload'), 'APPLY the fallback restarts, once').toEqual(['reload']);
    to('redundant');
    expect(timers.length, 'APPLY nothing after it settled').toBe(1);
  });

  it('⭐ APPLY — a worker already active when watched: the fallback at once; one that fails to install: \'failed\', no restart', async () => {
    const fast = fakeEnv('found', 'activated');
    await applyUpdate(fast.env);
    expect(fast.timers.map((t) => t.ms), 'APPLY already active').toEqual([RELOAD_FALLBACK_MS]);
    resetUpdateStateForTests();
    const bad = fakeEnv('found');
    await applyUpdate(bad.env);
    bad.to('redundant');
    expect(getUpdateState().status, 'APPLY a failed install').toBe('failed');
    expect([bad.log.includes('reload'), bad.timers.length], 'APPLY a failed install: no restart').toEqual([false, 0]);
  });

  it('⭐ APPLY — nothing new to install, or no service worker (the dev server): a plain restart, at once', async () => {
    const nothing = fakeEnv('nothing');
    await applyUpdate(nothing.env);
    expect(nothing.log, 'APPLY nothing new').toEqual(['getRegistration', 'update', 'reload']);
    resetUpdateStateForTests();
    const none = fakeEnv('none');
    await applyUpdate(none.env);
    expect(none.log, 'APPLY no worker').toEqual(['getRegistration', 'reload']);
  });

  it('⭐ APPLY — offline: no restart, the card says so; a second tap works; a tap while one applies does nothing', async () => {
    const off = fakeEnv('fails');
    await applyUpdate(off.env);
    expect(getUpdateState().status, 'APPLY failed').toBe('failed');
    expect(off.log, 'APPLY offline: no restart').toEqual(['getRegistration', 'update']);
    const again = fakeEnv('found');
    await applyUpdate(again.env);
    expect(again.log, 'APPLY try again').toEqual(['getRegistration', 'update', 'watch']);
    resetUpdateStateForTests();
    const busy = fakeEnv('pending');
    void applyUpdate(busy.env);
    await applyUpdate(busy.env);
    expect(busy.log, 'APPLY one tap at a time').toEqual(['getRegistration']);
  });
});

/** A fake page and clock: listeners and timers recorded, `now` and visibility set by the test. */
function fakePage() {
  const p = {
    t: 1_000_000, vis: true, checks: 0,
    afters: [] as { fn: () => void; ms: number; stopped: boolean }[],
    everys: [] as { fn: () => void; ms: number; stopped: boolean }[],
    fg: [] as (() => void)[], removed: 0,
  };
  const env: CheckEnv = {
    now: () => p.t,
    visible: () => p.vis,
    onForeground: (fn) => { p.fg.push(fn); return () => { p.removed++; }; },
    after: (fn, ms) => { const r = { fn, ms, stopped: false }; p.afters.push(r); return () => { r.stopped = true; }; },
    every: (fn, ms) => { const r = { fn, ms, stopped: false }; p.everys.push(r); return () => { r.stopped = true; }; },
  };
  const check = () => { p.checks++; };
  const foreground = () => p.fg.forEach((fn) => fn());
  return { p, env, check, foreground };
}

describe('⭐ when it checks', () => {
  it('⭐ SCHEDULE — when it opens (10 s in), back to the front (once a minute at most, on screen) and hourly on screen', () => {
    const { p, env, check, foreground } = fakePage();
    startUpdateChecks(env, check);
    expect(p.afters.map((a) => a.ms), 'SCHEDULE the open check').toEqual([OPEN_DELAY_MS]);
    expect(OPEN_DELAY_MS, 'SCHEDULE 10 s').toBe(10_000);
    expect(p.everys.map((e) => e.ms), 'SCHEDULE hourly').toEqual([HOURLY_MS]);
    expect(HOURLY_MS, 'SCHEDULE an hour').toBe(3_600_000);
    // A fresh start fires pageshow (and focus) at once — no check before the open one.
    p.t += 500; foreground();
    expect(p.checks, 'SCHEDULE no check at the start\'s own pageshow').toBe(0);
    p.t += 9_500; p.afters[0].fn();
    expect(p.checks, 'SCHEDULE the open check').toBe(1);
    p.t += FOREGROUND_GAP_MS - 1; foreground();
    expect(p.checks, 'SCHEDULE within the minute: none').toBe(1);
    p.t += 1; foreground();
    expect(p.checks, 'SCHEDULE back to the front a minute on').toBe(2);
    p.t += 5 * 60_000; p.vis = false; foreground();
    expect(p.checks, 'SCHEDULE hidden: none').toBe(2);
    p.vis = true; foreground();
    expect(p.checks, 'SCHEDULE visible again').toBe(3);
    p.everys[0].fn();
    expect(p.checks, 'SCHEDULE the hour').toBe(4);
    p.vis = false; p.everys[0].fn();
    expect(p.checks, 'SCHEDULE the hour, hidden: none').toBe(4);
    expect(FOREGROUND_GAP_MS, 'SCHEDULE a minute').toBe(60_000);
  });

  it('⭐ SCHEDULE — its stop removes every listener and timer; the default check is a check, never the tap', async () => {
    const { p, env, check } = fakePage();
    const stop = startUpdateChecks(env, check);
    stop();
    expect([p.afters[0].stopped, p.everys[0].stopped, p.removed], 'SCHEDULE stopped').toEqual([true, true, 1]);
    // The default `check` is checkForUpdate: run through the real module with a fake fetch, it leaves the state
    // 'available' and nothing applying.
    const page = fakePage();
    startUpdateChecks(page.env);
    const f = fakeFetch(live(OTHER));
    const realFetch = globalThis.fetch;
    globalThis.fetch = f.impl;
    try {
      page.p.afters[0].fn();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      globalThis.fetch = realFetch;
    }
    expect([f.calls.length, getUpdateState().status], 'SCHEDULE the default check only checks').toEqual([1, 'available']);
  });
});
