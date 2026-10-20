import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 5e (F1, spec `pbloc-spec-batch-1-v1` §2.1 and its review's changes 2–3) — "Loading your plan…" in place of the red
 * flash after a fresh sign-in. Up while the session's first pull runs on a device without its plan — the plan AND the
 * journal (the red Strike LTV lived between them) — and down when it lands: with a plan, with nothing, or failed; never
 * longer, and before any publish. Never a trap ("Open the app" at 15 s), never late (a first pull that starts once the
 * app is on screen never raises it), and display only: 5c's guard, untouched, refuses every plan-dependent write
 * (firstPullFresh.test.ts walks that through a fresh sign-in). The pull and the publish engine are mocked here, so each
 * can be held open; the store and syncNow are real.
 */

const h = vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem:    (k: string) => mem.get(k) ?? null,
    setItem:    (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  return {
    pull: null as null | { resolve: (v: { ok: boolean; planFound: boolean }) => void; reject: (e: unknown) => void },
    publish: null as null | Promise<boolean>,
  };
});

vi.mock('../sync', () => ({
  fetchAndSync: vi.fn(() => new Promise((resolve, reject) => { h.pull = { resolve, reject }; })),
}));
vi.mock('../syncEngine', () => ({
  publishRecordsNowImmediate: vi.fn(() => h.publish ?? Promise.resolve(true)),
  publishPlanEventsNow:       vi.fn(() => Promise.resolve(true)),
  publishPrefsNow:            vi.fn(() => Promise.resolve(true)),
  flushViewerRevocations:     vi.fn(() => Promise.resolve(true)),
  refusedForSize:             () => false,
  heldWithoutPlan:            () => false,
}));
vi.mock('../session', () => ({ restoreSigner: vi.fn(() => Promise.resolve(null)) }));

import { useStore } from '../../../store/useStore';
import { syncNow } from '../syncNow';
import {
  PLAN_SCREEN_SLOW_MS, firstPullLands, firstPullStarts, getFirstPull, getPlanScreen, markAppOnScreen, openTheApp,
  resetFirstPull,
} from '../firstPull';
import { PlanLoadingGate, PLAN_LOADING_TITLE, PLAN_LOADING_SLOW, OPEN_THE_APP } from '../../../components/Auth/PlanLoadingGate';

/** A signed-in owner device, its signer in hand and its relays known — a fresh sign-in's state; `planLoaded` false. */
const signedIn = (extra: Record<string, unknown> = {}) => useStore.setState({
  nostrAuthEnabled: true, viewerMode: false, planLoaded: false, keyProvenance: 'external', backupVerifiedAt: null,
  isAuthenticated: true, nostrSigner: {} as never, nostrPubkey: 'pk', nostrSigningMethod: 'nip07', nostrRelays: ['wss://a'],
  recordsDirty: false, planDirty: false, prefsDirty: false, nostrReconnectNeeded: false, pendingViewerRevocations: [],
  ...extra,
} as never);
const up = () => getPlanScreen().up;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => { resetFirstPull(); h.pull = null; h.publish = null; signedIn(); });
// A test that fails before it lets its pull land would leave syncNow's shared run in flight for the next one: land it.
afterEach(async () => { vi.useRealTimers(); h.pull?.resolve({ ok: true, planFound: false }); await new Promise((r) => setTimeout(r, 0)); });

