import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ViewerWhatIf } from '../viewerWhatIf';
import { NumberInput } from '../NumberInput';
import { SliderInput } from '../SliderInput';
import { Toggle } from '../Toggle';

/**
 * ⚠ BL48 (V4 B) — a viewer's shared inputs lock everywhere but the Almanac's what-ifs: `AlmanacView` lifts the lock
 * around its faces (`ViewerWhatIf` true), and FireFace — whose inputs save — puts it back (false). Rendered to static
 * markup, as goalTile.test.tsx renders the tile (the repo has no DOM harness) — over a mocked store, since a server
 * render reads zustand's initial state; where the provider sits is read off the source. e2e/viewerAlmanac.spec.ts's WHAT-IF, MINING and PARITY pin it on screen. Each assertion carries its tag.
 */
const mock = vi.hoisted(() => ({ state: { viewerMode: false } }));
vi.mock('../../../store/useStore', () => ({ useStore: (sel: (s: typeof mock.state) => unknown) => sel(mock.state) }));

const noop = () => {};
const field = () => <NumberInput value={1} onChange={noop} save="live" />;
const slider = () => <SliderInput label="L" value={1} onChange={noop} min={0} max={2} step={1} display="1" />;
const toggle = () => <Toggle value={false} onChange={noop} />;
const locked = (html: string): boolean => /\b(readonly|disabled)=""/.test(html);
const as = (viewerMode: boolean, el: () => ReactElement, provide?: boolean[]) => {
  mock.state.viewerMode = viewerMode;
  let node: ReactElement = el();
  for (const v of [...(provide ?? [])].reverse()) node = <ViewerWhatIf.Provider value={v}>{node}</ViewerWhatIf.Provider>;
  return renderToStaticMarkup(node);
};

describe('⭐ the lock', () => {
  it('⭐ LOCK — a viewer\'s field, slider and switch lock outside the Almanac; the owner\'s never', () => {
    for (const [name, el] of [['NumberInput', field], ['SliderInput', slider], ['Toggle', toggle]] as const) {
      expect(locked(as(true, el)), `LOCK ${name}: a viewer, no what-if place`).toBe(true);
      expect(locked(as(false, el)), `LOCK ${name}: the owner`).toBe(false);
    }
  });

  it('⭐ WHAT-IF — inside the Almanac\'s what-ifs a viewer\'s inputs are live; inside FIRE\'s face, locked again', () => {
    for (const [name, el] of [['NumberInput', field], ['SliderInput', slider], ['Toggle', toggle]] as const) {
      expect(locked(as(true, el, [true])), `WHAT-IF ${name}: the hub lifts it`).toBe(false);
      expect(locked(as(true, el, [true, false])), `WHAT-IF ${name}: FIRE puts it back`).toBe(true);
      expect(locked(as(false, el, [true, false])), `WHAT-IF ${name}: never the owner's`).toBe(false);
    }
  });
});

describe('⭐ where the lock lifts (read off the source)', () => {
  const ROOT = process.cwd();
  const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  const SRC = walk(join(ROOT, 'src')).map((p) => ({ path: p.slice(ROOT.length + 1).split('\\').join('/'), code: strip(readFileSync(p, 'utf8')) }));

  it('⭐ ONLY THERE — the provider sits in the hub (true) and FIRE\'s face (false), nowhere else', () => {
    const sites = SRC.flatMap(({ path, code }) => [...code.matchAll(/<ViewerWhatIf\.Provider value=\{(true|false)\}>/g)].map((m) => `${path}:${m[1]}`));
    expect(sites.sort(), 'ONLY THERE').toEqual(['src/components/Almanac/AlmanacView.tsx:true', 'src/components/Almanac/FireFace.tsx:false']);
  });

  it('⭐ ONE READ — the three shared inputs ask `useViewerLocked`, and read `viewerMode` no other way', () => {
    for (const f of ['NumberInput', 'SliderInput', 'Toggle']) {
      const code = SRC.find((s) => s.path === `src/components/ui/${f}.tsx`)!.code;
      expect(code, `ONE READ ${f}`).toContain('const viewerLocked = useViewerLocked();');
      expect(code, `ONE READ ${f}: no viewerMode of its own`).not.toMatch(/viewerMode/);
    }
  });
});
