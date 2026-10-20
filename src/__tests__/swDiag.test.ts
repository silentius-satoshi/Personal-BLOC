import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * 5e (F2, spec `pbloc-spec-batch-1-v1` §2.1) — index.html's start-up diagnostic (the SW DIAG panel). It records errors
 * from the page's first moment, paints after a 15 s watchdog only if the app hasn't started (window.__APP_BOOTED), removes
 * a panel it painted the moment the app starts — so it never stays over a healthy start — and keeps ?swdebug's panel,
 * which was asked for. The REAL inline script runs here, extracted from index.html, in node:vm with a fake window,
 * document and clock: the logic is pinned, not the browser's event delivery (the e2e, startup.spec.ts, sees that).
 */

const HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)![1];   // the one inline script (the bundle's has a src)

interface FakeEl {
  id: string;
  textContent: string;
  style: { cssText: string };
  children: FakeEl[];
  parentNode: FakeEl | null;
  appendChild(c: FakeEl): FakeEl;
  removeChild(c: FakeEl): FakeEl;
}

function el(): FakeEl {
  const node: FakeEl = {
    id: '', textContent: '', style: { cssText: '' }, children: [], parentNode: null,
    appendChild(c) { c.parentNode = node; node.children.push(c); return c; },
    removeChild(c) { node.children = node.children.filter((x) => x !== c); c.parentNode = null; return c; },
  };
  return node;
}

function find(root: FakeEl | null, id: string): FakeEl | null {
  if (!root) return null;
  if (root.id === id) return root;
  for (const c of root.children) { const f = find(c, id); if (f) return f; }
  return null;
}

/** Runs the script on a fresh fake page; `bodyLate` holds the body back until `ready()` (DOMContentLoaded). */
function page(opts: { search?: string; bodyLate?: boolean } = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const add = (fn: () => void, ms: number, every?: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every }); return id; };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void; every?: number }] | null = null;
      for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      const [id, t] = next;
      now = t.at;
      if (t.every) t.at += t.every; else timers.delete(id);
      t.fn();
    }
    now = end;
  };

  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const loaded: (() => void)[] = [];
  const body = el();
  const document = {
    body: opts.bodyLate ? null as FakeEl | null : body,
    scripts: [] as unknown[],
    getElementById: (id: string) => find(document.body, id),
    createElement: () => el(),
    addEventListener: (type: string, fn: () => void) => { if (type === 'DOMContentLoaded') loaded.push(fn); },
  };
  const win: Record<string, unknown> = {
    document,
    location: { search: opts.search ?? '', href: 'https://bloc.example/', origin: 'https://bloc.example' },
    navigator: { onLine: true },
    setTimeout: (fn: () => void, ms: number) => add(fn, ms),
    setInterval: (fn: () => void, ms: number) => add(fn, ms, ms),
    clearTimeout: (id: number) => { timers.delete(id); },
    clearInterval: (id: number) => { timers.delete(id); },
    addEventListener: (type: string, fn: (e: unknown) => void) => { (listeners[type] ??= []).push(fn); },
  };
  win.window = win;   // the context's own global, as in a browser
  vm.createContext(win);
  vm.runInContext(SCRIPT, win);

  const panel = () => find(document.body, 'sw-diag-panel');
  return {
    advance,
    panel,
    lines: () => panel()?.children.map((c) => c.textContent) ?? [],
    started: () => { win.__APP_BOOTED = true; },
    fire: (type: string, e: unknown) => { for (const fn of listeners[type] ?? []) fn(e); },
    ready: () => { document.body = body; for (const fn of loaded) fn(); },
  };
}

describe('⭐ F2 — the start-up diagnostic', () => {
  it('⭐ F2 QUIET — an app that starts inside the window: no panel, ever', () => {
    const p = page();
    p.advance(5_000);
    p.started();
    p.advance(60_000);
    expect(p.panel(), 'QUIET').toBeNull();
  });

  it('⭐ F2 WINDOW — the watchdog waits 15 s, not less', () => {
    const p = page();
    p.advance(14_999);
    expect(p.panel(), 'WINDOW not before 15 s').toBeNull();
    p.advance(1);
    expect(p.panel(), 'WINDOW at 15 s').not.toBeNull();
  });

  it('⭐ F2 GONE — a slow start the watchdog painted over: the panel removes itself the moment the app starts', () => {
    const p = page();
    p.advance(15_000);
    expect(p.panel(), 'GONE PREMISE: painted').not.toBeNull();
    expect(p.lines()[0], 'GONE PREMISE: it is the diagnostic').toBe('SW DIAG');
    p.started();
    p.advance(250);
    expect(p.panel(), 'GONE removed').toBeNull();
    p.advance(60_000);
    expect(p.panel(), 'GONE and never back').toBeNull();
  });

  it('⭐ F2 GONE — the watchdog re-checks at paint time: a body that arrives after the app started gets no panel', () => {
    const p = page({ bodyLate: true });
    p.advance(15_000);   // the watchdog fires before the body exists: it waits for DOMContentLoaded
    p.started();         // …and the app starts meanwhile
    p.ready();
    expect(p.panel(), 'GONE no flash at paint time').toBeNull();
  });

  it('⭐ F2 FIRST MOMENT — errors before the panel are recorded and printed when it shows, a failed load included', () => {
    const p = page();
    p.fire('error', { message: 'boom' });
    p.fire('error', { target: { src: '/assets/index-abc123.js' } });   // a resource error: no message, its URL
    p.fire('unhandledrejection', { reason: { message: 'nope' } });
    p.advance(15_000);
    expect(p.lines(), 'FIRST MOMENT').toEqual(expect.arrayContaining([
      'heard before the panel:',
      '  window.onerror: boom',
      '  failed to load: /assets/index-abc123.js',
      '  unhandledrejection: nope',
    ]));
    p.fire('error', { message: 'later' });
    expect(p.lines(), 'FIRST MOMENT and after').toContain('window.onerror: later');
  });

  it('⭐ F2 FIRST MOMENT — the first 50 lines are kept and the rest counted (the boot\'s first error comes first)', () => {
    const p = page();
    for (let i = 0; i < 60; i++) p.fire('error', { message: `e${i}` });
    p.advance(15_000);
    const lines = p.lines();
    expect(lines, 'FIRST MOMENT the first kept').toContain('  window.onerror: e0');
    expect(lines).toContain('  window.onerror: e49');
    expect(lines).not.toContain('  window.onerror: e50');
    expect(lines, 'FIRST MOMENT the rest counted').toContain('  … and 10 more');
  });

  it('⭐ F2 SWDEBUG — ?swdebug paints at once and stays: it was asked for', () => {
    const p = page({ search: '?swdebug' });
    expect(p.panel(), 'SWDEBUG at once').not.toBeNull();
    p.started();
    p.advance(60_000);
    expect(p.panel(), 'SWDEBUG stays after the app starts').not.toBeNull();
  });

  it('⭐ F2 ES5 — the script stays ES5: it must run where the bundle can\'t', () => {
    const bare = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(bare, 'ES5 no arrow').not.toMatch(/=>/);
    expect(bare, 'ES5 no template').not.toMatch(/`/);
    expect(bare, 'ES5 no let/const/class').not.toMatch(/\b(let|const|class)\b/);
    expect(SCRIPT, 'ES5 it leaves the flag alone: e2e seeds and main.tsx own it').not.toMatch(/__APP_BOOTED\s*=/);
  });
});