describe('⭐ F1 — the loading screen lasts the first pull, and never longer', () => {
  it('⭐ F1 SHOWN — a fresh sign-in\'s sync puts the screen up in the same tick, before any await', () => {
    const run = syncNow({} as never);
    expect(up(), 'SHOWN at once — the sign-in\'s first render already sees it').toBe(true);
    expect(getFirstPull()).toBe('running');
    h.pull!.resolve({ ok: true, planFound: true });
    return run;
  });

  it('⭐ F1 LANDS — it stays up after the plan applies, through the journal, and goes when the pull returns — before any publish', async () => {
    useStore.setState({ recordsDirty: true } as never);   // a publish follows the pull
    let release!: (v: boolean) => void;
    h.publish = new Promise<boolean>((r) => { release = r; });
    const run = syncNow({} as never);
    await settle();
    useStore.setState({ planLoaded: true } as never);    // the plan applies mid-pull (sync.ts L99) — the journal hasn't landed
    await settle();
    expect(up(), 'LANDS still up between the plan and the journal').toBe(true);
    h.pull!.resolve({ ok: true, planFound: true });       // the journal has landed: fetchAndSync returns
    await settle();
    expect(up(), 'LANDS down when the pull returns').toBe(false);
    expect(getFirstPull(), 'LANDS settled while the publish is still in flight').toBe('settled');
    release(true);
    await run;
  });

  it('⭐ F1 LANDS — with nothing, failed, and a throw: down every time', async () => {
    for (const outcome of ['none', 'failed', 'throw'] as const) {
      resetFirstPull();
      signedIn();
      const run = syncNow({} as never);
      expect(up(), `LANDS ${outcome}: up`).toBe(true);
      await settle();
      if (outcome === 'throw') h.pull!.reject(new Error('relay socket closed'));
      else h.pull!.resolve({ ok: outcome === 'none', planFound: false });
      await run;
      expect(up(), `LANDS ${outcome}: down`).toBe(false);
      expect(getFirstPull(), `LANDS ${outcome}: settled`).toBe('settled');
      expect(useStore.getState().planLoaded, `LANDS ${outcome}: a pull that found nothing never sets planLoaded`).toBe(false);
    }
  });

  it('⭐ F1 ONCE — the session\'s first pull only: a later sync never raises it again', async () => {
    const first = syncNow({} as never);
    await settle();
    h.pull!.resolve({ ok: true, planFound: false });
    await first;
    const second = syncNow({} as never);
    expect(up(), 'ONCE').toBe(false);
    await settle();
    h.pull!.resolve({ ok: true, planFound: false });
    await second;
  });

  it('⭐ F1 HOLDS — a device holding its plan, a viewer, an unbacked-up key and a missing signer never see it', async () => {
    signedIn({ planLoaded: true });
    const loaded = syncNow({} as never);
    expect(up(), 'HOLDS its plan loaded').toBe(false);
    expect(getFirstPull(), 'HOLDS settled at once').toBe('settled');
    await settle();
    h.pull!.resolve({ ok: true, planFound: true });
    await loaded;

    for (const [label, state] of [
      ['a viewer', { viewerMode: true }],
      ['an unbacked-up generated key', { keyProvenance: 'generated', backupVerifiedAt: null }],
      ['no signer', { nostrSigner: null }],
    ] as const) {
      resetFirstPull();
      signedIn(state);
      h.pull = null;
      await syncNow({} as never);
      expect(up(), `HOLDS ${label}`).toBe(false);
      expect(h.pull, `HOLDS ${label}: no pull ran`).toBeNull();
    }
  });

  it('⭐ F1 LATE — a first pull that starts once the app is on screen never raises it (an unlock that didn\'t sync, Reconnect, the ceremony\'s wake)', async () => {
    markAppOnScreen();
    const run = syncNow({} as never);
    expect(getFirstPull(), 'LATE the pull runs').toBe('running');
    expect(up(), 'LATE but the screen stays down').toBe(false);
    await settle();
    h.pull!.resolve({ ok: true, planFound: true });
    await run;
  });
});

describe('⭐ F1 ESCAPE — never a trap', () => {
  const planless = { nostrAuthEnabled: true, viewerMode: false, planLoaded: false };

  it('⭐ F1 ESCAPE — "Open the app" at 15 s, not before; pressing it ends the screen; the pull\'s own end still settles cleanly', () => {
    vi.useFakeTimers();
    firstPullStarts(planless);
    expect(getPlanScreen(), 'ESCAPE up, not yet slow').toEqual({ up: true, slow: false });
    vi.advanceTimersByTime(PLAN_SCREEN_SLOW_MS - 1);
    expect(getPlanScreen().slow, 'ESCAPE not before 15 s').toBe(false);
    vi.advanceTimersByTime(1);
    expect(getPlanScreen(), 'ESCAPE at 15 s').toEqual({ up: true, slow: true });
    openTheApp();
    expect(up(), 'ESCAPE pressed: down').toBe(false);
    expect(getFirstPull(), 'ESCAPE the pull carries on').toBe('running');
    firstPullLands();
    expect(getFirstPull(), 'ESCAPE the pull\'s end settles').toBe('settled');
    expect(up()).toBe(false);
    firstPullStarts(planless);
    expect(up(), 'ESCAPE never back this session').toBe(false);
    expect(vi.getTimerCount(), 'ESCAPE no timer left').toBe(0);
  });

  it('the limit is fifteen seconds', () => {
    expect(PLAN_SCREEN_SLOW_MS).toBe(15_000);
  });

  it('⭐ F1 ESCAPE — the words: the title alone at first; at 15 s why it\'s still loading, and the button', () => {
    const quiet = renderToStaticMarkup(createElement(PlanLoadingGate, { slow: false }));
    expect(quiet, 'ESCAPE the title').toContain(PLAN_LOADING_TITLE);
    expect(PLAN_LOADING_TITLE).toBe('Loading your plan…');
    expect(quiet, 'ESCAPE no button before 15 s').not.toContain(OPEN_THE_APP);
    const slow = renderToStaticMarkup(createElement(PlanLoadingGate, { slow: true }));
    expect(slow, 'ESCAPE why').toContain(PLAN_LOADING_SLOW);
    expect(PLAN_LOADING_SLOW).toBe('Still loading — your relays or signer are slow.');
    expect(slow, 'ESCAPE the button').toMatch(/<button[^>]*>Open the app<\/button>/);
  });
});

describe('⭐ F1 GATE — the wiring (read off the source)', () => {
  const read = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
  const SHELL = read('components/Layout/AppShell.tsx');
  const SYNC_NOW = read('lib/nostr/syncNow.ts');

  it('⭐ F1 GATE — one owner branch after PrivateAppNotice and before the viewer home; its hook on its own line; DEV-bypassed like A–F', () => {
    expect(SHELL, 'GATE the hook, alone on its line').toMatch(/^\s*const planLoading\s+= usePlanLoading\(\);/m);
    expect(SHELL, 'GATE the signed-in owner').toMatch(/const signedInApp = onboardingComplete && !viewerMode && nostrAuthEnabled && isAuthenticated && isOwner;/);
    expect(SHELL, 'GATE the app on screen is recorded').toMatch(/useEffect\(\(\) => \{ if \(signedInApp && !planLoading\.up\) markAppOnScreen\(\); \}, \[signedInApp, planLoading\.up\]\);/);
    const branch = SHELL.indexOf(') : signedInApp && planLoading.up && !import.meta.env.DEV ? (');
    expect(branch, 'GATE the branch').toBeGreaterThan(-1);
    expect(SHELL.indexOf('<PrivateAppNotice />'), 'GATE after F').toBeLessThan(branch);
    expect(SHELL.indexOf(') : viewerMode && viewerDataLoaded'), 'GATE before G').toBeGreaterThan(branch);
    expect(SHELL.slice(branch, branch + 600), 'GATE the screen').toMatch(/<PlanLoadingGate slow=\{planLoading\.slow\} \/>/);
    expect(read('hooks/usePlanLoading.ts'), 'GATE the server snapshot too').toMatch(/useSyncExternalStore\(subscribePlanScreen, getPlanScreen, getPlanScreen\)/);
  });

  it('⭐ F1 GATE — syncNow gains only the marker: the start inside the try, the end after the pull and in the finally', () => {
    expect(SYNC_NOW.match(/firstPull(Starts|Lands)\(/g), 'GATE three calls').toEqual(['firstPullStarts(', 'firstPullLands(', 'firstPullLands(']);
    expect(SYNC_NOW, 'GATE the start, first in the try').toMatch(/try \{\s*firstPullStarts\(useStore\.getState\(\)\);/);
    expect(SYNC_NOW, 'GATE the end, right after the pull').toMatch(/await fetchAndSync\(signer, nostrPubkey, useStore\.getState\(\)\.nostrRelays\);\s*firstPullLands\(\);/);
    expect(SYNC_NOW, 'GATE the end, in the finally').toMatch(/\} finally \{\s*firstPullLands\(\);/);
  });

  it('⭐ F1 GATE — display only: no F1 file sets planLoaded or writes the store', () => {
    for (const rel of ['lib/nostr/firstPull.ts', 'hooks/usePlanLoading.ts', 'components/Auth/PlanLoadingGate.tsx']) {
      const text = read(rel);
      expect(text, `GATE ${rel} never sets planLoaded`).not.toMatch(/setPlanLoaded\(/);
      expect(text, `GATE ${rel} never touches the store`).not.toMatch(/useStore|setState\(/);
    }
  });
});
